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
      const branchArgs = args.branch ? ['--branch', args.branch] : []
      return await $`${castCmd} post ${args.content} ${branchArgs}`.text()
    }
    case 'cast_reply':
      return await $`${castCmd} reply ${args.message_id} ${args.content}`.text()
    case 'cast_react':
      return await $`${castCmd} react ${args.message_id} ${args.emoji}`.text()
    case 'cast_read':
      return await $`${castCmd} branch ${args.branch}`.text()
    case 'cast_search': {
      const branchArgs = args.branch ? ['--branch', args.branch] : []
      return await $`${castCmd} search ${args.query} ${branchArgs}`.text()
    }
    default:
      throw new Error(`Unknown cast tool: ${name}`)
  }
}
