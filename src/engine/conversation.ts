import { spawn, type Subprocess } from 'bun'

export type ClaudeOptions = {
  systemPrompt: string
  model?: string
  skipPermissions?: boolean
  allowedTools?: string[]
  mcpConfig?: string
  additionalArgs?: string[]
  resumeSessionId?: string // resume a previous session
}

export function buildClaudeArgs(opts: ClaudeOptions): string[] {
  const args = [
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--system-prompt', opts.systemPrompt,
  ]
  if (opts.model) args.push('--model', opts.model)
  if (opts.skipPermissions) args.push('--dangerously-skip-permissions')
  if (opts.allowedTools?.length) {
    args.push('--allowedTools', opts.allowedTools.join(','))
  }
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig)
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)
  if (opts.additionalArgs) args.push(...opts.additionalArgs)
  return args
}

export type StreamMessage = {
  type: string
  message?: {
    role: string
    content: unknown
  }
  [key: string]: unknown
}

export function parseStreamMessage(line: string): StreamMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function formatUserMessage(content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
  })
}

export type ConversationEngine = {
  send(content: string): void
  onMessage(handler: (msg: StreamMessage) => void): void
  start(): Promise<void>
  stop(): void
  restart(overrides: { model?: string; resumeSessionId?: string }): Promise<void>
  isRunning(): boolean
  getModel(): string | undefined
}

export function createConversationEngine(
  opts: ClaudeOptions,
): ConversationEngine {
  let proc: Subprocess | null = null
  let messageHandler: ((msg: StreamMessage) => void) | null = null
  let currentOpts = { ...opts }

  function spawnProcess() {
    const args = buildClaudeArgs(currentOpts)
    proc = spawn(['claude', ...args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    })

    const stdout = proc.stdout as ReadableStream<Uint8Array>
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const msg = parseStreamMessage(line)
            if (msg && messageHandler) messageHandler(msg)
          }
        }
      } catch {
        // Process exited
      }
    }

    readLoop().catch(() => {})
  }

  return {
    send(content: string) {
      if (!proc?.stdin) throw new Error('Claude process not running')
      const stdin = proc.stdin as unknown as { write(data: string | Uint8Array): number; flush(): void }
      stdin.write(formatUserMessage(content) + '\n')
      stdin.flush()
    },

    onMessage(handler) {
      messageHandler = handler
    },

    async start() {
      spawnProcess()
    },

    stop() {
      proc?.kill()
      proc = null
    },

    async restart(overrides) {
      // Kill current process
      proc?.kill()
      proc = null

      // Wait a beat for process cleanup
      await new Promise(r => setTimeout(r, 500))

      // Update options
      if (overrides.model) currentOpts.model = overrides.model
      if (overrides.resumeSessionId) currentOpts.resumeSessionId = overrides.resumeSessionId

      // Respawn
      spawnProcess()
    },

    isRunning() {
      return proc !== null
    },

    getModel() {
      return currentOpts.model
    },
  }
}
