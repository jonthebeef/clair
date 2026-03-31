const DEFAULT_TICK_MS = 30_000
const MAX_SLEEP_MS = 30 * 60 * 1000

export type TickContext = {
  terminalFocused?: boolean
  pendingMessages?: number
}

export function formatTick(now: Date, ctx?: TickContext): string {
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`

  let attrs = ''
  if (ctx?.terminalFocused !== undefined) {
    attrs += ` terminalFocus="${ctx.terminalFocused}"`
  }
  if (ctx?.pendingMessages !== undefined && ctx.pendingMessages > 0) {
    attrs += ` pending="${ctx.pendingMessages}"`
  }
  return `<tick${attrs}>${iso}</tick>`
}

import type { MessageQueue } from './queue'

export type TickLoop = {
  start(): void
  stop(): void
  setSleepDuration(ms: number): void
  wake(): void
}

export function createTickLoop(
  queue: MessageQueue,
  opts?: { initialIntervalMs?: number },
): TickLoop {
  let intervalMs = opts?.initialIntervalMs ?? DEFAULT_TICK_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  function scheduleTick() {
    if (!running) return
    timer = setTimeout(() => {
      const tick = formatTick(new Date(), {
        pendingMessages: queue.hasMessages() ? undefined : 0,
      })
      queue.enqueue({ type: 'tick', content: tick })
      scheduleTick()
    }, intervalMs)
  }

  return {
    start() {
      running = true
      const tick = formatTick(new Date())
      queue.enqueue({ type: 'tick', content: tick })
      scheduleTick()
    },

    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },

    setSleepDuration(ms: number) {
      intervalMs = Math.min(ms, MAX_SLEEP_MS)
      if (timer) {
        clearTimeout(timer)
        scheduleTick()
      }
    },

    wake() {
      if (timer) {
        clearTimeout(timer)
        scheduleTick()
      }
    },
  }
}

export function parseSleepDuration(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_TICK_MS

  const match = trimmed.match(/^(\d+)(m|s)?$/)
  if (!match) return DEFAULT_TICK_MS

  const value = parseInt(match[1], 10)
  const unit = match[2] ?? 's'

  const ms = unit === 'm' ? value * 60_000 : value * 1_000
  return Math.min(ms, MAX_SLEEP_MS)
}
