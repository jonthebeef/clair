import { describe, test, expect } from 'bun:test'
import {
  shortRequestId,
  PERMISSION_REPLY_RE,
  createPermissionCallbacks,
} from './permissions'

describe('shortRequestId', () => {
  test('returns 5-letter string', () => {
    const id = shortRequestId('toolu_abc123')
    expect(id).toHaveLength(5)
    expect(id).toMatch(/^[a-km-z]{5}$/)
  })

  test('is deterministic', () => {
    const a = shortRequestId('toolu_abc123')
    const b = shortRequestId('toolu_abc123')
    expect(a).toBe(b)
  })

  test('never contains "l"', () => {
    for (let i = 0; i < 100; i++) {
      const id = shortRequestId(`toolu_test_${i}`)
      expect(id).not.toContain('l')
    }
  })

  test('avoids profanity', () => {
    for (let i = 0; i < 200; i++) {
      const id = shortRequestId(`toolu_profanity_${i}`)
      expect(id).toHaveLength(5)
      expect(id).toMatch(/^[a-km-z]{5}$/)
    }
  })
})

describe('PERMISSION_REPLY_RE', () => {
  test('matches "yes xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('yes tbxkq')).toBe(true)
  })

  test('matches "no xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('no tbxkq')).toBe(true)
  })

  test('matches "y xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('y tbxkq')).toBe(true)
  })

  test('case insensitive', () => {
    expect(PERMISSION_REPLY_RE.test('YES TBXKQ')).toBe(true)
  })

  test('rejects bare yes/no', () => {
    expect(PERMISSION_REPLY_RE.test('yes')).toBe(false)
  })

  test('rejects wrong length codes', () => {
    expect(PERMISSION_REPLY_RE.test('yes abcd')).toBe(false)
    expect(PERMISSION_REPLY_RE.test('yes abcdef')).toBe(false)
  })
})

describe('createPermissionCallbacks', () => {
  test('resolve returns true for pending request', () => {
    const cb = createPermissionCallbacks()
    let result: { behavior: string; fromServer: string } | null = null
    cb.onResponse('abcde', r => { result = r })
    const resolved = cb.resolve('abcde', 'allow', 'cast:main')
    expect(resolved).toBe(true)
    expect(result?.behavior).toBe('allow')
    expect(result?.fromServer).toBe('cast:main')
  })

  test('resolve returns false for unknown request', () => {
    const cb = createPermissionCallbacks()
    expect(cb.resolve('zzzzz', 'allow', 'cast:main')).toBe(false)
  })

  test('unsubscribe prevents resolution', () => {
    const cb = createPermissionCallbacks()
    let called = false
    const unsub = cb.onResponse('abcde', () => { called = true })
    unsub()
    cb.resolve('abcde', 'allow', 'cast:main')
    expect(called).toBe(false)
  })

  test('case insensitive matching', () => {
    const cb = createPermissionCallbacks()
    let result: { behavior: string } | null = null
    cb.onResponse('ABCDE', r => { result = r })
    expect(cb.resolve('abcde', 'deny', 'cast:main')).toBe(true)
    expect(result?.behavior).toBe('deny')
  })
})
