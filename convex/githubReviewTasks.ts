import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from './_generated/server'
import { githubReviewTaskKindValidator } from './constants'
import { findUserByGitHubLogin, getRepositoryLink } from './githubLinks'
import { applyIssueUpdate, createDefinition } from './issues'
import { createActivity } from './lib/activity'
import {
  canWrite,
  isAdmin,
  requireIssueViewAccess,
  requireIssueWriteAccess,
  requireProjectViewAccess,
  requireProjectWriteAccess,
} from './lib/auth'
import { resolveActor } from './lib/githubActors'
import { locationLabel, normalizeReviewTaskSettings } from './lib/githubReviewTasks'
import { descriptionDocValidator } from './lib/issueDescriptions'
import { getProjectStatusColor, getProjectStatusLabel, normalizeProject } from './lib/projectStatuses'

// Pull request review conversations tracked as tasks. GitHub calls live in
// `githubReviewTaskActions.ts`; the task -> GitHub direction is queued from
// `issues.ts` through `lib/githubReviewSync.ts`.

type Ctx = QueryCtx | MutationCtx

function pullRequestUrl(repository: Doc<'githubRepositoryLinks'>, pullNumber: number) {
  return `${repository.htmlUrl}/pull/${pullNumber}`
}

/** Whether a user can be assigned tasks in the project, as `issues.ts` requires. */
async function isAssignable(ctx: Ctx, projectId: Id<'projects'>, user: Doc<'users'> | null) {
  if (!user?.isActive) return false
  if (isAdmin(user.globalRole)) return true
  const membership = await ctx.db
    .query('projectMembers')
    .withIndex('by_projectId_userId', (q) => q.eq('projectId', projectId).eq('userId', user._id))
    .unique()
  return Boolean(membership)
}

function presentIssue(
  issue: Doc<'issues'>,
  project: ReturnType<typeof normalizeProject<Doc<'projects'>>>,
  assignee: Doc<'users'> | null,
) {
  return {
    _id: issue._id,
    key: `${project.key}-${issue.issueNumber}`,
    title: issue.title,
    status: issue.status,
    statusLabel: getProjectStatusLabel(project, issue.status),
    statusColor: getProjectStatusColor(project, issue.status),
    isDone: issue.status === 'done',
    archived: issue.archived,
    assignee: assignee ? { _id: assignee._id, name: assignee.name, imageUrl: assignee.imageUrl ?? null } : null,
  }
}

// ---------------------------------------------------------------------------
// Queries

/** Review tasks of one pull request, keyed by thread, plus what tracking needs. */
export const listForPullRequest = query({
  args: { projectId: v.id('projects'), pullNumber: v.number(), authorLogin: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return null
    const { user, project } = await requireProjectViewAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) return null
    const normalized = normalizeProject(project)

    const links = await ctx.db
      .query('githubReviewThreadLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId).eq('pullNumber', args.pullNumber))
      .collect()
    const threads = (
      await Promise.all(
        links.map(async (link) => {
          const issue = await ctx.db.get(link.issueId)
          if (!issue || issue.deletedAt) return null
          const assignee = issue.assigneeId ? await ctx.db.get(issue.assigneeId) : null
          return {
            linkId: link._id,
            threadId: link.threadId,
            kind: link.kind,
            path: link.path,
            line: link.line ?? null,
            isResolved: link.isResolved,
            isOutdated: link.isOutdated,
            issue: presentIssue(issue, normalized, assignee),
          }
        }),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null)

    // Tasks the pull request belongs to that can hold review sub-tasks.
    const pullRequestLinks = await ctx.db
      .query('githubPullRequestLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId).eq('pullNumber', args.pullNumber))
      .collect()
    const parentCandidates = (
      await Promise.all(pullRequestLinks.map((row) => ctx.db.get(row.issueId)))
    )
      .filter(
        (issue): issue is Doc<'issues'> =>
          Boolean(issue && !issue.deletedAt && !issue.archived && !issue.parentIssueId && issue.status !== 'done'),
      )
      .sort((a, b) => a.issueNumber - b.issueNumber)
      .map((issue) => ({ _id: issue._id, key: `${project.key}-${issue.issueNumber}`, title: issue.title }))

    const author = await findUserByGitHubLogin(ctx, args.authorLogin)
    const authorAssignee =
      author && (await isAssignable(ctx, args.projectId, author)) ? { _id: author._id, name: author.name } : null

    return {
      canWrite: canWrite(user.globalRole) && !project.archived,
      settings: normalizeReviewTaskSettings(repository.reviewTaskSettings),
      threads: threads.sort((a, b) => a.issue.key.localeCompare(b.issue.key, undefined, { numeric: true })),
      parentCandidates: [...new Map(parentCandidates.map((issue) => [issue._id, issue])).values()],
      authorAssignee,
    }
  },
})

/** Review conversations a task was created from, for its Development panel. */
export const listForIssue = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId)
    if (!issue || issue.deletedAt) return null
    const { user, project } = await requireIssueViewAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, issue.projectId)
    if (!repository) return null
    const links = await ctx.db
      .query('githubReviewThreadLinks')
      .withIndex('by_issueId', (q) => q.eq('issueId', args.issueId))
      .collect()
    return {
      projectId: issue.projectId,
      canWrite: canWrite(user.globalRole) && !project.archived,
      items: links
        .filter((link) => link.repositoryId === repository.repositoryId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((link) => ({
          linkId: link._id,
          threadId: link.threadId,
          kind: link.kind,
          pullNumber: link.pullNumber,
          pullUrl: pullRequestUrl(repository, link.pullNumber),
          path: link.path,
          line: link.line ?? null,
          authorLogin: link.authorLogin ?? null,
          isResolved: link.isResolved,
          isOutdated: link.isOutdated,
          replyCount: link.replyCount ?? 0,
          lastReplyAt: link.lastReplyAt ?? null,
          lastReplyLogin: link.lastReplyLogin ?? null,
        })),
    }
  },
})

