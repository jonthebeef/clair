import { describe, test, expect, beforeEach } from 'bun:test'
import { existsSync, unlinkSync } from 'fs'
import { loadSession, saveSession, clearSession, type SessionInfo } from './session'

const TEST_PATH = '/tmp/clair-test-session.json'

describe('session persistence', () => {
  beforeEach(() => {
    try { unlinkSync(TEST_PATH) } catch {}
  })

  test('loadSession returns null when no file', () => {
    expect(loadSession()).toBeNull()
  })

  test('saveSession and loadSession roundtrip', () => {
    const info: SessionInfo = {
      sessionId: 'abc-123',
      startedAt: '2026-04-01T00:00:00Z',
      lastActivity: '2026-04-01T01:00:00Z',
    }
    saveSession(info)
    const loaded = loadSession()
    expect(loaded).not.toBeNull()
    expect(loaded!.sessionId).toBe('abc-123')
  })

  test('clearSession removes the file', () => {
    saveSession({
      sessionId: 'test',
      startedAt: '2026-04-01T00:00:00Z',
      lastActivity: '2026-04-01T00:00:00Z',
    })
    clearSession()
    expect(loadSession()).toBeNull()
  })
})
