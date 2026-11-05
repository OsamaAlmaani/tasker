import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationCtx } from '../convex/_generated/server'
import * as githubWebhooks from '../convex/githubWebhooks'
import { normalizeWebhookEvent } from '../convex/lib/githubAutomation'
import { linkCandidatesFromSummaries, snapshotFromRest } from '../convex/lib/githubLinkSync'
import type { PullRequestSummary } from '../convex/lib/githubApi'
import { DEFAULT_PROJECT_STATUSES } from '../convex/constants'

const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: any, args: Record<string, unknown>) => Promise<any> })._handler

type Row = Record<string, any>

/** Tiny in-memory Convex database: ids are `${table}-${n}`, indexes are equality filters. */
function fakeDb() {
  const rows = new Map<string, Row>()
  let counter = 0
  const insert = async (table: string, doc: Row) => {
    const id = `${table}-${++counter}`
    rows.set(id, { ...doc, _id: id, _creationTime: Date.now() })
    return id
  }
  const db = {
    insert: vi.fn(insert),
    get: vi.fn(async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)) : null)),
    patch: vi.fn(async (id: string, patch: Row) => {
      const row = rows.get(id)
      if (!row) throw new Error(`missing ${id}`)
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key]
        else row[key] = value
      }
    }),
    delete: vi.fn(async (id: string) => {
      rows.delete(id)
    }),
    normalizeId: (table: string, id: string) => (id.startsWith(`${table}-`) ? id : null),
    query: (table: string) => {
      const filters: [string, unknown][] = []
      const list = () =>
        [...rows.entries()]
          .filter(([id, row]) => id.startsWith(`${table}-`) && filters.every(([key, value]) => row[key] === value))
          .map(([, row]) => structuredClone(row))
      const chain = {
        withIndex: (_name: string, fn: (q: any) => unknown) => {
          const q = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value])
              return q
            },
          }
          fn(q)
          return chain
        },
        order: () => chain,
        collect: async () => list(),
        take: async (n: number) => list().slice(0, n),
        unique: async () => list()[0] ?? null,
        first: async () => list()[0] ?? null,
      }
      return chain
    },
  }
  return { db, rows, insert }
}

const repository = { id: 99, full_name: 'acme/app', default_branch: 'main' }

function pullRequestPayload(action: string, overrides: Record<string, unknown> = {}, sender = 'dev') {
  return {
    action,
    repository,
    sender: { login: sender },
    pull_request: {
      number: 12,
      title: 'Fix tax rounding',
      body: 'Details',
      html_url: 'https://github.com/acme/app/pull/12',
      state: 'open',
      draft: false,
      merged: false,
      merged_at: null,
      mergeable: true,
      updated_at: '2026-11-05T10:00:00Z',
      user: { login: 'dev' },
      head: { ref: 'feat/shop-142-fix-tax', sha: 'abc' },
      base: { ref: 'main' },
      ...overrides,
    },
  }
}

