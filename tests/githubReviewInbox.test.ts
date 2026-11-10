import { describe, expect, it } from 'vitest'
import {
  chunk,
  inboxPreview,
  inboxPullRequestFromRaw,
  inboxThreadFromRaw,
  parseSeverity,
  type RawInboxThread,
  severityPriority,
} from '../convex/lib/githubReviewInbox'

function rawThread(overrides: Partial<RawInboxThread> = {}): RawInboxThread {
  return {
    id: 'PRRT_1',
    path: 'src/a.ts',
    line: null,
    originalLine: 7,
    subjectType: 'LINE',
    isResolved: false,
    isOutdated: true,
    resolvedBy: null,
    pullRequest: { number: 3, repository: { nameWithOwner: 'acme/app' } },
    first: {
      totalCount: 3,
      nodes: [{
        id: 'c1',
        url: 'https://github.com/acme/app/pull/3#discussion_r1',
        body: '**Major** · Use <b>bold</b> & `escape`',
        createdAt: '2026-11-10T00:00:00Z',
        pullRequestReview: { state: 'COMMENTED' },
        author: { __typename: 'User', login: 'me', avatarUrl: null, url: null },
      }],
    },
    last: { nodes: [{ createdAt: '2026-11-10T05:00:00Z', author: { login: 'dev' } }] },
    ...overrides,
  }
}

describe('review inbox conversations', () => {
  it('keeps the first comment preview and the last activity', () => {
    expect(inboxThreadFromRaw(rawThread())).toEqual({
      id: 'PRRT_1',
      pullNumber: 3,
      path: 'src/a.ts',
      line: 7,
      startLine: null,
      isFileComment: false,
      isResolved: false,
      isOutdated: true,
      resolvedBy: null,
      startedBy: { login: 'me', avatarUrl: null, url: null, isBot: false },
      startedAt: Date.parse('2026-11-10T00:00:00Z'),
      url: 'https://github.com/acme/app/pull/3#discussion_r1',
      preview: 'Major · Use bold & escape',
      severity: 'major',
      replyCount: 2,
      lastCommentAt: Date.parse('2026-11-10T05:00:00Z'),
      lastCommentBy: 'dev',
    })
  })

  it('uses the first comment as the last activity when nobody replied', () => {
    const thread = inboxThreadFromRaw(
      rawThread({ first: { ...rawThread().first!, totalCount: 1 }, last: { nodes: [] } }),
    )
    expect(thread).toMatchObject({ replyCount: 0, lastCommentBy: 'me', lastCommentAt: thread!.startedAt })
  })

  it('marks bots and leaves out unsubmitted reviews and non-threads', () => {
    const bot = rawThread({
      first: {
        totalCount: 1,
        nodes: [{ ...rawThread().first!.nodes![0]!, author: { __typename: 'Bot', login: 'coderabbitai' } }],
      },
    })
    expect(inboxThreadFromRaw(bot)?.startedBy?.isBot).toBe(true)
    const pending = rawThread({
      first: { totalCount: 1, nodes: [{ ...rawThread().first!.nodes![0]!, pullRequestReview: { state: 'PENDING' } }] },
    })
    expect(inboxThreadFromRaw(pending)).toBeNull()
    expect(inboxThreadFromRaw(rawThread({ first: { totalCount: 0, nodes: [] } }))).toBeNull()
    expect(inboxThreadFromRaw({ id: 'x' })).toBeNull()
    expect(inboxThreadFromRaw(null)).toBeNull()
  })

  it('builds pull requests with users asked to review and their conversations in order', () => {
    const later = inboxThreadFromRaw(rawThread({ id: 'PRRT_2', first: { ...rawThread().first!, nodes: [{ ...rawThread().first!.nodes![0]!, createdAt: '2026-11-11T00:00:00Z' }] } }))!
    const earlier = inboxThreadFromRaw(rawThread())!
    const pr = inboxPullRequestFromRaw(
      {
        number: 3,
        title: 'Fix',
        url: 'u',
        isDraft: false,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-11T00:00:00Z',
        reviewDecision: 'CHANGES_REQUESTED',
        author: { login: 'dev' },
        reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'me' } }, { requestedReviewer: { __typename: 'Team' } }, null] },
        reviewThreads: { nodes: [{ id: 'PRRT_2', isResolved: false, isOutdated: false, resolvedBy: null }, { id: 'PRRT_1', isResolved: false, isOutdated: false, resolvedBy: null }, { id: 'missing', isResolved: false, isOutdated: false, resolvedBy: null }] },
      },
      new Map([[later.id, later], [earlier.id, earlier]]),
    )
    expect(pr.reviewDecision).toBe('changes_requested')
    expect(pr.requestedReviewers).toEqual(['me'])
    expect(pr.threads.map((thread) => thread.id)).toEqual(['PRRT_1', 'PRRT_2'])
    expect(pr.author).toMatchObject({ login: 'dev', isBot: false })
  })
})

describe('severity labels', () => {
  it('reads bot labels and nit prefixes from the first line', () => {
    expect(parseSeverity('_⚠️ Potential issue_ | _🟠 Major_\n\nDetails')).toBe('major')
    expect(parseSeverity('**Critical** · Security')).toBe('critical')
    expect(parseSeverity('🧹 Nitpick (assertive)')).toBe('nitpick')
    expect(parseSeverity('nit: rename this')).toBe('nitpick')
    expect(parseSeverity('Minor · Readability')).toBe('minor')
  })

  it('ignores ordinary sentences that mention a severity word', () => {
    expect(parseSeverity('This is a major refactor of how we load the routes and it needs a closer look before merging.')).toBeNull()
    expect(parseSeverity('Looks good to me')).toBeNull()
    expect(parseSeverity('')).toBeNull()
  })

  it('maps severities to task priorities', () => {
    expect(['critical', 'major', 'minor', 'nitpick'].map((s) => severityPriority(s as never))).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ])
  })
})

describe('inbox helpers', () => {
  it('previews bot-style markdown as one short line', () => {
    const body = [
      '<!-- metadata -->',
      '**Major** · Quick win',
      '',
      '<details><summary>Fix</summary>',
      '',
      '```ts',
      'const a = 1',
      '```',
      '</details>',
    ].join('\n')
    expect(inboxPreview(body)).toBe('Major · Quick win Fix')
    expect(inboxPreview('x'.repeat(900))).toHaveLength(500)
  })

  it('splits ids into request-sized batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 15)).toEqual([])
  })
})
