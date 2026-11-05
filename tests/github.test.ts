import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../convex/_generated/dataModel'
import * as githubActions from '../convex/githubActions'
import {
  normalizeCheckContext,
  normalizePullRequestDetail,
  normalizePullRequestSummary,
  parseRepositoryReference,
  type RawPullRequestDetail,
  toGitHubError,
} from '../convex/lib/githubApi'
import {
  bytesToBase64,
  decryptSecret,
  encryptSecret,
  importEncryptionKey,
} from '../convex/lib/githubCrypto'

const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: any, args: Record<string, unknown>) => Promise<any> })._handler

const keySecret = bytesToBase64(new Uint8Array(32).fill(7))
const projectId = 'project' as Id<'projects'>


function rawPullRequest(overrides: Partial<RawPullRequestDetail> = {}): RawPullRequestDetail {
  return {
    id: 'PR_node',
    number: 12,
    title: 'Add GitHub integration',
    url: 'https://github.com/acme/app/pull/12',
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-02T10:00:00Z',
    closedAt: null,
    mergedAt: null,
    author: { login: 'octocat', avatarUrl: 'https://avatars/octocat', url: 'https://github.com/octocat' },
    headRefName: 'feature/github',
    baseRefName: 'main',
    reviewDecision: 'CHANGES_REQUESTED',
    mergeable: 'CONFLICTING',
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    comments: { totalCount: 1 },
    labels: { nodes: [{ name: 'feature', color: '00ff00' }, null] },
    assignees: { nodes: [{ login: 'hubot', avatarUrl: null }] },
    reviewRequests: {
      nodes: [
        { requestedReviewer: { __typename: 'User', login: 'reviewer' } },
        { requestedReviewer: { __typename: 'Team', name: 'core' } },
      ],
    },
    commits: {
      totalCount: 3,
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                nodes: [
                  { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null },
                  { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'TIMED_OUT', detailsUrl: 'https://ci/test' },
                  { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: null, description: 'Waiting' },
                ],
              },
            },
          },
        },
      ],
    },
    body: 'Body',
    headRefOid: 'abc123',
    headRepository: { nameWithOwner: 'acme/app' },
    isCrossRepository: false,
    mergeStateStatus: 'DIRTY',
    mergedBy: null,
    files: { totalCount: 1, nodes: [{ path: 'src/a.ts', additions: 10, deletions: 2, changeType: 'MODIFIED' }] },
    timelineComments: {
      nodes: [{ id: 'c1', url: null, body: 'Later comment', createdAt: '2026-11-02T09:00:00Z', author: null }],
    },
    reviews: {
      nodes: [
        { id: 'r1', url: null, body: '', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-01T12:00:00Z', createdAt: '2026-11-01T12:00:00Z', author: { login: 'reviewer' } },
        { id: 'r2', url: null, body: '', state: 'COMMENTED', submittedAt: '2026-11-01T13:00:00Z', createdAt: '2026-11-01T13:00:00Z', author: { login: 'inline-only' } },
        { id: 'r3', url: null, body: 'draft', state: 'PENDING', submittedAt: null, createdAt: '2026-11-01T14:00:00Z', author: { login: 'me' } },
      ],
    },
    ...overrides,
  }
}

const mergeSettings = {
  mergeCommitAllowed: false,
  squashMergeAllowed: true,
  rebaseMergeAllowed: true,
  deleteBranchOnMerge: true,
  viewerDefaultMergeMethod: 'MERGE' as const,
  viewerPermission: 'WRITE',
}

describe('GitHub credential encryption', () => {
  it('round-trips secrets with a fresh IV and rejects tampering', async () => {
    const key = await importEncryptionKey(keySecret)
    const first = await encryptSecret(key, 'ghp_secret')
    const second = await encryptSecret(key, 'ghp_secret')
    expect(first).not.toContain('ghp_secret')
    expect(first).not.toBe(second)
    expect(await decryptSecret(key, first)).toBe('ghp_secret')
    const [version, iv, ciphertext] = first.split('.')
    const tampered = `${version}.${iv}.${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`
    await expect(decryptSecret(key, tampered)).rejects.toThrow()
  })

  it('requires a 32-byte key', async () => {
    await expect(importEncryptionKey(bytesToBase64(new Uint8Array(16)))).rejects.toThrow()
  })
})

