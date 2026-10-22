import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { applyIssueUpdate } from './issues'
import { createActivity } from './lib/activity'
import { isAdmin, requireAdmin, requireIssueViewAccess, requireIssueWriteAccess, requireProjectViewAccess, requireProjectViewAccessForUser } from './lib/auth'
import { deriveGithubStatus, parseRepository, suggestBranchName, validateBranchName } from './lib/github'
import { ensureProjectStatusExists } from './lib/projectStatuses'

const INTERVAL = 5 * 60 * 1000
const LEASE = 2 * 60 * 1000
const connectionArgs = {
  projectId: v.id('projects'), owner: v.string(), repo: v.string(), repositoryId: v.number(), installationId: v.number(),
  baseBranch: v.string(), workStatus: v.string(), reviewStatus: v.string(),
}

function fail(message: string): never { throw new ConvexError({ code: 'VALIDATION_ERROR', message }) }

async function connectionFor(ctx: MutationCtx | Parameters<typeof requireProjectViewAccess>[0], projectId: Id<'projects'>) {
  return ctx.db.query('githubConnections').withIndex('by_projectId', q => q.eq('projectId', projectId)).unique()
}

function validateMapping(project: Doc<'projects'>, work: string, review: string) {
  if (work === review || ['todo', 'done'].includes(work) || ['todo', 'done'].includes(review) ||
    !ensureProjectStatusExists(project, work) || !ensureProjectStatusExists(project, review)) {
    fail('Choose distinct work and review statuses from this project, excluding Todo and Done.')
  }
}

export const projectConnection = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { user } = await requireProjectViewAccess(ctx, projectId)
    const slug = process.env.GITHUB_APP_SLUG
    const configured = Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET)
    return {
      connection: await connectionFor(ctx, projectId), canConfigure: isAdmin(user.globalRole), configured,
      installUrl: slug && /^[a-zA-Z0-9-]+$/.test(slug) ? `https://github.com/apps/${slug}/installations/new` : null,
    }
  },
})

export const issueLink = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { issue, project } = await requireIssueViewAccess(ctx, issueId)
    return {
      connection: await connectionFor(ctx, project._id),
      link: await ctx.db.query('githubLinks').withIndex('by_issueId', q => q.eq('issueId', issueId)).unique(),
      suggestedBranch: suggestBranchName(project.key, issue.issueNumber, issue.title),
    }
  },
})

export const authorizeConnection = internalQuery({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireAdmin(ctx)
    const { project } = await requireProjectViewAccess(ctx, projectId)
    if (project.archived) fail('Restore this project before connecting GitHub.')
    return { connectionVersion: (await connectionFor(ctx, projectId))?.version ?? null }
  },
})

export const saveConnection = internalMutation({
  args: { ...connectionArgs, expectedVersion: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const { project } = await requireProjectViewAccess(ctx, args.projectId)
    if (project.archived) fail('Restore this project before connecting GitHub.')
    parseRepository(`${args.owner}/${args.repo}`)
    validateBranchName(args.baseBranch)
    validateMapping(project, args.workStatus, args.reviewStatus)
    for (const id of [args.repositoryId, args.installationId]) if (!Number.isSafeInteger(id) || id <= 0) fail('Invalid GitHub repository or installation.')
    const old = await connectionFor(ctx, args.projectId)
    if ((old?.version ?? null) !== args.expectedVersion) fail('GitHub settings changed while validating the repository. Reload the settings and try again.')
    if (old && old.repositoryId !== args.repositoryId) {
      const links = await ctx.db.query('githubLinks').withIndex('by_projectId', q => q.eq('projectId', args.projectId)).take(1)
      if (links.length) fail('This project already has tracked branches. Keep its existing repository.')
    }
    const now = Date.now()
    const { expectedVersion: _expectedVersion, ...settings } = args
    const fields = { ...settings, enabled: true, configuredBy: user._id, version: (old?.version ?? 0) + 1, updatedAt: now }
    const id = old ? old._id : await ctx.db.insert('githubConnections', { ...fields, createdAt: now })
    if (old) await ctx.db.patch(id, fields)
    await createActivity(ctx, { actorId: user._id, projectId: args.projectId, entityType: 'project', entityId: args.projectId, action: 'project.github_connected', metadata: { repository: `${args.owner}/${args.repo}` } })
    return id
  },
})

