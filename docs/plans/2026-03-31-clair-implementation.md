# Clair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an autonomous AI agent (KAIROS clone) that drives Claude Code, talks via Cast, runs scheduled tasks, and manages its own state.

**Architecture:** Bun/TypeScript CLI that spawns `claude` as a subprocess using `--print --input-format stream-json --output-format stream-json`. A tick loop injects periodic prompts. A Cast MCP server (stdio child process) handles bidirectional messaging. A cron scheduler fires durable tasks.

**Tech Stack:** Bun 1.3.6, TypeScript, `@modelcontextprotocol/sdk` for MCP, Cast CLI at `~/Desktop/cast/packages/cli`, Claude Code CLI.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `CLAUDE.md`

**Step 1: Initialize the project**

```bash
cd /Users/jongrant/Desktop/clair
```

Create `package.json`:
```json
{
  "name": "clair",
  "version": "0.1.0",
  "type": "module",
  "bin": { "clair": "./src/index.ts" },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun"]
  },
  "include": ["src"]
}
```

Create `src/index.ts`:
```typescript
#!/usr/bin/env bun
console.log('clair v0.1.0')
```

Create `CLAUDE.md`:
```markdown
# Clair

Autonomous AI agent — KAIROS clone. Bun/TypeScript.

## Dev commands
- `bun run start` — launch clair
- `bun test` — run tests

## Architecture
- `src/engine/` — conversation driver, tick loop, message queue
- `src/scheduler/` — cron-based task scheduling
- `src/channels/` — MCP host for channel servers
- `src/cast/` — Cast channel MCP server (wraps Cast CLI)
- `src/ui/` — terminal display
- `src/config/` — settings and system prompts

## Conventions
- No classes unless necessary — prefer functions and plain objects
- Types in the same file unless shared across modules
- Tests next to source: `foo.test.ts` beside `foo.ts`
```

**Step 2: Install dependencies**

Run: `bun install`
Expected: lockfile created, node_modules populated

**Step 3: Verify it runs**

Run: `bun run src/index.ts`
Expected: prints `clair v0.1.0`

**Step 4: Commit**

```bash
git add package.json tsconfig.json bun.lockb src/index.ts CLAUDE.md
git commit -m "chore: scaffold clair project"
```

---

### Task 2: Message Queue

The priority queue that all layers feed into. Foundation for everything else.

**Files:**
- Create: `src/engine/queue.ts`
- Create: `src/engine/queue.test.ts`

**Step 1: Write the failing test**

```typescript
// src/engine/queue.test.ts
import { describe, test, expect } from 'bun:test'
import { createMessageQueue, type QueueMessage } from './queue'

describe('MessageQueue', () => {
  test('dequeue returns undefined when empty', () => {
    const q = createMessageQueue()
    expect(q.dequeue()).toBeUndefined()
  })

  test('enqueue and dequeue in FIFO order', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'a' })
    q.enqueue({ type: 'tick', content: 'b' })
    expect(q.dequeue()?.content).toBe('a')
    expect(q.dequeue()?.content).toBe('b')
  })

  test('priority "next" jumps ahead of normal messages', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'normal' })
    q.enqueue({ type: 'channel', content: 'urgent', priority: 'next' })
    expect(q.dequeue()?.content).toBe('urgent')
    expect(q.dequeue()?.content).toBe('normal')
  })

  test('hasMessages reflects queue state', () => {
    const q = createMessageQueue()
    expect(q.hasMessages()).toBe(false)
    q.enqueue({ type: 'tick', content: 'a' })
    expect(q.hasMessages()).toBe(true)
    q.dequeue()
    expect(q.hasMessages()).toBe(false)
  })

  test('waitForMessage resolves when message enqueued', async () => {
    const q = createMessageQueue()
    const promise = q.waitForMessage()
    q.enqueue({ type: 'tick', content: 'wake' })
    const msg = await promise
    expect(msg.content).toBe('wake')
  })

  test('drain returns all messages and empties queue', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'a' })
    q.enqueue({ type: 'tick', content: 'b' })
    const all = q.drain()
    expect(all).toHaveLength(2)
    expect(q.hasMessages()).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/queue.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/engine/queue.ts
export type QueueMessage = {
  type: 'tick' | 'channel' | 'cron' | 'user'
  content: string
  priority?: 'normal' | 'next'
  meta?: Record<string, string>
}

type Waiter = (msg: QueueMessage) => void

export type MessageQueue = {
  enqueue(msg: QueueMessage): void
  dequeue(): QueueMessage | undefined
  hasMessages(): boolean
  waitForMessage(): Promise<QueueMessage>
  drain(): QueueMessage[]
}

export function createMessageQueue(): MessageQueue {
  const normal: QueueMessage[] = []
  const urgent: QueueMessage[] = []
  const waiters: Waiter[] = []

  return {
    enqueue(msg) {
      // If someone is waiting, resolve immediately
      if (waiters.length > 0) {
        const waiter = waiters.shift()!
        waiter(msg)
        return
      }
      if (msg.priority === 'next') {
        urgent.push(msg)
      } else {
        normal.push(msg)
      }
    },

    dequeue() {
      if (urgent.length > 0) return urgent.shift()
      return normal.shift()
    },

    hasMessages() {
      return urgent.length > 0 || normal.length > 0
    },

    waitForMessage() {
      // If there's already a message, return it
      const existing = this.dequeue()
      if (existing) return Promise.resolve(existing)
      // Otherwise wait
      return new Promise<QueueMessage>(resolve => {
        waiters.push(resolve)
      })
    },

    drain() {
      const all = [...urgent, ...normal]
      urgent.length = 0
      normal.length = 0
      return all
    },
  }
}
```

**Step 4: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/queue.test.ts`
Expected: 6 passing

**Step 5: Commit**

```bash
git add src/engine/queue.ts src/engine/queue.test.ts
git commit -m "feat: add priority message queue"
```

---

### Task 3: Conversation Engine

Drives `claude` as a subprocess using stream-json mode for bidirectional communication.

**Files:**
- Create: `src/engine/conversation.ts`
- Create: `src/engine/conversation.test.ts`

**Step 1: Write the failing test**

```typescript
// src/engine/conversation.test.ts
import { describe, test, expect } from 'bun:test'
import {
  buildClaudeArgs,
  parseStreamMessage,
  formatUserMessage,
} from './conversation'

