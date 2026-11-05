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
import {
  type GitHubPullRequestSnapshot,
  githubAutomationRuleValidator,
  githubLinkSourceValidator,
  githubPullRequestSnapshotValidator,
  githubTemplatesValidator,
} from './constants'
import { createActivity } from './lib/activity'
import {
  canWrite,
  requireCurrentUser,
  requireIssueViewAccess,
  requireIssueWriteAccess,
  requireProjectViewAccess,
  requireProjectWriteAccess,
} from './lib/auth'
import { describeAutomationRules, normalizeAutomationRules } from './lib/githubAutomation'
import { normalizeTemplates } from './lib/githubReferences'
import { getIssueChecklistProgress } from './lib/issueChecklists'
import { getProjectStatusColor, getProjectStatusLabel, normalizeProject } from './lib/projectStatuses'

// Task <-> pull request links, branch links, automation settings and the
// per-user repository access cache. Only identifiers and webhook-sourced
// metadata are stored here; GitHub network calls live in
// `githubLinkActions.ts` and webhook processing in `githubWebhooks.ts`.

/** How long a repository access check stays valid. */
export const REPOSITORY_ACCESS_TTL = 24 * 60 * 60 * 1000

type Ctx = QueryCtx | MutationCtx

export type RepositoryAccess = 'ok' | 'none' | 'unknown'

export async function getRepositoryLink(ctx: Ctx, projectId: Id<'projects'>) {
  return await ctx.db
    .query('githubRepositoryLinks')
    .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
    .unique()
}

async function getConnection(ctx: Ctx, userId: Id<'users'>) {
  return await ctx.db
    .query('githubConnections')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
}

/** Finds the Tasker user whose connected GitHub login matches. */
export async function findUserByGitHubLogin(ctx: Ctx, login: string | null | undefined) {
  if (!login) return null
  const connection = await ctx.db
    .query('githubConnections')
    .withIndex('by_githubLogin', (q) => q.eq('githubLogin', login))
    .first()
  if (!connection) return null
  const user = await ctx.db.get(connection.userId)
  return user?.isActive ? user : null
}

/**
 * Whether the user's own token was recently verified to read the repository.
 * `unknown` tells the client to run `verifyRepositoryAccess`.
 */
export async function getRepositoryAccess(
  ctx: Ctx,
  userId: Id<'users'>,
  repositoryId: number,
  now = Date.now(),
): Promise<RepositoryAccess> {
  const connection = await getConnection(ctx, userId)
  if (!connection) return 'none'
  const record = await ctx.db
    .query('githubRepositoryAccess')
    .withIndex('by_userId_repositoryId', (q) => q.eq('userId', userId).eq('repositoryId', repositoryId))
    .unique()
  if (!record || now - record.checkedAt > REPOSITORY_ACCESS_TTL || record.checkedAt > now + 60_000) {
    return 'unknown'
  }
  return record.canRead ? 'ok' : 'none'
}

function pullRequestUrl(link: Doc<'githubRepositoryLinks'>, pullNumber: number) {
  return `${link.htmlUrl}/pull/${pullNumber}`
}

/** A link as shown to a viewer. The snapshot is withheld without repository access. */
export function presentPullRequestLink(
  row: Doc<'githubPullRequestLinks'>,
  repository: Doc<'githubRepositoryLinks'>,
  access: RepositoryAccess,
) {
  return {
    _id: row._id,
    issueId: row.issueId,
    pullNumber: row.pullNumber,
    source: row.source,
    linkedAt: row.linkedAt,
    url: pullRequestUrl(repository, row.pullNumber),
    snapshot: access === 'ok' ? (row.snapshot ?? null) : null,
  }
}

export type PresentedPullRequestLink = ReturnType<typeof presentPullRequestLink>

async function listIssuePullRequestLinks(ctx: Ctx, issueId: Id<'issues'>) {
  return await ctx.db
    .query('githubPullRequestLinks')
    .withIndex('by_issueId', (q) => q.eq('issueId', issueId))
    .collect()
}

async function listIssueBranchLinks(ctx: Ctx, issueId: Id<'issues'>) {
  return (
    await ctx.db
      .query('githubBranchLinks')
      .withIndex('by_issueId', (q) => q.eq('issueId', issueId))
      .collect()
  ).filter((row) => !row.deletedAt)
}

