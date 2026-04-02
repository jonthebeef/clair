import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const CAST_CONFIG_PATH = process.env.CLAIR_CASTRC ?? join(homedir(), '.clair-castrc')

export function loadCastConfig(): { apiUrl: string; token: string } {
  const raw = readFileSync(CAST_CONFIG_PATH, 'utf-8')
  return JSON.parse(raw)
}