export const disconnect = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const user = await requireAdmin(ctx)
    await requireProjectViewAccess(ctx, projectId)
    const connection = await connectionFor(ctx, projectId)
    if (!connection) return
    await ctx.db.patch(connection._id, { enabled: false, version: connection.version + 1, updatedAt: Date.now() })
    await createActivity(ctx, { actorId: user._id, projectId, entityType: 'project', entityId: projectId, action: 'project.github_disconnected' })
  },
})

export const authorizeIssue = internalQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }) => {
    const { issue, project } = await requireIssueWriteAccess(ctx, issueId)
    if (issue.archived || project.archived) fail('Restore this task and project before using GitHub.')
    const link = await ctx.db.query('githubLinks').withIndex('by_issueId', q => q.eq('issueId', issueId)).unique()
    if (!link || link.creationState !== 'ready') fail('Create or link a branch first.')
    return link._id
  },
})

export const reserveBranch = internalMutation({
  args: { issueId: v.id('issues'), branch: v.string(), baseBranch: v.string(), attempt: v.string(), mode: v.union(v.literal('create'), v.literal('link')) },
  handler: async (ctx, args) => {
    const { user, issue, project } = await requireIssueWriteAccess(ctx, args.issueId)
    if (issue.archived || project.archived || issue.status === 'done') fail('Use an active, unfinished task to create or link a branch.')
    validateBranchName(args.branch); validateBranchName(args.baseBranch)
    if (args.branch === args.baseBranch) fail('The task branch must differ from its base branch.')
    const connection = await connectionFor(ctx, issue.projectId)
    if (!connection?.enabled) fail('Ask an admin to connect a GitHub repository to this project.')
    validateMapping(project, connection.workStatus, connection.reviewStatus)
    const old = await ctx.db.query('githubLinks').withIndex('by_issueId', q => q.eq('issueId', args.issueId)).unique()
    const now = Date.now()
    if (old?.creationState === 'ready') fail('This task already has a tracked branch.')
    if (old?.creationState === 'pending' && old.creationLeaseUntil > now) fail('A branch request is already in progress. Try again in two minutes.')
    const conflict = await ctx.db.query('githubLinks').withIndex('by_repositoryId_branch', q => q.eq('repositoryId', connection.repositoryId).eq('branch', args.branch)).unique()
    if (conflict && conflict._id !== old?._id) fail('This branch is already linked to another Tasker task.')
    const fields = {
      projectId: issue.projectId, issueId: issue._id, connectionId: connection._id, repositoryId: connection.repositoryId,
      branch: args.branch, baseBranch: args.baseBranch, createdBy: user._id,
      minimumPullNumber: old?.repositoryId === connection.repositoryId && old.branch === args.branch ? old.minimumPullNumber : undefined,
      creationState: 'pending' as const, creationAttempt: args.attempt, creationLeaseUntil: now + LEASE,
      syncEnabled: true, pauseReason: undefined, lastAppliedStatus: issue.status, syncError: undefined,
      nextSyncAt: now, updatedAt: now,
    }
    const linkId = old?._id ?? await ctx.db.insert('githubLinks', { ...fields, createdAt: now })
    if (old) await ctx.db.patch(linkId, fields)
    const link = await ctx.db.get(linkId)
    if (!link) fail('Could not reserve the task branch.')
    return { link, connection }
  },
})

