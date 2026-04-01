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
  isRunning(): boolean
}

export function createConversationEngine(
  opts: ClaudeOptions,
): ConversationEngine {
  let proc: Subprocess | null = null
  let messageHandler: ((msg: StreamMessage) => void) | null = null

  return {
    send(content: string) {
      if (!proc?.stdin) throw new Error('Claude process not running')
      // Bun's spawn stdin is a FileSink, not a WritableStream
      const stdin = proc.stdin as unknown as { write(data: string | Uint8Array): number; flush(): void }
      stdin.write(formatUserMessage(content) + '\n')
      stdin.flush()
    },

    onMessage(handler) {
      messageHandler = handler
    },

    async start() {
      const args = buildClaudeArgs(opts)
      proc = spawn(['claude', ...args], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
      })

      // Bun's stdout is a ReadableStream<Uint8Array>
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
    },

    stop() {
      proc?.kill()
      proc = null
    },

    isRunning() {
      return proc !== null
    },
  }
}