describe('buildClaudeArgs', () => {
  test('builds default args for stream-json mode', () => {
    const args = buildClaudeArgs({ systemPrompt: 'You are Clair.' })
    expect(args).toContain('--print')
    expect(args).toContain('--input-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--system-prompt')
    expect(args).toContain('You are Clair.')
  })

  test('includes --dangerously-skip-permissions when set', () => {
    const args = buildClaudeArgs({
      systemPrompt: 'test',
      skipPermissions: true,
    })
    expect(args).toContain('--dangerously-skip-permissions')
  })

  test('includes --model when set', () => {
    const args = buildClaudeArgs({ systemPrompt: 'test', model: 'sonnet' })
    expect(args).toContain('--model')
    expect(args).toContain('sonnet')
  })
})

describe('parseStreamMessage', () => {
  test('parses assistant text message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })
    const parsed = parseStreamMessage(line)
    expect(parsed?.type).toBe('assistant')
  })

  test('returns null for empty lines', () => {
    expect(parseStreamMessage('')).toBeNull()
    expect(parseStreamMessage('  ')).toBeNull()
  })

  test('returns null for invalid JSON', () => {
    expect(parseStreamMessage('not json')).toBeNull()
  })
})

describe('formatUserMessage', () => {
  test('wraps content in stream-json user message', () => {
    const msg = formatUserMessage('hello')
    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('user')
    expect(parsed.message.role).toBe('user')
    expect(parsed.message.content).toBe('hello')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/conversation.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/engine/conversation.ts
import { spawn, type Subprocess } from 'bun'
import type { MessageQueue } from './queue'

export type ClaudeOptions = {
  systemPrompt: string
  model?: string
  skipPermissions?: boolean
  allowedTools?: string[]
  mcpConfig?: string
  additionalArgs?: string[]
}

export function buildClaudeArgs(opts: ClaudeOptions): string[] {
  const args = [
    '--print',
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
      const writer = proc.stdin as WritableStream
      const w = writer.getWriter()
      w.write(new TextEncoder().encode(formatUserMessage(content) + '\n'))
      w.releaseLock()
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

      // Read stdout line by line
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const readLoop = async () => {
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
```

**Step 4: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/conversation.test.ts`
Expected: 6 passing

**Step 5: Commit**

```bash
git add src/engine/conversation.ts src/engine/conversation.test.ts
git commit -m "feat: add conversation engine (claude subprocess driver)"
```

---

### Task 4: Tick Loop

Injects `<tick>` prompts on an interval. Respects sleep requests and wake triggers.

**Files:**
- Create: `src/engine/tick.ts`
- Create: `src/engine/tick.test.ts`

**Step 1: Write the failing test**

```typescript
// src/engine/tick.test.ts
import { describe, test, expect } from 'bun:test'
import { formatTick, parseSleepDuration } from './tick'

describe('formatTick', () => {
  test('wraps ISO timestamp in tick tags', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'))
    expect(tick).toBe('<tick>2026-03-31T14:30:00</tick>')
  })

  test('includes terminal focus when provided', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'), { terminalFocused: true })
    expect(tick).toContain('terminalFocus="true"')
  })

  test('includes pending count when provided', () => {
    const tick = formatTick(new Date('2026-03-31T14:30:00'), { pendingMessages: 3 })
    expect(tick).toContain('pending="3"')
  })
})

describe('parseSleepDuration', () => {
  test('parses seconds', () => {
    expect(parseSleepDuration('30s')).toBe(30_000)
    expect(parseSleepDuration('30')).toBe(30_000)
  })

  test('parses minutes', () => {
    expect(parseSleepDuration('5m')).toBe(300_000)
  })

  test('returns default for invalid input', () => {
    expect(parseSleepDuration('')).toBe(30_000)
    expect(parseSleepDuration('abc')).toBe(30_000)
  })

  test('caps at 30 minutes', () => {
    expect(parseSleepDuration('60m')).toBe(1_800_000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/tick.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/engine/tick.ts
import type { MessageQueue } from './queue'

const DEFAULT_TICK_MS = 30_000
const MAX_SLEEP_MS = 30 * 60 * 1000 // 30 minutes

export type TickContext = {
  terminalFocused?: boolean
  pendingMessages?: number
}

export function formatTick(now: Date, ctx?: TickContext): string {
  // Format without timezone offset, matching CC's local time format
  const iso = now.toISOString().replace(/\.\d{3}Z$/, '')
  let attrs = ''
  if (ctx?.terminalFocused !== undefined) {
    attrs += ` terminalFocus="${ctx.terminalFocused}"`
  }
  if (ctx?.pendingMessages !== undefined && ctx.pendingMessages > 0) {
    attrs += ` pending="${ctx.pendingMessages}"`
  }
  return `<tick${attrs}>${iso}</tick>`
}

export function parseSleepDuration(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_TICK_MS

  const match = trimmed.match(/^(\d+)(m|s)?$/)
  if (!match) return DEFAULT_TICK_MS

  const value = parseInt(match[1], 10)
  const unit = match[2] ?? 's'

  const ms = unit === 'm' ? value * 60_000 : value * 1_000
  return Math.min(ms, MAX_SLEEP_MS)
}

export type TickLoop = {
  start(): void
  stop(): void
  /** Call when Claude requests a sleep duration */
  setSleepDuration(ms: number): void
  /** Interrupt sleep early (channel message, cron fire, etc.) */
  wake(): void
}

export function createTickLoop(
  queue: MessageQueue,
  opts?: { initialIntervalMs?: number },
): TickLoop {
  let intervalMs = opts?.initialIntervalMs ?? DEFAULT_TICK_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let wakeResolver: (() => void) | null = null

  function scheduleTick() {
    if (!running) return
    timer = setTimeout(() => {
      const tick = formatTick(new Date(), {
        pendingMessages: queue.hasMessages() ? undefined : 0,
      })
      queue.enqueue({ type: 'tick', content: tick })
      scheduleTick()
    }, intervalMs)
  }

  return {
    start() {
      running = true
      // First tick immediately
      const tick = formatTick(new Date())
      queue.enqueue({ type: 'tick', content: tick })
      scheduleTick()
    },

    stop() {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },

    setSleepDuration(ms: number) {
      intervalMs = Math.min(ms, MAX_SLEEP_MS)
      // Reschedule with new interval
      if (timer) {
        clearTimeout(timer)
        scheduleTick()
      }
    },

    wake() {
      if (timer) {
        clearTimeout(timer)
        scheduleTick()
      }
      wakeResolver?.()
    },
  }
}
```

**Step 4: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/engine/tick.test.ts`
Expected: 7 passing

**Step 5: Commit**

```bash
git add src/engine/tick.ts src/engine/tick.test.ts
git commit -m "feat: add tick loop with sleep/wake control"
```

---

### Task 5: Channel Protocol Types

Shared types for the channel notification protocol. Used by both the MCP host and channel servers.

**Files:**
- Create: `src/channels/protocol.ts`
- Create: `src/channels/protocol.test.ts`

**Step 1: Write the failing test**

```typescript
// src/channels/protocol.test.ts
import { describe, test, expect } from 'bun:test'
import { wrapChannelMessage, parseChannelNotification } from './protocol'

describe('wrapChannelMessage', () => {
  test('wraps content in channel tags with source', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello world')
    expect(wrapped).toBe('<channel source="cast:main">\nhello world\n</channel>')
  })

  test('includes meta as attributes', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      branch: 'clair-private',
      author: 'jon',
    })
    expect(wrapped).toContain('branch="clair-private"')
    expect(wrapped).toContain('author="jon"')
  })

  test('rejects unsafe meta keys', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      'good_key': 'ok',
      'bad"key': 'nope',
    })
    expect(wrapped).toContain('good_key="ok"')
    expect(wrapped).not.toContain('bad')
  })

  test('escapes XML in values', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      author: 'Jon & "friends"',
    })
    expect(wrapped).toContain('author="Jon &amp; &quot;friends&quot;"')
  })
})

