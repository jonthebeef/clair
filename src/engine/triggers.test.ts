import { describe, test, expect, afterEach } from 'bun:test'
import { createTriggerServer } from './triggers'
import { createMessageQueue } from './queue'

describe('createTriggerServer', () => {
  let server: ReturnType<typeof createTriggerServer> | null = null

  afterEach(() => {
    server?.stop()
    server = null
  })

  test('health check returns ok', async () => {
    const queue = createMessageQueue()
    server = createTriggerServer({ queue, port: 14117 })
    server.start()

    const res = await fetch('http://localhost:14117/health')
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('trigger injects message into queue', async () => {
    const queue = createMessageQueue()
    server = createTriggerServer({ queue, port: 14118 })
    server.start()

    const res = await fetch('http://localhost:14118/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'deploy to prod', source: 'github' }),
    })
    const body = await res.json()
    expect(body.ok).toBe(true)

    const msg = queue.drain()
    expect(msg).toHaveLength(1)
    expect(msg[0].content).toContain('deploy to prod')
    expect(msg[0].content).toContain('source="github"')
  })

  test('rejects missing prompt', async () => {
    const queue = createMessageQueue()
    server = createTriggerServer({ queue, port: 14119 })
    server.start()

    const res = await fetch('http://localhost:14119/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test' }),
    })
    expect(res.status).toBe(400)
  })

  test('enforces secret when configured', async () => {
    const queue = createMessageQueue()
    server = createTriggerServer({ queue, port: 14120, secret: 'mysecret' })
    server.start()

    // No auth
    const res1 = await fetch('http://localhost:14120/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    })
    expect(res1.status).toBe(401)

    // With auth
    const res2 = await fetch('http://localhost:14120/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mysecret',
      },
      body: JSON.stringify({ prompt: 'test' }),
    })
    expect(res2.status).toBe(200)
  })
})
