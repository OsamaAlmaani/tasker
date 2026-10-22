import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { GithubClient, createAppJwt, installationClient } from '../convex/lib/githubClient'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('GitHub API boundary', () => {
  it('creates the exact branch ref from the selected base commit', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return Response.json(url.endsWith('/git/refs') ? { ref: 'refs/heads/feature/TASK-1' } : { object: { sha: 'a'.repeat(40) } })
    })
    const client = new GithubClient('token')
    const sha = await client.branchSha('owner', 'repo', 'main')
    await client.createBranch('owner', 'repo', 'feature/TASK-1', sha!)
    expect(requests[0].url).toBe('https://api.github.com/repos/owner/repo/git/ref/heads/main')
    expect(JSON.parse(requests[1].init!.body as string)).toEqual({ ref: 'refs/heads/feature/TASK-1', sha: 'a'.repeat(40) })
    expect((requests[1].init!.headers as Record<string, string>).Authorization).toBe('Bearer token')
  })
  it('distinguishes a missing branch from permission/rate-limit failures without leaking response secrets', async () => {
    const client = new GithubClient('token')
    vi.stubGlobal('fetch', async () => new Response('secret-token', { status: 404 }))
    expect(await client.branchSha('owner', 'repo', 'gone')).toBeNull()
    vi.stubGlobal('fetch', async () => new Response('secret-token', { status: 403 }))
    await expect(client.branchSha('owner', 'repo', 'main')).rejects.toThrow(/403/)
    await expect(client.branchSha('owner', 'repo', 'main')).rejects.not.toThrow(/secret-token/)
  })
  it('reads the tracked PR by number and uses merged state even after branch deletion', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url)
      if (url.includes('/git/ref/')) return new Response('', { status: 404 })
      return Response.json({ number: 42, state: 'closed', draft: false, merged: true, merged_at: '2026-10-12T00:00:00Z', base: { ref: 'main', repo: { id: 123 } }, head: { ref: 'feature/TASK-1', repo: { id: 123 } } })
    })
    const snapshot = await new GithubClient('token').snapshot({ owner: 'owner', repo: 'repo', repositoryId: 123, branch: 'feature/TASK-1', pullNumber: 42 })
    expect(snapshot).toEqual({ branchExists: false, pullRequest: { number: 42, state: 'merged', baseBranch: 'main', url: 'https://github.com/owner/repo/pull/42' } })
    expect(requests.some(url => url.endsWith('/pulls/42'))).toBe(true)
    expect(requests.some(url => url.includes('?head='))).toBe(false)
  })
  it('never adopts PRs from a fork or another head branch', async () => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('/git/ref/') ? { object: { sha: 'a'.repeat(40) } } : [{ number: 42, state: 'open', draft: false, base: { ref: 'main', repo: { id: 123 } }, head: { ref: 'feature/TASK-1', repo: { id: 999 } } }]))
    expect(await new GithubClient('token').snapshot({ owner: 'owner', repo: 'repo', repositoryId: 123, branch: 'feature/TASK-1' })).toEqual({ branchExists: true })
  })
  it('does not adopt a historical merged PR after recreating its deleted branch name', async () => {
    const historical = { number: 7, state: 'closed', draft: false, merged: true, merged_at: '2026-01-01T00:00:00Z', base: { ref: 'main', repo: { id: 123 } }, head: { ref: 'feature/reused', repo: { id: 123 } } }
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/git/ref/')) return Response.json({ object: { sha: 'a'.repeat(40) } })
      if (url.endsWith('/git/refs')) return Response.json({ ref: 'refs/heads/feature/reused' })
      return Response.json([historical])
    })
    const client = new GithubClient('token')
    const minimumPullNumber = await client.pullRequestBaseline('owner', 'repo', 'feature/reused')
    expect(minimumPullNumber).toBe(7)
    await client.createBranch('owner', 'repo', 'feature/reused', 'a'.repeat(40))
    expect(await client.snapshot({ owner: 'owner', repo: 'repo', repositoryId: 123, branch: 'feature/reused', minimumPullNumber })).toEqual({ branchExists: true })
  })
  it('signs a short-lived App JWT and scopes installation credentials to a single repo', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('GITHUB_APP_ID', '123')
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    const jwt = createAppJwt()
    const [header, payload, signature] = jwt.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg).toBe('RS256')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expect(claims.iss).toBe('123')
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(privateKey), Buffer.from(signature, 'base64url'))).toBe(true)
    let body: unknown
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); return Response.json({ token: 'temporary' }) })
    expect(await installationClient(7, 123)).toBeInstanceOf(GithubClient)
    expect(body).toEqual({ repository_ids: [123], permissions: { contents: 'write', pull_requests: 'read' } })
  })
})
