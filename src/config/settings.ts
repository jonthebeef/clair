import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

export type ClairConfig = {
  tickIntervalMs: number
  model?: string
  cast: {
    branches: string[]
    pollIntervalMs: number
    privateBranch: string
    forwardProactive: boolean
    mentionOnlyBranches: string[] // branches where Clair only responds to @clair mentions
    username: string // Clair's Cast username for @mention detection
  }
  scheduler: {
    maxJobs: number
  }
}

const CONFIG_PATH = join(homedir(), '.clair', 'config.json')

const DEFAULTS: ClairConfig = {
  tickIntervalMs: 30_000,
  cast: {
    branches: ['clair-private'],
    pollIntervalMs: 3_000,
    privateBranch: 'clair-private',
    forwardProactive: true,
    mentionOnlyBranches: [], // e.g. ['main', 'dev'] — only respond when @clair
    username: 'clair',
  },
  scheduler: {
    maxJobs: 50,
  },
}

export function loadConfig(): ClairConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return DEFAULTS
    const text = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(text)
    return {
      ...DEFAULTS,
      ...parsed,
      cast: { ...DEFAULTS.cast, ...parsed.cast },
      scheduler: { ...DEFAULTS.scheduler, ...parsed.scheduler },
    }
  } catch {
    return DEFAULTS
  }
}

export function saveConfig(config: ClairConfig): void {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
