/**
 * Permission relay — posts permission requests to Cast and matches
 * user replies back. Bridges Claude's permission system with Cast
 * so the user can approve/deny from their phone.
 *
 * Flow:
 * 1. Claude needs permission for a tool → emits permission request
 * 2. Relay generates a 5-letter code, posts to Cast private branch
 * 3. User replies "yes tbxkq" or "no tbxkq" on Cast
 * 4. Poller picks up the reply, relay matches the code
 * 5. Permission response is sent back to Claude via stdin
 */

import { shortRequestId, createPermissionCallbacks } from './permissions'
import type { PermissionCallbacks } from './permissions'

export type CastApi = {
  post(content: string, branchId?: string): Promise<void>
}

export type PermissionRelay = {
  callbacks: PermissionCallbacks
  requestPermission(opts: {
    toolName: string
    toolUseId: string
    inputPreview?: string
    branch: string
  }): Promise<{ code: string; behavior: Promise<'allow' | 'deny'> }>
}

export function createPermissionRelay(castApi: CastApi): PermissionRelay {
  const callbacks = createPermissionCallbacks()

  return {
    callbacks,

    async requestPermission({ toolName, toolUseId, inputPreview, branch }) {
      const code = shortRequestId(toolUseId)

      // Post the permission request to Cast
      const preview = inputPreview ? `\n> ${inputPreview}` : ''
      const message = `🔐 **Permission needed**: \`${toolName}\`${preview}\n\nReply: **yes ${code}** or **no ${code}**`

      await castApi.post(message, branch)

      // Return the code and a promise that resolves when the user replies
      const behavior = new Promise<'allow' | 'deny'>((resolve) => {
        // Auto-timeout after 5 minutes → deny
        const timer = setTimeout(() => {
          unsub()
          resolve('deny')
        }, 5 * 60 * 1000)

        const unsub = callbacks.onResponse(code, (response) => {
          clearTimeout(timer)
          resolve(response.behavior)
        })
      })

      return { code, behavior }
    },
  }
}
