import { describe, test, expect } from 'bun:test'
import { parseCastOutput, diffMessages } from './poller'

describe('parseCastOutput', () => {
  test('extracts message IDs and content from real cast branch output', () => {
    const output = `# clair-private

Jon Grant  Product Leader | Strategist | Builder  just now  mnf4mcah-721o1r30
  hello from the other side

Jon Grant  Product Leader | Strategist | Builder  just now  mnf4lr58-160f0o00
  Started the branch **clair-private**`
    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('mnf4mcah-721o1r30')
    expect(messages[0].author).toBe('Jon Grant')
    expect(messages[0].content).toBe('hello from the other side')
    expect(messages[1].id).toBe('mnf4lr58-160f0o00')
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
