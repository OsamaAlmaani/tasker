import { ConvexError, v } from 'convex/values'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { type ActionCtx, action, internalAction } from './_generated/server'
import { type GitHubReviewTaskKind, githubReviewTaskKindValidator } from './constants'
import type { TrackResult } from './githubReviewTasks'
import { decryptToken, invalidInput, loadLinkedClient } from './lib/githubAccess'
import {
  githubError,
  githubGraphql,
  normalizeReviewThread,
  type PullRequestReviewThread,
  REPLY_TO_REVIEW_THREAD_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
} from './lib/githubApi'
import { parseSeverity, severityPriority } from './lib/githubReviewInbox'
import {
  followUpReplyBody,
  MAX_TRACKED_THREADS,
  normalizeTrackedThread,
  type RawTrackedThread,
  REVIEW_THREAD_DETAILS_QUERY,
  REVIEW_THREADS_QUERY,
  reviewTaskDescription,
  reviewTaskTitle,
  type TrackedThread,
} from './lib/githubReviewTasks'

// GitHub calls for review tasks. Tracking uses the signed-in user's token;
// the scheduled sync uses the token of the user who changed the task.

const MAX_NODE_ID_LENGTH = 200

function appBaseUrl() {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

async function loadThreads(token: string, threadIds: string[]) {
  const data = await githubGraphql<{ nodes: Array<RawTrackedThread | null> }>(token, REVIEW_THREADS_QUERY, {
    ids: threadIds,
  })
  return (data.nodes ?? []).map((node) => normalizeTrackedThread(node))
}

function belongsTo(thread: TrackedThread | null, repository: string, pullNumber: number): thread is TrackedThread {
  return Boolean(
    thread && thread.pullNumber === pullNumber && thread.repository.toLowerCase() === repository.toLowerCase(),
  )
}

export function errorMessage(error: unknown) {
  if (error instanceof ConvexError) return (error.data as { message?: string }).message ?? 'GitHub request failed.'
  return error instanceof Error ? error.message : 'GitHub request failed.'
}

/** Unique, well-formed thread ids, at most `MAX_TRACKED_THREADS`. */
export function validateThreadIds(ids: string[]) {
  const threadIds = [...new Set(ids)]
  if (!threadIds.length) throw invalidInput('Pick at least one conversation.')
  if (threadIds.length > MAX_TRACKED_THREADS) {
    throw invalidInput(`Pick at most ${MAX_TRACKED_THREADS} conversations at once.`)
  }
  if (threadIds.some((id) => !id || id.length > MAX_NODE_ID_LENGTH)) {
    throw invalidInput('That conversation could not be found.')
  }
  return threadIds
}

/**
 * Loads conversations with the caller's token and confirms each belongs to
 * the linked repository (and to `pullNumber` when given), so a client cannot
 * act on conversations elsewhere.
 */
export async function loadOwnedThreads(token: string, repository: string, threadIds: string[], pullNumber?: number) {
  const threads = await loadThreads(token, threadIds)
  const owned = threads.every(
    (thread) => thread && belongsTo(thread, repository, pullNumber ?? thread.pullNumber),
  )
  if (threads.length !== threadIds.length || !owned) {
    throw githubError('GITHUB_NOT_FOUND', 'A conversation is not part of this repository or pull request.')
  }
  return threads as TrackedThread[]
}

/**
 * Creates tasks for loaded conversations of one pull request, then answers
 * and resolves `follow_up` conversations on GitHub.
 */
export async function trackLoadedThreads(
  ctx: ActionCtx,
  token: string,
  args: {
    projectId: Id<'projects'>
    kind: GitHubReviewTaskKind
    parentIssueId?: Id<'issues'>
    assignToAuthor: boolean
    priorityFromSeverity: boolean
    threads: TrackedThread[]
  },
): Promise<{ results: TrackResult[]; warnings: string[] }> {
  const { userId, results } = await ctx.runMutation(internal.githubReviewTasks.recordTrackedThreads, {
    projectId: args.projectId,
    kind: args.kind,
    parentIssueId: args.parentIssueId,
    assignToAuthor: args.assignToAuthor,
    threads: args.threads.map((thread) => {
      const severity = args.priorityFromSeverity ? parseSeverity(thread.body) : null
      return {
        threadId: thread.threadId,
        rootCommentId: thread.rootCommentId ?? undefined,
        pullNumber: thread.pullNumber,
        pullAuthorLogin: thread.pullAuthorLogin ?? undefined,
        path: thread.path,
        line: thread.line ?? undefined,
        authorLogin: thread.authorLogin ?? undefined,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        url: thread.url,
        title: reviewTaskTitle(thread.body, thread.path, thread.line),
        descriptionDoc: reviewTaskDescription(thread),
        priority: severity ? severityPriority(severity) : undefined,
      }
    }),
  })

  // Follow-ups free the pull request: answer with the task and resolve.
  const warnings: string[] = []
  if (args.kind === 'follow_up') {
    for (const result of results) {
      if (result.outcome !== 'created' || !result.linkId || !result.issueId || !result.key) continue
      try {
        await githubGraphql(token, REPLY_TO_REVIEW_THREAD_MUTATION, {
          threadId: result.threadId,
          body: followUpReplyBody(result.key, `${appBaseUrl()}/issues/${result.issueId}`),
        })
        if (!result.isResolved) {
          await githubGraphql(token, RESOLVE_REVIEW_THREAD_MUTATION, { threadId: result.threadId })
        }
        await ctx.runMutation(internal.githubReviewTasks.recordThreadSync, {
          linkId: result.linkId,
          actorId: userId,
          resolved: true,
        })
        result.isResolved = true
      } catch (error) {
        warnings.push(`${result.key}: ${errorMessage(error)}`)
      }
    }
  }
  return { results, warnings }
}

/**
 * Turns review conversations of a pull request into tasks. `follow_up`
 * conversations are then answered with a link to the task and resolved.
 */
export const trackThreads = action({
  args: {
    projectId: v.id('projects'),
    pullNumber: v.number(),
    threadIds: v.array(v.string()),
    kind: githubReviewTaskKindValidator,
    parentIssueId: v.optional(v.id('issues')),
    assignToAuthor: v.boolean(),
    priorityFromSeverity: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ results: TrackResult[]; warnings: string[] }> => {
    if (!Number.isInteger(args.pullNumber) || args.pullNumber <= 0) {
      throw invalidInput('Pull request number must be a positive integer.')
    }
    const threadIds = validateThreadIds(args.threadIds)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const threads = await loadOwnedThreads(token, repository.fullName, threadIds, args.pullNumber)
    return await trackLoadedThreads(ctx, token, {
      projectId: args.projectId,
      kind: args.kind,
      parentIssueId: args.parentIssueId,
      assignToAuthor: args.assignToAuthor,
      priorityFromSeverity: args.priorityFromSeverity ?? false,
      threads,
    })
  },
})

type RawThreadDetail = Parameters<typeof normalizeReviewThread>[0] & {
  pullRequest?: { number: number; repository: { nameWithOwner: string } } | null
}

/**
 * The live conversations a task was created from, read with the viewer's own
 * token. Also brings stored thread state up to date.
 */
export const getIssueReviewThreads = action({
  args: { issueId: v.id('issues') },
  handler: async (
    ctx,
    args,
  ): Promise<{ repository: string | null; threads: Array<{ pullNumber: number; thread: PullRequestReviewThread }> }> => {
    const feedback = await ctx.runQuery(api.githubReviewTasks.listForIssue, { issueId: args.issueId })
    if (!feedback?.items.length) return { repository: null, threads: [] }
    const { token, repository } = await loadLinkedClient(ctx, feedback.projectId, 'view')
    const expected = new Map(feedback.items.map((item) => [item.threadId, item.pullNumber]))
    const data = await githubGraphql<{ nodes: Array<RawThreadDetail | null> }>(token, REVIEW_THREAD_DETAILS_QUERY, {
      ids: [...expected.keys()],
    })
    const threads: Array<{ pullNumber: number; thread: PullRequestReviewThread }> = []
    for (const node of data.nodes ?? []) {
      if (!node?.id || !node.pullRequest) continue
      const pullNumber = expected.get(node.id)
      if (
        pullNumber !== node.pullRequest.number ||
        node.pullRequest.repository.nameWithOwner.toLowerCase() !== repository.fullName.toLowerCase()
      ) {
        continue
      }
      threads.push({ pullNumber, thread: normalizeReviewThread(node) })
    }
    for (const pullNumber of new Set(threads.map((item) => item.pullNumber))) {
      await ctx.runMutation(internal.githubReviewTasks.reconcileThreads, {
        projectId: feedback.projectId,
        pullNumber,
        threads: threads
          .filter((item) => item.pullNumber === pullNumber)
          .map(({ thread }) => ({
            threadId: thread.id,
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
            resolvedByLogin: thread.resolvedBy ?? undefined,
          })),
      })
    }
    return { repository: repository.fullName, threads }
  },
})

/**
 * Resolves or reopens a `fix` conversation after its task entered or left
 * done in Tasker, with the token of the user who made that change.
 */
export const syncThreadResolution = internalAction({
  args: { linkId: v.id('githubReviewThreadLinks'), userId: v.id('users'), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.githubReviewTasks.getThreadSyncContext, {
      linkId: args.linkId,
      userId: args.userId,
    })
    if (!context) return null
    const record = (error?: string) =>
      ctx.runMutation(internal.githubReviewTasks.recordThreadSync, {
        linkId: args.linkId,
        actorId: args.userId,
        resolved: args.resolved,
        error,
      })
    if (context.link.isResolved === args.resolved) return null
    if (!context.connection) {
      await record('Connect GitHub in Settings so Tasker can update the conversation with your account.')
      return null
    }
    try {
      const token = await decryptToken(context.connection)
      const [thread] = await loadThreads(token, [context.link.threadId])
      if (!belongsTo(thread ?? null, context.repository.fullName, context.link.pullNumber)) {
        await record('The conversation is no longer on this pull request.')
        return null
      }
      if (thread!.isResolved !== args.resolved) {
        await githubGraphql(token, args.resolved ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION, {
          threadId: context.link.threadId,
        })
      }
      await record()
    } catch (error) {
      await record(errorMessage(error))
    }
    return null
  },
})