export const recordBranchBaseline = internalMutation({
  args: { linkId: v.id('githubLinks'), attempt: v.string(), connectionVersion: v.number(), minimumPullNumber: v.number() },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link || link.creationState !== 'pending' || link.creationAttempt !== args.attempt || link.creationLeaseUntil <= Date.now()) fail('This branch request expired. Try again.')
    const { user, issue, project } = await requireIssueWriteAccess(ctx, link.issueId)
    if (user._id !== link.createdBy || issue.archived || project.archived || issue.status === 'done') fail('Task access changed while creating the branch. Try again when access is restored.')
    const connection = await ctx.db.get(link.connectionId)
    if (!connection?.enabled || connection.version !== args.connectionVersion) fail('GitHub settings changed while creating the branch. Try again.')
    if (!Number.isSafeInteger(args.minimumPullNumber) || args.minimumPullNumber < 0) fail('Invalid pull request baseline.')
    await ctx.db.patch(link._id, { minimumPullNumber: args.minimumPullNumber, updatedAt: Date.now() })
  },
})

async function applyStatus(ctx: MutationCtx, link: Doc<'githubLinks'>, issue: Doc<'issues'>, user: Doc<'users'>, desired: string | null) {
  if (!link.syncEnabled || !desired) return undefined
  if (issue.status !== link.lastAppliedStatus) {
    await ctx.db.patch(link._id, { syncEnabled: false, pauseReason: 'Paused after a task status change. Resume to follow GitHub again.' })
    return undefined
  }
  if (desired === issue.status) return undefined
  try {
    await applyIssueUpdate(ctx, { issue, user, source: 'github', changes: { status: desired } })
    await ctx.db.patch(link._id, { lastAppliedStatus: desired })
    return undefined
  } catch (cause) {
    if (cause instanceof ConvexError && typeof cause.data === 'object' && cause.data?.code === 'VALIDATION_ERROR') {
      return String(cause.data.message)
    }
    throw cause
  }
}

export const finishBranch = internalMutation({
  args: { linkId: v.id('githubLinks'), attempt: v.string(), connectionVersion: v.number() },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link || link.creationState !== 'pending' || link.creationAttempt !== args.attempt || link.creationLeaseUntil <= Date.now()) fail('This branch request expired. Link the existing branch to try again.')
    const { user, issue, project } = await requireIssueWriteAccess(ctx, link.issueId)
    if (user._id !== link.createdBy || issue.archived || project.archived) fail('Task access changed while creating the branch. Link it again when access is restored.')
    const connection = await ctx.db.get(link.connectionId)
    if (!connection?.enabled || connection.version !== args.connectionVersion) fail('GitHub settings changed while creating the branch. Link the existing branch to try again.')
    const syncError = await applyStatus(ctx, link, issue, user, connection.workStatus)
    const now = Date.now()
    await ctx.db.patch(link._id, { creationState: 'ready', creationLeaseUntil: 0, branchExists: true, syncError, updatedAt: now, nextSyncAt: now })
    await createActivity(ctx, { actorId: user._id, projectId: issue.projectId, issueId: issue._id, entityType: 'issue', entityId: issue._id, action: 'issue.github_branch_linked', metadata: { branch: link.branch, repository: `${connection.owner}/${connection.repo}` } })
    await ctx.scheduler.runAfter(0, internal.githubActions.synchronize, { linkId: link._id })
    return link._id
  },
})

export const failBranch = internalMutation({
  args: { linkId: v.id('githubLinks'), attempt: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (link?.creationState === 'pending' && link.creationAttempt === args.attempt) {
      await ctx.db.patch(link._id, { creationState: 'failed', creationLeaseUntil: 0, syncError: args.error.slice(0, 500), updatedAt: Date.now() })
    }
  },
})