// ---------------------------------------------------------------------------
// Mutations

/** Stops tracking a conversation. The task and the GitHub thread stay as they are. */
export const unlink = mutation({
  args: { linkId: v.id('githubReviewThreadLinks') },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    const { user } = await requireIssueWriteAccess(ctx, link.issueId)
    await ctx.db.delete(link._id)
    await createActivity(ctx, {
      actorId: user._id,
      projectId: link.projectId,
      issueId: link.issueId,
      entityType: 'github',
      entityId: `${link.repositoryId}#${link.pullNumber}`,
      action: 'github.review_thread_unlinked',
      metadata: { pullNumber: link.pullNumber, path: link.path, line: link.line ?? null },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Internal: tracking threads

const trackedThreadValidator = v.object({
  threadId: v.string(),
  rootCommentId: v.optional(v.number()),
  pullNumber: v.number(),
  pullAuthorLogin: v.optional(v.string()),
  path: v.string(),
  line: v.optional(v.number()),
  authorLogin: v.optional(v.string()),
  isResolved: v.boolean(),
  isOutdated: v.boolean(),
  url: v.string(),
  title: v.string(),
  descriptionDoc: descriptionDocValidator,
})

export type TrackResult = {
  threadId: string
  outcome: 'created' | 'existing' | 'skipped_resolved'
  linkId: Id<'githubReviewThreadLinks'> | null
  issueId: Id<'issues'> | null
  key: string | null
  kind: Doc<'githubReviewThreadLinks'>['kind'] | null
  isResolved: boolean
}

/**
 * Creates one task and link per thread the signed-in writer loaded from
 * GitHub. Threads already tracked in the project are returned as they are.
 */
export const recordTrackedThreads = internalMutation({
  args: {
    projectId: v.id('projects'),
    kind: githubReviewTaskKindValidator,
    parentIssueId: v.optional(v.id('issues')),
    assignToAuthor: v.boolean(),
    threads: v.array(trackedThreadValidator),
  },
  handler: async (ctx, args): Promise<{ userId: Id<'users'>; results: TrackResult[] }> => {
    const { user, project } = await requireProjectWriteAccess(ctx, args.projectId)
    if (project.archived) {
      throw new ConvexError({ code: 'FORBIDDEN', message: 'This project is archived.' })
    }
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) {
      throw new ConvexError({ code: 'GITHUB_REPO_NOT_LINKED', message: 'Link a repository first.' })
    }

    // Follow-ups outlive the pull request, so they never block its task.
    let parentIssueId: Id<'issues'> | undefined
    if (args.kind === 'fix' && args.parentIssueId) {
      const parent = await ctx.db.get(args.parentIssueId)
      if (
        !parent ||
        parent.projectId !== args.projectId ||
        parent.deletedAt ||
        parent.archived ||
        parent.parentIssueId ||
        parent.status === 'done'
      ) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Pick an open top-level task of this project as the parent.',
        })
      }
      parentIssueId = parent._id
    }

    const assigneeCache = new Map<string, Id<'users'> | undefined>()
    async function assigneeFor(login: string | undefined) {
      if (!args.assignToAuthor || !login) return undefined
      if (!assigneeCache.has(login)) {
        const author = await findUserByGitHubLogin(ctx, login)
        assigneeCache.set(login, author && (await isAssignable(ctx, args.projectId, author)) ? author._id : undefined)
      }
      return assigneeCache.get(login)
    }

    const results: TrackResult[] = []
    for (const thread of args.threads) {
      const existing = (
        await ctx.db
          .query('githubReviewThreadLinks')
          .withIndex('by_threadId', (q) => q.eq('threadId', thread.threadId))
          .collect()
      ).find((row) => row.projectId === args.projectId)
      if (existing) {
        const issue = await ctx.db.get(existing.issueId)
        results.push({
          threadId: thread.threadId,
          outcome: 'existing',
          linkId: existing._id,
          issueId: existing.issueId,
          key: issue ? `${project.key}-${issue.issueNumber}` : null,
          kind: existing.kind,
          isResolved: existing.isResolved,
        })
        continue
      }
      if (args.kind === 'fix' && thread.isResolved) {
        results.push({
          threadId: thread.threadId,
          outcome: 'skipped_resolved',
          linkId: null,
          issueId: null,
          key: null,
          kind: null,
          isResolved: true,
        })
        continue
      }

      const issue = await createDefinition.handler(ctx, {
        projectId: args.projectId,
        title: thread.title,
        descriptionDoc: thread.descriptionDoc,
        assigneeId: await assigneeFor(thread.pullAuthorLogin),
        parentIssueId,
      })
      if (!issue) throw new ConvexError({ code: 'INTERNAL_ERROR', message: 'Could not create the task.' })
      const now = Date.now()
      const linkId = await ctx.db.insert('githubReviewThreadLinks', {
        projectId: args.projectId,
        repositoryId: repository.repositoryId,
        pullNumber: thread.pullNumber,
        issueId: issue._id,
        threadId: thread.threadId,
        rootCommentId: thread.rootCommentId,
        kind: args.kind,
        path: thread.path,
        line: thread.line,
        authorLogin: thread.authorLogin,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      })
      await createActivity(ctx, {
        actorId: user._id,
        projectId: args.projectId,
        issueId: issue._id,
        entityType: 'github',
        entityId: `${repository.repositoryId}#${thread.pullNumber}`,
        action: 'github.review_thread_linked',
        metadata: {
          pullNumber: thread.pullNumber,
          path: thread.path,
          line: thread.line ?? null,
          kind: args.kind,
          url: thread.url,
          reviewerLogin: thread.authorLogin ?? null,
        },
      })
      results.push({
        threadId: thread.threadId,
        outcome: 'created',
        linkId,
        issueId: issue._id,
        key: `${project.key}-${issue.issueNumber}`,
        kind: args.kind,
        isResolved: thread.isResolved,
      })
    }
    return { userId: user._id, results }
  },
})

