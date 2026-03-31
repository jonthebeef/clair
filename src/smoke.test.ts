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