function webhookEndpoint() {
  const explicit = process.env.GITHUB_WEBHOOK_URL
  if (explicit) return explicit
  const site = process.env.CONVEX_SITE_URL
  return site ? `${site.replace(/\/$/, '')}/github/webhook` : null
}

// ---------------------------------------------------------------------------
// Queries

/** Development panel data for a task. */
export const listForIssue = query({
  args: { issueId: v.id('issues') },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId)
    if (!issue || issue.deletedAt) return null
    const { user, project } = await requireIssueViewAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, issue.projectId)
    const connection = await getConnection(ctx, user._id)
    if (!repository) {
      return {
        repository: null,
        viewerConnected: Boolean(connection),
        viewerLogin: connection?.githubLogin ?? null,
        access: 'none' as RepositoryAccess,
        canWrite: canWrite(user.globalRole) && !project.archived,
        projectKey: project.key,
        templates: normalizeTemplates(null),
        pullRequests: [],
        branches: [],
      }
    }
    const access = await getRepositoryAccess(ctx, user._id, repository.repositoryId)
    const [pullRequests, branches] = await Promise.all([
      listIssuePullRequestLinks(ctx, args.issueId),
      listIssueBranchLinks(ctx, args.issueId),
    ])
    return {
      repository: {
        fullName: repository.fullName,
        htmlUrl: repository.htmlUrl,
        defaultBranch: repository.defaultBranch,
        repositoryId: repository.repositoryId,
      },
      viewerConnected: Boolean(connection),
      viewerLogin: connection?.githubLogin ?? null,
      access,
      canWrite: canWrite(user.globalRole) && !project.archived,
      projectKey: project.key,
      templates: normalizeTemplates(repository.templates),
      pullRequests: pullRequests
        .sort((a, b) => b.linkedAt - a.linkedAt)
        .map((row) => presentPullRequestLink(row, repository, access)),
      branches: branches
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          _id: row._id,
          branchName: row.branchName,
          source: row.source,
          createdAt: row.createdAt,
          url: `${repository.htmlUrl}/tree/${row.branchName.split('/').map(encodeURIComponent).join('/')}`,
        })),
    }
  },
})

export type PullRequestChip = {
  pullNumber: number
  url: string
  state: GitHubPullRequestSnapshot['state'] | null
  isDraft: boolean
  checks: GitHubPullRequestSnapshot['checks']
  reviewDecision: GitHubPullRequestSnapshot['reviewDecision']
  mergeable: GitHubPullRequestSnapshot['mergeable'] | null
  title: string | null
}

/** Compact pull request chips for every task of a project, keyed by task id. */
export const listForProject = query({
  args: { projectId: v.id('projects') },
  handler: async (
    ctx,
    args,
  ): Promise<{ access: RepositoryAccess; linked: boolean; byIssue: Record<string, PullRequestChip[]> }> => {
    if (!(await ctx.db.get(args.projectId))) return { access: 'none', linked: false, byIssue: {} }
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) return { access: 'none', linked: false, byIssue: {} }
    const access = await getRepositoryAccess(ctx, user._id, repository.repositoryId)
    const rows = await ctx.db
      .query('githubPullRequestLinks')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()
    const byIssue: Record<string, PullRequestChip[]> = {}
    for (const row of rows.sort((a, b) => b.linkedAt - a.linkedAt)) {
      const snapshot = access === 'ok' ? row.snapshot : undefined
      const chip: PullRequestChip = {
        pullNumber: row.pullNumber,
        url: pullRequestUrl(repository, row.pullNumber),
        state: snapshot?.state ?? null,
        isDraft: snapshot?.isDraft ?? false,
        checks: snapshot?.checks ?? null,
        reviewDecision: snapshot?.reviewDecision ?? null,
        mergeable: snapshot?.mergeable ?? null,
        title: snapshot?.title ?? null,
      }
      ;(byIssue[row.issueId] ??= []).push(chip)
    }
    return { access, linked: true, byIssue }
  },
})