// ---------------------------------------------------------------------------
// Internal: GitHub -> task

type ThreadState = {
  isResolved?: boolean
  isOutdated?: boolean
}

/**
 * Applies a thread's GitHub state to its link and, for `fix` threads, to the
 * task: resolved completes it, unresolved restores the status it had. The
 * link is patched first so the task change does not echo back to GitHub.
 */
export async function applyThreadState(
  ctx: MutationCtx,
  args: {
    repository: Doc<'githubRepositoryLinks'>
    project: Doc<'projects'>
    link: Doc<'githubReviewThreadLinks'>
    state: ThreadState
    sender: Doc<'users'> | null
    senderLogin: string | null
    deliveryId?: string
  },
): Promise<string> {
  const { link, state } = args
  const patch: Partial<Doc<'githubReviewThreadLinks'>> = {}
  if (state.isOutdated !== undefined && state.isOutdated !== link.isOutdated) patch.isOutdated = state.isOutdated
  const resolvedChanged = state.isResolved !== undefined && state.isResolved !== link.isResolved
  if (resolvedChanged) patch.isResolved = state.isResolved
  if (!Object.keys(patch).length) return 'unchanged'
  await ctx.db.patch(link._id, { ...patch, updatedAt: Date.now() })
  if (!resolvedChanged || link.kind !== 'fix') return 'updated'

  const resolved = state.isResolved === true
  const issue = await ctx.db.get(link.issueId)
  if (!issue || issue.deletedAt) return 'task missing'
  const project = normalizeProject(args.project)
  const metadata = {
    event: resolved ? 'resolved' : 'unresolved',
    pullNumber: link.pullNumber,
    path: link.path,
    line: link.line ?? null,
    actorLogin: args.senderLogin,
    deliveryId: args.deliveryId,
  }
  const activity = (extra: Record<string, unknown>) =>
    createActivity(ctx, {
      actorId: args.sender?._id,
      projectId: link.projectId,
      issueId: issue._id,
      entityType: 'github',
      entityId: `${link.repositoryId}#${link.pullNumber}`,
      action: 'github.review_thread_event',
      metadata: { ...metadata, ...extra },
    })

  let target: string | null = null
  if (normalizeReviewTaskSettings(args.repository.reviewTaskSettings).completeTaskOnResolve && !issue.archived) {
    const statusKeys = project.statuses.map((status) => status.key)
    if (resolved && issue.status !== 'done') {
      target = 'done'
    } else if (!resolved && issue.status === 'done') {
      const previous = link.statusBeforeResolve
      target = previous && previous !== 'done' && statusKeys.includes(previous) ? previous : 'todo'
    }
  }
  if (!target) {
    await activity({})
    return resolved ? 'thread resolved' : 'thread unresolved'
  }

  const actor = await resolveActor(ctx, args.repository, args.project, args.sender)
  if (!actor) {
    await activity({ from: issue.status, to: target, reason: 'Nobody who can change tasks is available.' })
    return 'skipped: no actor'
  }
  try {
    await ctx.db.patch(link._id, { statusBeforeResolve: resolved ? issue.status : undefined })
    await applyIssueUpdate(ctx, { issue, user: actor, changes: { status: target } })
    await activity({ from: issue.status, to: target })
    return `task moved to ${target}`
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error
    await ctx.db.patch(link._id, { statusBeforeResolve: link.statusBeforeResolve })
    await activity({
      from: issue.status,
      to: target,
      reason: (error.data as { message?: string }).message ?? 'Blocked by task rules.',
    })
    return 'skipped: blocked'
  }
}

