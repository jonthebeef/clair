import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type CastMessage = {
  id: string
  author: string
  authorId?: string // Cast user ID (for self-filtering)
  content: string
  timestamp: string
  threadId?: string // parent message ID if this is a thread reply
  branch?: string // which branch this message came from
}

// --- API-based polling (uses Clair's own token) ---

const CAST_CONFIG_PATH = process.env.CLAIR_CASTRC ?? join(homedir(), '.clair-castrc')

function loadCastConfig(): { apiUrl: string; token: string } {
  const raw = readFileSync(CAST_CONFIG_PATH, 'utf-8')
  return JSON.parse(raw)
}

async function castApiFetch(path: string): Promise<unknown> {
  const config = loadCastConfig()
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!res.ok) throw new Error(`Cast API ${res.status}`)
  return res.json()
}

async function markNotificationsRead(): Promise<void> {
  const config = loadCastConfig()
  await fetch(`${config.apiUrl}/notifications/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
  })
}

type ApiNotification = {
  id: string
  type: string
  message_id: string
  actor_id: string
  actor_name: string
  message_preview: string
  message_parent_id: string | null
  branch_id: string | null
  branch_name: string | null
  created_at: string
  read: number
}

type ApiBranchMessage = {
  id: string
  author_id: string
  display_name: string
  content: string
  created_at: string
  parent_id: string | null
  branch_id: string | null
}

// --- CLI-based parsing (kept for branch polling which uses your CLI) ---

export function parseCastOutput(output: string): CastMessage[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const lines = clean.split('\n')
  const messages: CastMessage[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const idMatch = line.match(/\s([a-z0-9]+-[a-z0-9]+)\s*$/)
    if (idMatch) {
      const id = idMatch[1]
      const trimmed = line.trim()

      let author = 'unknown'
      const pipeIdx = trimmed.indexOf(' | ')
      if (pipeIdx > 0) {
        author = extractAuthorFromRaw(output, id)
      }

      const tsMatch = line.match(/(\d+[smh]\s+ago|\d+\s+\w+\s+ago|just now)\s+[a-z0-9]+-/)
      const timestamp = tsMatch ? tsMatch[1] : ''

      const contentLines: string[] = []
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (next.match(/^\s{2,}\S/)) {
          contentLines.push(next.trim())
          i++
        } else {
          break
        }
      }

      if (contentLines.length > 0) {
        messages.push({ id, author, content: contentLines.join('\n'), timestamp })
      }
    } else {
      i++
    }
  }

  return messages
}

function extractAuthorFromRaw(rawOutput: string, messageId: string): string {
  const lines = rawOutput.split('\n')
  for (const line of lines) {
    if (!line.includes(messageId)) continue
    const boldMatch = line.match(/\x1b\[1m(.+?)\x1b\[0m/)
    if (boldMatch) return boldMatch[1].trim()
  }
  return 'unknown'
}

export function diffMessages(
  current: CastMessage[],
  seenIds: Set<string>,
): CastMessage[] {
  return current.filter(m => !seenIds.has(m.id))
}

export type CastPoller = {
  start(): void
  stop(): void
  onNewMessages(handler: (messages: CastMessage[]) => void): void
  trackThread(parentId: string, branch?: string): void
}

export function createCastPoller(opts: {
  branches: string[]
  intervalMs: number
  castPath?: string
  selfUsername?: string // filter out messages from this user (prevent feedback loops)
}): CastPoller {
  const seenIds = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let handler: ((messages: CastMessage[]) => void) | null = null

  const seededBranches = new Set<string>()

  async function pollBranch() {
    for (const branch of opts.branches) {
      try {
        const data = await castApiFetch(`/branches/${branch}`) as {
          messages: ApiBranchMessage[]
        }

        const messages: CastMessage[] = data.messages.map(m => ({
          id: m.id,
          author: m.display_name ?? m.author_id,
          authorId: m.author_id,
          content: m.content,
          timestamp: m.created_at,
          branch,
        }))

        if (!seededBranches.has(branch)) {
          for (const msg of messages) seenIds.add(msg.id)
          seededBranches.add(branch)
          continue
        }

        const newMsgs = diffMessages(messages, seenIds)
          .filter(m => !opts.selfUsername || m.authorId !== opts.selfUsername)
        for (const msg of messages) seenIds.add(msg.id)
        if (newMsgs.length > 0 && handler) {
          handler(newMsgs)
        }
      } catch (err) {
        if (process.env.CLAIR_DEBUG) console.error(`[poller] branch ${branch} error:`, err)
      }
    }
  }

  let notificationsSeeded = false

  async function pollNotifications() {
    try {
      const data = await castApiFetch('/notifications') as {
        notifications: ApiNotification[]
        unread_count: number
      }

      if (!notificationsSeeded) {
        // First poll: seed existing notification message IDs without emitting
        for (const notif of data.notifications) {
          seenIds.add(notif.message_id)
        }
        notificationsSeeded = true
        return
      }

      const newMessages: CastMessage[] = []

      for (const notif of data.notifications) {
        if (notif.actor_id === opts.selfUsername) continue
        if (notif.type === 'reaction') continue
        if (seenIds.has(notif.message_id)) continue

        seenIds.add(notif.message_id)

        newMessages.push({
          id: notif.message_id,
          author: notif.actor_name,
          content: notif.message_preview,
          timestamp: notif.created_at,
          threadId: notif.message_parent_id ?? undefined,
          branch: notif.branch_id ?? undefined,
        })
      }

      if (newMessages.length > 0 && handler) {
        handler(newMessages)
      }
    } catch (err) {
      if (process.env.CLAIR_DEBUG) console.error('[poller] notifications error:', err)
    }
  }

  // --- Thread polling: watch threads Clair has replied to ---

  const trackedThreads = new Set<string>()
  const threadBranches = new Map<string, string>() // parentId → branch

  async function pollThreads() {
    for (const parentId of trackedThreads) {
      try {
        const data = await castApiFetch(`/threads/${parentId}`) as {
          message: ApiBranchMessage
          replies: ApiBranchMessage[]
        }

        const branch = threadBranches.get(parentId)
        const newReplies: CastMessage[] = []

        for (const r of data.replies) {
          if (seenIds.has(r.id)) continue
          if (opts.selfUsername && r.author_id === opts.selfUsername) continue
          seenIds.add(r.id)
          newReplies.push({
            id: r.id,
            author: r.display_name ?? r.author_id,
            authorId: r.author_id,
            content: r.content,
            timestamp: r.created_at,
            threadId: parentId,
            branch,
          })
        }

        if (newReplies.length > 0 && handler) {
          handler(newReplies)
        }
      } catch {
        // Thread may have been deleted
      }
    }
  }

  async function poll() {
    await pollBranch()
    await pollNotifications()
    await pollThreads()
  }

  return {
    start() {
      poll()
      timer = setInterval(poll, opts.intervalMs)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    onNewMessages(h) {
      handler = h
    },
    trackThread(parentId: string, branch?: string) {
      trackedThreads.add(parentId)
      if (branch) threadBranches.set(parentId, branch)
    },
  }
}
