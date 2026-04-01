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

export function loadSession(customPath?: string): SessionInfo | null {
  const path = customPath ?? SESSION_PATH
  try {
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (!data.sessionId) return null
    return data
  } catch {
    return null
  }
}

export function saveSession(info: SessionInfo, customPath?: string): void {
  const path = customPath ?? SESSION_PATH
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(info, null, 2) + '\n')
}

export function clearSession(customPath?: string): void {
  const path = customPath ?? SESSION_PATH
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Non-critical
  }
}