describe('parseChannelNotification', () => {
  test('parses valid notification', () => {
    const notif = parseChannelNotification({
      method: 'notifications/claude/channel',
      params: { content: 'hello', meta: { branch: 'main' } },
    })
    expect(notif?.content).toBe('hello')
    expect(notif?.meta?.branch).toBe('main')
  })

  test('returns null for wrong method', () => {
    const notif = parseChannelNotification({
      method: 'notifications/other',
      params: { content: 'hello' },
    })
    expect(notif).toBeNull()
  })

  test('returns null for missing content', () => {
    const notif = parseChannelNotification({
      method: 'notifications/claude/channel',
      params: {},
    })
    expect(notif).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/channels/protocol.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/channels/protocol.ts

// --- XML helpers ---

const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function wrapChannelMessage(
  source: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  return `<channel source="${escapeXmlAttr(source)}"${attrs}>\n${content}\n</channel>`
}

// --- Notification parsing ---

export const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel'
export const CHANNEL_PERMISSION_METHOD = 'notifications/claude/channel/permission'
export const CHANNEL_PERMISSION_REQUEST_METHOD = 'notifications/claude/channel/permission_request'

export type ChannelNotification = {
  content: string
  meta?: Record<string, string>
}

export type PermissionNotification = {
  request_id: string
  behavior: 'allow' | 'deny'
}

export type PermissionRequest = {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

export function parseChannelNotification(
  msg: unknown,
): ChannelNotification | null {
  if (!msg || typeof msg !== 'object') return null
  const { method, params } = msg as Record<string, unknown>
  if (method !== CHANNEL_NOTIFICATION_METHOD) return null
  if (!params || typeof params !== 'object') return null
  const { content, meta } = params as Record<string, unknown>
  if (typeof content !== 'string') return null
  return {
    content,
    meta: meta as Record<string, string> | undefined,
  }
}

export function parsePermissionNotification(
  msg: unknown,
): PermissionNotification | null {
  if (!msg || typeof msg !== 'object') return null
  const { method, params } = msg as Record<string, unknown>
  if (method !== CHANNEL_PERMISSION_METHOD) return null
  if (!params || typeof params !== 'object') return null
  const { request_id, behavior } = params as Record<string, unknown>
  if (typeof request_id !== 'string') return null
  if (behavior !== 'allow' && behavior !== 'deny') return null
  return { request_id, behavior }
}
```

**Step 4: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/channels/protocol.test.ts`
Expected: 7 passing

**Step 5: Commit**

```bash
git add src/channels/protocol.ts src/channels/protocol.test.ts
git commit -m "feat: add channel notification protocol types"
```

---

### Task 6: Permission ID Generator

5-letter codes for permission relay, matching KAIROS's algorithm.

**Files:**
- Create: `src/channels/permissions.ts`
- Create: `src/channels/permissions.test.ts`

**Step 1: Write the failing test**

```typescript
// src/channels/permissions.test.ts
import { describe, test, expect } from 'bun:test'
import {
  shortRequestId,
  PERMISSION_REPLY_RE,
  createPermissionCallbacks,
} from './permissions'

describe('shortRequestId', () => {
  test('returns 5-letter string', () => {
    const id = shortRequestId('toolu_abc123')
    expect(id).toHaveLength(5)
    expect(id).toMatch(/^[a-km-z]{5}$/)
  })

  test('is deterministic', () => {
    const a = shortRequestId('toolu_abc123')
    const b = shortRequestId('toolu_abc123')
    expect(a).toBe(b)
  })

  test('never contains "l"', () => {
    // Generate a bunch and check
    for (let i = 0; i < 100; i++) {
      const id = shortRequestId(`toolu_test_${i}`)
      expect(id).not.toContain('l')
    }
  })

  test('avoids profanity', () => {
    // Can't easily test this deterministically, but verify the function
    // doesn't crash and returns valid IDs
    for (let i = 0; i < 200; i++) {
      const id = shortRequestId(`toolu_profanity_${i}`)
      expect(id).toHaveLength(5)
      expect(id).toMatch(/^[a-km-z]{5}$/)
    }
  })
})

describe('PERMISSION_REPLY_RE', () => {
  test('matches "yes xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('yes tbxkq')).toBe(true)
  })

  test('matches "no xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('no tbxkq')).toBe(true)
  })

  test('matches "y xxxxx"', () => {
    expect(PERMISSION_REPLY_RE.test('y tbxkq')).toBe(true)
  })

  test('case insensitive', () => {
    expect(PERMISSION_REPLY_RE.test('YES TBXKQ')).toBe(true)
  })

  test('rejects bare yes/no', () => {
    expect(PERMISSION_REPLY_RE.test('yes')).toBe(false)
  })

  test('rejects wrong length codes', () => {
    expect(PERMISSION_REPLY_RE.test('yes abcd')).toBe(false)
    expect(PERMISSION_REPLY_RE.test('yes abcdef')).toBe(false)
  })
})

describe('createPermissionCallbacks', () => {
  test('resolve returns true for pending request', () => {
    const cb = createPermissionCallbacks()
    let result: { behavior: string; fromServer: string } | null = null
    cb.onResponse('abcde', r => { result = r })
    const resolved = cb.resolve('abcde', 'allow', 'cast:main')
    expect(resolved).toBe(true)
    expect(result?.behavior).toBe('allow')
    expect(result?.fromServer).toBe('cast:main')
  })

  test('resolve returns false for unknown request', () => {
    const cb = createPermissionCallbacks()
    expect(cb.resolve('zzzzz', 'allow', 'cast:main')).toBe(false)
  })

  test('unsubscribe prevents resolution', () => {
    const cb = createPermissionCallbacks()
    let called = false
    const unsub = cb.onResponse('abcde', () => { called = true })
    unsub()
    cb.resolve('abcde', 'allow', 'cast:main')
    expect(called).toBe(false)
  })

  test('case insensitive matching', () => {
    const cb = createPermissionCallbacks()
    let result: { behavior: string } | null = null
    cb.onResponse('ABCDE', r => { result = r })
    expect(cb.resolve('abcde', 'deny', 'cast:main')).toBe(true)
    expect(result?.behavior).toBe('deny')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/channels/permissions.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/channels/permissions.ts

// Exact port from CC's channelPermissions.ts

export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz' // 25 chars, no 'l'

// prettier-ignore
const ID_AVOID_SUBSTRINGS = [
  'fuck','shit','cunt','cock','dick','twat','piss','crap','bitch','whore',
  'ass','tit','cum','fag','dyke','nig','kike','rape','nazi','damn',
  'poo','pee','wank','anus',
]

function hashToId(input: string): string {
  // FNV-1a → uint32, then base-25 encode
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h = h >>> 0
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ID_ALPHABET[h % 25]
    h = Math.floor(h / 25)
  }
  return s
}

export function shortRequestId(toolUseID: string): string {
  let candidate = hashToId(toolUseID)
  for (let salt = 0; salt < 10; salt++) {
    if (!ID_AVOID_SUBSTRINGS.some(bad => candidate.includes(bad))) {
      return candidate
    }
    candidate = hashToId(`${toolUseID}:${salt}`)
  }
  return candidate
}

// --- Permission callbacks (same pattern as CC) ---

export type PermissionResponse = {
  behavior: 'allow' | 'deny'
  fromServer: string
}

export type PermissionCallbacks = {
  onResponse(
    requestId: string,
    handler: (response: PermissionResponse) => void,
  ): () => void
  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean
}

export function createPermissionCallbacks(): PermissionCallbacks {
  const pending = new Map<string, (response: PermissionResponse) => void>()

  return {
    onResponse(requestId, handler) {
      const key = requestId.toLowerCase()
      pending.set(key, handler)
      return () => { pending.delete(key) }
    },

    resolve(requestId, behavior, fromServer) {
      const key = requestId.toLowerCase()
      const resolver = pending.get(key)
      if (!resolver) return false
      pending.delete(key)
      resolver({ behavior, fromServer })
      return true
    },
  }
}
```

**Step 4: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/channels/permissions.test.ts`
Expected: 10 passing

**Step 5: Commit**

```bash
git add src/channels/permissions.ts src/channels/permissions.test.ts
git commit -m "feat: add permission ID generator and callbacks"
```

---

### Task 7: Cast Channel MCP Server

Standalone MCP server that wraps the Cast CLI. Runs as a stdio child process.

**Files:**
- Create: `src/cast/server.ts`
- Create: `src/cast/poller.ts`
- Create: `src/cast/tools.ts`
- Create: `src/cast/poller.test.ts`

**Step 1: Write the failing test for the poller**

```typescript
// src/cast/poller.test.ts
import { describe, test, expect } from 'bun:test'
import { parseCastOutput, diffMessages } from './poller'

describe('parseCastOutput', () => {
  test('extracts message IDs and content from cast branch output', () => {
    const output = `msg_abc123 | jon | 2026-03-31 14:00 | Hello from Cast
msg_def456 | jon | 2026-03-31 14:01 | Another message`
    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg_abc123')
    expect(messages[0].author).toBe('jon')
    expect(messages[0].content).toBe('Hello from Cast')
  })

  test('handles empty output', () => {
    expect(parseCastOutput('')).toEqual([])
  })
})

describe('diffMessages', () => {
  test('returns only new messages', () => {
    const prev = new Set(['msg_abc123'])
    const current = [
      { id: 'msg_abc123', author: 'jon', content: 'old', timestamp: '' },
      { id: 'msg_def456', author: 'jon', content: 'new', timestamp: '' },
    ]
    const newMsgs = diffMessages(current, prev)
    expect(newMsgs).toHaveLength(1)
    expect(newMsgs[0].id).toBe('msg_def456')
  })

  test('returns empty when no new messages', () => {
    const prev = new Set(['msg_abc123'])
    const current = [
      { id: 'msg_abc123', author: 'jon', content: 'old', timestamp: '' },
    ]
    expect(diffMessages(current, prev)).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/cast/poller.test.ts`
Expected: FAIL

**Step 3: Write the poller**

```typescript
// src/cast/poller.ts
import { $ } from 'bun'

export type CastMessage = {
  id: string
  author: string
  content: string
  timestamp: string
}

/**
 * Parse the tabular output from `cast branch <id>`.
 * Format: "msg_id | author | timestamp | content"
 * This is a best-effort parser — if Cast CLI changes format, update here.
 */
export function parseCastOutput(output: string): CastMessage[] {
  const lines = output.trim().split('\n').filter(Boolean)
  return lines
    .map(line => {
      const parts = line.split(' | ')
      if (parts.length < 4) return null
      return {
        id: parts[0].trim(),
        author: parts[1].trim(),
        timestamp: parts[2].trim(),
        content: parts.slice(3).join(' | ').trim(),
      }
    })
    .filter((m): m is CastMessage => m !== null)
}

export function diffMessages(
  current: CastMessage[],
  seenIds: Set<string>,
): CastMessage[] {
  return current.filter(m => !seenIds.has(m.id))
}

export type CastPoller = {
  start(): void
  stop(): void
  onNewMessages(handler: (messages: CastMessage[]) => void): void
}

export function createCastPoller(opts: {
  branches: string[]
  intervalMs: number
  castPath?: string
}): CastPoller {
  const seenIds = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let handler: ((messages: CastMessage[]) => void) | null = null
  const castCmd = opts.castPath ?? 'cast'

  async function poll() {
    for (const branch of opts.branches) {
      try {
        const result = await $`${castCmd} branch ${branch}`.text()
        const messages = parseCastOutput(result)
        const newMsgs = diffMessages(messages, seenIds)
        for (const msg of messages) seenIds.add(msg.id)
        if (newMsgs.length > 0 && handler) {
          handler(newMsgs)
        }
      } catch {
        // Cast CLI failed — skip this poll cycle
      }
    }
  }

  return {
    start() {
      // Initial poll to seed seen IDs (don't emit old messages)
      poll()
      timer = setInterval(poll, opts.intervalMs)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },

    onNewMessages(h) {
      handler = h
    },
  }
}
```

**Step 4: Write the Cast MCP tools**

```typescript
// src/cast/tools.ts
import { $ } from 'bun'

const castCmd = process.env.CAST_PATH ?? 'cast'

export const CAST_TOOLS = [
  {
    name: 'cast_post',
    description: 'Post a message to a Cast branch',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Message content' },
        branch: { type: 'string', description: 'Branch ID (optional, defaults to private branch)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'cast_reply',
    description: 'Reply to a Cast message thread',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'ID of the message to reply to' },
        content: { type: 'string', description: 'Reply content' },
      },
      required: ['message_id', 'content'],
    },
  },
  {
    name: 'cast_react',
    description: 'React to a Cast message with an emoji',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'ID of the message to react to' },
        emoji: { type: 'string', description: 'Emoji to react with' },
      },
      required: ['message_id', 'emoji'],
    },
  },
  {
    name: 'cast_read',
    description: 'Read recent messages from a Cast branch',
    inputSchema: {
      type: 'object' as const,
      properties: {
        branch: { type: 'string', description: 'Branch ID' },
      },
      required: ['branch'],
    },
  },
  {
    name: 'cast_search',
    description: 'Search Cast messages',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        branch: { type: 'string', description: 'Branch ID (optional)' },
      },
      required: ['query'],
    },
  },
]

export async function executeCastTool(
  name: string,
  args: Record<string, string>,
): Promise<string> {
  switch (name) {
    case 'cast_post': {
      const branchArg = args.branch ? `--branch ${args.branch}` : ''
      return await $`${castCmd} post ${JSON.stringify(args.content)} ${branchArg}`.text()
    }
    case 'cast_reply':
      return await $`${castCmd} reply ${args.message_id} ${JSON.stringify(args.content)}`.text()
    case 'cast_react':
      return await $`${castCmd} react ${args.message_id} ${args.emoji}`.text()
    case 'cast_read':
      return await $`${castCmd} branch ${args.branch}`.text()
    case 'cast_search': {
      const branchArg = args.branch ? `--branch ${args.branch}` : ''
      return await $`${castCmd} search ${JSON.stringify(args.query)} ${branchArg}`.text()
    }
    default:
      throw new Error(`Unknown cast tool: ${name}`)
  }
}
```

**Step 5: Write the MCP server**

```typescript
// src/cast/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CAST_TOOLS, executeCastTool } from './tools.js'
import { createCastPoller } from './poller.js'
import { PERMISSION_REPLY_RE } from '../channels/permissions.js'

const config = JSON.parse(process.env.CLAIR_CAST_CONFIG ?? '{}')
const branches: string[] = config.branches ?? ['clair-private']
const pollIntervalMs: number = config.pollIntervalMs ?? 5000

const server = new Server(
  { name: 'cast-channel', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
  },
)

// --- Tools ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: CAST_TOOLS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    const result = await executeCastTool(name, args as Record<string, string>)
    return { content: [{ type: 'text', text: result }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
      isError: true,
    }
  }
})