/** Tasks linked to one pull request, for the PR page sidebar. */
export const listForPullRequest = query({
  args: { projectId: v.id('projects'), pullNumber: v.number() },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return null
    const { user, project } = await requireProjectViewAccess(ctx, args.projectId)
    const normalized = normalizeProject(project)
    const rows = await ctx.db
      .query('githubPullRequestLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId).eq('pullNumber', args.pullNumber))
      .collect()
    const items = await Promise.all(
      rows.map(async (row) => {
        const issue = await ctx.db.get(row.issueId)
        if (!issue || issue.deletedAt) return null
        const assignee = issue.assigneeId ? await ctx.db.get(issue.assigneeId) : null
        const checklist = getIssueChecklistProgress(issue.checklistItems ?? [])
        return {
          linkId: row._id,
          source: row.source,
          issue: {
            _id: issue._id,
            issueNumber: issue.issueNumber,
            key: `${project.key}-${issue.issueNumber}`,
            title: issue.title,
            description: issue.description ?? '',
            status: issue.status,
            statusLabel: getProjectStatusLabel(normalized, issue.status),
            statusColor: getProjectStatusColor(normalized, issue.status),
            priority: issue.priority,
            archived: issue.archived,
            checklistItems: [...(issue.checklistItems ?? [])].sort((a, b) => a.position - b.position),
            checklistItemCount: checklist.checklistItemCount,
            completedChecklistItemCount: checklist.completedChecklistItemCount,
            assignee: assignee ? { _id: assignee._id, name: assignee.name, imageUrl: assignee.imageUrl ?? null } : null,
          },
        }
      }),
    )
    return {
      canWrite: canWrite(user.globalRole) && !project.archived,
      statuses: normalized.statuses.map((status) => ({ key: status.key, name: status.name, color: status.color })),
      items: items
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.issue.issueNumber - b.issue.issueNumber),
    }
  },
})

/** Tasks a viewer can link a pull request to: open, non-archived tasks of the project. */
export const searchLinkableIssues = query({
  args: { projectId: v.id('projects'), search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return []
    const { project } = await requireProjectViewAccess(ctx, args.projectId)
    const search = args.search?.trim().toLowerCase() ?? ''
    const numberMatch = search.match(/^(?:#|[a-z0-9]+-)?(\d+)$/i)
    const issues = await ctx.db
      .query('issues')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()
    return issues
      .filter((issue) => !issue.deletedAt && !issue.archived)
      .filter((issue) => {
        if (!search) return true
        if (numberMatch && issue.issueNumber === Number(numberMatch[1])) return true
        return issue.title.toLowerCase().includes(search)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.min(args.limit ?? 20, 50))
      .map((issue) => ({
        _id: issue._id,
        issueNumber: issue.issueNumber,
        key: `${project.key}-${issue.issueNumber}`,
        title: issue.title,
        status: issue.status,
      }))
  },
})

/** Automation, template, webhook and identity settings for the GitHub tab. */
export const getSettings = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return null
    const { user, project } = await requireProjectViewAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) return null
    const statuses = normalizeProject(project).statuses
    const automationUser = repository.automationUserId ? await ctx.db.get(repository.automationUserId) : null
    const automationConnection = automationUser ? await getConnection(ctx, automationUser._id) : null
    const registeredBy = repository.webhook ? await ctx.db.get(repository.webhook.registeredBy) : null
    const connection = await getConnection(ctx, user._id)
    return {
      canManage: canWrite(user.globalRole) && !project.archived,
      viewerConnected: Boolean(connection),
      statuses: statuses.map((status) => ({ key: status.key, name: status.name, color: status.color })),
      rules: describeAutomationRules(
        normalizeAutomationRules(repository.automationRules),
        statuses.map((status) => status.key),
      ),
      templates: normalizeTemplates(repository.templates),
      webhook: repository.webhook
        ? {
            hookId: repository.webhook.hookId,
            url: repository.webhook.url,
            registeredByName: registeredBy?.name ?? null,
            registeredAt: repository.webhook.registeredAt,
            lastDeliveryAt: repository.webhook.lastDeliveryAt ?? null,
            lastDeliveryEvent: repository.webhook.lastDeliveryEvent ?? null,
            lastError: repository.webhook.lastError ?? null,
          }
        : null,
      webhookEndpoint: webhookEndpoint(),
      automationUser:
        automationUser && automationConnection
          ? { _id: automationUser._id, name: automationUser.name, login: automationConnection.githubLogin }
          : null,
      viewerIsAutomationUser: repository.automationUserId === user._id,
      liveVersion: repository.liveVersion ?? 0,
    }
  },
})

