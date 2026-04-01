/**
 * Session persistence — save/restore Claude conversation session IDs.
 * Allows Clair to resume context after restarts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const SESSION_PATH = join(homedir(), '.clair', 'session.json')

export type SessionInfo = {
  sessionId: string
  startedAt: string
  lastActivity: string
}

export function loadSession(): SessionInfo | null {
  try {
    if (!existsSync(SESSION_PATH)) return null
    const data = JSON.parse(readFileSync(SESSION_PATH, 'utf-8'))
    if (!data.sessionId) return null
    return data
  } catch {
    return null
  }
}

export function saveSession(info: SessionInfo): void {
  const dir = dirname(SESSION_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SESSION_PATH, JSON.stringify(info, null, 2) + '\n')
}

export function clearSession(): void {
  try {
    if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH)
  } catch {
    // Non-critical
  }
}