// --- Inbound: poll Cast → push notifications ---

const poller = createCastPoller({
  branches,
  intervalMs: pollIntervalMs,
})

poller.onNewMessages(messages => {
  for (const msg of messages) {
    // Check if it's a permission reply
    const permMatch = msg.content.match(PERMISSION_REPLY_RE)
    if (permMatch) {
      const behavior = permMatch[1].toLowerCase().startsWith('y') ? 'allow' : 'deny'
      const requestId = permMatch[2].toLowerCase()
      server.notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id: requestId, behavior },
      })
      return
    }

    // Regular channel message
    server.notification({
      method: 'notifications/claude/channel',
      params: {
        content: msg.content,
        meta: {
          author: msg.author,
          message_id: msg.id,
          branch: branches[0] ?? 'unknown',
        },
      },
    })
  }
})

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  poller.start()
}

main().catch(console.error)
```

**Step 6: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/cast/poller.test.ts`
Expected: 4 passing

**Step 7: Commit**

```bash
git add src/cast/server.ts src/cast/poller.ts src/cast/tools.ts src/cast/poller.test.ts
git commit -m "feat: add Cast channel MCP server"
```

---

### Task 8: Cron Scheduler

Durable cron-based task scheduling with persistence.

**Files:**
- Create: `src/scheduler/types.ts`
- Create: `src/scheduler/cron.ts`
- Create: `src/scheduler/persistence.ts`
- Create: `src/scheduler/cron.test.ts`

