import { describe, expect, it } from 'vitest'
import {
  checksSummaryFromConclusion,
  defaultAutomationRules,
  describeAutomationRules,
  normalizeAutomationRules,
  normalizeWebhookEvent,
  resolveTransition,
  signWebhookBody,
  snapshotFromPullRequest,
  verifyWebhookSignature,
} from '../convex/lib/githubAutomation'

const repository = { id: 99, full_name: 'acme/app', default_branch: 'main' }
const sender = { login: 'octocat' }

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    repository,
    sender,
    pull_request: {
      number: 12,
      title: 'SHOP-142: Fix tax',
      body: 'Closes #3',
      html_url: 'https://github.com/acme/app/pull/12',
      state: 'open',
      draft: false,
      merged: false,
      merged_at: null,
      mergeable: null,
      updated_at: '2026-11-05T10:00:00Z',
      user: { login: 'dev' },
      head: { ref: 'feat/shop-142-fix-tax', sha: 'abc' },
      base: { ref: 'main' },
      ...overrides,
    },
  }
}

describe('automation rules', () => {
  const statuses = ['todo', 'backlog', 'in_progress', 'in_review', 'done']

  it('fills in defaults and drops unknown triggers', () => {
    const rules = normalizeAutomationRules([
      { trigger: 'pr_opened', enabled: false, targetStatus: ' qa ', fromStatuses: ['todo', 'todo', ' '] },
      { trigger: 'bogus' as never, enabled: true },
      { trigger: 'pr_closed', enabled: true, targetStatus: 'ignored' },
    ])
    expect(rules.map((rule) => rule.trigger)).toEqual(defaultAutomationRules().map((rule) => rule.trigger))
    expect(rules.find((rule) => rule.trigger === 'pr_opened')).toEqual({
      trigger: 'pr_opened',
      enabled: false,
      targetStatus: 'qa',
      fromStatuses: ['todo'],
    })
    expect(rules.find((rule) => rule.trigger === 'pr_closed')).toEqual({ trigger: 'pr_closed', enabled: true })
  })

  it('flags rules whose target status no longer exists', () => {
    const states = describeAutomationRules(defaultAutomationRules(), ['todo', 'done'])
    expect(states.find((state) => state.rule.trigger === 'pr_merged')?.active).toBe(true)
    expect(states.find((state) => state.rule.trigger === 'pr_opened')).toMatchObject({ targetExists: false, active: false })
    expect(states.find((state) => state.rule.trigger === 'pr_closed')?.active).toBe(true)
  })

  it('resolves transitions respecting from-statuses and never leaving done', () => {
    const [branchPushed, prOpened, , prMerged, prClosed] = defaultAutomationRules()
    expect(resolveTransition(branchPushed, 'todo', statuses)).toBe('in_progress')
    expect(resolveTransition(branchPushed, 'in_review', statuses)).toBeNull()
    expect(resolveTransition(prOpened, 'backlog', statuses)).toBe('in_review')
    expect(resolveTransition(prOpened, 'in_review', statuses)).toBeNull()
    expect(resolveTransition(prOpened, 'done', statuses)).toBeNull()
    expect(resolveTransition(prMerged, 'in_review', statuses)).toBe('done')
    expect(resolveTransition(prMerged, 'in_review', ['todo', 'in_review'])).toBeNull()
    expect(resolveTransition(prClosed, 'in_review', statuses)).toBeNull()
    expect(resolveTransition({ ...prOpened, enabled: false }, 'todo', statuses)).toBeNull()
  })
})

