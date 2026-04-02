import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CAST_CONFIG_PATH = process.env.CLAIR_CASTRC ?? join(homedir(), '.clair-castrc')

let _cached: { apiUrl: string; token: string } | null = null

export function loadCastConfig(): { apiUrl: string; token: string } {
  _cached ??= JSON.parse(readFileSync(CAST_CONFIG_PATH, 'utf-8'))
  return _cached
}
