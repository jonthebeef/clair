import { describe, test, expect } from 'bun:test'
import { parseCastOutput, diffMessages } from './poller'

describe('parseCastOutput', () => {
  test('extracts message IDs and content from cast branch output', () => {
    const output = `msg_abc123 | jon | 2026-03-31 14:00 | Hello from Cast
msg_def456 | jon | 2026-03-31 14:01 | Another message`
    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg_abc123')
    expect(messages[0].author).toBe('jon')
    expect(messages[0].content).toBe('Hello from Cast')
  })

  test('handles empty output', () => {
    expect(parseCastOutput('')).toEqual([])
  })
})

describe('diffMessages', () => {
  test('returns only new messages', () => {
    const prev = new Set(['msg_abc123'])
    const current = [
      { id: 'msg_abc123', author: 'jon', content: 'old', timestamp: '' },
      { id: 'msg_def456', author: 'jon', content: 'new', timestamp: '' },
    ]
    const newMsgs = diffMessages(current, prev)
    expect(newMsgs).toHaveLength(1)
    expect(newMsgs[0].id).toBe('msg_def456')
  })

  test('returns empty when no new messages', () => {
    const prev = new Set(['msg_abc123'])
    const current = [
      { id: 'msg_abc123', author: 'jon', content: 'old', timestamp: '' },
    ]
    expect(diffMessages(current, prev)).toEqual([])
  })
})
