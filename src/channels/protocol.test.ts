import { describe, test, expect } from 'bun:test'
import { wrapChannelMessage, parseChannelNotification } from './protocol'

describe('wrapChannelMessage', () => {
  test('wraps content in channel tags with source', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello world')
    expect(wrapped).toBe('<channel source="cast:main">\nhello world\n</channel>')
  })

  test('includes meta as attributes', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      branch: 'clair-private',
      author: 'jon',
    })
    expect(wrapped).toContain('branch="clair-private"')
    expect(wrapped).toContain('author="jon"')
  })

  test('rejects unsafe meta keys', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      'good_key': 'ok',
      'bad"key': 'nope',
    })
    expect(wrapped).toContain('good_key="ok"')
    expect(wrapped).not.toContain('bad')
  })

  test('escapes XML in values', () => {
    const wrapped = wrapChannelMessage('cast:main', 'hello', {
      author: 'Jon & "friends"',
    })
    expect(wrapped).toContain('author="Jon &amp; &quot;friends&quot;"')
  })
})

describe('parseChannelNotification', () => {
  test('parses valid notification', () => {
    const notif = parseChannelNotification({
      method: 'notifications/claude/channel',
      params: { content: 'hello', meta: { branch: 'main' } },
    })
    expect(notif?.content).toBe('hello')
    expect(notif?.meta?.branch).toBe('main')
  })

  test('returns null for wrong method', () => {
    const notif = parseChannelNotification({
      method: 'notifications/other',
      params: { content: 'hello' },
    })
    expect(notif).toBeNull()
  })

  test('returns null for missing content', () => {
    const notif = parseChannelNotification({
      method: 'notifications/claude/channel',
      params: {},
    })
    expect(notif).toBeNull()
  })
})