describe('webhook processing', () => {
  let ctx: MutationCtx
  let rows: Map<string, Row>
  let runMutation: ReturnType<typeof vi.fn>
  let linkId: string
  let issueId: string

  beforeEach(async () => {
    const fake = fakeDb()
    rows = fake.rows
    runMutation = vi.fn(async () => null)
    ctx = { db: fake.db, runMutation, auth: { getUserIdentity: async () => null } } as unknown as MutationCtx
    const now = Date.now()
    const linker = await fake.insert('users', { name: 'Linker', email: 'l@x', globalRole: 'member', isActive: true })
    const dev = await fake.insert('users', { name: 'Dev', email: 'd@x', globalRole: 'member', isActive: true })
    await fake.insert('githubConnections', { userId: dev, githubLogin: 'dev', accessToken: 'x', scopes: [], githubUserId: 1, createdAt: now, updatedAt: now })
    const projectId = await fake.insert('projects', {
      name: 'Shop',
      key: 'SHOP',
      statuses: DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status })),
      createdBy: linker,
      archived: false,
      allowMemberInvites: true,
      allowIssueDelete: true,
      createdAt: now,
      updatedAt: now,
    })
    await fake.insert('projectMembers', { projectId, userId: dev, addedBy: linker, joinedAt: now })
    issueId = await fake.insert('issues', {
      projectId,
      issueNumber: 142,
      title: 'Fix tax rounding',
      searchText: 'fix tax rounding',
      status: 'todo',
      priority: 'none',
      reporterId: linker,
      createdBy: linker,
      labels: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    })
    linkId = await fake.insert('githubRepositoryLinks', {
      projectId,
      repositoryId: 99,
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      htmlUrl: 'https://github.com/acme/app',
      defaultBranch: 'main',
      private: true,
      linkedBy: linker,
      linkedAt: now,
      webhook: { hookId: 1, secret: 'enc', url: 'https://x/github/webhook', registeredBy: linker, registeredAt: now },
    })
  })

  async function deliver(eventName: string, payload: unknown, deliveryId = `d-${Math.random()}`) {
    const event = normalizeWebhookEvent(eventName, payload)
    if (!event) throw new Error('event ignored')
    return await handler(githubWebhooks.processEvent)(ctx, { deliveryId, linkIds: [linkId], event })
  }

  const issue = () => rows.get(issueId)!
  const activities = (action: string) => [...rows.values()].filter((row) => row.action === action)
  const prLinks = () => [...rows.entries()].filter(([id]) => id.startsWith('githubPullRequestLinks-')).map(([, row]) => row)

  it('links a pull request from its branch name and moves the task to review', async () => {
    const result = await deliver('pull_request', pullRequestPayload('opened'))
    expect(result.outcomes[0]).toContain('1 task(s)')
    expect(prLinks()).toHaveLength(1)
    expect(prLinks()[0]).toMatchObject({ pullNumber: 12, issueId, source: 'webhook', automationPreviousStatus: 'todo' })
    expect(prLinks()[0].snapshot).toMatchObject({ title: 'Fix tax rounding', state: 'open', headSha: 'abc', mergeable: 'mergeable' })
    expect(issue().status).toBe('in_review')
    expect(activities('github.pr_linked')).toHaveLength(1)
    expect(activities('github.pr_event')[0].metadata).toMatchObject({ event: 'opened', pullNumber: 12 })
    expect(activities('github.automation_applied')[0].metadata).toMatchObject({ trigger: 'pr_opened', from: 'todo', to: 'in_review' })
    // The mapped sender is the actor of the status change.
    expect(activities('issue.status_changed')[0].actorId).toBe('users-2')
    expect(rows.get(linkId)!.liveVersion).toBe(1)
    expect(rows.get(linkId)!.webhook.lastDeliveryEvent).toBe('pull_request')
    // A branch link is recorded as well.
    expect([...rows.keys()].some((id) => id.startsWith('githubBranchLinks-'))).toBe(true)
  })

  it('restores the previous status when the pull request closes unmerged, then completes on merge', async () => {
    await deliver('pull_request', pullRequestPayload('opened'))
    await deliver('pull_request', pullRequestPayload('closed', { state: 'closed' }))
    expect(issue().status).toBe('todo')
    expect(prLinks()[0].automationPreviousStatus).toBeUndefined()
    expect(prLinks()[0].snapshot.state).toBe('closed')

    await deliver('pull_request', pullRequestPayload('reopened'))
    expect(issue().status).toBe('in_review')
    await deliver('pull_request', pullRequestPayload('closed', { state: 'closed', merged: true, merged_at: '2026-11-05T12:00:00Z' }, 'maintainer'))
    expect(issue().status).toBe('done')
    expect(issue().completedAt).toBeTypeOf('number')
    expect(prLinks()[0].snapshot.state).toBe('merged')
    // The author (dev) is told their pull request merged by someone else.
    const merged = runMutation.mock.calls.find(([, args]: any) => args?.type === 'github_pr_merged')
    expect(merged?.[1]).toMatchObject({ recipientUserId: 'users-2', metadata: { pullNumber: 12, taskKeys: ['SHOP-142'] } })
  })

  it('does not notify people about their own actions and records reviews', async () => {
    await deliver('pull_request', pullRequestPayload('opened'))
    runMutation.mockClear()
    await deliver('pull_request_review', {
      ...pullRequestPayload('submitted', {}, 'reviewer'),
      review: { state: 'approved', user: { login: 'reviewer' } },
    })
    expect(prLinks()[0].snapshot.reviewDecision).toBe('approved')
    expect(activities('github.pr_event').map((row) => row.metadata.event)).toContain('approved')
    expect(runMutation.mock.calls.some(([, args]: any) => args?.type === 'github_approved')).toBe(true)
    // The review_approved rule is off by default.
    expect(issue().status).toBe('in_review')

    runMutation.mockClear()
    await deliver('pull_request', pullRequestPayload('review_requested', { requested_reviewer: undefined }, 'dev'))
    // Requesting a review from oneself (dev -> dev) produces nothing.
    await deliver('pull_request', { ...pullRequestPayload('review_requested', {}, 'dev'), requested_reviewer: { login: 'dev' } })
    expect(runMutation.mock.calls.some(([, args]: any) => args?.type === 'github_review_requested')).toBe(false)
  })

  it('marks checks red for the matching commit only and notifies the author', async () => {
    await deliver('pull_request', pullRequestPayload('opened'))
    runMutation.mockClear()
    await deliver('check_suite', {
      repository,
      sender: { login: 'github-actions[bot]' },
      action: 'completed',
      check_suite: { head_sha: 'old', status: 'completed', conclusion: 'failure', pull_requests: [{ number: 12 }] },
    })
    expect(prLinks()[0].snapshot.checks).toBeNull()
    await deliver('check_suite', {
      repository,
      sender: { login: 'github-actions[bot]' },
      action: 'completed',
      check_suite: { head_sha: 'abc', status: 'completed', conclusion: 'failure', pull_requests: [{ number: 12 }] },
    })
    expect(prLinks()[0].snapshot.checks).toBe('failure')
    expect(runMutation.mock.calls.some(([, args]: any) => args?.type === 'github_checks_failed')).toBe(true)
    // A later green suite does not clear a red commit.
    await deliver('check_suite', {
      repository,
      sender: { login: 'github-actions[bot]' },
      action: 'completed',
      check_suite: { head_sha: 'abc', status: 'completed', conclusion: 'success', pull_requests: [{ number: 12 }] },
    })
    expect(prLinks()[0].snapshot.checks).toBe('failure')
  })

  it('links branches on push and moves todo tasks to in progress', async () => {
    await deliver('push', {
      repository,
      sender: { login: 'dev' },
      ref: 'refs/heads/shop-142-rounding',
      after: 'def',
      created: true,
      deleted: false,
      pusher: { name: 'dev' },
      commits: [],
    })
    expect(issue().status).toBe('in_progress')
    const branches = [...rows.entries()].filter(([id]) => id.startsWith('githubBranchLinks-')).map(([, row]) => row)
    expect(branches).toHaveLength(1)
    expect(activities('github.pr_event')[0].metadata).toMatchObject({ event: 'branch_pushed', branchName: 'shop-142-rounding' })

    await deliver('push', { repository, sender: { login: 'dev' }, ref: 'refs/heads/shop-142-rounding', deleted: true })
    expect(branches[0].deletedAt).toBeTypeOf('number')
    // Unrelated branches do nothing.
    const before = rows.size
    await deliver('push', { repository, sender: { login: 'dev' }, ref: 'refs/heads/chore/deps', after: 'x' })
    expect(rows.size).toBe(before)
  })

  it('tells the mapped actor when a workflow fails on the default branch', async () => {
    await deliver('workflow_run', {
      repository,
      sender: { login: 'dev' },
      action: 'completed',
      workflow_run: {
        id: 77,
        name: 'CI',
        html_url: 'https://github.com/acme/app/actions/runs/77',
        head_sha: 'zzz',
        head_branch: 'main',
        status: 'completed',
        conclusion: 'failure',
        triggering_actor: { login: 'dev' },
        pull_requests: [],
      },
    })
    const call = runMutation.mock.calls.find(([, args]: any) => args?.type === 'github_workflow_failed')
    expect(call?.[1]).toMatchObject({ recipientUserId: 'users-2', metadata: { runId: 77, branch: 'main', dedupeKey: 'workflow_failed:99:77' } })
  })

  it('never acts as a GitHub user who could not make the change in Tasker', async () => {
    rows.get('users-2')!.globalRole = 'viewer'
    await deliver('pull_request', pullRequestPayload('opened'))
    // The task still moves, but the actor falls back to the project creator who linked the repository.
    expect(issue().status).toBe('in_review')
    expect(activities('issue.status_changed')[0].actorId).toBe('users-1')
    // Notifications still reach the viewer, who can see the project.
    runMutation.mockClear()
    await deliver('pull_request', pullRequestPayload('closed', { state: 'closed', merged: true, merged_at: '2026-11-05T12:00:00Z' }, 'maintainer'))
    expect(runMutation.mock.calls.some(([, args]: any) => args?.type === 'github_pr_merged')).toBe(true)
    // Someone outside the project hears nothing.
    for (const id of [...rows.keys()]) if (id.startsWith('projectMembers-')) rows.delete(id)
    runMutation.mockClear()
    await deliver('pull_request', pullRequestPayload('reopened', {}, 'maintainer'))
    await deliver('pull_request', pullRequestPayload('closed', { state: 'closed', merged: true, merged_at: '2026-11-05T13:00:00Z' }, 'maintainer'))
    expect(runMutation.mock.calls.some(([, args]: any) => args?.type === 'github_pr_merged')).toBe(false)
  })

  it('records each delivery once and accepts redelivery after a failure', async () => {
    const record = handler(githubWebhooks.recordDelivery)
    const update = handler(githubWebhooks.updateDeliveryOutcome)
    const failed = { repositoryId: 99, deliveryId: 'retry', event: 'push', action: null, outcome: 'processing' }
    expect(await record(ctx, failed)).toEqual({ duplicate: false })
    await update(ctx, { deliveryId: 'retry', outcome: 'failed: boom' })
    expect(await record(ctx, failed)).toEqual({ duplicate: false })
    expect(await record(ctx, failed)).toEqual({ duplicate: true })
  })

  it('records each delivery once', async () => {
    const record = handler(githubWebhooks.recordDelivery)
    const args = { repositoryId: 99, deliveryId: 'dup', event: 'ping', action: null, outcome: 'processing' }
    expect(await record(ctx, args)).toEqual({ duplicate: false })
    expect(await record(ctx, args)).toEqual({ duplicate: true })
  })
})

