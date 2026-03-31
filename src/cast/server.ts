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
  tools: [...CAST_TOOLS, SLEEP_TOOL],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Sleep is handled by the main process via stream interception — just ack it
  if (name === 'Sleep') {
    const duration = (args as Record<string, string>)?.duration ?? '5m'
    return { content: [{ type: 'text', text: `Sleeping for ${duration}` }] }
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

const poller = createCastPoller({
  branches,
  intervalMs: pollIntervalMs,
})

poller.onNewMessages(messages => {
  for (const msg of messages) {
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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  poller.start()
}

main().catch(console.error)