**Step 1: Write the failing test**

```typescript
// src/scheduler/cron.test.ts
import { describe, test, expect } from 'bun:test'
import { nextCronTime, addJitter } from './cron'
import type { ScheduledTask } from './types'

describe('nextCronTime', () => {
  test('every-minute cron fires within 60s', () => {
    const now = new Date('2026-03-31T14:00:00')
    const next = nextCronTime('* * * * *', now)
    expect(next).toBeDefined()
    const diffMs = next!.getTime() - now.getTime()
    expect(diffMs).toBeLessThanOrEqual(60_000)
    expect(diffMs).toBeGreaterThan(0)
  })

  test('returns null for invalid cron expression', () => {
    const next = nextCronTime('not a cron', new Date())
    expect(next).toBeNull()
  })
})

describe('addJitter', () => {
  test('adds 1-30s of jitter', () => {
    const base = new Date('2026-03-31T14:00:00')
    const jittered = addJitter(base)
    const diffMs = jittered.getTime() - base.getTime()
    expect(diffMs).toBeGreaterThanOrEqual(1000)
    expect(diffMs).toBeLessThanOrEqual(30_000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/scheduler/cron.test.ts`
Expected: FAIL

**Step 3: Write types**

```typescript
// src/scheduler/types.ts
export type ScheduledTask = {
  id: string
  cron: string
  prompt: string
  durable: boolean
  createdAt: string
  lastRun?: string
  nextRun: string
}
```

