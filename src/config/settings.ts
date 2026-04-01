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
  triggers: {
    enabled: boolean
    port: number
    secret?: string
  }
}

const CONFIG_PATH = join(homedir(), '.clair', 'config.json')

const DEFAULTS: ClairConfig = {
  tickIntervalMs: 30_000,
  model: 'haiku',
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
  triggers: {
    enabled: false,
    port: 4117,
  },
}

export function loadConfig(customPath?: string): ClairConfig {
  const configPath = customPath ?? CONFIG_PATH
  try {
    if (!existsSync(configPath)) {
      // First run — write defaults so the user has something to edit
      ensureConfigExists(configPath)
      return DEFAULTS
    }
    const text = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(text)
    return {
      ...DEFAULTS,
      ...parsed,
      cast: { ...DEFAULTS.cast, ...parsed.cast },
      scheduler: { ...DEFAULTS.scheduler, ...parsed.scheduler },
      triggers: { ...DEFAULTS.triggers, ...parsed.triggers },
    }
  } catch {
    return DEFAULTS
  }
}

function ensureConfigExists(configPath: string): void {
  try {
    const dir = dirname(configPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(configPath, JSON.stringify(DEFAULTS, null, 2) + '\n')
  } catch {
    // Non-critical — defaults still work
  }
}

export function saveConfig(config: ClairConfig, customPath?: string): void {
  const configPath = customPath ?? CONFIG_PATH
  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
