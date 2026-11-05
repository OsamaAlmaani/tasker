import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, type MutationCtx, query, type QueryCtx } from './_generated/server'
import { createActivity } from './lib/activity'
import { canWrite, requireProjectViewAccess, requireProjectWriteAccess } from './lib/auth'

// Workflow groups and Tasker-started releases. Groups are shared by everyone
// on the project. Neither table stores GitHub responses: run state is always
// loaded live with the viewer's own token (see githubWorkflows.ts).

const MAX_GROUP_NAME = 80
const MAX_GROUP_WORKFLOWS = 200
const MAX_GROUPS_PER_PROJECT = 100
const RELEASE_LIST_LIMIT = 60

const workflowRefValidator = v.object({ id: v.number(), path: v.string() })

function invalidInput(message: string) {
  return new ConvexError({ code: 'INVALID_INPUT', message })
}

async function requireLinkedRepository(ctx: QueryCtx | MutationCtx, projectId: Id<'projects'>) {
  const link = await ctx.db
    .query('githubRepositoryLinks')
    .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
    .unique()
  if (!link) {
    throw new ConvexError({
      code: 'GITHUB_REPO_NOT_LINKED',
      message: 'Link a GitHub repository to this project first.',
    })
  }
  return link
}

function cleanWorkflows(workflows: Array<{ id: number; path: string }>) {
  const seen = new Set<number>()
  const result: Array<{ id: number; path: string }> = []
  for (const workflow of workflows) {
    if (!Number.isInteger(workflow.id) || workflow.id <= 0 || seen.has(workflow.id)) continue
    seen.add(workflow.id)
    result.push({ id: workflow.id, path: workflow.path.slice(0, 300) })
  }
  if (result.length > MAX_GROUP_WORKFLOWS) {
    throw invalidInput(`A group can hold up to ${MAX_GROUP_WORKFLOWS} workflows.`)
  }
  return result
}

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) throw invalidInput('Give the group a name.')
  if (trimmed.length > MAX_GROUP_NAME) throw invalidInput(`Group names can be up to ${MAX_GROUP_NAME} characters.`)
  return trimmed
}

function groupSummary(group: Doc<'githubWorkflowGroups'>) {
  return {
    _id: group._id,
    name: group.name,
    workflows: group.workflows,
    updatedAt: group.updatedAt,
  }
}

/** Groups and recent releases for the linked repository. */
export const getWorkspace = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    const link = await ctx.db
      .query('githubRepositoryLinks')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .unique()
    if (!link) return { canWrite: canWrite(user.globalRole), groups: [], releases: [] }

    const groups = (
      await ctx.db
        .query('githubWorkflowGroups')
        .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
        .collect()
    )
      .filter((group) => group.repositoryId === link.repositoryId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))

    const releases = (
      await ctx.db
        .query('githubWorkflowReleases')
        .withIndex('by_projectId_startedAt', (q) => q.eq('projectId', args.projectId))
        .order('desc')
        .take(RELEASE_LIST_LIMIT)
    ).filter((release) => release.repositoryId === link.repositoryId)

    const starterIds = [...new Set(releases.map((release) => release.startedBy))]
    const starters = new Map(
      (await Promise.all(starterIds.map((id) => ctx.db.get(id)))).flatMap((starter) =>
        starter ? [[starter._id, starter.name] as const] : [],
      ),
    )

    return {
      canWrite: canWrite(user.globalRole),
      groups: groups.map(groupSummary),
      releases: releases.map((release) => ({
        _id: release._id,
        name: release.name,
        ref: release.ref,
        headSha: release.headSha,
        groupIds: release.groupIds,
        runs: release.runs,
        skipped: release.skipped,
        status: release.status,
        startedAt: release.startedAt,
        startedByName: starters.get(release.startedBy) ?? null,
      })),
    }
  },
})

