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
