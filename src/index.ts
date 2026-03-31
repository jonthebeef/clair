#!/usr/bin/env bun

import { parseArgs } from 'util'
import { resolve } from 'path'
import { writeFileSync } from 'fs'
import { loadConfig } from './config/settings'
import { getProactiveSystemPrompt } from './config/prompts'
import { createMessageQueue } from './engine/queue'
import { createTickLoop } from './engine/tick'
import { createConversationEngine, type StreamMessage } from './engine/conversation'
import { createScheduler } from './scheduler/cron'
import { loadTasks, saveTasks } from './scheduler/persistence'
import { createCastPoller } from './cast/poller'
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

// --- Handle Claude's responses ---

engine.onMessage((msg: StreamMessage) => {
  if (msg.type === 'assistant') {
    const content = msg.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          (block as { type: string }).type === 'text'
        ) {
          const text = (block as { type: string; text: string }).text
          if (text.trim()) {
            console.log(`\x1b[33mclair:\x1b[0m ${text}`)
          }
        }
      }
    }
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

// --- Cast poller (runs in main process, not MCP) ---
// Claude Code's channel notification handler is compile-gated behind
// feature('KAIROS_CHANNELS'), so MCP notifications are ignored.
// Instead we poll Cast directly and inject messages into the queue.

let castPoller: ReturnType<typeof createCastPoller> | null = null
if (!flags['no-cast']) {
  castPoller = createCastPoller({
    branches: config.cast.branches,
    intervalMs: config.cast.pollIntervalMs,
  })

  castPoller.onNewMessages(messages => {
    for (const msg of messages) {
      const wrapped = wrapChannelMessage('cast:' + config.cast.privateBranch, msg.content, {
        author: msg.author,
        message_id: msg.id,
        branch: config.cast.privateBranch,
      })
      queue.enqueue({
        type: 'channel',
        content: wrapped,
        priority: 'next',
      })
      console.log(`\x1b[35mcast:\x1b[0m ${msg.author}: ${msg.content}`)
    }
  })
}

// --- Main loop: drain queue → send to Claude ---

async function mainLoop() {
  await engine.start()
  tickLoop.start()
  castPoller?.start()

  console.log('\x1b[32m✓\x1b[0m Engine started. Waiting for first tick...')
  if (!flags['no-cast']) {
    console.log(`\x1b[32m✓\x1b[0m Cast channel: polling [${config.cast.branches.join(', ')}] every ${config.cast.pollIntervalMs / 1000}s`)
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
