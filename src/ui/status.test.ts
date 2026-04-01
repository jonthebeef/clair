import { describe, test, expect } from 'bun:test'
import { createStatusLine, formatWakeTime } from './status'

describe('createStatusLine', () => {
  test('starts in idle mode', () => {
    const status = createStatusLine()
    expect(status.getState().mode).toBe('idle')
  })

  test('updates state with partial', () => {
    const status = createStatusLine()
    status.update({ mode: 'sleeping', sleepUntil: '14:35' })
    const state = status.getState()
    expect(state.mode).toBe('sleeping')
    expect(state.sleepUntil).toBe('14:35')
  })

  test('preserves existing state on partial update', () => {
    const status = createStatusLine()
    status.update({ mode: 'working', castConnected: true })
    status.update({ lastActivity: 'reading file' })
    const state = status.getState()
    expect(state.mode).toBe('working')
    expect(state.castConnected).toBe(true)
    expect(state.lastActivity).toBe('reading file')
  })
})

describe('formatWakeTime', () => {
  test('returns HH:MM format', () => {
    const result = formatWakeTime(0)
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })
})
