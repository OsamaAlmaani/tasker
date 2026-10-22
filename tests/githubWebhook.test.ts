import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubWebhook } from '../convex/http'

afterEach(() => vi.unstubAllEnvs())

describe('GitHub HTTP webhook', () => {
  const handle = (githubWebhook as unknown as { _handler: (ctx: any, request: Request) => Promise<Response> })._handler
  function request(body: string, event = 'pull_request', signed = true) {
    return new Request('https://example.convex.site/github/webhook', { method: 'POST', body, headers: {
      'X-GitHub-Event': event, 'X-GitHub-Delivery': 'delivery-1',
      'X-Hub-Signature-256': signed ? `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}` : 'sha256=bad',
    } })
  }
  it('rejects unsigned requests before invoking persistence', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'secret')
    const runMutation = vi.fn()
    expect((await handle({ runMutation }, request('{}', 'push', false))).status).toBe(401)
    expect(runMutation).not.toHaveBeenCalled()
  })
  it('queues an exact PR head branch without trusting status from the payload', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'secret')
    const args: unknown[] = []
    const runMutation = async (_ref: unknown, data: unknown) => { args.push(data) }
    const body = JSON.stringify({ repository: { id: 123 }, installation: { id: 7 }, action: 'closed', pull_request: { head: { ref: 'feature/TASK-1', repo: { id: 123 } }, merged: true } })
    expect((await handle({ runMutation }, request(body))).status).toBe(202)
    expect(args).toEqual([{ deliveryId: 'delivery-1', repositoryId: 123, branch: 'feature/TASK-1', installationId: 7 }])
  })
  it('ignores tags and fork PRs even if their branch name matches a task', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'secret')
    const runMutation = vi.fn()
    const tag = JSON.stringify({ repository: { id: 123 }, ref: 'refs/tags/feature/TASK-1' })
    expect((await handle({ runMutation }, request(tag, 'push'))).status).toBe(204)
    const fork = JSON.stringify({ repository: { id: 123 }, pull_request: { head: { ref: 'feature/TASK-1', repo: { id: 999 } } } })
    expect((await handle({ runMutation }, request(fork))).status).toBe(204)
    expect(runMutation).not.toHaveBeenCalled()
  })
  it('accepts installation removal and rejects malformed signed JSON', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'secret')
    const args: unknown[] = []
    const ctx = { runMutation: async (_ref: unknown, data: unknown) => { args.push(data) } }
    expect((await handle(ctx, request(JSON.stringify({ installation: { id: 7 }, action: 'deleted' }), 'installation'))).status).toBe(202)
    expect(args[0]).toEqual({ deliveryId: 'delivery-1', installationId: 7, disableInstallation: true })
    expect((await handle(ctx, request('not json'))).status).toBe(400)
  })
})