describe('webhook normalisation', () => {
  it('normalises pull request events', () => {
    const event = normalizeWebhookEvent('pull_request', pullRequestPayload({ action: 'opened' }))
    expect(event).toMatchObject({
      kind: 'pull_request',
      action: 'opened',
      repository: { repositoryId: 99, fullName: 'acme/app', defaultBranch: 'main' },
      senderLogin: 'octocat',
      pullRequest: {
        number: 12,
        state: 'open',
        headRefName: 'feat/shop-142-fix-tax',
        authorLogin: 'dev',
        mergeable: 'unknown',
      },
    })
    const merged = normalizeWebhookEvent(
      'pull_request',
      pullRequestPayload({ state: 'closed', merged: true, merged_at: '2026-11-05T11:00:00Z' }),
    )
    expect(merged?.kind === 'pull_request' && merged.pullRequest.state).toBe('merged')
    const closed = normalizeWebhookEvent('pull_request', pullRequestPayload({ state: 'closed' }))
    expect(closed?.kind === 'pull_request' && closed.pullRequest.state).toBe('closed')
    const weird = normalizeWebhookEvent('pull_request', { ...pullRequestPayload(), action: 'labeled' })
    expect(weird?.kind === 'pull_request' && weird.action).toBe('other')
  })

  it('normalises reviews, pushes, check suites and workflow runs', () => {
    const review = normalizeWebhookEvent('pull_request_review', {
      ...pullRequestPayload(),
      action: 'submitted',
      review: { state: 'APPROVED', user: { login: 'reviewer' } },
    })
    expect(review).toMatchObject({ kind: 'pull_request_review', state: 'approved', reviewerLogin: 'reviewer' })

    const push = normalizeWebhookEvent('push', {
      repository,
      sender,
      ref: 'refs/heads/feat/shop-142',
      after: 'def',
      created: true,
      deleted: false,
      pusher: { name: 'dev' },
      commits: [{ message: 'SHOP-142 first' }, { message: 'tidy' }],
    })
    expect(push).toMatchObject({
      kind: 'push',
      branchName: 'feat/shop-142',
      created: true,
      commitMessages: ['SHOP-142 first', 'tidy'],
      pusherLogin: 'dev',
    })
    const tagPush = normalizeWebhookEvent('push', { repository, sender, ref: 'refs/tags/v1' })
    expect(tagPush?.kind === 'push' && tagPush.branchName).toBeNull()

    const suite = normalizeWebhookEvent('check_suite', {
      repository,
      sender,
      action: 'completed',
      check_suite: { head_sha: 'abc', status: 'completed', conclusion: 'failure', pull_requests: [{ number: 12 }], app: { name: 'GitHub Actions' } },
    })
    expect(suite).toMatchObject({ kind: 'check_suite', conclusion: 'failure', pullNumbers: [12], appName: 'GitHub Actions' })

    const run = normalizeWebhookEvent('workflow_run', {
      repository,
      sender,
      action: 'completed',
      workflow_run: {
        id: 5,
        name: 'CI',
        html_url: 'https://github.com/acme/app/actions/runs/5',
        head_sha: 'abc',
        head_branch: 'main',
        status: 'completed',
        conclusion: 'failure',
        triggering_actor: { login: 'dev' },
        pull_requests: [],
      },
    })
    expect(run).toMatchObject({ kind: 'workflow_run', runId: 5, headBranch: 'main', conclusion: 'failure', actorLogin: 'dev' })
  })

  it('ignores unknown events and malformed payloads', () => {
    expect(normalizeWebhookEvent('issues', { repository, sender })).toBeNull()
    expect(normalizeWebhookEvent('pull_request', { repository, sender, pull_request: { number: 'x' } })).toBeNull()
    expect(normalizeWebhookEvent('push', { sender, ref: 'refs/heads/x' })).toBeNull()
    expect(normalizeWebhookEvent('ping', { hook_id: 7, sender })).toMatchObject({ kind: 'ping', hookId: 7, repository: null })
  })

  it('maps conclusions to check summaries and resets them on new commits', () => {
    expect(checksSummaryFromConclusion('completed', 'success')).toBe('success')
    expect(checksSummaryFromConclusion('completed', 'timed_out')).toBe('failure')
    expect(checksSummaryFromConclusion('in_progress', null)).toBe('pending')
    expect(checksSummaryFromConclusion('completed', 'mystery')).toBeNull()

    const event = normalizeWebhookEvent('pull_request', pullRequestPayload())
    if (event?.kind !== 'pull_request') throw new Error('expected pull request')
    const previous = { ...snapshotFromPullRequest(event.pullRequest), checks: 'failure' as const, reviewDecision: 'approved' as const }
    expect(snapshotFromPullRequest(event.pullRequest, previous)).toMatchObject({ checks: 'failure', reviewDecision: 'approved' })
    expect(snapshotFromPullRequest({ ...event.pullRequest, headSha: 'new' }, previous)).toMatchObject({
      checks: null,
      reviewDecision: null,
    })
  })
})

describe('webhook signatures', () => {
  it('accepts matching signatures and rejects everything else', async () => {
    const body = '{"zen":"Keep it logically awesome."}'
    const signature = await signWebhookBody('s3cret', body)
    expect(signature.startsWith('sha256=')).toBe(true)
    expect(await verifyWebhookSignature('s3cret', body, signature)).toBe(true)
    expect(await verifyWebhookSignature('s3cret', `${body} `, signature)).toBe(false)
    expect(await verifyWebhookSignature('other', body, signature)).toBe(false)
    expect(await verifyWebhookSignature('s3cret', body, null)).toBe(false)
    expect(await verifyWebhookSignature('s3cret', body, 'sha1=abc')).toBe(false)
  })
})
