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
    expect(args).toContain('--verbose')
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
