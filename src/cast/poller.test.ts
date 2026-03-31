import { describe, test, expect } from 'bun:test'
import { parseCastOutput, diffMessages } from './poller'

describe('parseCastOutput', () => {
  test('extracts message IDs, content, and author from ANSI output', () => {
    // Real Cast CLI output with ANSI bold (\x1b[1m) around name, dim (\x1b[2m) around role
    const output = [
      '# clair-private',
      '',
      '\x1b[1mJon Grant\x1b[0m \x1b[2mProduct Leader | Strategist | Builder\x1b[0m  just now  mnf4mcah-721o1r30',
      '  hello from the other side',
      '',
      '\x1b[1mJon Grant\x1b[0m \x1b[2mProduct Leader | Strategist | Builder\x1b[0m  just now  mnf4lr58-160f0o00',
      '  Started the branch **clair-private**',
    ].join('\n')

    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('mnf4mcah-721o1r30')
    expect(messages[0].author).toBe('Jon Grant')
    expect(messages[0].content).toBe('hello from the other side')
    expect(messages[1].id).toBe('mnf4lr58-160f0o00')
    expect(messages[1].author).toBe('Jon Grant')
  })

  test('extracts author from plain text (no ANSI) with pipe separator', () => {
    const output = `# clair-private

Jon Grant  Product Leader | Strategist | Builder  just now  mnf4mcah-721o1r30
  hello from the other side`
    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(1)
    // Without ANSI bold markers, extractAuthorFromRaw returns 'unknown'
    expect(messages[0].id).toBe('mnf4mcah-721o1r30')
    expect(messages[0].content).toBe('hello from the other side')
  })

  test('handles empty output', () => {
    expect(parseCastOutput('')).toEqual([])
  })

  test('handles output with no content lines', () => {
    const output = `# clair-private

\x1b[1mJon Grant\x1b[0m \x1b[2mProduct Leader\x1b[0m  just now  abc123-def456`
    // No indented content line follows — should not produce a message
    const messages = parseCastOutput(output)
    expect(messages).toHaveLength(0)
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