**Step 4: Write cron parser**

We'll use a lightweight cron parser. For v1, support the basic 5-field format with a simple implementation rather than pulling in a dependency.

```typescript
// src/scheduler/cron.ts
import type { ScheduledTask } from './types'
import type { MessageQueue } from '../engine/queue'

/**
 * Minimal cron next-time calculator. Supports 5-field standard cron
 * (minute hour dom month dow). For v1 we support: *, numeric, and * /step.
 * A full cron library can replace this later.
 */
export function nextCronTime(
  expr: string,
  after: Date,
): Date | null {
  try {
    const fields = expr.trim().split(/\s+/)
    if (fields.length !== 5) return null

    const matchers = fields.map(parseCronField)
    if (matchers.some(m => m === null)) return null

    // Brute-force: check every minute for the next 24 hours
    const limit = 24 * 60
    const candidate = new Date(after)
    candidate.setSeconds(0, 0)
    candidate.setMinutes(candidate.getMinutes() + 1)

    for (let i = 0; i < limit; i++) {
      const min = candidate.getMinutes()
      const hour = candidate.getHours()
      const dom = candidate.getDate()
      const month = candidate.getMonth() + 1
      const dow = candidate.getDay()

      if (
        matchers[0]!(min) &&
        matchers[1]!(hour) &&
        matchers[2]!(dom) &&
        matchers[3]!(month) &&
        matchers[4]!(dow)
      ) {
        return candidate
      }
      candidate.setMinutes(candidate.getMinutes() + 1)
    }
    return null
  } catch {
    return null
  }
}

function parseCronField(field: string): ((value: number) => boolean) | null {
  if (field === '*') return () => true

  // */step
  const stepMatch = field.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10)
    return (v: number) => v % step === 0
  }

  // Numeric
  const num = parseInt(field, 10)
  if (!isNaN(num)) return (v: number) => v === num

  // Comma-separated
  if (field.includes(',')) {
    const values = field.split(',').map(Number)
    if (values.some(isNaN)) return null
    return (v: number) => values.includes(v)
  }

  // Range
  const rangeMatch = field.match(/^(\d+)-(\d+)$/)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    return (v: number) => v >= lo && v <= hi
  }

  return null
}

export function addJitter(date: Date): Date {
  const jitterMs = 1000 + Math.floor(Math.random() * 29_000) // 1-30s
  return new Date(date.getTime() + jitterMs)
}

export type Scheduler = {
  addTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'nextRun'>): ScheduledTask
  removeTask(id: string): boolean
  getTasks(): ScheduledTask[]
  start(queue: MessageQueue): void
  stop(): void
}

export function createScheduler(maxJobs = 50): Scheduler {
  const tasks = new Map<string, ScheduledTask>()
  let timer: ReturnType<typeof setInterval> | null = null

  function computeNextRun(cron: string): string {
    const next = nextCronTime(cron, new Date())
    return next ? addJitter(next).toISOString() : ''
  }

  return {
    addTask(input) {
      if (tasks.size >= maxJobs) throw new Error(`Max ${maxJobs} scheduled tasks`)
      const task: ScheduledTask = {
        id: crypto.randomUUID().slice(0, 8),
        cron: input.cron,
        prompt: input.prompt,
        durable: input.durable,
        createdAt: new Date().toISOString(),
        nextRun: computeNextRun(input.cron),
      }
      tasks.set(task.id, task)
      return task
    },

    removeTask(id) {
      return tasks.delete(id)
    },

    getTasks() {
      return Array.from(tasks.values())
    },

    start(queue) {
      // Check every 10s if any tasks should fire
      timer = setInterval(() => {
        const now = Date.now()
        for (const task of tasks.values()) {
          if (!task.nextRun) continue
          const nextMs = new Date(task.nextRun).getTime()
          if (now >= nextMs) {
            queue.enqueue({
              type: 'cron',
              content: `<cron task_id="${task.id}">\n${task.prompt}\n</cron>`,
            })
            task.lastRun = new Date().toISOString()
            task.nextRun = computeNextRun(task.cron)
          }
        }
      }, 10_000)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
```

