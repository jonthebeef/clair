import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ClairConfig } from '../config/settings'

export type CastApiConfig = { apiUrl: string; token: string }

export function loadCastApiConfig(): CastApiConfig | null {
  try {
    const rcPath = process.env.CLAIR_CASTRC ?? join(homedir(), '.clair-castrc')
    return JSON.parse(readFileSync(rcPath, 'utf-8'))
  } catch {
    return null
  }
}

export function createCastApi(castConfig: CastApiConfig | null, config: ClairConfig, noCast?: boolean) {
  async function post(content: string, branchId?: string): Promise<void> {
    if (!castConfig) return
    await fetch(`${castConfig.apiUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${castConfig.token}`,
      },
      body: JSON.stringify({
        content,
        branch_id: branchId ?? config.cast.privateBranch,
      }),
    })
  }

  async function forward(text: string): Promise<void> {
    if (!castConfig || noCast || !config.cast.forwardProactive) return
    if (text.length < 10) return
    try {
      await post(text)
    } catch {
      // Non-critical
    }
  }

  return { post, forward }
}
