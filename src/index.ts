#!/usr/bin/env bun

import { parseArgs } from 'util'
import { resolve, join } from 'path'
import { writeFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { loadConfig } from './config/settings'
import { getProactiveSystemPrompt } from './config/prompts'
import { createMessageQueue } from './engine/queue'
import { createTickLoop, parseSleepDuration } from './engine/tick'
import { createConversationEngine, type StreamMessage } from './engine/conversation'
import { createScheduler } from './scheduler/cron'
import { loadTasks, saveTasks } from './scheduler/persistence'
import { createCastPoller } from './cast/poller'
import { wrapChannelMessage } from './channels/protocol'
import { PERMISSION_REPLY_RE } from './channels/permissions'
import { createPermissionRelay, type PermissionRelay } from './channels/relay'
import { isTerminalFocused } from './engine/focus'
import {
  formatClairText,
  formatCastMessage,
  formatToolCall,
  formatToolResult,
  formatSleep,
  formatPermissionRequest,
  formatBoot,
  formatStatus,
  formatShutdown,
} from './ui/terminal'
import { createStatusLine, formatWakeTime } from './ui/status'

const VERSION = '0.1.0'

const { values: flags } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    model: { type: 'string', short: 'm' },
    config: { type: 'string', short: 'c' },
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
  -c, --config <path>     Config file path (default: ~/.clair/config.json)
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

console.log(formatBoot(VERSION))
console.log()

const config = loadConfig(flags.config as string | undefined)
const queue = createMessageQueue()
const systemPrompt = getProactiveSystemPrompt(config)
const statusLine = createStatusLine()

// --- Cast API client (Clair's own identity) ---

let castConfig: { apiUrl: string; token: string } | null = null
try {
  const rcPath = process.env.CLAIR_CASTRC ?? join(homedir(), '.clair-castrc')
  castConfig = JSON.parse(readFileSync(rcPath, 'utf-8'))
} catch {
  // No Cast config — forwarding and permissions disabled
}

async function castApiPost(content: string, branchId?: string): Promise<void> {
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

async function forwardToCast(text: string) {
  if (!castConfig || flags['no-cast'] || !config.cast.forwardProactive) return
  if (text.length < 10) return
  try {
    await castApiPost(text)
  } catch {
    // Non-critical
  }
}

// --- Permission relay ---

let permissionRelay: PermissionRelay | null = null
if (!flags['no-cast'] && castConfig) {
  permissionRelay = createPermissionRelay({ post: castApiPost })
}

// --- MCP config for Cast channel server ---

let mcpConfigPath: string | undefined
if (!flags['no-cast']) {
  const castMcpConfig = {
    mcpServers: {
      'cast-channel': {
        command: 'bun',
        args: [resolve(import.meta.dir, 'cast/server.ts')],
        env: {
          CLAIR_CAST_CONFIG: JSON.stringify(config.cast),
        },
      },
    },
  }
  mcpConfigPath = '/tmp/clair-mcp.json'
  writeFileSync(mcpConfigPath, JSON.stringify(castMcpConfig))
}

const engine = createConversationEngine({
  systemPrompt,
  model: flags.model as string | undefined,
  skipPermissions: flags['skip-permissions'] as boolean | undefined,
  mcpConfig: mcpConfigPath,
})

function truncateStatus(s: string): string {
  const line = s.split('\n')[0].trim()
  return line.length > 40 ? line.slice(0, 37) + '...' : line
}

// --- Handle Claude's responses ---

engine.onMessage((msg: StreamMessage) => {
  if (msg.type === 'assistant') {
    const content = msg.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block !== 'object' || block === null || !('type' in block)) continue
        const typed = block as { type: string; [key: string]: unknown }

        if (typed.type === 'text') {
          const text = (typed as { type: string; text: string }).text
          if (text.trim()) {
            console.log(formatClairText(text))
            forwardToCast(text.trim())
            statusLine.update({ mode: 'working', lastActivity: truncateStatus(text) })
          }
        }

        // Intercept Sleep tool calls to adjust tick pacing
        const toolName = typed.name as string | undefined
        const isSleep = typed.type === 'tool_use' && (toolName === 'Sleep' || toolName?.endsWith('__Sleep'))
        if (isSleep) {
          const input = typed.input as { duration?: string } | undefined
          const duration = input?.duration ?? '5m'
          const ms = parseSleepDuration(duration)
          tickLoop.setSleepDuration(ms)
          console.log(formatSleep(duration, ms))
          statusLine.update({ mode: 'sleeping', sleepUntil: formatWakeTime(ms) })
        }

        // Display tool calls (collapsed) — skip Sleep (already displayed) and internal ToolSearch
        const isInternal = toolName === 'ToolSearch' || toolName?.endsWith('__ToolSearch')
        if (typed.type === 'tool_use' && !isSleep && !isInternal) {
          console.log(formatToolCall({
            name: typed.name as string,
            input: typed.input as Record<string, unknown>,
          }))
        }
      }
    }
  }

  // Display tool results
  if (msg.type === 'result') {
    const content = msg.message?.content
    if (typeof content === 'string' && content.trim()) {
      const isError = (msg as Record<string, unknown>).is_error === true
      console.log(formatToolResult({
        output: content,
        isError,
      }))
    }
  }
})