**Step 5: Write persistence**

```typescript
// src/scheduler/persistence.ts
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { ScheduledTask } from './types'

const TASKS_PATH = join(homedir(), '.clair', 'scheduled_tasks.json')

export function loadTasks(): ScheduledTask[] {
  try {
    if (!existsSync(TASKS_PATH)) return []
    const raw = Bun.file(TASKS_PATH)
    // Bun.file().json() is async, use readFileSync for simplicity
    const text = require('fs').readFileSync(TASKS_PATH, 'utf-8')
    const tasks = JSON.parse(text)
    return Array.isArray(tasks) ? tasks.filter((t: ScheduledTask) => t.durable) : []
  } catch {
    return []
  }
}

export function saveTasks(tasks: ScheduledTask[]): void {
  const dir = dirname(TASKS_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const durable = tasks.filter(t => t.durable)
  require('fs').writeFileSync(TASKS_PATH, JSON.stringify(durable, null, 2))
}
```

**Step 6: Run tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test src/scheduler/cron.test.ts`
Expected: 3 passing

**Step 7: Commit**

```bash
git add src/scheduler/types.ts src/scheduler/cron.ts src/scheduler/persistence.ts src/scheduler/cron.test.ts
git commit -m "feat: add cron scheduler with durable persistence"
```

---

### Task 9: Config & System Prompts

Settings file and the proactive system prompt.

**Files:**
- Create: `src/config/settings.ts`
- Create: `src/config/prompts.ts`

**Step 1: Write settings**

```typescript
// src/config/settings.ts
import { existsSync, mkdirSync } from 'fs'
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
    pollIntervalMs: 5_000,
    privateBranch: 'clair-private',
    forwardProactive: true,
  },
  scheduler: {
    maxJobs: 50,
  },
}

export function loadConfig(): ClairConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return DEFAULTS
    const text = require('fs').readFileSync(CONFIG_PATH, 'utf-8')
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
  require('fs').writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
```

**Step 2: Write system prompts**

```typescript
// src/config/prompts.ts
import type { ClairConfig } from './settings'

export function getProactiveSystemPrompt(config: ClairConfig): string {
  const branches = config.cast.branches.join(', ')

  return `You are Clair, an autonomous agent. You will receive \`<tick>\` prompts that keep you alive between turns — treat them as "you're awake, what now?" The time in each \`<tick>\` is the user's current local time.

Multiple ticks may be batched into a single message. Process the latest one. Never echo or repeat tick content.

## Pacing

Use the Sleep tool to control how long you wait between actions. Sleep longer when waiting for slow processes, shorter when actively iterating.

**If you have nothing useful to do on a tick, you MUST call Sleep.** Never respond with only a status message like "still waiting" — that wastes a turn.

## First wake-up

On your very first tick, greet the user briefly and ask what they'd like to work on. Do not start exploring unprompted.

## Channel messages

Messages from Cast arrive as \`<channel>\` tags with source, branch, and author attributes. Reply using the cast_post or cast_reply tools. The user gets push notifications on Cast.

Monitored branches: ${branches}
Private branch for direct comms: ${config.cast.privateBranch}

## Scheduled tasks

Cron tasks arrive as \`<cron>\` tags. Execute the prompt inside them.

## Terminal focus

The tick may include a \`terminalFocus\` attribute:
- **Unfocused**: The user is away. Lean into autonomous action — make decisions, explore, commit.
- **Focused**: The user is watching. Be collaborative, surface choices, keep output concise.

## Bias toward action

Act on your best judgment rather than asking for confirmation.
- Read files, search code, run tests, check types — all without asking.
- Make code changes. Commit when you reach a good stopping point.
- If unsure between two approaches, pick one and go.

## Be concise

Keep text output brief. Focus on:
- Decisions that need the user's input
- High-level status updates at milestones
- Errors or blockers that change the plan

Do not narrate each step or explain routine actions.

## Talking to the user

Use SendUserMessage for anything you want the user to actually see. Text outside it may not be read. Set status to 'proactive' when you're initiating (task finished, blocker found, needs input). Set 'normal' when replying to something they said.

Every time the user says something, the reply goes through SendUserMessage. If you need to go look at something, ack first ("On it — checking"), then work, then send the result.`
}
```

**Step 3: Commit**

```bash
git add src/config/settings.ts src/config/prompts.ts
git commit -m "feat: add config and proactive system prompts"
```

---

### Task 10: Main Entry Point — Wire Everything Together

Connect all layers into the main CLI.

**Files:**
- Create: `src/index.ts` (overwrite scaffold)

**Step 1: Write the main entry point**

```typescript
// src/index.ts
#!/usr/bin/env bun

import { parseArgs } from 'util'
import { resolve } from 'path'
import { loadConfig } from './config/settings'
import { getProactiveSystemPrompt } from './config/prompts'
import { createMessageQueue } from './engine/queue'
import { createTickLoop } from './engine/tick'
import { createConversationEngine, type StreamMessage } from './engine/conversation'
import { createScheduler } from './scheduler/cron'
import { loadTasks, saveTasks } from './scheduler/persistence'
import { wrapChannelMessage } from './channels/protocol'

const VERSION = '0.1.0'

const { values: flags } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    model: { type: 'string', short: 'm' },
    'skip-permissions': { type: 'boolean' },
    'no-cast': { type: 'boolean' },
  },
  strict: false,
})

if (flags.help) {
  console.log(`clair v${VERSION} — autonomous AI agent

Usage: clair [options]

Options:
  -h, --help              Show this help
  -v, --version           Show version
  -m, --model <model>     Claude model (default: from config)
  --skip-permissions      Skip permission checks (dangerous)
  --no-cast               Disable Cast channel integration
`)
  process.exit(0)
}

if (flags.version) {
  console.log(VERSION)
  process.exit(0)
}

// --- Boot ---

console.log(`\x1b[36mclair\x1b[0m v${VERSION}`)
console.log()

const config = loadConfig()
const queue = createMessageQueue()
const systemPrompt = getProactiveSystemPrompt(config)

