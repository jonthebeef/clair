import type { StreamMessage } from './conversation'
import type { createTickLoop } from './tick'
import type { createScheduler } from '../scheduler/cron'
import type { createCastPoller } from '../cast/poller'
import type { createStatusLine } from '../ui/status'
import { parseSleepDuration } from './tick'
import { saveTasks } from '../scheduler/persistence'
import {
  formatClairText,
  formatToolCall,
  formatToolResult,
  formatSleep,
  formatStatus,
} from '../ui/terminal'
import { formatWakeTime } from '../ui/status'

export type StreamHandlerDeps = {
  tickLoop: ReturnType<typeof createTickLoop>
  scheduler: ReturnType<typeof createScheduler>
  castPoller: ReturnType<typeof createCastPoller> | null
  statusLine: ReturnType<typeof createStatusLine>
  forwardToCast: (text: string) => void
  saveSession: (data: { sessionId: string; startedAt: string; lastActivity: string }) => void
  previousStartedAt: string | undefined
  engine: { restart(opts: { model: string; resumeSessionId: string }): Promise<void> }
}

export type StreamHandlerState = {
  currentSessionId: string | null
  sessionCostUsd: number
  sessionInputTokens: number
  sessionOutputTokens: number
  currentModel: string
  pendingModelSwitch: string | null
}

function shortModelName(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.replace(/^claude-/, '').replace(/\[.*\]$/, '')
}

function truncateStatus(s: string): string {
  const line = s.split('\n')[0].trim()
  return line.length > 40 ? line.slice(0, 37) + '...' : line
}

/** Match a tool name allowing MCP-prefixed forms like mcp__cast-channel__Sleep */
function matchToolName(toolName: string | undefined, baseName: string): boolean {
  if (!toolName) return false
  return toolName === baseName || toolName.endsWith(`__${baseName}`)
}

type ToolInterceptor = {
  handler: (input: unknown, deps: StreamHandlerDeps, state: StreamHandlerState) => void
  /** If true, suppress the generic tool-call log line */
  silent: boolean
}

const toolInterceptors: Record<string, ToolInterceptor> = {
  Sleep: {
    handler(input, deps) {
      const typed = input as { duration?: string } | undefined
      const duration = typed?.duration ?? '5m'
      const ms = parseSleepDuration(duration)
      deps.tickLoop.setSleepDuration(ms)
      console.log(formatSleep(duration, ms))
      deps.statusLine.update({ mode: 'sleeping', sleepUntil: formatWakeTime(ms) })
    },
    silent: true,
  },

  schedule_task: {
    handler(input, deps) {
      const typed = input as { cron?: string; prompt?: string; durable?: boolean } | undefined
      if (typed?.cron && typed?.prompt) {
        try {
          const task = deps.scheduler.addTask({
            cron: typed.cron,
            prompt: typed.prompt,
            durable: typed.durable ?? true,
          })
          if (task.durable) saveTasks(deps.scheduler.getTasks())
          console.log(formatClairText(`Scheduled task ${task.id}: "${typed.prompt}" (${typed.cron}), next: ${task.nextRun}`))
        } catch (e) {
          console.log(formatClairText(`Failed to schedule: ${(e as Error).message}`))
        }
      }
    },
    silent: true,
  },

  remove_task: {
    handler(input, deps) {
      const typed = input as { task_id?: string } | undefined
      if (typed?.task_id) {
        const removed = deps.scheduler.removeTask(typed.task_id)
        saveTasks(deps.scheduler.getTasks())
        console.log(formatClairText(removed ? `Removed task ${typed.task_id}` : `Task ${typed.task_id} not found`))
      }
    },
    silent: true,
  },

  list_tasks: {
    handler(_input, deps) {
      const tasks = deps.scheduler.getTasks()
      if (tasks.length === 0) {
        console.log(formatClairText('No scheduled tasks'))
      } else {
        for (const t of tasks) {
          console.log(formatClairText(`  ${t.id}: "${t.prompt}" (${t.cron}) next: ${t.nextRun}`))
        }
      }
    },
    silent: true,
  },

  cast_reply: {
    handler(input, deps) {
      const typed = input as { message_id?: string } | undefined
      if (typed?.message_id && deps.castPoller) {
        deps.castPoller.trackThread(typed.message_id)
      }
    },
    silent: false,
  },

  switch_model: {
    handler(input, _deps, state) {
      const typed = input as { model?: string; reason?: string } | undefined
      if (typed?.model && typed.model !== state.currentModel) {
        state.pendingModelSwitch = typed.model
        const reason = typed.reason ? ` — ${typed.reason}` : ''
        console.log(formatClairText(`Switching to ${typed.model}${reason}`))
      }
    },
    silent: true,
  },
}