describe('GitHub API helpers', () => {
  it('parses repository references', () => {
    expect(parseRepositoryReference('acme/app')).toEqual({ owner: 'acme', name: 'app' })
    expect(parseRepositoryReference('https://github.com/acme/app.git')).toEqual({ owner: 'acme', name: 'app' })
    expect(parseRepositoryReference('git@github.com:acme/app.git')).toEqual({ owner: 'acme', name: 'app' })
    expect(parseRepositoryReference('acme/app/pulls')).toBeNull()
    expect(parseRepositoryReference('../etc/passwd')).toBeNull()
    expect(parseRepositoryReference('acme')).toBeNull()
  })

  it('maps GitHub failures to actionable errors', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' })
    expect((toGitHubError(401, new Headers(), null).data as { code: string }).code).toBe('GITHUB_UNAUTHORIZED')
    expect((toGitHubError(403, headers, null).data as { code: string }).code).toBe('GITHUB_RATE_LIMITED')
    expect((toGitHubError(404, new Headers(), null).data as { code: string }).code).toBe('GITHUB_NOT_FOUND')
    const validation = toGitHubError(422, new Headers(), { message: 'Validation Failed', errors: [{ message: 'Head branch was modified' }] })
    expect((validation.data as { message: string }).message).toBe('Validation Failed — Head branch was modified')
  })

  it('normalizes pull request summaries and details', () => {
    const summary = normalizePullRequestSummary(rawPullRequest())
    expect(summary).toMatchObject({
      state: 'open',
      reviewDecision: 'changes_requested',
      mergeable: 'conflicting',
      checks: 'failure',
      labels: [{ name: 'feature', color: '00ff00' }],
      reviewRequests: ['reviewer', 'core'],
    })
    expect(normalizePullRequestSummary(rawPullRequest({ state: 'MERGED' })).state).toBe('merged')

    const detail = normalizePullRequestDetail(rawPullRequest(), mergeSettings)
    expect(detail.checkRuns.map((check) => [check.name, check.state])).toEqual([
      ['test', 'failure'],
      ['deploy', 'pending'],
      ['lint', 'success'],
    ])
    // Pending and body-less "commented" reviews are hidden; items are chronological.
    expect(detail.timeline.map((item) => item.id)).toEqual(['r1', 'c1'])
    // MERGE is not allowed in this repository, so the default falls back.
    expect(detail.repository.defaultMergeMethod).toBe('squash')
    expect(detail.headSha).toBe('abc123')
  })

  it('treats unfinished check runs as pending', () => {
    expect(
      normalizeCheckContext({ __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null }).state,
    ).toBe('pending')
  })
})