export const setIssueSync = mutation({
  args: { issueId: v.id('issues'), enabled: v.boolean() },
  handler: async (ctx, { issueId, enabled }) => {
    const { user, issue, project } = await requireIssueWriteAccess(ctx, issueId)
    const link = await ctx.db.query('githubLinks').withIndex('by_issueId', q => q.eq('issueId', issueId)).unique()
    if (!link || link.creationState !== 'ready') fail('Create or link a branch first.')
    if (enabled) {
      const connection = await ctx.db.get(link.connectionId)
      if (!connection?.enabled || issue.archived || project.archived) fail('Restore the task and enable its project connection before resuming.')
      validateMapping(project, connection.workStatus, connection.reviewStatus)
    }
    await ctx.db.patch(link._id, {
      syncEnabled: enabled, pauseReason: enabled ? undefined : 'Paused by a project member.',
      lastAppliedStatus: issue.status, syncLease: undefined, syncLeaseUntil: undefined,
      nextSyncAt: Date.now(), updatedAt: Date.now(),
    })
    await createActivity(ctx, { actorId: user._id, projectId: issue.projectId, issueId, entityType: 'issue', entityId: issueId, action: enabled ? 'issue.github_sync_resumed' : 'issue.github_sync_paused' })
    if (enabled) await ctx.scheduler.runAfter(0, internal.githubActions.synchronize, { linkId: link._id })
  },
})

async function activeSyncContext(ctx: MutationCtx, link: Doc<'githubLinks'>) {
  const [connection, issue, project] = await Promise.all([ctx.db.get(link.connectionId), ctx.db.get(link.issueId), ctx.db.get(link.projectId)])
  if (!connection?.enabled || !issue || !project || issue.deletedAt || issue.archived || project.archived) return null
  const user = await ctx.db.get(connection.configuredBy)
  if (!user?.isActive || !isAdmin(user.globalRole)) return null
  await requireProjectViewAccessForUser(ctx, project._id, user)
  return { connection, issue, project, user }
}

export const prepareSync = internalMutation({
  args: { linkId: v.id('githubLinks'), nonce: v.string() },
  handler: async (ctx, { linkId, nonce }) => {
    const link = await ctx.db.get(linkId)
    const now = Date.now()
    if (!link || link.creationState !== 'ready' || (link.syncLeaseUntil ?? 0) > now) return null
    const context = await activeSyncContext(ctx, link)
    if (!context) {
      await ctx.db.patch(linkId, { nextSyncAt: now + INTERVAL, syncError: 'Sync is unavailable. Check the project connection, archive state, and configuring admin access.' })
      return null
    }
    await ctx.db.patch(linkId, { syncLease: nonce, syncLeaseUntil: now + LEASE, nextSyncAt: now + INTERVAL })
    return { link, connection: context.connection }
  },
})

const snapshotValidator = v.object({
  branchExists: v.boolean(),
  pullRequest: v.optional(v.object({ number: v.number(), state: v.union(v.literal('draft'), v.literal('open'), v.literal('closed'), v.literal('merged')), baseBranch: v.string(), url: v.string() })),
})

export const finishSync = internalMutation({
  args: { linkId: v.id('githubLinks'), nonce: v.string(), connectionVersion: v.number(), snapshot: snapshotValidator },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link || link.syncLease !== args.nonce || (link.syncLeaseUntil ?? 0) <= Date.now()) return
    const context = await activeSyncContext(ctx, link)
    if (!context || context.connection.version !== args.connectionVersion) {
      await ctx.db.patch(link._id, { syncLease: undefined, syncLeaseUntil: undefined, nextSyncAt: Date.now(), syncError: 'Project connection or task access changed. Refresh again when available.' })
      return
    }
    const { connection, issue, project, user } = context
    const pr = args.snapshot.pullRequest
    if (pr && pr.number <= (link.minimumPullNumber ?? 0)) fail('This pull request predates the created task branch.')
    if (pr && link.pullNumber && pr.number !== link.pullNumber) fail('This task already tracks a different pull request.')
    let syncError: string | undefined
    try {
      validateMapping(project, connection.workStatus, connection.reviewStatus)
      syncError = await applyStatus(ctx, link, issue, user, deriveGithubStatus(args.snapshot, { ...connection, baseBranch: link.baseBranch }))
    } catch (cause) {
      if (!(cause instanceof ConvexError)) throw cause
      syncError = 'The project work/review statuses changed. Ask an admin to update the GitHub mappings.'
    }
    if (pr && (pr.number !== link.pullNumber || pr.state !== link.pullState || pr.baseBranch !== link.pullBaseBranch)) {
      await createActivity(ctx, { projectId: issue.projectId, issueId: issue._id, entityType: 'issue', entityId: issue._id, action: 'issue.github_pull_request_updated', metadata: { number: pr.number, state: pr.state, baseBranch: pr.baseBranch } })
    }
    if (pr && pr.baseBranch !== link.baseBranch) syncError = `The pull request targets ${pr.baseBranch}; this task tracks merges into ${link.baseBranch}.`
    const now = Date.now()
    await ctx.db.patch(link._id, {
      branchExists: args.snapshot.branchExists, pullNumber: pr?.number ?? link.pullNumber, pullState: pr?.state ?? link.pullState,
      pullBaseBranch: pr?.baseBranch ?? link.pullBaseBranch, syncError, syncLease: undefined, syncLeaseUntil: undefined,
      lastSyncedAt: now, nextSyncAt: now + INTERVAL, updatedAt: now,
    })
  },
})

