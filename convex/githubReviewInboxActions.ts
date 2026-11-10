import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { action } from './_generated/server'
import { githubReviewTaskKindValidator } from './constants'
import {
  errorMessage,
  loadOwnedThreads,
  trackLoadedThreads,
  validateThreadIds,
} from './githubReviewTaskActions'
import type { TrackResult } from './githubReviewTasks'
import { invalidInput, loadLinkedClient } from './lib/githubAccess'
import {
  githubError,
  githubGraphql,
  normalizeReviewThread,
  type PullRequestReviewThread,
  REPLY_TO_REVIEW_THREAD_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
} from './lib/githubApi'
import {
  chunk,
  INBOX_BATCH_SIZE,
  INBOX_PULL_REQUESTS,
  INBOX_PULL_REQUESTS_QUERY,
  INBOX_THREADS_QUERY,
  type InboxPullRequest,
  type InboxThread,
  inboxPullRequestFromRaw,
  inboxThreadFromRaw,
  type RawInboxPullRequest,
  type RawInboxThread,
} from './lib/githubReviewInbox'
import type { TrackedThread } from './lib/githubReviewTasks'
import { REVIEW_THREAD_DETAILS_QUERY } from './lib/githubReviewTasks'

// GitHub calls for the Reviews inbox. Every call uses the signed-in user's own
// token; nothing read here is stored except tracked thread state.

const MAX_REPLY_LENGTH = 60_000

/** Retries once when GitHub times out (502/504), which large reads sometimes hit. */
async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    const status = error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
    if (status !== 502 && status !== 504) throw error
    return await load()
  }
}

type ThreadState = { threadId: string; isResolved: boolean; isOutdated: boolean; resolvedByLogin?: string }

/** Brings tracked tasks of one pull request in line with GitHub. */
async function reconcile(ctx: ActionCtx, projectId: Id<'projects'>, pullNumber: number, threads: ThreadState[]) {
  if (!threads.length) return
  await ctx.runMutation(internal.githubReviewTasks.reconcileThreads, { projectId, pullNumber, threads })
}

export type ReviewInbox = {
  viewerLogin: string
  totalPullRequests: number
  checkedPullRequests: number
  /** Conversations whose details GitHub did not return. */
  missingThreads: number
  pullRequests: InboxPullRequest[]
}

/**
 * Open pull requests with every conversation (open and resolved), each with
 * its first comment and last activity. A light listing comes first, then the
 * comments load in parallel batches so every request stays well inside
 * GitHub's time limit.
 */
export const getReviewInbox = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<ReviewInbox> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const data = await withRetry(() =>
      githubGraphql<{
        viewer: { login: string }
        repository: { pullRequests: { totalCount: number; nodes: Array<RawInboxPullRequest | null> | null } } | null
      }>(token, INBOX_PULL_REQUESTS_QUERY, {
        owner: repository.owner,
        name: repository.name,
        first: INBOX_PULL_REQUESTS,
      }),
    )
    if (!data.repository) throw githubError('GITHUB_NOT_FOUND', 'The linked repository was not found.')
    const pulls = (data.repository.pullRequests.nodes ?? []).filter((pr): pr is RawInboxPullRequest => Boolean(pr))
    const threadsOf = (pr: RawInboxPullRequest) =>
      (pr.reviewThreads?.nodes ?? []).filter((node): node is NonNullable<typeof node> => Boolean(node))

    // Keep tracked tasks in step with what GitHub reports.
    const tracked = new Set(
      await ctx.runQuery(internal.githubReviewTasks.trackedPullNumbers, { projectId: args.projectId }),
    )
    for (const pr of pulls) {
      if (!tracked.has(pr.number)) continue
      await reconcile(
        ctx,
        args.projectId,
        pr.number,
        threadsOf(pr).map((thread) => ({
          threadId: thread.id,
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          resolvedByLogin: thread.resolvedBy?.login ?? undefined,
        })),
      )
    }

    const ids = pulls.flatMap((pr) => threadsOf(pr).map((thread) => thread.id))
    const batches = await Promise.all(
      chunk(ids, INBOX_BATCH_SIZE).map(async (batch) => {
        try {
          return await withRetry(() =>
            githubGraphql<{ nodes: Array<RawInboxThread | null> }>(token, INBOX_THREADS_QUERY, { ids: batch }),
          )
        } catch {
          return { nodes: [] as Array<RawInboxThread | null> }
        }
      }),
    )
    const threads = new Map<string, InboxThread>()
    const loaded = new Set<string>()
    for (const node of batches.flatMap((batch) => batch.nodes ?? [])) {
      if (!node?.id) continue
      if (node.pullRequest?.repository.nameWithOwner.toLowerCase() !== repository.fullName.toLowerCase()) continue
      loaded.add(node.id)
      const thread = inboxThreadFromRaw(node)
      if (thread) threads.set(thread.id, thread)
    }

    return {
      viewerLogin: data.viewer.login,
      totalPullRequests: data.repository.pullRequests.totalCount,
      checkedPullRequests: pulls.length,
      missingThreads: ids.filter((id) => !loaded.has(id)).length,
      pullRequests: pulls.map((pr) => inboxPullRequestFromRaw(pr, threads)),
    }
  },
})

