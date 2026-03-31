import { describe, test, expect } from 'bun:test'
import {
  formatClairText,
  formatCastMessage,
  formatToolCall,
  formatToolResult,
  formatSleep,
  formatPermissionRequest,
} from './terminal'

describe('terminal UI', () => {
  test('formatClairText includes clair prefix', () => {
    const out = formatClairText('hello world')
    expect(out).toContain('clair:')
    expect(out).toContain('hello world')
  })

  test('formatCastMessage includes author and content', () => {
    const out = formatCastMessage('Jon', 'hi there')
    expect(out).toContain('cast:')
    expect(out).toContain('Jon')
    expect(out).toContain('hi there')
  })

  test('formatCastMessage shows thread tag', () => {
    const out = formatCastMessage('Jon', 'reply', 'abc123')
    expect(out).toContain('(thread)')
  })

  test('formatToolCall shows tool name', () => {
    const out = formatToolCall({ name: 'Read', input: { file: 'test.ts' } })
    expect(out).toContain('Read')
    expect(out).toContain('test.ts')
  })

  test('formatToolResult shows error on failure', () => {
    const out = formatToolResult({ name: 'Write', output: 'Permission denied', isError: true })
    expect(out).toContain('error')
    expect(out).toContain('Permission denied')
  })

  test('formatSleep shows duration', () => {
    const out = formatSleep('5m', 300_000)
    expect(out).toContain('sleeping 5m')
    expect(out).toContain('300s')
  })

  test('formatPermissionRequest shows code', () => {
    const out = formatPermissionRequest('Write production.yaml', 'tbxkq')
    expect(out).toContain('Permission needed')
    expect(out).toContain('yes tbxkq')
    expect(out).toContain('no tbxkq')
  })
})