describe('link candidates from loaded pull requests', () => {
  const summary = {
    number: 5,
    title: 'SHOP-3: Checkout',
    url: 'https://github.com/acme/app/pull/5',
    state: 'open',
    isDraft: true,
    author: { login: 'dev', avatarUrl: null, url: null, isBot: false },
    headRefName: 'shop-4-extra',
    baseRefName: 'main',
    headSha: 'sha',
    createdAt: 1,
    updatedAt: 2,
    closedAt: null,
    mergedAt: null,
    reviewDecision: null,
    mergeable: 'unknown',
    checks: 'pending',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    commentCount: 0,
    labels: [],
    reviewRequests: [],
    assignees: [],
  } satisfies PullRequestSummary

  it('merges references from title, body and branch', () => {
    const [candidate] = linkCandidatesFromSummaries([summary], 'SHOP', 'Also fixes #9 and /issues/abcdefghijklmnopqrst')
    expect(candidate.issueNumbers).toEqual([3, 4])
    expect(candidate.issueIds).toEqual(['abcdefghijklmnopqrst'])
    expect(candidate.snapshot).toMatchObject({ isDraft: true, checks: 'pending', authorLogin: 'dev', headSha: 'sha' })
  })

  it('builds snapshots from REST pull requests', () => {
    expect(
      snapshotFromRest({
        number: 1,
        title: 'T',
        html_url: 'u',
        state: 'closed',
        merged_at: '2026-11-05T00:00:00Z',
        head: { ref: 'h', sha: 's' },
        base: { ref: 'main' },
        mergeable: null,
      }),
    ).toMatchObject({ state: 'merged', mergeable: 'unknown', reviewDecision: null })
  })
})
