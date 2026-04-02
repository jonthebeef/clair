import { describe, test, expect } from 'bun:test'
import { wrapChannelMessage, wrapCdata, parseChannelNotification } from './protocol'

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

  test('wraps content in CDATA when it contains closing tag', () => {
    const wrapped = wrapChannelMessage('cast:main', 'before </channel> after')
    expect(wrapped).toContain('<![CDATA[before </channel> after]]>')
    expect(wrapped).not.toContain('\nbefore </channel> after\n')
  })

  test('does not use CDATA when content is safe', () => {
    const wrapped = wrapChannelMessage('cast:main', 'safe content')
    expect(wrapped).not.toContain('CDATA')
    expect(wrapped).toContain('\nsafe content\n')
  })

  test('escapes ]]> inside CDATA content', () => {
    const wrapped = wrapChannelMessage('cast:main', 'a]]></channel>b')
    expect(wrapped).toContain('<![CDATA[a]]]]><![CDATA[></channel>b]]>')
  })
})

describe('wrapCdata', () => {
  test('returns content unchanged when no closing tag present', () => {
    expect(wrapCdata('hello world', '</trigger>')).toBe('hello world')
  })

  test('wraps in CDATA when closing tag is present', () => {
    const result = wrapCdata('bad </trigger> stuff', '</trigger>')
    expect(result).toBe('<![CDATA[bad </trigger> stuff]]>')
  })

  test('escapes ]]> sequences inside CDATA', () => {
    const result = wrapCdata('a]]></trigger>b', '</trigger>')
    expect(result).toBe('<![CDATA[a]]]]><![CDATA[></trigger>b]]>')
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