// MCP config for Cast channel server
const castMcpConfig = flags['no-cast'] ? undefined : JSON.stringify({
  mcpServers: {
    'cast-channel': {
      command: 'bun',
      args: [resolve(import.meta.dir, 'cast/server.ts')],
      env: {
        CLAIR_CAST_CONFIG: JSON.stringify(config.cast),
      },
    },
  },
})

// Write MCP config to temp file if Cast is enabled
let mcpConfigPath: string | undefined
if (castMcpConfig) {
  mcpConfigPath = '/tmp/clair-mcp.json'
  require('fs').writeFileSync(mcpConfigPath, castMcpConfig)
}

const engine = createConversationEngine({
  systemPrompt,
  model: (flags.model as string) ?? config.model,
  skipPermissions: flags['skip-permissions'] as boolean,
  mcpConfig: mcpConfigPath,
})

// --- Handle Claude's responses ---

engine.onMessage((msg: StreamMessage) => {
  if (msg.type === 'assistant') {
    // Extract text content from the message
    const content = msg.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null && 'type' in block) {
          if ((block as { type: string }).type === 'text') {
            const text = (block as { type: string; text: string }).text
            if (text.trim()) {
              console.log(`\x1b[33mclair:\x1b[0m ${text}`)
            }
          }
        }
      }
    }
  }

  // Check for tool use — specifically Sleep
  if (msg.type === 'tool_use' || (msg as Record<string, unknown>).tool_name === 'Sleep') {
    // TODO: Parse sleep duration from tool input and pass to tick loop
  }
})

// --- Tick loop ---

const tickLoop = createTickLoop(queue, {
  initialIntervalMs: config.tickIntervalMs,
})

// --- Scheduler ---

const scheduler = createScheduler(config.scheduler.maxJobs)
const durableTasks = loadTasks()
for (const task of durableTasks) {
  scheduler.addTask(task)
}
scheduler.start(queue)

// --- Main loop: drain queue → send to Claude ---

async function mainLoop() {
  await engine.start()
  tickLoop.start()

  console.log('\x1b[32m✓\x1b[0m Engine started. Waiting for first tick...')
  if (!flags['no-cast']) {
    console.log(`\x1b[32m✓\x1b[0m Cast channel: monitoring [${config.cast.branches.join(', ')}]`)
  }
  console.log()

  while (engine.isRunning()) {
    const msg = await queue.waitForMessage()

    // Batch: grab any additional queued messages
    const batch = [msg, ...queue.drain()]

    // For ticks, only send the latest
    const ticks = batch.filter(m => m.type === 'tick')
    const nonTicks = batch.filter(m => m.type !== 'tick')
    const latest = ticks.length > 0 ? [ticks[ticks.length - 1]] : []

    for (const m of [...nonTicks, ...latest]) {
      engine.send(m.content)
    }
  }
}

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('\n\x1b[36mclair:\x1b[0m shutting down...')
  tickLoop.stop()
  scheduler.stop()
  saveTasks(scheduler.getTasks())
  engine.stop()
  process.exit(0)
})

mainLoop().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
```

**Step 2: Verify it at least starts without errors**

Run: `cd /Users/jongrant/Desktop/clair && bun run src/index.ts --help`
Expected: Shows help text, exits cleanly

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire all layers into main entry point"
```

---

### Task 11: Integration Test — End-to-End Smoke Test

Verify the whole system boots, sends a tick to Claude, and gets a response.

**Files:**
- Create: `src/smoke.test.ts`

**Step 1: Write the smoke test**

```typescript
// src/smoke.test.ts
import { describe, test, expect } from 'bun:test'
import { buildClaudeArgs } from './engine/conversation'
import { createMessageQueue } from './engine/queue'
import { createTickLoop, formatTick } from './engine/tick'
import { loadConfig } from './config/settings'
import { getProactiveSystemPrompt } from './config/prompts'

describe('smoke test', () => {
  test('config loads with defaults', () => {
    const config = loadConfig()
    expect(config.tickIntervalMs).toBe(30_000)
    expect(config.cast.branches).toEqual(['clair-private'])
  })

  test('system prompt contains key instructions', () => {
    const config = loadConfig()
    const prompt = getProactiveSystemPrompt(config)
    expect(prompt).toContain('Clair')
    expect(prompt).toContain('<tick>')
    expect(prompt).toContain('Sleep')
    expect(prompt).toContain('cast_post')
    expect(prompt).toContain('SendUserMessage')
  })

  test('claude args include stream-json and mcp config', () => {
    const args = buildClaudeArgs({
      systemPrompt: 'test',
      mcpConfig: '/tmp/test-mcp.json',
    })
    expect(args).toContain('--input-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--mcp-config')
    expect(args).toContain('/tmp/test-mcp.json')
  })

  test('tick loop enqueues tick to queue', async () => {
    const queue = createMessageQueue()
    const tickLoop = createTickLoop(queue, { initialIntervalMs: 100 })
    tickLoop.start()

    const msg = await queue.waitForMessage()
    expect(msg.type).toBe('tick')
    expect(msg.content).toContain('<tick>')

    tickLoop.stop()
  })

  test('queue priority: channel message jumps tick', () => {
    const queue = createMessageQueue()
    queue.enqueue({ type: 'tick', content: '<tick>now</tick>' })
    queue.enqueue({
      type: 'channel',
      content: '<channel source="cast:main">urgent</channel>',
      priority: 'next',
    })

    const first = queue.dequeue()
    expect(first?.type).toBe('channel')
    expect(first?.content).toContain('urgent')
  })
})
```

**Step 2: Run all tests**

Run: `cd /Users/jongrant/Desktop/clair && bun test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/smoke.test.ts
git commit -m "test: add integration smoke tests"
```

---

### Task 12: Polish — README and bin setup

**Files:**
- Modify: `package.json` (add bin)

**Step 1: Make clair executable**

Run: `chmod +x /Users/jongrant/Desktop/clair/src/index.ts`

**Step 2: Test running as a command**

Run: `cd /Users/jongrant/Desktop/clair && bun run start -- --version`
Expected: prints `0.1.0`

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: polish project setup"
```
