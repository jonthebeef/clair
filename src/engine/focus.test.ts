import { describe, test, expect } from 'bun:test'
import { isTerminalFocused } from './focus'

describe('isTerminalFocused', () => {
  test('returns a boolean', async () => {
    const result = await isTerminalFocused()
    expect(typeof result).toBe('boolean')
  })

  test('caches result on repeated calls', async () => {
    const a = await isTerminalFocused()
    const b = await isTerminalFocused()
    expect(a).toBe(b)
  })
})
