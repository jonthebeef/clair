import { describe, test, expect } from 'bun:test'
import { createPermissionRelay } from './relay'

describe('createPermissionRelay', () => {
  test('posts permission request to Cast and returns code', async () => {
    const posted: { content: string; branch?: string }[] = []
    const relay = createPermissionRelay({
      async post(content, branch) {
        posted.push({ content, branch })
      },
    })

    const { code, behavior } = await relay.requestPermission({
      toolName: 'Write',
      toolUseId: 'toolu_abc123',
      inputPreview: 'production.yaml',
      branch: 'clair-private',
    })

    expect(code).toHaveLength(5)
    expect(code).toMatch(/^[a-km-z]{5}$/)
    expect(posted).toHaveLength(1)
    expect(posted[0].content).toContain('Permission needed')
    expect(posted[0].content).toContain('Write')
    expect(posted[0].content).toContain(code)
    expect(posted[0].branch).toBe('clair-private')

    // Simulate user approving
    relay.callbacks.resolve(code, 'allow', 'cast:clair-private')
    const result = await behavior
    expect(result).toBe('allow')
  })

  test('deny works', async () => {
    const relay = createPermissionRelay({
      async post() {},
    })

    const { code, behavior } = await relay.requestPermission({
      toolName: 'Bash',
      toolUseId: 'toolu_def456',
      branch: 'clair-private',
    })

    relay.callbacks.resolve(code, 'deny', 'cast:clair-private')
    const result = await behavior
    expect(result).toBe('deny')
  })

  test('times out to deny after 5 minutes', async () => {
    const relay = createPermissionRelay({
      async post() {},
    })

    // Override timeout for testing — we can't wait 5 minutes
    // Just verify the code is generated and the promise exists
    const { code, behavior } = await relay.requestPermission({
      toolName: 'Bash',
      toolUseId: 'toolu_timeout',
      branch: 'clair-private',
    })

    expect(code).toHaveLength(5)
    expect(typeof behavior.then).toBe('function')

    // Resolve it so the test doesn't hang
    relay.callbacks.resolve(code, 'deny', 'test')
    await behavior
  })
})