describe('GitHub pull request actions', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', keySecret)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  // `resolveAccess` returns only the caller's own connection, so the token in
  // these tests always belongs to the user making the request.
  async function actionContext(options: { connected?: boolean } = {}) {
    const key = await importEncryptionKey(keySecret)
    const connection =
      options.connected === false
        ? null
        : { _id: 'connection', userId: 'user', accessToken: await encryptSecret(key, 'ghp_mine') }
    const repository = { owner: 'acme', name: 'app', fullName: 'acme/app', defaultBranch: 'main' }
    const runQuery = vi.fn(async (_ref: unknown, _args: unknown) => ({ connection, repository }))
    const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null)
    return { ctx: { runQuery, runMutation }, runQuery, runMutation }
  }

  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  it("posts comments with the caller's own token, unchanged", async () => {
    const { ctx, runQuery } = await actionContext()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 1 }))
    await handler(githubActions.addPullRequestComment)(ctx, { projectId, number: 12, body: ' Looks good ' })
    expect(runQuery.mock.calls[0][1]).toEqual({ projectId, level: 'write' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/acme/app/issues/12/comments')
    expect(init.headers.Authorization).toBe('Bearer ghp_mine')
    expect(JSON.parse(init.body).body).toBe('Looks good')
  })

  it('asks the caller to add their own token instead of using anyone else', async () => {
    const { ctx } = await actionContext({ connected: false })
    await expect(
      handler(githubActions.listPullRequests)(ctx, { projectId, state: 'open' }),
    ).rejects.toThrow(/Connect your GitHub account/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('merges only the reviewed head commit and records activity', async () => {
    const { ctx, runMutation } = await actionContext()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { title: 'Feature', html_url: 'u', head: { ref: 'feature', sha: 'abc', repo: { full_name: 'acme/app' } } }))
      .mockResolvedValueOnce(jsonResponse(200, { sha: 'merged-sha', merged: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const result = await handler(githubActions.mergePullRequest)(ctx, {
      projectId,
      number: 12,
      method: 'squash',
      expectedHeadSha: 'abc',
      deleteBranch: true,
    })
    const mergeCall = fetchMock.mock.calls[1]
    expect(mergeCall[0]).toBe('https://api.github.com/repos/acme/app/pulls/12/merge')
    expect(JSON.parse(mergeCall[1].body)).toMatchObject({ merge_method: 'squash', sha: 'abc' })
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.github.com/repos/acme/app/git/refs/heads/feature')
    expect(result).toEqual({ sha: 'merged-sha', branchDeleted: true, branchDeleteError: null })
    expect(runMutation.mock.calls[0][1]).toMatchObject({ action: 'github.pr_merged', number: 12 })
  })

  it('explains merges rejected because the head moved', async () => {
    const { ctx, runMutation } = await actionContext()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { title: 'Feature', html_url: 'u', head: { ref: 'feature', sha: 'new', repo: { full_name: 'acme/app' } } }))
      .mockResolvedValueOnce(jsonResponse(409, { message: 'Head branch was modified.' }))
    await expect(
      handler(githubActions.mergePullRequest)(ctx, { projectId, number: 12, method: 'merge', expectedHeadSha: 'old' }),
    ).rejects.toThrow(/New commits were pushed/)
    expect(runMutation).not.toHaveBeenCalled()
  })

  it('loads a pull request when GitHub hides check runs from the token', async () => {
    const { ctx } = await actionContext()
    const pullRequest = {
      number: 3102, title: 'Feature', url: 'u', state: 'OPEN', isDraft: false, createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z', mergedAt: null, closedAt: null, headRefName: 'feature', baseRefName: 'main',
      additions: 1, deletions: 0, changedFiles: 1, mergeable: 'MERGEABLE', reviewDecision: null,
      author: { login: 'ann', avatarUrl: null, url: null },
      comments: { totalCount: 0 }, labels: { nodes: [] }, assignees: { nodes: [] }, reviewRequests: { nodes: [] },
      id: 'PR_1', body: '', headRefOid: 'abc', headRepository: { nameWithOwner: 'acme/app' }, isCrossRepository: false,
      mergeStateStatus: 'CLEAN', mergedBy: null,
      commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [
        null,
        { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: null, description: null },
      ] } } } }] },
      files: { totalCount: 0, nodes: [] }, timelineComments: { nodes: [] }, reviews: { nodes: [] },
    }
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          repository: {
            mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: false,
            viewerDefaultMergeMethod: 'MERGE', viewerPermission: 'WRITE', pullRequest,
          },
        },
        errors: [{
          type: 'FORBIDDEN',
          message: 'Resource not accessible by personal access token',
          path: ['repository', 'pullRequest', 'commits', 'nodes', 0, 'commit', 'statusCheckRollup', 'contexts', 'nodes', 0],
        }],
      }),
    )
    const result = await handler(githubActions.getPullRequest)(ctx, { projectId, number: 3102 })
    expect(result.pullRequest.checksHidden).toBe(true)
    expect(result.pullRequest.detailsHidden).toBe(false)
    expect(result.pullRequest.checkRuns.map((check: { name: string }) => check.name)).toEqual(['ci/legacy'])
  })

  it('still fails when GitHub hides the pull request itself', async () => {
    const { ctx } = await actionContext()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: { repository: null },
        errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token', path: ['repository'] }],
      }),
    )
    await expect(
      handler(githubActions.getPullRequest)(ctx, { projectId, number: 3102 }),
    ).rejects.toThrow(/Resource not accessible/)
  })

  it('requires a body when requesting changes', async () => {
    const { ctx } = await actionContext()
    await expect(
      handler(githubActions.submitPullRequestReview)(ctx, { projectId, number: 12, event: 'request_changes', body: ' ' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the Tasker session before sending a pasted token to GitHub', async () => {
    const { ctx, runQuery } = await actionContext()
    runQuery.mockRejectedValueOnce(new Error('signed out'))
    await expect(handler(githubActions.connectAccount)(ctx, { token: 'ghp_new' })).rejects.toThrow('signed out')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores a pasted token encrypted for the caller', async () => {
    const { ctx, runMutation } = await actionContext()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 7, login: 'ann' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'x-oauth-scopes': 'repo, read:user' },
      }),
    )
    expect(await handler(githubActions.connectAccount)(ctx, { token: ' ghp_new ' })).toEqual({ login: 'ann' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_new')
    const saved = runMutation.mock.calls[0][1] as { accessToken: string; scopes: string[]; githubLogin: string }
    expect(saved.accessToken).not.toContain('ghp_new')
    expect(await decryptSecret(await importEncryptionKey(keySecret), saved.accessToken)).toBe('ghp_new')
    expect(saved).toMatchObject({ githubLogin: 'ann', scopes: ['repo', 'read:user'] })
  })
})