// ---------------------------------------------------------------------------
// Mutations

export const unlinkPullRequest = mutation({
  args: { linkId: v.id('githubPullRequestLinks') },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    const { user, project, issue } = await requireIssueWriteAccess(ctx, link.issueId)
    await ctx.db.delete(link._id)
    await createActivity(ctx, {
      actorId: user._id,
      projectId: project._id,
      issueId: issue._id,
      entityType: 'github',
      entityId: `${link.repositoryId}#${link.pullNumber}`,
      action: 'github.pr_unlinked',
      metadata: { pullNumber: link.pullNumber, title: link.snapshot?.title ?? null },
    })
    return null
  },
})

export const updateAutomationSettings = mutation({
  args: {
    projectId: v.id('projects'),
    rules: v.optional(v.array(githubAutomationRuleValidator)),
    templates: v.optional(githubTemplatesValidator),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectWriteAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) {
      throw new ConvexError({ code: 'GITHUB_REPO_NOT_LINKED', message: 'Link a repository first.' })
    }
    const statusKeys = normalizeProject(project).statuses.map((status) => status.key)
    const patch: Partial<Doc<'githubRepositoryLinks'>> = {}
    if (args.rules) {
      const rules = normalizeAutomationRules(args.rules)
      const invalid = rules.find(
        (rule) => rule.enabled && rule.trigger !== 'pr_closed' && (!rule.targetStatus || !statusKeys.includes(rule.targetStatus)),
      )
      if (invalid) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Every enabled rule needs a target status that exists in this project.',
        })
      }
      patch.automationRules = rules
    }
    if (args.templates) patch.templates = normalizeTemplates(args.templates)
    await ctx.db.patch(repository._id, patch)
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: repository._id,
      action: 'github.automation_settings_changed',
      metadata: { changed: Object.keys(patch) },
    })
    return null
  },
})

