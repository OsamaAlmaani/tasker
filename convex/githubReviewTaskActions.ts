import { ConvexError, v } from 'convex/values'
import { api, internal } from './_generated/api'
import { action, internalAction } from './_generated/server'
import { githubReviewTaskKindValidator } from './constants'
import type { TrackResult } from './githubReviewTasks'
import { decryptToken, invalidInput, loadLinkedClient } from './lib/githubAccess'
import {
  type GitHubActor,
  githubError,
  githubGraphql,
  normalizeActor,
  normalizeReviewThread,
  type PullRequestReviewThread,
  REPLY_TO_REVIEW_THREAD_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
} from './lib/githubApi'
import {
  followUpReplyBody,
  MAX_TRACKED_THREADS,
  normalizeTrackedThread,
  OPEN_REVIEW_PULL_REQUESTS,
  OPEN_REVIEW_PULL_REQUESTS_QUERY,
  REVIEW_INBOX_BATCH_SIZE,
  REVIEW_INBOX_THREADS_QUERY,
  type RawInboxThread,
  chunk,
  inboxThreadFromRaw,
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

function errorMessage(error: unknown) {
  if (error instanceof ConvexError) return (error.data as { message?: string }).message ?? 'GitHub request failed.'
  return error instanceof Error ? error.message : 'GitHub request failed.'
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
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ results: TrackResult[]; warnings: string[] }> => {
    if (!Number.isInteger(args.pullNumber) || args.pullNumber <= 0) {
      throw invalidInput('Pull request number must be a positive integer.')
    }
    const threadIds = [...new Set(args.threadIds)]
    if (!threadIds.length) throw invalidInput('Pick at least one conversation.')
    if (threadIds.length > MAX_TRACKED_THREADS) {
      throw invalidInput(`Track at most ${MAX_TRACKED_THREADS} conversations at once.`)
    }
    if (threadIds.some((id) => !id || id.length > MAX_NODE_ID_LENGTH)) {
      throw invalidInput('That conversation could not be found.')
    }

    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const threads = await loadThreads(token, threadIds)
    if (threads.length !== threadIds.length || !threads.every((thread) => belongsTo(thread, repository.fullName, args.pullNumber))) {
      throw githubError('GITHUB_NOT_FOUND', 'A conversation is not part of this pull request.')
    }
    const loaded = threads as TrackedThread[]

    const { userId, results } = await ctx.runMutation(internal.githubReviewTasks.recordTrackedThreads, {
      projectId: args.projectId,
      kind: args.kind,
      parentIssueId: args.parentIssueId,
      assignToAuthor: args.assignToAuthor,
      threads: loaded.map((thread) => ({
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
      })),
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

type RawOpenPullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: string
  author: Parameters<typeof normalizeActor>[0]
  reviewThreads: {
    nodes: Array<{ id: string; isResolved: boolean; isOutdated: boolean; resolvedBy: { login: string } | null } | null> | null
  } | null
}

export type OpenReviewPullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: number
  author: GitHubActor | null
  threads: PullRequestReviewThread[]
}

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

/**
 * Unresolved review conversations across the most recently updated open pull
 * requests, read with the viewer's own token. A light listing finds the open
 * conversations, then their first comments load in parallel batches, which
 * keeps every request well inside GitHub's time limit. Threads of reviews that
 * are not submitted yet are left out.
 */
export const listOpenReviewThreads = action({
  args: { projectId: v.id('projects') },
  handler: async (
    ctx,
    args,
  ): Promise<{
    viewerLogin: string
    totalPullRequests: number
    checkedPullRequests: number
    /** Open conversations whose details GitHub did not return. */
    missingThreads: number
    pullRequests: OpenReviewPullRequest[]
  }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const data = await withRetry(() =>
      githubGraphql<{
        viewer: { login: string }
        repository: { pullRequests: { totalCount: number; nodes: Array<RawOpenPullRequest | null> | null } } | null
      }>(token, OPEN_REVIEW_PULL_REQUESTS_QUERY, {
        owner: repository.owner,
        name: repository.name,
        first: OPEN_REVIEW_PULL_REQUESTS,
      }),
    )
    if (!data.repository) throw githubError('GITHUB_NOT_FOUND', 'The linked repository was not found.')
    const pulls = (data.repository.pullRequests.nodes ?? []).filter((pr): pr is RawOpenPullRequest => Boolean(pr))
    const threadsOf = (pr: RawOpenPullRequest) =>
      (pr.reviewThreads?.nodes ?? []).filter((node): node is NonNullable<typeof node> => Boolean(node))

    // Keep tracked tasks in step with what GitHub reports.
    const tracked = new Set(
      await ctx.runQuery(internal.githubReviewTasks.trackedPullNumbers, { projectId: args.projectId }),
    )
    for (const pr of pulls) {
      if (!tracked.has(pr.number)) continue
      await ctx.runMutation(internal.githubReviewTasks.reconcileThreads, {
        projectId: args.projectId,
        pullNumber: pr.number,
        threads: threadsOf(pr).map((thread) => ({
          threadId: thread.id,
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          resolvedByLogin: thread.resolvedBy?.login ?? undefined,
        })),
      })
    }

    const openIds = pulls.flatMap((pr) => threadsOf(pr).filter((thread) => !thread.isResolved).map((thread) => thread.id))
    const batches = await Promise.all(
      chunk(openIds, REVIEW_INBOX_BATCH_SIZE).map(async (ids) => {
        try {
          return await withRetry(() =>
            githubGraphql<{ nodes: Array<RawInboxThread | null> }>(token, REVIEW_INBOX_THREADS_QUERY, { ids }),
          )
        } catch {
          return { nodes: [] as Array<RawInboxThread | null> }
        }
      }),
    )
    const details = new Map<string, PullRequestReviewThread>()
    const loaded = new Set<string>()
    for (const node of batches.flatMap((batch) => batch.nodes ?? [])) {
      if (!node?.id) continue
      if (node.pullRequest?.repository.nameWithOwner.toLowerCase() !== repository.fullName.toLowerCase()) continue
      loaded.add(node.id)
      const thread = inboxThreadFromRaw(node)
      if (thread && !thread.isResolved) details.set(node.id, thread)
    }

    const pullRequests: OpenReviewPullRequest[] = []
    for (const pr of pulls) {
      const open = threadsOf(pr)
        .map((thread) => details.get(thread.id))
        .filter((thread): thread is PullRequestReviewThread => Boolean(thread))
        .sort((a, b) => a.createdAt - b.createdAt)
      if (!open.length) continue
      pullRequests.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isDraft: pr.isDraft,
        updatedAt: Date.parse(pr.updatedAt) || 0,
        author: normalizeActor(pr.author),
        threads: open,
      })
    }
    return {
      viewerLogin: data.viewer.login,
      totalPullRequests: data.repository.pullRequests.totalCount,
      checkedPullRequests: pulls.length,
      missingThreads: openIds.filter((id) => !loaded.has(id)).length,
      pullRequests,
    }
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