export const saveGroup = mutation({
  args: {
    projectId: v.id('projects'),
    groupId: v.optional(v.id('githubWorkflowGroups')),
    name: v.string(),
    workflows: v.array(workflowRefValidator),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const link = await requireLinkedRepository(ctx, args.projectId)
    const name = cleanName(args.name)
    const workflows = cleanWorkflows(args.workflows)
    const now = Date.now()

    const existing = await ctx.db
      .query('githubWorkflowGroups')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()
    const sameName = existing.find(
      (group) =>
        group._id !== args.groupId &&
        group.repositoryId === link.repositoryId &&
        group.name.toLowerCase() === name.toLowerCase(),
    )
    if (sameName) throw invalidInput(`A group named "${sameName.name}" already exists.`)

    if (args.groupId) {
      const group = await ctx.db.get(args.groupId)
      if (!group || group.projectId !== args.projectId) throw invalidInput('That group no longer exists.')
      await ctx.db.patch(group._id, { name, workflows, repositoryId: link.repositoryId, updatedAt: now })
      return group._id
    }
    if (existing.length >= MAX_GROUPS_PER_PROJECT) {
      throw invalidInput(`A project can have up to ${MAX_GROUPS_PER_PROJECT} groups.`)
    }
    return await ctx.db.insert('githubWorkflowGroups', {
      projectId: args.projectId,
      repositoryId: link.repositoryId,
      name,
      workflows,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Adds workflows to an existing group, keeping the ones it already has. */
export const addToGroup = mutation({
  args: {
    projectId: v.id('projects'),
    groupId: v.id('githubWorkflowGroups'),
    workflows: v.array(workflowRefValidator),
  },
  handler: async (ctx, args) => {
    await requireProjectWriteAccess(ctx, args.projectId)
    const group = await ctx.db.get(args.groupId)
    if (!group || group.projectId !== args.projectId) throw invalidInput('That group no longer exists.')
    const workflows = cleanWorkflows([...group.workflows, ...args.workflows])
    await ctx.db.patch(group._id, { workflows, updatedAt: Date.now() })
    return workflows.length - group.workflows.length
  },
})

export const deleteGroup = mutation({
  args: { projectId: v.id('projects'), groupId: v.id('githubWorkflowGroups') },
  handler: async (ctx, args) => {
    await requireProjectWriteAccess(ctx, args.projectId)
    const group = await ctx.db.get(args.groupId)
    if (!group || group.projectId !== args.projectId) return null
    await ctx.db.delete(group._id)
    return null
  },
})

// ---------------------------------------------------------------------------
// Internal helpers for githubWorkflows.ts. They run with the caller's auth.

const releaseRunValidator = v.object({
  workflowId: v.number(),
  workflowName: v.string(),
  workflowPath: v.string(),
  runId: v.union(v.number(), v.null()),
  error: v.union(v.string(), v.null()),
})

export const createRelease = internalMutation({
  args: {
    projectId: v.id('projects'),
    repositoryId: v.number(),
    name: v.string(),
    ref: v.string(),
    headSha: v.string(),
    groupIds: v.array(v.id('githubWorkflowGroups')),
    runs: v.array(releaseRunValidator),
    skipped: v.array(
      v.object({
        workflowId: v.number(),
        workflowName: v.string(),
        reason: v.union(v.literal('unchanged'), v.literal('removed')),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const groupIds: Id<'githubWorkflowGroups'>[] = []
    for (const groupId of args.groupIds) {
      const group = await ctx.db.get(groupId)
      if (group && group.projectId === args.projectId) groupIds.push(groupId)
    }
    return await ctx.db.insert('githubWorkflowReleases', {
      ...args,
      groupIds,
      status: 'starting',
      startedBy: user._id,
      startedAt: Date.now(),
    })
  },
})

export const finishRelease = internalMutation({
  args: {
    projectId: v.id('projects'),
    releaseId: v.id('githubWorkflowReleases'),
    runs: v.array(releaseRunValidator),
    repository: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const release = await ctx.db.get(args.releaseId)
    if (!release || release.projectId !== args.projectId) return null
    await ctx.db.patch(release._id, { runs: args.runs, status: 'started' })
    const started = args.runs.filter((run) => run.runId !== null).length
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: release._id,
      action: 'github.workflows_started',
      metadata: {
        repository: args.repository,
        title: `${release.name} · ${started} ${started === 1 ? 'workflow' : 'workflows'} on ${release.ref}`,
      },
    })
    return null
  },
})

export const getRelease = internalQuery({
  args: { projectId: v.id('projects'), releaseId: v.id('githubWorkflowReleases') },
  handler: async (ctx, args) => {
    await requireProjectViewAccess(ctx, args.projectId)
    const release = await ctx.db.get(args.releaseId)
    return release && release.projectId === args.projectId ? release : null
  },
})
