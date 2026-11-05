import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { GitHubAutomationRule, GitHubAutomationTrigger, GitHubPullRequestSnapshot } from './constants'
import { applyIssueUpdate } from './issues'
import { createActivity } from './lib/activity'
import { canWrite, getProjectMembership, isAdmin, requireProjectWriteAccess } from './lib/auth'
import {
  checksSummaryFromConclusion,
  normalizeAutomationRules,
  resolveTransition,
  snapshotFromPullRequest,
  type WebhookEvent,
} from './lib/githubAutomation'
import { parseTaskReferences } from './lib/githubReferences'
import type { GitHubNotificationMetadata, GitHubNotificationType } from './lib/notifications'
import { normalizeProject } from './lib/projectStatuses'
import {
  findUserByGitHubLogin,
  getRepositoryLink,
  upsertBranchLinkForProject,
  upsertPullRequestLinksForProject,
} from './githubLinks'

// Webhook persistence and processing. The HTTP route in `http.ts` verifies the
// signature, then calls `processEvent` for the repository links whose secret
// matched. Nothing here calls GitHub; it only updates Tasker state.

export const lookupRepository = internalQuery({
  args: { repositoryId: v.number() },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query('githubRepositoryLinks')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .collect()
    return links
      .filter((link) => link.webhook)
      .map((link) => ({ linkId: link._id, projectId: link.projectId, secret: link.webhook!.secret }))
  },
})

export const saveWebhook = internalMutation({
  args: {
    projectId: v.id('projects'),
    hookId: v.union(v.number(), v.null()),
    secret: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const link = await getRepositoryLink(ctx, args.projectId)
    if (!link) throw new ConvexError({ code: 'GITHUB_REPO_NOT_LINKED', message: 'Link a repository first.' })
    await ctx.db.patch(link._id, {
      webhook: {
        hookId: args.hookId,
        secret: args.secret,
        url: args.url,
        registeredBy: user._id,
        registeredAt: Date.now(),
      },
    })
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: link._id,
      action: 'github.webhook_registered',
      metadata: { repository: link.fullName, manual: args.hookId === null },
    })
    return null
  },
})

export const clearWebhook = internalMutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const link = await getRepositoryLink(ctx, args.projectId)
    if (!link?.webhook) return null
    await ctx.db.patch(link._id, { webhook: undefined })
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: link._id,
      action: 'github.webhook_removed',
      metadata: { repository: link.fullName },
    })
    return null
  },
})

/**
 * Logs a delivery once. Returns `duplicate: true` when GitHub re-sent a
 * delivery that was processed; a delivery whose processing failed is accepted
 * again so a redelivery can repair it.
 */
export const recordDelivery = internalMutation({
  args: {
    repositoryId: v.number(),
    deliveryId: v.string(),
    event: v.string(),
    action: v.union(v.string(), v.null()),
    pullNumber: v.optional(v.number()),
    ref: v.optional(v.string()),
    sha: v.optional(v.string()),
    senderLogin: v.optional(v.string()),
    outcome: v.string(),
  },
  handler: async (ctx, args): Promise<{ duplicate: boolean }> => {
    const existing = await ctx.db
      .query('githubWebhookDeliveries')
      .withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
      .first()
    if (existing) {
      if (!existing.outcome.startsWith('failed')) return { duplicate: true }
      await ctx.db.patch(existing._id, { outcome: args.outcome, receivedAt: Date.now() })
      return { duplicate: false }
    }
    await ctx.db.insert('githubWebhookDeliveries', { ...args, receivedAt: Date.now() })
    return { duplicate: false }
  },
})

export const updateDeliveryOutcome = internalMutation({
  args: { deliveryId: v.string(), outcome: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('githubWebhookDeliveries')
      .withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
      .first()
    if (row) await ctx.db.patch(row._id, { outcome: args.outcome })
    return null
  },
})

/** Events that change what the pull request and workflow pages show. */
function changesLiveViews(event: WebhookEvent) {
  return (
    event.kind === 'pull_request' ||
    (event.kind === 'pull_request_review' && event.action === 'submitted') ||
    event.kind === 'check_suite' ||
    event.kind === 'workflow_run'
  )
}

