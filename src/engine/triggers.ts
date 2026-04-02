/**
 * Remote triggers — HTTP server that accepts webhook POSTs
 * and injects them into the message queue.
 *
 * POST /trigger — inject a message into Clair's queue
 *   Body: { "prompt": "...", "source": "github", "priority": "next" }
 *
 * GET /health — health check
 */

import { timingSafeEqual } from 'crypto'
import { escapeXmlAttr } from '../channels/protocol'
import type { MessageQueue } from './queue'

export type TriggerServer = {
  start(): void
  stop(): void
  port: number
}

export function createTriggerServer(opts: {
  queue: MessageQueue
  port?: number
  secret?: string // optional shared secret for auth
}): TriggerServer {
  const port = opts.port ?? 4117
  let server: ReturnType<typeof Bun.serve> | null = null

  return {
    port,

    start() {
      server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url)

          if (url.pathname === '/health' && req.method === 'GET') {
            return new Response(JSON.stringify({ ok: true }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (url.pathname === '/trigger' && req.method === 'POST') {
            // Auth check
            if (opts.secret) {
              const auth = req.headers.get('Authorization') ?? ''
              const expected = `Bearer ${opts.secret}`
              const authBuf = Buffer.from(auth)
              const expectedBuf = Buffer.from(expected)
              if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
                return new Response(JSON.stringify({ error: 'unauthorized' }), {
                  status: 401,
                  headers: { 'Content-Type': 'application/json' },
                })
              }
            }

            return req.json().then((body: { prompt?: string; source?: string; priority?: string }) => {
              if (!body.prompt) {
                return new Response(JSON.stringify({ error: 'prompt required' }), {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                })
              }

              const source = body.source ?? 'webhook'
              const content = `<trigger source="${escapeXmlAttr(source)}">\n${body.prompt}\n</trigger>`

              opts.queue.enqueue({
                type: 'channel',
                content,
                priority: body.priority === 'next' ? 'next' : undefined,
              })

              return new Response(JSON.stringify({ ok: true, source }), {
                headers: { 'Content-Type': 'application/json' },
              })
            }).catch(() => {
              return new Response(JSON.stringify({ error: 'invalid json' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              })
            })
          }

          return new Response('Not Found', { status: 404 })
        },
      })
    },

    stop() {
      server?.stop()
      server = null
    },
  }
}