/** Opt the signed-in writer in (or out) as the project's automation identity. */
export const setAutomationIdentity = mutation({
  args: { projectId: v.id('projects'), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) {
      throw new ConvexError({ code: 'GITHUB_REPO_NOT_LINKED', message: 'Link a repository first.' })
    }
    if (args.enabled) {
      if (!(await getConnection(ctx, user._id))) {
        throw new ConvexError({
          code: 'GITHUB_NOT_CONNECTED',
          message: 'Add your GitHub token before acting for automations.',
        })
      }
      await ctx.db.patch(repository._id, { automationUserId: user._id })
    } else {
      if (repository.automationUserId && repository.automationUserId !== user._id && user.globalRole === 'member') {
        throw new ConvexError({ code: 'FORBIDDEN', message: 'Only that user or an admin can remove the automation identity.' })
      }
      await ctx.db.patch(repository._id, { automationUserId: undefined })
    }
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: repository._id,
      action: 'github.automation_settings_changed',
      metadata: { changed: ['automationUserId'], enabled: args.enabled },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Internal helpers shared by actions and webhook processing

export type LinkCandidate = {
  pullNumber: number
  issueNumbers: number[]
  issueIds: string[]
  snapshot?: GitHubPullRequestSnapshot
}

/**
 * Creates missing links for the given task references and refreshes snapshots
 * on every link of the pull request. Returns the ids of all linked tasks.
 */
export async function upsertPullRequestLinksForProject(
  ctx: MutationCtx,
  args: {
    projectId: Id<'projects'>
    repositoryId: number
    source: Doc<'githubPullRequestLinks'>['source']
    linkedBy?: Id<'users'>
    items: LinkCandidate[]
    now?: number
  },
) {
  const now = args.now ?? Date.now()
  const linkedIssueIds = new Set<Id<'issues'>>()
  let created = 0
  for (const item of args.items) {
    const existing = await ctx.db
      .query('githubPullRequestLinks')
      .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', args.projectId).eq('pullNumber', item.pullNumber))
      .collect()
    const existingByIssue = new Map(existing.map((row) => [row.issueId, row]))

    const targets = new Map<Id<'issues'>, Doc<'issues'>>()
    for (const issueNumber of item.issueNumbers) {
      const issue = await ctx.db
        .query('issues')
        .withIndex('by_projectId_issueNumber', (q) => q.eq('projectId', args.projectId).eq('issueNumber', issueNumber))
        .unique()
      if (issue && !issue.deletedAt) targets.set(issue._id, issue)
    }
    for (const issueId of item.issueIds) {
      const normalizedId = ctx.db.normalizeId('issues', issueId)
      const issue = normalizedId ? await ctx.db.get(normalizedId) : null
      if (issue && !issue.deletedAt && issue.projectId === args.projectId) targets.set(issue._id, issue)
    }

    for (const row of existing) {
      linkedIssueIds.add(row.issueId)
      if (item.snapshot && (row.snapshot?.updatedAt ?? 0) <= item.snapshot.updatedAt) {
        await ctx.db.patch(row._id, { snapshot: item.snapshot })
      }
    }
    for (const [issueId, issue] of targets) {
      if (existingByIssue.has(issueId)) continue
      await ctx.db.insert('githubPullRequestLinks', {
        projectId: args.projectId,
        repositoryId: args.repositoryId,
        issueId,
        pullNumber: item.pullNumber,
        source: args.source,
        linkedBy: args.linkedBy,
        linkedAt: now,
        snapshot: item.snapshot,
      })
      await createActivity(ctx, {
        actorId: args.linkedBy,
        projectId: args.projectId,
        issueId: issue._id,
        entityType: 'github',
        entityId: `${args.repositoryId}#${item.pullNumber}`,
        action: 'github.pr_linked',
        metadata: {
          pullNumber: item.pullNumber,
          title: item.snapshot?.title ?? null,
          url: item.snapshot?.url ?? null,
          source: args.source,
        },
      })
      linkedIssueIds.add(issueId)
      created++
    }
  }
  return { linkedIssueIds: [...linkedIssueIds], created }
}

const linkCandidateValidator = v.object({
  pullNumber: v.number(),
  issueNumbers: v.array(v.number()),
  issueIds: v.array(v.string()),
  snapshot: v.optional(githubPullRequestSnapshotValidator),
})

/**
 * Called by read actions after loading pull requests with the caller's token.
 * The links come from GitHub data, not from a user's decision, so they carry no
 * actor: a viewer merely opening a page is never shown as having linked anything.
 */
export const syncPullRequestLinks = internalMutation({
  args: {
    projectId: v.id('projects'),
    source: githubLinkSourceValidator,
    items: v.array(linkCandidateValidator),
  },
  handler: async (ctx, args) => {
    await requireProjectViewAccess(ctx, args.projectId)
    const repository = await getRepositoryLink(ctx, args.projectId)
    if (!repository) return { linkedIssueIds: [], created: 0 }
    return await upsertPullRequestLinksForProject(ctx, {
      projectId: args.projectId,
      repositoryId: repository.repositoryId,
      source: args.source,
      items: args.items,
    })
  },
})

export async function upsertBranchLinkForProject(
  ctx: MutationCtx,
  args: {
    projectId: Id<'projects'>
    repositoryId: number
    issueId: Id<'issues'>
    branchName: string
    source: Doc<'githubBranchLinks'>['source']
    createdBy?: Id<'users'>
    now?: number
  },
) {
  const now = args.now ?? Date.now()
  const existing = (
    await ctx.db
      .query('githubBranchLinks')
      .withIndex('by_repositoryId_branchName', (q) =>
        q.eq('repositoryId', args.repositoryId).eq('branchName', args.branchName),
      )
      .collect()
  ).find((row) => row.issueId === args.issueId)
  if (existing) {
    if (existing.deletedAt) await ctx.db.patch(existing._id, { deletedAt: undefined, createdAt: now })
    return { created: Boolean(existing.deletedAt), linkId: existing._id }
  }
  const linkId = await ctx.db.insert('githubBranchLinks', {
    projectId: args.projectId,
    repositoryId: args.repositoryId,
    issueId: args.issueId,
    branchName: args.branchName,
    source: args.source,
    createdBy: args.createdBy,
    createdAt: now,
  })
  return { created: true, linkId }
}

/** Branch created from a task by the signed-in user. */
export const recordCreatedBranch = internalMutation({
  args: { issueId: v.id('issues'), branchName: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    const { user, project, issue } = await requireIssueWriteAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, project._id)
    if (!repository) return null
    await upsertBranchLinkForProject(ctx, {
      projectId: project._id,
      repositoryId: repository.repositoryId,
      issueId: issue._id,
      branchName: args.branchName,
      source: 'created_from_task',
      createdBy: user._id,
    })
    await createActivity(ctx, {
      actorId: user._id,
      projectId: project._id,
      issueId: issue._id,
      entityType: 'github',
      entityId: `${repository.repositoryId}:${args.branchName}`,
      action: 'github.branch_created',
      metadata: { branchName: args.branchName, url: args.url },
    })
    return null
  },
})

/** Pull request created from a task by the signed-in user. */
export const recordCreatedPullRequest = internalMutation({
  args: { issueId: v.id('issues'), snapshot: githubPullRequestSnapshotValidator, pullNumber: v.number() },
  handler: async (ctx, args) => {
    const { user, project, issue } = await requireIssueWriteAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, project._id)
    if (!repository) return null
    await upsertPullRequestLinksForProject(ctx, {
      projectId: project._id,
      repositoryId: repository.repositoryId,
      source: 'created_from_task',
      linkedBy: user._id,
      items: [{ pullNumber: args.pullNumber, issueNumbers: [], issueIds: [issue._id], snapshot: args.snapshot }],
    })
    await createActivity(ctx, {
      actorId: user._id,
      projectId: project._id,
      issueId: issue._id,
      entityType: 'github',
      entityId: `${repository.repositoryId}#${args.pullNumber}`,
      action: 'github.pr_created',
      metadata: { pullNumber: args.pullNumber, title: args.snapshot.title, url: args.snapshot.url },
    })
    return null
  },
})