// --- Tick loop (with terminal focus) ---

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

// --- Cast poller (runs in main process) ---

let castPoller: ReturnType<typeof createCastPoller> | null = null
if (!flags['no-cast']) {
  castPoller = createCastPoller({
    branches: config.cast.branches,
    intervalMs: config.cast.pollIntervalMs,
    selfUsername: config.cast.username,
  })

  castPoller.onNewMessages(messages => {
    for (const msg of messages) {
      // Check if this is a permission reply (e.g. "yes tbxkq")
      const permMatch = msg.content.match(PERMISSION_REPLY_RE)
      if (permMatch && permissionRelay) {
        const behavior = permMatch[1].toLowerCase().startsWith('y') ? 'allow' as const : 'deny' as const
        const code = permMatch[2].toLowerCase()
        const resolved = permissionRelay.callbacks.resolve(code, behavior, 'cast:' + config.cast.privateBranch)
        if (resolved) {
          console.log(formatClairText(`Permission ${behavior === 'allow' ? '✓ granted' : '✗ denied'} (${code})`))
          continue // Don't forward permission replies to Claude
        }
      }

      // On mention-only branches, skip messages that don't @mention Clair
      const msgBranch = msg.threadId ? '' : config.cast.privateBranch // notifications don't have branch context
      if (config.cast.mentionOnlyBranches.includes(msgBranch)) {
        const mentionRe = new RegExp(`@${config.cast.username}\\b`, 'i')
        if (!mentionRe.test(msg.content)) continue
      }

      const meta: Record<string, string> = {
        author: msg.author,
        message_id: msg.id,
        branch: config.cast.privateBranch,
      }
      if (msg.threadId) {
        meta.thread_id = msg.threadId
      }
      const wrapped = wrapChannelMessage('cast:' + config.cast.privateBranch, msg.content, meta)
      queue.enqueue({
        type: 'channel',
        content: wrapped,
        priority: 'next',
      })
      console.log(formatCastMessage(msg.author, msg.content, msg.threadId))
      statusLine.update({ mode: 'listening', lastActivity: `cast: ${msg.author}` })
    }
  })
}

// --- Main loop: drain queue → send to Claude ---

async function mainLoop() {
  await engine.start()
  tickLoop.start()
  castPoller?.start()

  console.log(formatStatus('Engine started. Waiting for first tick...'))
  if (!flags['no-cast']) {
    console.log(formatStatus(`Cast channel: polling [${config.cast.branches.join(', ')}] every ${config.cast.pollIntervalMs / 1000}s`))
    if (permissionRelay) {
      console.log(formatStatus('Permission relay: active (reply on Cast to approve/deny)'))
    }
  }
  console.log()

  statusLine.update({ mode: 'idle', castConnected: !flags['no-cast'] })

  while (engine.isRunning()) {
    const msg = await queue.waitForMessage()

    // Batch: grab any additional queued messages
    const batch = [msg, ...queue.drain()]

    // For ticks, only send the latest
    const ticks = batch.filter(m => m.type === 'tick')
    const nonTicks = batch.filter(m => m.type !== 'tick')
    const latest = ticks.length > 0 ? [ticks[ticks.length - 1]] : []

    // Inject terminal focus into tick messages
    for (const m of latest) {
      const focused = await isTerminalFocused()
      statusLine.update({ focused })
      if (m.content.includes('<tick')) {
        m.content = m.content.replace(
          /<tick([^>]*)>/,
          `<tick$1 terminalFocus="${focused}">`,
        )
      }
    }

    for (const m of [...nonTicks, ...latest]) {
      engine.send(m.content)
    }
  }
}

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  statusLine.clear()
  console.log(formatShutdown())
  tickLoop.stop()
  castPoller?.stop()
  scheduler.stop()
  saveTasks(scheduler.getTasks())
  engine.stop()
  process.exit(0)
})

mainLoop().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
