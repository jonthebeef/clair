/**
 * Status line — persistent bottom-of-terminal bar showing Clair's state.
 *
 * Sets a scroll region (rows 1..N-1) so console.log output never touches
 * the last row. The status line renders on row N with inverted colors.
 */

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'

export type StatusState = {
  mode: 'idle' | 'sleeping' | 'working' | 'listening'
  sleepUntil?: string  // e.g. "14:35"
  focused?: boolean
  castConnected?: boolean
  lastActivity?: string // brief description
}

export type StatusLine = {
  update(partial: Partial<StatusState>): void
  render(): void
  clear(): void
  getState(): StatusState
}

export function createStatusLine(): StatusLine {
  let state: StatusState = {
    mode: 'idle',
    castConnected: false,
  }
  const enabled = process.stdout.isTTY ?? false
  let scrollRegionSet = false

  function ensureScrollRegion() {
    if (!enabled || scrollRegionSet) return
    const rows = process.stdout.rows || 24
    // Set scroll region to rows 1..(N-1), leaving the last row for status
    process.stdout.write(`\x1b[1;${rows - 1}r`)
    // Move cursor to top of scroll region
    process.stdout.write(`\x1b[${rows - 1};1H`)
    scrollRegionSet = true

    // Re-set scroll region on terminal resize
    process.stdout.on('resize', () => {
      const newRows = process.stdout.rows || 24
      process.stdout.write(`\x1b[1;${newRows - 1}r`)
      render()
    })
  }

  function formatLine(): string {
    const parts: string[] = []

    // Mode indicator
    switch (state.mode) {
      case 'sleeping': {
        const until = state.sleepUntil ? ` until ${state.sleepUntil}` : ''
        parts.push(`${DIM}zzz sleeping${until}${RESET}`)
        break
      }
      case 'working':
        parts.push(`${YELLOW}● working${RESET}`)
        break
      case 'listening':
        parts.push(`${GREEN}● listening${RESET}`)
        break
      case 'idle':
        parts.push(`${DIM}○ idle${RESET}`)
        break
    }

    // Focus
    if (state.focused !== undefined) {
      parts.push(state.focused ? `${DIM}[focused]${RESET}` : `${DIM}[away]${RESET}`)
    }

    // Cast
    if (state.castConnected) {
      parts.push(`${CYAN}cast${RESET}`)
    }

    // Last activity
    if (state.lastActivity) {
      parts.push(`${DIM}${state.lastActivity}${RESET}`)
    }

    return parts.join('  ')
  }

  function render() {
    if (!enabled) return
    ensureScrollRegion()
    const rows = process.stdout.rows || 24
    const cols = process.stdout.columns || 80
    const line = formatLine()
    // Strip ANSI for length calculation
    const plainLen = line.replace(/\x1b\[[0-9;]*m/g, '').length
    const padded = plainLen < cols ? line + ' '.repeat(cols - plainLen) : line

    // Save cursor, move to last row, write inverted, restore cursor
    process.stdout.write(
      `\x1b[s\x1b[${rows};1H\x1b[7m${padded}\x1b[0m\x1b[u`
    )
  }

  return {
    update(partial: Partial<StatusState>) {
      state = { ...state, ...partial }
      render()
    },

    render,

    clear() {
      if (!enabled) return
      const rows = process.stdout.rows || 24
      const cols = process.stdout.columns || 80
      // Clear the status row
      process.stdout.write(`\x1b[s\x1b[${rows};1H${' '.repeat(cols)}\x1b[u`)
      // Reset scroll region to full terminal
      process.stdout.write(`\x1b[r`)
      scrollRegionSet = false
    },

    getState() {
      return { ...state }
    },
  }
}

/** Format a timestamp as HH:MM for sleep display */
export function formatWakeTime(ms: number): string {
  const wake = new Date(Date.now() + ms)
  const h = String(wake.getHours()).padStart(2, '0')
  const m = String(wake.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}
