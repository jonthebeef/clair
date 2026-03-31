import { $ } from 'bun'

export type CastMessage = {
  id: string
  author: string
  content: string
  timestamp: string
}

export function parseCastOutput(output: string): CastMessage[] {
  const lines = output.trim().split('\n').filter(Boolean)
  return lines
    .map(line => {
      const parts = line.split(' | ')
      if (parts.length < 4) return null
      return {
        id: parts[0].trim(),
        author: parts[1].trim(),
        timestamp: parts[2].trim(),
        content: parts.slice(3).join(' | ').trim(),
      }
    })
    .filter((m): m is CastMessage => m !== null)
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
