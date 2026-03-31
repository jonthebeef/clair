import { describe, test, expect } from 'bun:test'
import { createMessageQueue, type QueueMessage } from './queue'

describe('MessageQueue', () => {
  test('dequeue returns undefined when empty', () => {
    const q = createMessageQueue()
    expect(q.dequeue()).toBeUndefined()
  })

  test('enqueue and dequeue in FIFO order', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'a' })
    q.enqueue({ type: 'tick', content: 'b' })
    expect(q.dequeue()?.content).toBe('a')
    expect(q.dequeue()?.content).toBe('b')
  })

  test('priority "next" jumps ahead of normal messages', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'normal' })
    q.enqueue({ type: 'channel', content: 'urgent', priority: 'next' })
    expect(q.dequeue()?.content).toBe('urgent')
    expect(q.dequeue()?.content).toBe('normal')
  })

  test('hasMessages reflects queue state', () => {
    const q = createMessageQueue()
    expect(q.hasMessages()).toBe(false)
    q.enqueue({ type: 'tick', content: 'a' })
    expect(q.hasMessages()).toBe(true)
    q.dequeue()
    expect(q.hasMessages()).toBe(false)
  })

  test('waitForMessage resolves when message enqueued', async () => {
    const q = createMessageQueue()
    const promise = q.waitForMessage()
    q.enqueue({ type: 'tick', content: 'wake' })
    const msg = await promise
    expect(msg.content).toBe('wake')
  })

  test('drain returns all messages and empties queue', () => {
    const q = createMessageQueue()
    q.enqueue({ type: 'tick', content: 'a' })
    q.enqueue({ type: 'tick', content: 'b' })
    const all = q.drain()
    expect(all).toHaveLength(2)
    expect(q.hasMessages()).toBe(false)
  })
})
