import { describe, expect, it } from 'vitest'
import { missingWebhookEvents, normalizeWebhookEvent } from '../convex/lib/githubAutomation'
import { buildGitHubNotificationContent } from '../convex/lib/notifications'
import {
  diffHunkTail,
  followUpReplyBody,
  isPendingReviewThread,
  normalizeReviewTaskSettings,
  normalizeTrackedThread,
  reviewTaskDescription,
  reviewTaskTitle,
  type TrackedThread,
} from '../convex/lib/githubReviewTasks'
import { normalizeDescriptionDoc } from '../convex/lib/issueDescriptions'
import {
  filterReviewInbox,
  reviewTaskProgress,
  reviewThreadLocation,
  trackSummary,
} from '../src/features/tasker/github/reviewTaskDisplay'

const thread: TrackedThread = {
  threadId: 'PRRT_1',
  repository: 'acme/app',
  pullNumber: 12,
  pullTitle: 'Fix tax rounding',
  pullUrl: 'https://github.com/acme/app/pull/12',
  pullAuthorLogin: 'dev',
  path: 'src/billing/tax.ts',
  line: 42,
  isFileComment: false,
  isResolved: false,
  isOutdated: false,
  rootCommentId: 1001,
  body: 'This **leaks** the token into logs.\n\nUse `redact()` instead.',
  url: 'https://github.com/acme/app/pull/12#discussion_r1001',
  authorLogin: 'reviewer',
  diffHunk: '@@ -1,3 +1,4 @@\n const a = 1\n+log(token)\n const b = 2',
}

describe('review task text', () => {
  it('uses the first line of the comment as the title, without markdown', () => {
    expect(reviewTaskTitle(thread.body, thread.path, thread.line)).toBe('This leaks the token into logs.')
    expect(reviewTaskTitle('> quoted [link](https://x.y) and `code`', 'a.ts')).toBe('quoted link and code')
  })

  it('shortens long comments at a sentence or with an ellipsis', () => {
    const sentence = `${'Rename this variable to something clearer. '.repeat(1)}${'More detail '.repeat(20)}`
    expect(reviewTaskTitle(sentence, 'a.ts')).toBe('Rename this variable to something clearer.')
    const long = 'x'.repeat(300)
    const title = reviewTaskTitle(long, 'a.ts')
    expect(title).toHaveLength(100)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back to the location for suggestion-only or empty comments', () => {
    expect(reviewTaskTitle('```suggestion\nconst b = 2\n```', 'src/a.ts', 7)).toBe('Apply suggested change in a.ts:7')
    expect(reviewTaskTitle('', 'src/a.ts')).toBe('Address review comment in a.ts')
  })

  it('builds a valid description with the location, quote and code', () => {
    const doc = reviewTaskDescription(thread)
    // The description passes the same validation as one typed in the editor.
    expect(normalizeDescriptionDoc(doc)).toEqual(doc)
    expect(doc.content.map((node) => node.type)).toEqual(['paragraph', 'blockquote', 'codeBlock'])
    const intro = JSON.stringify(doc.content[0])
    expect(intro).toContain('@reviewer')
    expect(intro).toContain('src/billing/tax.ts:42')
    expect(intro).toContain(thread.url)
    expect(doc.content[2].content?.[0].text).toBe(' const a = 1\n+log(token)\n const b = 2')
  })

  it('skips the code for file comments and links that are not http', () => {
    const doc = reviewTaskDescription({ ...thread, isFileComment: true, line: null, url: 'javascript:alert(1)', body: '' })
    expect(normalizeDescriptionDoc(doc)).toEqual(doc)
    expect(doc.content).toHaveLength(1)
    expect(JSON.stringify(doc)).not.toContain('javascript:')
  })

  it('keeps the end of a diff hunk', () => {
    expect(diffHunkTail('@@ -1 +1 @@\na\nb\nc', 2)).toBe('b\nc')
    expect(diffHunkTail(null)).toBeNull()
  })

  it('links the task in the follow-up reply', () => {
    expect(followUpReplyBody('SHOP-7', 'https://tasker/issues/x')).toBe(
      'Tracked as a follow-up in [SHOP-7](https://tasker/issues/x).',
    )
  })
})

describe('review thread lookup', () => {
  it('normalizes a GraphQL thread', () => {
    expect(
      normalizeTrackedThread({
        id: 'PRRT_1',
        path: 'a.ts',
        line: null,
        originalLine: 9,
        subjectType: 'LINE',
        isResolved: true,
        isOutdated: true,
        pullRequest: {
          number: 3,
          title: 'T',
          url: 'https://github.com/acme/app/pull/3',
          author: { login: 'dev' },
          repository: { nameWithOwner: 'acme/app' },
        },
        comments: { nodes: [null, { databaseId: 5, body: 'b', url: 'u', diffHunk: null, author: null }] },
      }),
    ).toMatchObject({ line: 9, isResolved: true, isOutdated: true, rootCommentId: 5, authorLogin: null, pullAuthorLogin: 'dev' })
  })

  it('rejects nodes that are not review threads', () => {
    expect(normalizeTrackedThread(null)).toBeNull()
    expect(normalizeTrackedThread({ id: 'X' })).toBeNull()
  })
})