/** Manual link by the signed-in user after the PR was loaded with their token. */
export const recordManualLink = internalMutation({
  args: { issueId: v.id('issues'), snapshot: githubPullRequestSnapshotValidator, pullNumber: v.number() },
  handler: async (ctx, args) => {
    const { user, project, issue } = await requireIssueWriteAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, project._id)
    if (!repository) return null
    return await upsertPullRequestLinksForProject(ctx, {
      projectId: project._id,
      repositoryId: repository.repositoryId,
      source: 'manual',
      linkedBy: user._id,
      items: [{ pullNumber: args.pullNumber, issueNumbers: [], issueIds: [issue._id], snapshot: args.snapshot }],
    })
  },
})

export const recordRepositoryAccess = internalMutation({
  args: { repositoryId: v.number(), canRead: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const now = Date.now()
    const existing = await ctx.db
      .query('githubRepositoryAccess')
      .withIndex('by_userId_repositoryId', (q) => q.eq('userId', user._id).eq('repositoryId', args.repositoryId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { canRead: args.canRead, checkedAt: now })
    } else {
      await ctx.db.insert('githubRepositoryAccess', {
        userId: user._id,
        repositoryId: args.repositoryId,
        canRead: args.canRead,
        checkedAt: now,
      })
    }
    return null
  },
})

/** Everything an action needs to create a branch or pull request for a task. */
export const getIssueContext = internalQuery({
  args: { issueId: v.id('issues'), level: v.union(v.literal('view'), v.literal('write')) },
  handler: async (ctx, args) => {
    const { user, project, issue } =
      args.level === 'write'
        ? await requireIssueWriteAccess(ctx, args.issueId)
        : await requireIssueViewAccess(ctx, args.issueId)
    const repository = await getRepositoryLink(ctx, project._id)
    const connection = await getConnection(ctx, user._id)
    const pullNumbers = (await listIssuePullRequestLinks(ctx, args.issueId)).map((row) => row.pullNumber)
    const branches = (await listIssueBranchLinks(ctx, args.issueId)).map((row) => row.branchName)
    return {
      user: { _id: user._id, name: user.name },
      project: { _id: project._id, key: project.key, name: project.name, archived: project.archived },
      issue: {
        _id: issue._id,
        issueNumber: issue.issueNumber,
        title: issue.title,
        description: issue.description ?? '',
        checklistItems: issue.checklistItems ?? [],
      },
      repository,
      connection,
      templates: normalizeTemplates(repository?.templates),
      pullNumbers: [...new Set(pullNumbers)],
      branches,
    }
  },
})