/**
 * Called after a pull request is loaded with the viewer's token, so tasks
 * follow GitHub even when a webhook delivery was missed or none is set up.
 */
export const reconcileThreads = internalMutation({
  args: {
    projectId: v.id('projects'),
    pullNumber: v.number(),
    threads: v.array(
      v.object({
        threadId: v.string(),
        isResolved: v.boolean(),
        isOutdated: v.boolean(),
        resolvedByLogin: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectViewAccess(ctx, args.projectId)
    if (project.archived) return null
    const links = await ctx.db
      .query('githubReviewThreadLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId).eq('pullNumber', args.pullNumber))
      .collect()
    if (!links.length) return null
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) return null
    const byThread = new Map(args.threads.map((thread) => [thread.threadId, thread]))
    for (const link of links) {
      const thread = byThread.get(link.threadId)
      if (!thread || link.repositoryId !== repository.repositoryId) continue
      if (thread.isResolved === link.isResolved && thread.isOutdated === link.isOutdated) continue
      const senderLogin = thread.isResolved ? (thread.resolvedByLogin ?? null) : null
      await applyThreadState(ctx, {
        repository,
        project,
        link,
        state: { isResolved: thread.isResolved, isOutdated: thread.isOutdated },
        sender: await findUserByGitHubLogin(ctx, senderLogin),
        senderLogin,
      })
    }
    return null
  },
})

/** Pull requests of a project with tracked conversations, to limit reconciling. */
export const trackedPullNumbers = internalQuery({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireProjectViewAccess(ctx, args.projectId)
    const links = await ctx.db
      .query('githubReviewThreadLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId))
      .collect()
    return [...new Set(links.map((link) => link.pullNumber))]
  },
})

// ---------------------------------------------------------------------------
// Internal: task -> GitHub

/** What the scheduled sync action needs. Internal only; no caller identity. */
export const getThreadSyncContext = internalQuery({
  args: { linkId: v.id('githubReviewThreadLinks'), userId: v.id('users') },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    const repository = await getRepositoryLink(ctx, link.projectId)
    if (!repository || repository.repositoryId !== link.repositoryId) return null
    const connection = await ctx.db
      .query('githubConnections')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    return { link, repository, connection }
  },
})

/** Records the outcome of a GitHub write for a tracked conversation. */
export const recordThreadSync = internalMutation({
  args: {
    linkId: v.id('githubReviewThreadLinks'),
    actorId: v.optional(v.id('users')),
    resolved: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    if (!args.error && link.isResolved !== args.resolved) {
      await ctx.db.patch(link._id, { isResolved: args.resolved, updatedAt: Date.now() })
    }
    await createActivity(ctx, {
      actorId: args.actorId,
      projectId: link.projectId,
      issueId: link.issueId,
      entityType: 'github',
      entityId: `${link.repositoryId}#${link.pullNumber}`,
      action: 'github.review_thread_event',
      metadata: {
        event: args.error ? 'sync_failed' : args.resolved ? 'resolved_on_github' : 'unresolved_on_github',
        pullNumber: link.pullNumber,
        path: link.path,
        line: link.line ?? null,
        location: locationLabel(link.path, link.line),
        reason: args.error ?? null,
      },
    })
    return null
  },
})