describe('review task settings and webhook events', () => {
  it('defaults both sync directions on', () => {
    expect(normalizeReviewTaskSettings(undefined)).toEqual({ completeTaskOnResolve: true, resolveThreadOnDone: true })
    expect(normalizeReviewTaskSettings({ resolveThreadOnDone: false })).toEqual({
      completeTaskOnResolve: true,
      resolveThreadOnDone: false,
    })
  })

  it('reports events missing from hooks registered before review sync', () => {
    expect(missingWebhookEvents(undefined)).toEqual(['pull_request_review_thread', 'pull_request_review_comment'])
    expect(missingWebhookEvents(['pull_request', 'pull_request_review', 'pull_request_review_thread', 'push', 'check_suite', 'workflow_run'])).toEqual(['pull_request_review_comment'])
  })

  it('normalizes review thread webhook payloads', () => {
    const payload = {
      action: 'resolved',
      repository: { id: 99, full_name: 'acme/app' },
      sender: { login: 'dev' },
      thread: { node_id: 'PRRT_1' },
      pull_request: {
        number: 12,
        state: 'open',
        head: { ref: 'b', sha: 's' },
        base: { ref: 'main' },
      },
    }
    expect(normalizeWebhookEvent('pull_request_review_thread', payload)).toMatchObject({
      kind: 'pull_request_review_thread',
      action: 'resolved',
      threadId: 'PRRT_1',
      senderLogin: 'dev',
    })
    expect(normalizeWebhookEvent('pull_request_review_thread', { ...payload, action: 'created' })).toBeNull()
    expect(normalizeWebhookEvent('pull_request_review_thread', { ...payload, thread: {} })).toBeNull()
  })
})

describe('review task display', () => {
  it('shows file and line', () => {
    expect(reviewThreadLocation('src/a/b.ts', 4, false)).toBe('b.ts:4')
    expect(reviewThreadLocation('src/a/b.ts', 4, true)).toBe('b.ts')
  })

  it('counts fix tasks separately from follow-ups', () => {
    expect(
      reviewTaskProgress([
        { kind: 'fix', issue: { isDone: true } },
        { kind: 'fix', issue: { isDone: false } },
        { kind: 'follow_up', issue: { isDone: false } },
      ]),
    ).toEqual({ total: 3, fixes: 2, fixesDone: 1, fixesOpen: 1, followUps: 1 })
  })

  it('summarizes what tracking did', () => {
    expect(
      trackSummary(
        [
          { outcome: 'created', key: 'SHOP-1' },
          { outcome: 'existing', key: 'SHOP-2' },
          { outcome: 'skipped_resolved', key: null },
        ],
        [],
      ),
    ).toEqual({
      message: 'Created 1 task (SHOP-1). 1 conversation was already tracked. Skipped 1 resolved conversation.',
      failed: false,
    })
    expect(trackSummary([{ outcome: 'created', key: 'SHOP-1' }], ['SHOP-1: forbidden']).failed).toBe(true)
    expect(trackSummary([{ outcome: 'skipped_resolved', key: null }], []).failed).toBe(true)
  })
})

describe('review replies', () => {
  const base = {
    repository: { id: 99, full_name: 'acme/app' },
    sender: { login: 'dev' },
    pull_request: { number: 12, state: 'open', head: { ref: 'b', sha: 's' }, base: { ref: 'main' } },
  }

  it('normalizes review comment payloads', () => {
    expect(
      normalizeWebhookEvent('pull_request_review_comment', {
        ...base,
        action: 'created',
        comment: { id: 5, in_reply_to_id: 4, user: { login: 'dev' }, html_url: 'u' },
      }),
    ).toMatchObject({ kind: 'pull_request_review_comment', action: 'created', commentId: 5, inReplyToId: 4, authorLogin: 'dev' })
    expect(
      normalizeWebhookEvent('pull_request_review_comment', { ...base, action: 'created', comment: { id: 6 } }),
    ).toMatchObject({ inReplyToId: null })
    expect(normalizeWebhookEvent('pull_request_review_comment', { ...base, action: 'created', comment: {} })).toBeNull()
  })

  it('links reply notifications to the conversation', () => {
    const content = buildGitHubNotificationContent(
      'github_review_reply',
      {
        repository: 'acme/app',
        projectId: 'p1',
        projectKey: 'SHOP',
        projectName: 'Shop',
        actorLogin: 'reviewer',
        pullNumber: 12,
        pullTitle: 'Fix tax',
        taskKeys: ['SHOP-7'],
        threadId: 'PRRT_1',
        location: 'src/tax.ts:42',
        dedupeKey: 'x',
      },
      'https://tasker.example/',
    )
    expect(content.link).toBe('/projects/p1/pulls/12?thread=PRRT_1')
    expect(content.title).toBe('New reply on a review conversation for SHOP-7')
    expect(content.body).toBe('reviewer replied on src/tax.ts:42 in #12 Fix tax (acme/app).')
  })

  it('leaves out threads of reviews that are not submitted', () => {
    expect(isPendingReviewThread({ comments: { nodes: [{ pullRequestReview: { state: 'PENDING' } }] } })).toBe(true)
    expect(isPendingReviewThread({ comments: { nodes: [null, { pullRequestReview: { state: 'COMMENTED' } }] } })).toBe(false)
    expect(isPendingReviewThread({})).toBe(false)
  })

  it('filters the review inbox to conversations the viewer started', () => {
    const thread = (login: string | null) => ({ comments: [{ author: login ? { login } : null }] })
    const pullRequests = [
      { number: 1, threads: [thread('Me'), thread('other')] },
      { number: 2, threads: [thread('other'), thread(null)] },
    ]
    expect(filterReviewInbox(pullRequests, 'mine', 'me').map((pr) => [pr.number, pr.threads.length])).toEqual([[1, 1]])
    expect(filterReviewInbox(pullRequests, 'all', 'me')).toHaveLength(2)
  })
})
