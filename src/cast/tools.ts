import { loadCastConfig } from './config'

async function castApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<string> {
  const config = loadCastConfig()
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.text()
  if (!res.ok) throw new Error(`Cast API ${res.status}: ${data}`)
  return data
}

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
    case 'cast_post':
      return await castApi('POST', '/messages', {
        content: args.content,
        branch_id: args.branch || undefined,
      })
    case 'cast_reply':
      return await castApi('POST', `/threads/${args.message_id}/reply`, {
        content: args.content,
      })
    case 'cast_react':
      return await castApi('POST', `/messages/${args.message_id}/react`, {
        emoji: args.emoji,
      })
    case 'cast_read':
      return await castApi('GET', `/branches/${args.branch}`)
    case 'cast_search': {
      const params = new URLSearchParams({ q: args.query })
      if (args.branch) params.set('branch', args.branch)
      return await castApi('GET', `/search?${params}`)
    }
    default:
      throw new Error(`Unknown cast tool: ${name}`)
  }
}