export const failSync = internalMutation({
  args: { linkId: v.id('githubLinks'), nonce: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (link?.syncLease === args.nonce) await ctx.db.patch(link._id, { syncLease: undefined, syncLeaseUntil: undefined, syncError: args.error.slice(0, 500), nextSyncAt: Date.now() + INTERVAL, updatedAt: Date.now() })
  },
})

export const enqueueWebhook = internalMutation({
  args: { deliveryId: v.string(), repositoryId: v.optional(v.number()), branch: v.optional(v.string()), installationId: v.optional(v.number()), disableInstallation: v.optional(v.boolean()), removedRepositoryIds: v.optional(v.array(v.number())) },
  handler: async (ctx, args) => {
    const old = await ctx.db.query('githubDeliveries').withIndex('by_deliveryId', q => q.eq('deliveryId', args.deliveryId)).unique()
    if (old) return
    await ctx.db.insert('githubDeliveries', { deliveryId: args.deliveryId, receivedAt: Date.now() })
    if (args.disableInstallation && args.installationId) {
      const connections = await ctx.db.query('githubConnections').withIndex('by_installationId', q => q.eq('installationId', args.installationId!)).collect()
      for (const connection of connections) await ctx.db.patch(connection._id, { enabled: false, version: connection.version + 1, updatedAt: Date.now() })
    }
    for (const repositoryId of args.removedRepositoryIds ?? []) {
      const connections = await ctx.db.query('githubConnections').withIndex('by_repositoryId', q => q.eq('repositoryId', repositoryId)).collect()
      for (const connection of connections) {
        if (connection.installationId === args.installationId) await ctx.db.patch(connection._id, { enabled: false, version: connection.version + 1, updatedAt: Date.now() })
      }
    }
    if (!args.repositoryId || !args.branch) return
    const links = await ctx.db.query('githubLinks').withIndex('by_repositoryId_branch', q => q.eq('repositoryId', args.repositoryId!).eq('branch', args.branch!)).collect()
    for (const link of links) {
      if (link.creationState === 'ready') await ctx.scheduler.runAfter(0, internal.githubActions.synchronize, { linkId: link._id })
    }
  },
})

export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = await ctx.db.query('githubLinks').withIndex('by_creationState_nextSyncAt', q => q.eq('creationState', 'ready').lte('nextSyncAt', now)).take(50)
    for (const link of due) {
      await ctx.db.patch(link._id, { nextSyncAt: now + INTERVAL })
      await ctx.scheduler.runAfter(0, internal.githubActions.synchronize, { linkId: link._id })
    }
    const expired = await ctx.db.query('githubDeliveries').withIndex('by_receivedAt', q => q.lt('receivedAt', now - 7 * 86400000)).take(100)
    for (const delivery of expired) await ctx.db.delete(delivery._id)
  },
})
