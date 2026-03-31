import { $ } from 'bun'

export type CastMessage = {
  id: string
  author: string
  content: string
  timestamp: string
}

/**
 * Parse Cast CLI branch output. Real format (with ANSI stripped):
 *
 *   Jon Grant  Product Leader | Strategist | Builder  just now  mnf4mcah-721o1r30
 *     hello from the other side
 *
 * Message ID is the last token on the author line (matches /^[a-z0-9-]+$/).
 * Content is on indented lines following the author line.
 * The first line is a branch header ("# clair-private") — skip it.
 */
export function parseCastOutput(output: string): CastMessage[] {
  // Strip ANSI escape codes
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const lines = clean.split('\n')
  const messages: CastMessage[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Look for lines with a message ID at the end (like "mnf4mcah-721o1r30")
    const idMatch = line.match(/\s([a-z0-9]+-[a-z0-9]+)\s*$/)
    if (idMatch) {
      const id = idMatch[1]
      // Author is the first bold/visible name on this line
      const authorMatch = line.trim().match(/^(.+?)\s{2,}/)
      const author = authorMatch ? authorMatch[1].trim() : 'unknown'
      // Timestamp: look for relative time patterns before the ID
      const tsMatch = line.match(/(\d+\s+\w+\s+ago|just now)\s+[a-z0-9]+-/)
      const timestamp = tsMatch ? tsMatch[1] : ''

      // Collect indented content lines that follow
      const contentLines: string[] = []
      i++
      while (i < lines.length) {
        const next = lines[i]
        // Content lines are indented (start with spaces) and non-empty
        if (next.match(/^\s{2,}\S/)) {
          contentLines.push(next.trim())
          i++
        } else {
          break
        }
      }

      if (contentLines.length > 0) {
        messages.push({
          id,
          author,
          content: contentLines.join('\n'),
          timestamp,
        })
      }
    } else {
      i++
    }
  }

  return messages
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
}

export function createCastPoller(opts: {
  branches: string[]
  intervalMs: number
  castPath?: string
}): CastPoller {
  const seenIds = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let handler: ((messages: CastMessage[]) => void) | null = null
  const castCmd = opts.castPath ?? 'cast'

  async function poll() {
    for (const branch of opts.branches) {
      try {
        const result = await $`${castCmd} branch ${branch}`.text()
        const messages = parseCastOutput(result)
        const newMsgs = diffMessages(messages, seenIds)
        for (const msg of messages) seenIds.add(msg.id)
        if (newMsgs.length > 0 && handler) {
          handler(newMsgs)
        }
      } catch {
        // Cast CLI failed — skip this poll cycle
      }
    }
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
  }
}
