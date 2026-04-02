#!/usr/bin/env bun

import { parseArgs } from 'util'
import { resolve } from 'path'
import { writeFileSync } from 'fs'
import { loadConfig } from './config/settings'
import { getProactiveSystemPrompt } from './config/prompts'
import { createMessageQueue } from './engine/queue'
import { createTickLoop } from './engine/tick'
import { createConversationEngine } from './engine/conversation'
import { createScheduler } from './scheduler/cron'
import { loadTasks, saveTasks } from './scheduler/persistence'
import { createCastPoller } from './cast/poller'
import { loadCastApiConfig, createCastApi } from './cast/api'
import { wrapChannelMessage } from './channels/protocol'
import { PERMISSION_REPLY_RE } from './channels/permissions'
import { createPermissionRelay, type PermissionRelay } from './channels/relay'
import { isTerminalFocused } from './engine/focus'
import { createTriggerServer } from './engine/triggers'
import { loadSession, saveSession, clearSession } from './engine/session'
import { createStreamHandler, type StreamHandlerState } from './engine/stream-handler'
import {
  formatClairText,
  formatCastMessage,
  formatBoot,
  formatStatus,
  formatShutdown,
} from './ui/terminal'
import { createStatusLine } from './ui/status'

const VERSION = '0.1.0'

const { values: flags } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    model: { type: 'string', short: 'm' },
    config: { type: 'string', short: 'c' },
    'skip-permissions': { type: 'boolean' },
    'no-cast': { type: 'boolean' },
    'new-session': { type: 'boolean' },
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
  --new-session           Start fresh instead of resuming previous session

Session is auto-saved and resumed on restart. Cost tracked in status bar.
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

// --- Cast API client ---

const castConfig = loadCastApiConfig()
const castApi = createCastApi(castConfig, config, flags['no-cast'] as boolean | undefined)

// --- Permission relay ---