type RawThreadDetail = Parameters<typeof normalizeReviewThread>[0] & {
  pullRequest?: { number: number; repository: { nameWithOwner: string } } | null
}

/** One conversation in full (rendered comments, code, permissions) for the detail pane. */
export const getReviewThread = action({
  args: { projectId: v.id('projects'), threadId: v.string() },
  handler: async (ctx, args): Promise<{ pullNumber: number; thread: PullRequestReviewThread }> => {
    const [threadId] = validateThreadIds([args.threadId])
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const data = await withRetry(() =>
      githubGraphql<{ nodes: Array<RawThreadDetail | null> }>(token, REVIEW_THREAD_DETAILS_QUERY, { ids: [threadId] }),
    )
    const node = data.nodes?.[0]
    if (
      !node?.id ||
      !node.pullRequest ||
      node.pullRequest.repository.nameWithOwner.toLowerCase() !== repository.fullName.toLowerCase()
    ) {
      throw githubError('GITHUB_NOT_FOUND', 'That conversation is not part of this repository.')
    }
    const thread = normalizeReviewThread(node)
    await reconcile(ctx, args.projectId, node.pullRequest.number, [
      {
        threadId: thread.id,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        resolvedByLogin: thread.resolvedBy ?? undefined,
      },
    ])
    return { pullNumber: node.pullRequest.number, thread }
  },
})

/**
 * Tracks conversations from any open pull requests at once. Each pull
 * request's conversations go under that pull request's own open task when
 * `parent` is `pull_request_task`.
 */
export const trackThreadsBulk = action({
  args: {
    projectId: v.id('projects'),
    threadIds: v.array(v.string()),
    kind: githubReviewTaskKindValidator,
    parent: v.union(v.literal('pull_request_task'), v.literal('none')),
    assignToAuthor: v.boolean(),
    priorityFromSeverity: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ results: TrackResult[]; warnings: string[] }> => {
    const threadIds = validateThreadIds(args.threadIds)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const threads = await loadOwnedThreads(token, repository.fullName, threadIds)
    const byPull = new Map<number, TrackedThread[]>()
    for (const thread of threads) byPull.set(thread.pullNumber, [...(byPull.get(thread.pullNumber) ?? []), thread])

    const results: TrackResult[] = []
    const warnings: string[] = []
    for (const [pullNumber, group] of byPull) {
      const parentIssueId =
        args.kind === 'fix' && args.parent === 'pull_request_task'
          ? ((await ctx.runQuery(internal.githubReviewTasks.defaultParentIssue, {
              projectId: args.projectId,
              pullNumber,
            })) ?? undefined)
          : undefined
      try {
        const outcome = await trackLoadedThreads(ctx, token, {
          projectId: args.projectId,
          kind: args.kind,
          parentIssueId,
          assignToAuthor: args.assignToAuthor,
          priorityFromSeverity: args.priorityFromSeverity,
          threads: group,
        })
        results.push(...outcome.results)
        warnings.push(...outcome.warnings)
      } catch (error) {
        warnings.push(`#${pullNumber}: ${errorMessage(error)}`)
      }
    }
    return { results, warnings }
  },
})

type BulkOutcome = { done: number; failed: Array<{ threadId: string; message: string }> }

/** Resolves or reopens several conversations, then updates their tasks. */
export const setThreadsResolved = action({
  args: { projectId: v.id('projects'), threadIds: v.array(v.string()), resolved: v.boolean() },
  handler: async (ctx, args): Promise<BulkOutcome> => {
    const threadIds = validateThreadIds(args.threadIds)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const threads = await loadOwnedThreads(token, repository.fullName, threadIds)
    const outcome: BulkOutcome = { done: 0, failed: [] }
    const changed = new Map<number, ThreadState[]>()
    for (const thread of threads) {
      try {
        if (thread.isResolved !== args.resolved) {
          await githubGraphql(token, args.resolved ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION, {
            threadId: thread.threadId,
          })
        }
        outcome.done++
        changed.set(thread.pullNumber, [
          ...(changed.get(thread.pullNumber) ?? []),
          { threadId: thread.threadId, isResolved: args.resolved, isOutdated: thread.isOutdated },
        ])
      } catch (error) {
        outcome.failed.push({ threadId: thread.threadId, message: errorMessage(error) })
      }
    }
    for (const [pullNumber, states] of changed) await reconcile(ctx, args.projectId, pullNumber, states)
    return outcome
  },
})

/** Posts the same reply on several conversations. */
export const replyToThreads = action({
  args: { projectId: v.id('projects'), threadIds: v.array(v.string()), body: v.string() },
  handler: async (ctx, args): Promise<BulkOutcome> => {
    const body = args.body.trim()
    if (!body) throw invalidInput('Reply cannot be empty.')
    if (body.length > MAX_REPLY_LENGTH) throw invalidInput('Reply is too long.')
    const threadIds = validateThreadIds(args.threadIds)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const threads = await loadOwnedThreads(token, repository.fullName, threadIds)
    const outcome: BulkOutcome = { done: 0, failed: [] }
    for (const thread of threads) {
      try {
        await githubGraphql(token, REPLY_TO_REVIEW_THREAD_MUTATION, { threadId: thread.threadId, body })
        outcome.done++
      } catch (error) {
        outcome.failed.push({ threadId: thread.threadId, message: errorMessage(error) })
      }
    }
    return outcome
  },
})
