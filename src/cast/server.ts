import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CAST_TOOLS, executeCastTool } from './tools.js'

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

const SCHEDULE_TOOLS = [
  {
    name: 'schedule_task',
    description: 'Create a recurring scheduled task. The prompt will be injected into the conversation when the cron fires. Use standard 5-field cron expressions (minute hour day-of-month month day-of-week). Examples: "0 9 * * *" = daily at 9am, "*/5 * * * *" = every 5 minutes, "0 9 * * 1-5" = weekday mornings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cron: { type: 'string', description: 'Cron expression, e.g. "0 9 * * *"' },
        prompt: { type: 'string', description: 'What to do when the task fires' },
        durable: { type: 'boolean', description: 'Persist across restarts (default true)' },
      },
      required: ['cron', 'prompt'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all scheduled tasks with their IDs, cron expressions, and next run times.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'remove_task',
    description: 'Remove a scheduled task by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task ID to remove' },
      },
      required: ['task_id'],
    },
  },
]

const SWITCH_MODEL_TOOL = {
  name: 'switch_model',
  description: `Switch to a different Claude model. Use this BEFORE starting work that needs a different capability level.

Rules:
- **haiku**: Use for greetings, simple replies, status checks, Cast chit-chat, sleep decisions. CHEAPEST.
- **sonnet**: Use for standard coding tasks, refactoring, writing tests, multi-file edits, moderate debugging.
- **opus**: Use ONLY for architecture decisions, complex debugging across many files, ambiguous requirements, security-sensitive changes, or novel problems.

You start on haiku. Escalate when the task demands it, then switch back to haiku when done.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      model: {
        type: 'string',
        enum: ['haiku', 'sonnet', 'opus'],
        description: 'Target model',
      },
      reason: {
        type: 'string',
        description: 'Brief reason for switching (shown in terminal)',
      },
    },
    required: ['model'],
  },
}

const SLEEP_TOOL = {
  name: 'Sleep',
  description: 'Set how long to wait before the next tick wake-up. Use this when you have nothing to do. Accepts durations like "30s", "5m", "10m". Max 30 minutes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      duration: { type: 'string', description: 'How long to sleep, e.g. "30s", "5m", "10m"' },
    },
    required: ['duration'],
  },
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...CAST_TOOLS, SLEEP_TOOL, SWITCH_MODEL_TOOL, ...SCHEDULE_TOOLS],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Sleep is handled by the main process via stream interception — just ack it
  if (name === 'Sleep') {
    const duration = (args as Record<string, string>)?.duration ?? '5m'
    return { content: [{ type: 'text', text: `Sleeping for ${duration}` }] }
  }

  // Model switch is handled by the main process — ack and let the turn complete
  if (name === 'switch_model') {
    const a = args as Record<string, string>
    return { content: [{ type: 'text', text: `Switching to ${a.model}` }] }
  }

  // Schedule tools are handled by the main process via stream interception
  if (name === 'schedule_task') {
    const a = args as Record<string, unknown>
    return { content: [{ type: 'text', text: `Scheduling task: "${a.prompt}" with cron "${a.cron}"` }] }
  }
  if (name === 'list_tasks') {
    // Main process will intercept and inject actual task list via text output
    return { content: [{ type: 'text', text: 'Listing tasks (see terminal output)' }] }
  }
  if (name === 'remove_task') {
    const a = args as Record<string, string>
    return { content: [{ type: 'text', text: `Removing task ${a.task_id}` }] }
  }

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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
