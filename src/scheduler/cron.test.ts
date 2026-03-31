import { describe, test, expect } from 'bun:test'
import { nextCronTime, addJitter } from './cron'

describe('nextCronTime', () => {
  test('every-minute cron fires within 60s', () => {
    const now = new Date('2026-03-31T14:00:00')
    const next = nextCronTime('* * * * *', now)
    expect(next).toBeDefined()
    const diffMs = next!.getTime() - now.getTime()
    expect(diffMs).toBeLessThanOrEqual(60_000)
    expect(diffMs).toBeGreaterThan(0)
  })

  test('returns null for invalid cron expression', () => {
    const next = nextCronTime('not a cron', new Date())
    expect(next).toBeNull()
  })

  test('specific minute fires at correct time', () => {
    const now = new Date('2026-03-31T14:00:00')
    const next = nextCronTime('30 * * * *', now)
    expect(next).toBeDefined()
    expect(next!.getMinutes()).toBe(30)
  })

  test('comma-separated values work', () => {
    const now = new Date('2026-03-31T14:00:00')
    const next = nextCronTime('0,15,30,45 * * * *', now)
    expect(next).toBeDefined()
    expect(next!.getMinutes()).toBe(15)
  })
})

describe('addJitter', () => {
  test('adds 1-30s of jitter', () => {
    const base = new Date('2026-03-31T14:00:00')
    const jittered = addJitter(base)
    const diffMs = jittered.getTime() - base.getTime()
    expect(diffMs).toBeGreaterThanOrEqual(1000)
    expect(diffMs).toBeLessThanOrEqual(30_000)
  })
})