/** Internal tools that should never be logged */
const SILENT_TOOLS = ['ToolSearch']

function findInterceptor(toolName: string | undefined): ToolInterceptor | undefined {
  if (!toolName) return undefined
  for (const [baseName, interceptor] of Object.entries(toolInterceptors)) {
    if (matchToolName(toolName, baseName)) return interceptor
  }
  return undefined
}

function isSilentTool(toolName: string | undefined): boolean {
  if (!toolName) return false
  return SILENT_TOOLS.some(name => matchToolName(toolName, name))
}

export function createStreamHandler(deps: StreamHandlerDeps, state: StreamHandlerState) {
  return function handleMessage(msg: StreamMessage) {
    // Capture session ID from any message
    const sessionId = (msg as Record<string, unknown>).session_id as string | undefined
    if (sessionId && sessionId !== state.currentSessionId) {
      state.currentSessionId = sessionId
      deps.saveSession({
        sessionId,
        startedAt: deps.previousStartedAt ?? new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      })
    }

    // Capture model from init or assistant messages
    if (msg.type === 'system' && (msg as Record<string, unknown>).subtype === 'init') {
      const model = (msg as Record<string, unknown>).model as string | undefined
      if (model) {
        state.currentModel = shortModelName(model)
        deps.statusLine.update({ model: state.currentModel })
      }
    }
    if (msg.type === 'assistant') {
      const model = (msg.message as Record<string, unknown> | undefined)?.model as string | undefined
      if (model) {
        state.currentModel = shortModelName(model)
        deps.statusLine.update({ model: state.currentModel })
      }
    }

    // Capture cost + tokens from result messages
    if (msg.type === 'result') {
      const cost = (msg as Record<string, unknown>).total_cost_usd as number | undefined
      const usage = (msg as Record<string, unknown>).usage as Record<string, unknown> | undefined
      if (cost) state.sessionCostUsd += cost
      if (usage) {
        state.sessionInputTokens += (usage.input_tokens as number ?? 0) + (usage.cache_read_input_tokens as number ?? 0)
        state.sessionOutputTokens += (usage.output_tokens as number ?? 0)
      }
      deps.statusLine.update({
        cost: state.sessionCostUsd,
        tokensIn: state.sessionInputTokens,
        tokensOut: state.sessionOutputTokens,
      })

      // Execute pending model switch after turn completes
      if (state.pendingModelSwitch && state.currentSessionId) {
        const newModel = state.pendingModelSwitch
        state.pendingModelSwitch = null
        console.log(formatStatus(`Restarting with model: ${newModel}`))
        deps.engine.restart({ model: newModel, resumeSessionId: state.currentSessionId }).then(() => {
          state.currentModel = newModel
          deps.statusLine.update({ model: newModel })
          console.log(formatStatus(`Now running on ${newModel}`))
        }).catch(err => {
          console.error('Model switch failed:', err)
        })
      }
    }

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
              deps.forwardToCast(text.trim())
              deps.statusLine.update({ mode: 'working', lastActivity: truncateStatus(text) })
            }
          }

          if (typed.type === 'tool_use') {
            const toolName = typed.name as string | undefined
            const interceptor = findInterceptor(toolName)

            if (interceptor) {
              interceptor.handler(typed.input, deps, state)
            }

            // Log tool call unless interceptor is silent or tool is internal
            const shouldLog = !isSilentTool(toolName) && (!interceptor || !interceptor.silent)
            if (shouldLog) {
              console.log(formatToolCall({
                name: typed.name as string,
                input: typed.input as Record<string, unknown>,
              }))
            }
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
  }
}
