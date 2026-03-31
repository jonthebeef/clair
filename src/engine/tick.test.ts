import { describe, test, expect } from 'bun:test'
import { formatTick, parseSleepDuration } from './tick'

describe('formatTick', () => {
  test('wraps ISO timestamp in tick tags', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'))
    expect(tick).toBe('<tick>2026-03-31T14:30:00</tick>')
  })

  test('includes terminal focus when provided', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'), { terminalFocused: true })
    expect(tick).toContain('terminalFocus="true"')
  })

  test('includes pending count when provided', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'), { pendingMessages: 3 })
    expect(tick).toContain('pending="3"')
  })
})

describe('parseSleepDuration', () => {
  test('parses seconds', () => {
    expect(parseSleepDuration('30s')).toBe(30_000)
    expect(parseSleepDuration('30')).toBe(30_000)
  })

  test('parses minutes', () => {
    expect(parseSleepDuration('5m')).toBe(300_000)
  })

  test('returns default for invalid input', () => {
    expect(parseSleepDuration('')).toBe(30_000)
    expect(parseSleepDuration('abc')).toBe(30_000)
  })

  test('caps at 30 minutes', () => {
    expect(parseSleepDuration('60m')).toBe(1_800_000)
  })
})