/** Applies one verified event to every project whose webhook secret matched. */
export const processEvent = internalMutation({
  args: { deliveryId: v.string(), linkIds: v.array(v.id('githubRepositoryLinks')), event: v.any() },
  handler: async (ctx, args) => {
    const event = args.event as WebhookEvent
    const outcomes: string[] = []
    for (const linkId of args.linkIds) {
      const link = await ctx.db.get(linkId)
      if (!link) continue
      const now = Date.now()
      const liveVersion = (link.liveVersion ?? 0) + (changesLiveViews(event) ? 1 : 0)
      try {
        const outcome = await handleEvent(ctx, link, event, args.deliveryId)
        outcomes.push(outcome)
        await ctx.db.patch(link._id, {
          liveVersion,
          webhook: link.webhook
            ? { ...link.webhook, lastDeliveryAt: now, lastDeliveryEvent: event.kind, lastError: undefined }
            : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook processing failed.'
        outcomes.push(`error: ${message}`)
        await ctx.db.patch(link._id, {
          liveVersion,
          webhook: link.webhook ? { ...link.webhook, lastDeliveryAt: now, lastDeliveryEvent: event.kind, lastError: message } : undefined,
        })
      }
    }
    return { outcomes }
  },
})

/** Whether a user may see the project: admin, creator or member, and active. */
async function canViewProject(ctx: MutationCtx, user: Doc<'users'> | null, project: Doc<'projects'>) {
  if (!user || !user.isActive) return false
  if (isAdmin(user.globalRole) || project.createdBy === user._id) return true
  return Boolean(await getProjectMembership(ctx, project._id, user._id))
}

/** Whether a user may change tasks in the project, as the UI would allow. */
async function canActForProject(ctx: MutationCtx, user: Doc<'users'> | null, project: Doc<'projects'>) {
  return Boolean(user && canWrite(user.globalRole) && (await canViewProject(ctx, user, project)))
}

/**
 * Who automation acts as: the mapped GitHub sender when they could make the
 * change themselves, else the opted-in automation identity, else the person
 * who linked the repository. Null disables automation for this delivery.
 */
async function resolveActor(
  ctx: MutationCtx,
  link: Doc<'githubRepositoryLinks'>,
  project: Doc<'projects'>,
  sender: Doc<'users'> | null,
) {
  const candidates = [
    sender,
    link.automationUserId ? await ctx.db.get(link.automationUserId) : null,
    await ctx.db.get(link.linkedBy),
  ]
  for (const candidate of candidates) {
    if (await canActForProject(ctx, candidate, project)) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// Event handling

type ProjectContext = {
  link: Doc<'githubRepositoryLinks'>
  project: ReturnType<typeof normalizeProject<Doc<'projects'>>>
  statusKeys: string[]
  rules: GitHubAutomationRule[]
  sender: Doc<'users'> | null
  actor: Doc<'users'> | null
  deliveryId: string
}

async function handleEvent(
  ctx: MutationCtx,
  link: Doc<'githubRepositoryLinks'>,
  event: WebhookEvent,
  deliveryId: string,
): Promise<string> {
  if (event.kind === 'ping') return 'ping'
  const rawProject = await ctx.db.get(link.projectId)
  if (!rawProject || rawProject.archived) return 'project unavailable'
  const project = normalizeProject(rawProject)
  const sender = await findUserByGitHubLogin(ctx, event.senderLogin)
  const context: ProjectContext = {
    link,
    project,
    statusKeys: project.statuses.map((status) => status.key),
    rules: normalizeAutomationRules(link.automationRules),
    sender,
    actor: await resolveActor(ctx, link, rawProject, sender),
    deliveryId,
  }
  switch (event.kind) {
    case 'pull_request':
      return await handlePullRequest(ctx, context, event)
    case 'pull_request_review':
      return await handleReview(ctx, context, event)
    case 'push':
      return await handlePush(ctx, context, event)
    case 'check_suite':
      return await handleChecks(ctx, context, {
        headSha: event.headSha,
        pullNumbers: event.pullNumbers,
        checks: event.action === 'completed' ? checksSummaryFromConclusion(event.status, event.conclusion) : null,
      })
    case 'workflow_run':
      return await handleWorkflowRun(ctx, context, event)
  }
}

function ruleFor(context: ProjectContext, trigger: GitHubAutomationTrigger) {
  return context.rules.find((rule) => rule.trigger === trigger) ?? { trigger, enabled: false }
}

async function linksForPullRequest(ctx: MutationCtx, context: ProjectContext, pullNumber: number) {
  return await ctx.db
    .query('githubPullRequestLinks')
    .withIndex('by_projectId_pullNumber', (q) => q.eq('projectId', context.link.projectId).eq('pullNumber', pullNumber))
    .collect()
}

async function taskKeysFor(ctx: MutationCtx, context: ProjectContext, issueIds: Id<'issues'>[]) {
  const keys: string[] = []
  for (const issueId of issueIds) {
    const issue = await ctx.db.get(issueId)
    if (issue && !issue.deletedAt) keys.push(`${context.project.key}-${issue.issueNumber}`)
  }
  return keys
}

type NotifyArgs = {
  recipient: Doc<'users'> | null
  type: GitHubNotificationType
  issueId?: Id<'issues'>
  /** Failures reach their owner even when they triggered the run themselves. */
  allowSelf?: boolean
  meta: Omit<GitHubNotificationMetadata, 'projectId' | 'projectKey' | 'projectName' | 'repository'>
}

async function notify(ctx: MutationCtx, context: ProjectContext, args: NotifyArgs) {
  if (!args.recipient) return
  // People are not told about their own actions.
  if (!args.allowSelf && context.sender && args.recipient._id === context.sender._id) return
  // Only people who can open the project learn about its pull requests and tasks.
  if (!(await canViewProject(ctx, args.recipient, context.project))) return
  const metadata: GitHubNotificationMetadata = {
    ...args.meta,
    repository: context.link.fullName,
    projectId: context.link.projectId,
    projectKey: context.project.key,
    projectName: context.project.name,
  }
  await ctx.runMutation(internal.notifications.createGitHubNotification, {
    recipientUserId: args.recipient._id,
    actorUserId: context.sender?._id,
    type: args.type,
    projectId: context.link.projectId,
    issueId: args.issueId,
    metadata,
  })
}

async function recordPullRequestEvent(
  ctx: MutationCtx,
  context: ProjectContext,
  issueId: Id<'issues'>,
  pullNumber: number,
  metadata: Record<string, unknown>,
) {
  await createActivity(ctx, {
    actorId: context.sender?._id,
    projectId: context.link.projectId,
    issueId,
    entityType: 'github',
    entityId: `${context.link.repositoryId}#${pullNumber}`,
    action: 'github.pr_event',
    metadata: { pullNumber, deliveryId: context.deliveryId, ...metadata },
  })
}

/**
 * Moves a task for a rule. Blocked transitions (for example a parent with
 * unfinished sub-tasks) are recorded as skipped instead of failing the webhook.
 */
async function runAutomation(
  ctx: MutationCtx,
  context: ProjectContext,
  args: {
    trigger: GitHubAutomationTrigger
    issue: Doc<'issues'>
    prLink: Doc<'githubPullRequestLinks'> | null
    pullNumber: number | null
    detail: Record<string, unknown>
  },
) {
  const rule = ruleFor(context, args.trigger)
  if (!rule.enabled || !context.actor) return
  let target: string | null
  if (args.trigger === 'pr_closed') {
    const previous = args.prLink?.automationPreviousStatus
    target =
      previous && context.statusKeys.includes(previous) && args.issue.status !== previous && args.issue.status !== 'done'
        ? previous
        : null
  } else {
    target = resolveTransition(rule, args.issue.status, context.statusKeys)
  }
  if (!target) return
  const previousStatus = args.issue.status
  const base = {
    actorId: context.sender?._id,
    projectId: context.link.projectId,
    issueId: args.issue._id,
    entityType: 'github' as const,
    entityId: args.pullNumber ? `${context.link.repositoryId}#${args.pullNumber}` : `${context.link.repositoryId}`,
  }
  try {
    await applyIssueUpdate(ctx, { issue: args.issue, user: context.actor, changes: { status: target } })
    if (args.prLink) {
      await ctx.db.patch(args.prLink._id, {
        automationPreviousStatus: args.trigger === 'pr_closed' ? undefined : previousStatus,
      })
    }
    await createActivity(ctx, {
      ...base,
      action: 'github.automation_applied',
      metadata: {
        trigger: args.trigger,
        from: previousStatus,
        to: target,
        pullNumber: args.pullNumber,
        deliveryId: context.deliveryId,
        actorLogin: context.sender ? undefined : 'tasker-automation',
        ...args.detail,
      },
    })
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error
    await createActivity(ctx, {
      ...base,
      action: 'github.automation_skipped',
      metadata: {
        trigger: args.trigger,
        from: previousStatus,
        to: target,
        pullNumber: args.pullNumber,
        reason: (error.data as { message?: string }).message ?? 'Blocked by task rules.',
        deliveryId: context.deliveryId,
        ...args.detail,
      },
    })
  }
}

function timelineEventFor(event: Extract<WebhookEvent, { kind: 'pull_request' }>) {
  switch (event.action) {
    case 'opened':
    case 'reopened':
    case 'ready_for_review':
    case 'converted_to_draft':
    case 'review_requested':
      return event.action
    case 'closed':
      return event.pullRequest.state === 'merged' ? 'merged' : 'closed'
    default:
      return null
  }
}

async function handlePullRequest(
  ctx: MutationCtx,
  context: ProjectContext,
  event: Extract<WebhookEvent, { kind: 'pull_request' }>,
) {
  const pr = event.pullRequest
  const text = parseTaskReferences(`${pr.title}\n${pr.body}`, { projectKey: context.project.key })
  const branch = parseTaskReferences(pr.headRefName, { projectKey: context.project.key })
  const existing = await linksForPullRequest(ctx, context, pr.number)
  const previous = existing.find((row) => row.snapshot)?.snapshot ?? null
  const snapshot = snapshotFromPullRequest(pr, previous)

  const { linkedIssueIds } = await upsertPullRequestLinksForProject(ctx, {
    projectId: context.link.projectId,
    repositoryId: context.link.repositoryId,
    source: 'webhook',
    linkedBy: context.sender?._id,
    items: [
      {
        pullNumber: pr.number,
        issueNumbers: [...new Set([...text.issueNumbers, ...branch.issueNumbers])],
        issueIds: text.issueIds,
        snapshot,
      },
    ],
  })

  const links = await linksForPullRequest(ctx, context, pr.number)
  const timelineEvent = timelineEventFor(event)
  let trigger: GitHubAutomationTrigger | null = null
  if ((event.action === 'opened' || event.action === 'reopened' || event.action === 'ready_for_review') && !pr.isDraft) {
    trigger = 'pr_opened'
  } else if (event.action === 'converted_to_draft') {
    trigger = 'pr_draft'
  } else if (event.action === 'closed') {
    trigger = pr.state === 'merged' ? 'pr_merged' : 'pr_closed'
  }

  for (const issueId of linkedIssueIds) {
    const issue = await ctx.db.get(issueId)
    if (!issue || issue.deletedAt) continue
    if (branch.issueNumbers.includes(issue.issueNumber) && pr.headRefName) {
      await upsertBranchLinkForProject(ctx, {
        projectId: context.link.projectId,
        repositoryId: context.link.repositoryId,
        issueId,
        branchName: pr.headRefName,
        source: 'push',
        createdBy: context.sender?._id,
      })
    }
    if (timelineEvent) {
      await recordPullRequestEvent(ctx, context, issueId, pr.number, {
        event: timelineEvent,
        title: pr.title,
        url: pr.url,
        actorLogin: event.senderLogin,
        reviewerLogin: event.requestedReviewerLogin,
        isDraft: pr.isDraft,
      })
    }
    if (trigger) {
      await runAutomation(ctx, context, {
        trigger,
        issue,
        prLink: links.find((row) => row.issueId === issueId) ?? null,
        pullNumber: pr.number,
        detail: { title: pr.title, url: pr.url },
      })
    }
  }

  const taskKeys = await taskKeysFor(ctx, context, linkedIssueIds)
  const author = await findUserByGitHubLogin(ctx, pr.authorLogin)
  const prMeta = { pullNumber: pr.number, pullTitle: pr.title, pullUrl: pr.url, actorLogin: event.senderLogin, taskKeys }
  const firstIssue = linkedIssueIds[0]

  if (event.action === 'review_requested' && event.requestedReviewerLogin) {
    await notify(ctx, context, {
      recipient: await findUserByGitHubLogin(ctx, event.requestedReviewerLogin),
      type: 'github_review_requested',
      issueId: firstIssue,
      meta: { ...prMeta, dedupeKey: `review_requested:${context.link.repositoryId}:${pr.number}:${event.requestedReviewerLogin}` },
    })
  }
  if (event.action === 'closed' && pr.state === 'merged') {
    await notify(ctx, context, {
      recipient: author,
      type: 'github_pr_merged',
      issueId: firstIssue,
      meta: { ...prMeta, dedupeKey: `merged:${context.link.repositoryId}:${pr.number}` },
    })
  }
  if (snapshot.mergeable === 'conflicting' && previous?.mergeable !== 'conflicting' && pr.state === 'open') {
    await notify(ctx, context, {
      recipient: author,
      type: 'github_merge_conflict',
      issueId: firstIssue,
      meta: { ...prMeta, actorLogin: null, dedupeKey: `conflict:${context.link.repositoryId}:${pr.number}:${pr.headSha}` },
    })
  }
  return `pull_request ${event.action}: ${linkedIssueIds.length} task(s)`
}

async function handleReview(
  ctx: MutationCtx,
  context: ProjectContext,
  event: Extract<WebhookEvent, { kind: 'pull_request_review' }>,
) {
  if (event.action !== 'submitted') return 'review ignored'
  if (event.state !== 'approved' && event.state !== 'changes_requested') return `review ${event.state}`
  const pr = event.pullRequest
  const links = await linksForPullRequest(ctx, context, pr.number)
  for (const row of links) {
    if (row.snapshot && row.snapshot.headSha === pr.headSha) {
      await ctx.db.patch(row._id, { snapshot: { ...row.snapshot, reviewDecision: event.state } })
    }
  }
  const issueIds = links.map((row) => row.issueId)
  for (const row of links) {
    const issue = await ctx.db.get(row.issueId)
    if (!issue || issue.deletedAt) continue
    await recordPullRequestEvent(ctx, context, issue._id, pr.number, {
      event: event.state,
      title: pr.title,
      url: pr.url,
      actorLogin: event.reviewerLogin ?? event.senderLogin,
    })
    await runAutomation(ctx, context, {
      trigger: event.state === 'approved' ? 'review_approved' : 'changes_requested',
      issue,
      prLink: row,
      pullNumber: pr.number,
      detail: { title: pr.title, url: pr.url, reviewerLogin: event.reviewerLogin },
    })
  }
  await notify(ctx, context, {
    recipient: await findUserByGitHubLogin(ctx, pr.authorLogin),
    type: event.state === 'approved' ? 'github_approved' : 'github_changes_requested',
    issueId: issueIds[0],
    meta: {
      pullNumber: pr.number,
      pullTitle: pr.title,
      pullUrl: pr.url,
      actorLogin: event.reviewerLogin ?? event.senderLogin,
      taskKeys: await taskKeysFor(ctx, context, issueIds),
      dedupeKey: `review:${context.link.repositoryId}:${pr.number}:${event.reviewerLogin}:${event.state}:${pr.headSha}`,
    },
  })
  return `review ${event.state}: ${links.length} task(s)`
}

async function handlePush(ctx: MutationCtx, context: ProjectContext, event: Extract<WebhookEvent, { kind: 'push' }>) {
  if (!event.branchName) return 'push ignored (not a branch)'
  const rows = (
    await ctx.db
      .query('githubBranchLinks')
      .withIndex('by_repositoryId_branchName', (q) =>
        q.eq('repositoryId', context.link.repositoryId).eq('branchName', event.branchName!),
      )
      .collect()
  ).filter((row) => row.projectId === context.link.projectId)
  if (event.deleted) {
    for (const row of rows) if (!row.deletedAt) await ctx.db.patch(row._id, { deletedAt: Date.now() })
    return `branch deleted: ${rows.length} link(s)`
  }
  const refs = parseTaskReferences(event.branchName, { projectKey: context.project.key })
  if (!refs.issueNumbers.length) return 'push ignored (no task reference)'
  let touched = 0
  for (const issueNumber of refs.issueNumbers) {
    const issue = await ctx.db
      .query('issues')
      .withIndex('by_projectId_issueNumber', (q) => q.eq('projectId', context.link.projectId).eq('issueNumber', issueNumber))
      .unique()
    if (!issue || issue.deletedAt) continue
    touched++
    const { created } = await upsertBranchLinkForProject(ctx, {
      projectId: context.link.projectId,
      repositoryId: context.link.repositoryId,
      issueId: issue._id,
      branchName: event.branchName,
      source: 'push',
      createdBy: context.sender?._id,
    })
    if (created) {
      await createActivity(ctx, {
        actorId: context.sender?._id,
        projectId: context.link.projectId,
        issueId: issue._id,
        entityType: 'github',
        entityId: `${context.link.repositoryId}:${event.branchName}`,
        action: 'github.pr_event',
        metadata: { event: 'branch_pushed', branchName: event.branchName, actorLogin: event.pusherLogin, deliveryId: context.deliveryId },
      })
    }
    await runAutomation(ctx, context, {
      trigger: 'branch_pushed',
      issue,
      prLink: null,
      pullNumber: null,
      detail: { branchName: event.branchName },
    })
  }
  return `push: ${touched} task(s)`
}

async function handleChecks(
  ctx: MutationCtx,
  context: ProjectContext,
  args: { headSha: string; pullNumbers: number[]; checks: GitHubPullRequestSnapshot['checks'] },
) {
  if (!args.checks) return 'checks ignored (not completed)'
  let updated = 0
  for (const pullNumber of args.pullNumbers) {
    const rows = (await linksForPullRequest(ctx, context, pullNumber)).filter(
      (row) => row.snapshot && row.snapshot.headSha === args.headSha,
    )
    if (!rows.length) continue
    const snapshot = rows[0].snapshot!
    // One failing suite marks the commit red even if a later suite passes.
    const next = args.checks === 'success' && snapshot.checks === 'failure' ? 'failure' : args.checks
    const turnedRed = next === 'failure' && snapshot.checks !== 'failure'
    for (const row of rows) {
      await ctx.db.patch(row._id, { snapshot: { ...row.snapshot!, checks: next } })
      if (turnedRed) {
        await recordPullRequestEvent(ctx, context, row.issueId, pullNumber, {
          event: 'checks_failed',
          title: snapshot.title,
          url: snapshot.url,
          actorLogin: null,
        })
      }
    }
    updated += rows.length
    if (turnedRed) {
      await notify(ctx, context, {
        recipient: await findUserByGitHubLogin(ctx, snapshot.authorLogin),
        type: 'github_checks_failed',
        allowSelf: true,
        issueId: rows[0].issueId,
        meta: {
          pullNumber,
          pullTitle: snapshot.title,
          pullUrl: snapshot.url,
          actorLogin: null,
          taskKeys: await taskKeysFor(
            ctx,
            context,
            rows.map((row) => row.issueId),
          ),
          dedupeKey: `checks_failed:${context.link.repositoryId}:${args.headSha}`,
        },
      })
    }
  }
  return `checks ${args.checks}: ${updated} link(s)`
}

async function handleWorkflowRun(
  ctx: MutationCtx,
  context: ProjectContext,
  event: Extract<WebhookEvent, { kind: 'workflow_run' }>,
) {
  if (event.action !== 'completed') return 'workflow_run ignored'
  const checks = checksSummaryFromConclusion(event.status, event.conclusion)
  if (event.pullNumbers.length) {
    await handleChecks(ctx, context, { headSha: event.headSha, pullNumbers: event.pullNumbers, checks })
  }
  const defaultBranch = event.repository.defaultBranch ?? context.link.defaultBranch
  if (checks === 'failure' && event.headBranch === defaultBranch) {
    await notify(ctx, context, {
      recipient: await findUserByGitHubLogin(ctx, event.actorLogin),
      type: 'github_workflow_failed',
      allowSelf: true,
      meta: {
        runId: event.runId,
        runName: event.name,
        runUrl: event.url,
        branch: event.headBranch,
        actorLogin: event.actorLogin,
        dedupeKey: `workflow_failed:${context.link.repositoryId}:${event.runId}`,
      },
    })
    return `workflow failed on ${defaultBranch}`
  }
  return `workflow_run ${event.conclusion ?? 'unknown'}`
}