let permissionRelay: PermissionRelay | null = null
if (!flags['no-cast'] && castConfig) {
  permissionRelay = createPermissionRelay({ post: castApi.post })
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

// --- Session resume ---

const previousSession = flags['new-session'] ? null : loadSession()
if (previousSession) {
  console.log(formatStatus(`Resuming session ${previousSession.sessionId.slice(0, 8)}...`))
}

const defaultModel = (flags.model as string | undefined) ?? config.model ?? 'haiku'

const engine = createConversationEngine({
  systemPrompt,
  model: defaultModel,
  skipPermissions: flags['skip-permissions'] as boolean | undefined,
  mcpConfig: mcpConfigPath,
  resumeSessionId: previousSession?.sessionId,
  additionalArgs: ['--setting-sources', ''],
})

// --- Stream handler (tool interception, display, cost tracking) ---

const handlerState: StreamHandlerState = {
  currentSessionId: null,
  sessionCostUsd: 0,
  sessionInputTokens: 0,
  sessionOutputTokens: 0,
  currentModel: '',
  pendingModelSwitch: null,
}

const tickLoop = createTickLoop(queue, { initialIntervalMs: config.tickIntervalMs })
const scheduler = createScheduler(config.scheduler.maxJobs)

let castPoller: ReturnType<typeof createCastPoller> | null = null
if (!flags['no-cast']) {
  castPoller = createCastPoller({
    branches: config.cast.branches,
    intervalMs: config.cast.pollIntervalMs,
    selfUsername: config.cast.username,
  })
}

const handleMessage = createStreamHandler(
  {
    tickLoop,
    scheduler,
    castPoller,
    statusLine,
    forwardToCast: castApi.forward,
    saveSession: (data) => saveSession(data),
    previousStartedAt: previousSession?.startedAt,
    engine,
  },
  handlerState,
)

engine.onMessage(handleMessage)

// --- Scheduler: load durable tasks ---

const durableTasks = loadTasks()
for (const task of durableTasks) {
  scheduler.addTask(task)
}
scheduler.start(queue)

// --- Remote triggers (webhook server) ---

let triggerServer: ReturnType<typeof createTriggerServer> | null = null
if (config.triggers.enabled) {
  triggerServer = createTriggerServer({
    queue,
    port: config.triggers.port,
    secret: config.triggers.secret,
  })
}

// --- Cast poller callbacks ---

if (castPoller) {
  castPoller.onNewMessages(messages => {
    for (const msg of messages) {
      const permMatch = msg.content.match(PERMISSION_REPLY_RE)
      if (permMatch && permissionRelay) {
        const behavior = permMatch[1].toLowerCase().startsWith('y') ? 'allow' as const : 'deny' as const
        const code = permMatch[2].toLowerCase()
        const resolved = permissionRelay.callbacks.resolve(code, behavior, 'cast:' + config.cast.privateBranch)
        if (resolved) {
          console.log(formatClairText(`Permission ${behavior === 'allow' ? '✓ granted' : '✗ denied'} (${code})`))
          continue
        }
      }

      const msgBranch = msg.branch ?? config.cast.privateBranch
      if (config.cast.mentionOnlyBranches.includes(msgBranch)) {
        const mentionRe = new RegExp(`@${config.cast.username}\\b`, 'i')
        if (!mentionRe.test(msg.content)) continue
      }

      const meta: Record<string, string> = {
        author: msg.author,
        message_id: msg.id,
        branch: msgBranch,
      }
      if (msg.threadId) {
        meta.thread_id = msg.threadId
      }
      const wrapped = wrapChannelMessage('cast:' + msgBranch, msg.content, meta)
      queue.enqueue({
        type: 'channel',
        content: wrapped,
        priority: 'next',
      })
      console.log(formatCastMessage(msg.author, msg.content, msg.threadId))
      statusLine.update({ mode: 'listening', lastActivity: `cast: ${msg.author}` })

      if (msg.threadId && castPoller) {
        castPoller.trackThread(msg.threadId, msg.branch)
      }
    }
  })
}

// --- Main loop ---

async function mainLoop() {
  await engine.start()
  tickLoop.start()
  castPoller?.start()
  triggerServer?.start()

  console.log(formatStatus('Engine started. Waiting for first tick...'))
  if (!flags['no-cast']) {
    console.log(formatStatus(`Cast channel: polling [${config.cast.branches.join(', ')}] every ${config.cast.pollIntervalMs / 1000}s`))
    if (permissionRelay) {
      console.log(formatStatus('Permission relay: active (reply on Cast to approve/deny)'))
    }
  }
  if (triggerServer) {
    console.log(formatStatus(`Triggers: listening on port ${triggerServer.port}`))
  }
  console.log()

  statusLine.update({ mode: 'idle', castConnected: !flags['no-cast'] })

  while (engine.isRunning()) {
    const msg = await queue.waitForMessage()
    const batch = [msg, ...queue.drain()]

    const ticks = batch.filter(m => m.type === 'tick')
    const nonTicks = batch.filter(m => m.type !== 'tick')
    const latest = ticks.length > 0 ? [ticks[ticks.length - 1]] : []

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
  if (handlerState.currentSessionId) {
    saveSession({
      sessionId: handlerState.currentSessionId,
      startedAt: previousSession?.startedAt ?? new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    })
    console.log(formatStatus(`Session saved (${handlerState.currentSessionId.slice(0, 8)}). Use --new-session to start fresh.`))
  }
  if (handlerState.sessionCostUsd > 0) {
    console.log(formatStatus(`Session cost: $${handlerState.sessionCostUsd.toFixed(2)} (${handlerState.sessionInputTokens.toLocaleString()} in / ${handlerState.sessionOutputTokens.toLocaleString()} out)`))
  }
  tickLoop.stop()
  castPoller?.stop()
  triggerServer?.stop()
  scheduler.stop()
  saveTasks(scheduler.getTasks())
  engine.stop()
  process.exit(0)
})

mainLoop().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
