import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  DEFAULT_PROJECT_STATUSES,
  projectCustomFieldValidator,
  projectLabelValidator,
  projectStatusValidator,
} from './constants'
import {
  canWrite,
  getAccessibleProjectIds,
  requireCurrentUser,
  requireProjectMemberManagementAccess,
  requireProjectViewAccess,
  requireProjectWriteAccess,
} from './lib/auth'
import { createActivity } from './lib/activity'
import {
  normalizeIssueCustomFieldValues,
  normalizeProjectCustomFields,
} from './lib/projectCustomFields'
import { normalizeProjectLabels } from './lib/projectLabels'
import { normalizeProject, normalizeProjectStatuses } from './lib/projectStatuses'

function normalizeProjectKey(key: string) {
  return key.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function uniqueUsers<T extends { _id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item._id)) {
      return false
    }
    seen.add(item._id)
    return true
  })
}

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)

    if (user.globalRole === 'admin') {
      const projects = await ctx.db.query('projects').collect()
      return projects
        .filter((project) => args.includeArchived || !project.archived)
        .map((project) => normalizeProject(project))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    const projectIds = await getAccessibleProjectIds(ctx, user._id)
    const projects = await Promise.all(
      projectIds.map((projectId) => ctx.db.get(projectId)),
    )

    return projects
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .filter((project) => args.includeArchived || !project.archived)
      .map((project) => normalizeProject(project))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
})

export const sidebar = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)

    const projects =
      user.globalRole === 'admin'
        ? await ctx.db.query('projects').collect()
        : (
            await Promise.all(
              (await getAccessibleProjectIds(ctx, user._id)).map((projectId) =>
                ctx.db.get(projectId),
              ),
            )
          ).filter(
            (project): project is NonNullable<typeof project> => Boolean(project),
          )

    const visibleProjects = projects
      .filter((project) => args.includeArchived || !project.archived)
      .map((project) => normalizeProject(project))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    const rows = await Promise.all(
      visibleProjects.map(async (project) => {
        const issueLists = await ctx.db
          .query('issueLists')
          .withIndex('by_projectId_position', (q) => q.eq('projectId', project._id))
          .collect()

        return {
          project,
          issueLists,
        }
      }),
    )

    return rows
  },
})

export const getById = query({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const existingProject = await ctx.db.get(args.projectId)
    if (!existingProject) {
      return null
    }

    const { project, user } = await requireProjectViewAccess(ctx, args.projectId)
    const normalizedProject = normalizeProject(project)

    const memberships = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const members = []
    for (const membership of memberships) {
      const member = await ctx.db.get(membership.userId)
      if (member) {
        members.push({
          membership,
          user: member,
        })
      }
    }

    const issues = await ctx.db
      .query('issues')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const issueCounts = issues.reduce(
      (acc, issue) => {
        if (issue.deletedAt) {
          return acc
        }
        acc.total += 1
        acc.byStatus[issue.status] = (acc.byStatus[issue.status] ?? 0) + 1
        return acc
      },
      {
        total: 0,
        byStatus: {} as Record<string, number>,
      },
    )

    return {
      project: normalizedProject,
      issueCounts,
      members: uniqueUsers(members.map((item) => item.user)),
      membershipRows: members,
      canEdit: canWrite(user.globalRole),
      canManageMembers:
        user.globalRole === 'admin' ||
        (user.globalRole === 'member' && normalizedProject.allowMemberInvites),
      canDeleteIssues:
        canWrite(user.globalRole) && normalizedProject.allowIssueDelete,
    }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    key: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    customFields: v.optional(v.array(projectCustomFieldValidator)),
    labels: v.optional(v.array(projectLabelValidator)),
    statuses: v.optional(v.array(projectStatusValidator)),
    allowMemberInvites: v.optional(v.boolean()),
    allowIssueDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)

    if (!canWrite(user.globalRole)) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Viewer accounts cannot create projects.',
      })
    }

    const key = normalizeProjectKey(args.key)

    if (!key || key.length < 2) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Project key must contain at least two alphanumeric characters.',
      })
    }

    const existing = await ctx.db
      .query('projects')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique()

    if (existing) {
      throw new ConvexError({
        code: 'CONFLICT',
        message: 'This project key is already in use.',
      })
    }

    const now = Date.now()
    const projectId = await ctx.db.insert('projects', {
      name: args.name.trim(),
      key,
      description: args.description?.trim(),
      color: args.color?.trim(),
      icon: args.icon?.trim(),
      customFields: normalizeProjectCustomFields(args.customFields),
      labels: normalizeProjectLabels(args.labels),
      statuses: normalizeProjectStatuses(
        args.statuses ?? DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status })),
      ),
      createdBy: user._id,
      archived: false,
      allowMemberInvites: args.allowMemberInvites ?? true,
      allowIssueDelete: args.allowIssueDelete ?? true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('projectCounters', {
      projectId,
      nextIssueNumber: 1,
      updatedAt: now,
    })

    await ctx.db.insert('issueLists', {
      projectId,
      name: 'General',
      position: 0,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('projectMembers', {
      projectId,
      userId: user._id,
      addedBy: user._id,
      joinedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'project.created',
      metadata: {
        name: args.name,
        key,
      },
    })

    const project = await ctx.db.get(projectId)
    return project ? normalizeProject(project) : null
  },
})

export const update = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    customFields: v.optional(v.array(projectCustomFieldValidator)),
    labels: v.optional(v.array(projectLabelValidator)),
    statuses: v.optional(v.array(projectStatusValidator)),
    allowMemberInvites: v.optional(v.boolean()),
    allowIssueDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectWriteAccess(ctx, args.projectId)
    const normalizedExistingProject = normalizeProject(project)
    const now = Date.now()

    const patch: Record<string, unknown> = {
      updatedAt: now,
    }

    if (args.name !== undefined) {
      patch.name = args.name.trim()
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim()
    }
    if (args.color !== undefined) {
      patch.color = args.color.trim()
    }
    if (args.icon !== undefined) {
      patch.icon = args.icon.trim()
    }
    if (args.customFields !== undefined) {
      const nextCustomFields = normalizeProjectCustomFields(args.customFields)
      const projectIssues = await ctx.db
        .query('issues')
        .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
        .collect()

      for (const issue of projectIssues) {
        const nextValues = normalizeIssueCustomFieldValues(
          nextCustomFields,
          issue.customFieldValues,
          { strict: false },
        )
        const currentValues = issue.customFieldValues ?? {}
        if (JSON.stringify(currentValues) !== JSON.stringify(nextValues)) {
          await ctx.db.patch(issue._id, {
            customFieldValues: nextValues,
            updatedAt: now,
          })
        }
      }

      patch.customFields = nextCustomFields
    }

    if (args.labels !== undefined) {
      const nextLabels = normalizeProjectLabels(args.labels)
      const removedLabelKeys = (normalizedExistingProject.labels ?? [])
        .map((label) => label.key)
        .filter((key) => !nextLabels.some((label) => label.key === key))

      if (removedLabelKeys.length) {
        const projectIssues = await ctx.db
          .query('issues')
          .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
          .collect()

        await Promise.all(
          projectIssues
            .filter(
              (issue) =>
                !issue.deletedAt &&
                issue.labels.some((label) => removedLabelKeys.includes(label)),
            )
            .map((issue) =>
              ctx.db.patch(issue._id, {
                labels: issue.labels.filter(
                  (label) => !removedLabelKeys.includes(label),
                ),
                updatedAt: patch.updatedAt as number,
              }),
            ),
        )
      }

      patch.labels = nextLabels
    }
    if (args.statuses !== undefined) {
      const nextStatuses = normalizeProjectStatuses(args.statuses)
      const removedStatusKeys = normalizedExistingProject.statuses
        .map((status) => status.key)
        .filter(
          (key) =>
            key !== 'todo' &&
            key !== 'done' &&
            !nextStatuses.some((status) => status.key === key),
        )

      if (removedStatusKeys.length) {
        const projectIssues = await ctx.db
          .query('issues')
          .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
          .collect()
        const inUseRemovedStatus = removedStatusKeys.find((key) =>
          projectIssues.some(
            (issue) => !issue.deletedAt && !issue.archived && issue.status === key,
          ),
        )

        if (inUseRemovedStatus) {
          throw new ConvexError({
            code: 'VALIDATION_ERROR',
            message:
              'Move tasks out of a status before removing it from the workflow.',
          })
        }
      }

      patch.statuses = nextStatuses
    }
    if (args.allowMemberInvites !== undefined) {
      patch.allowMemberInvites = args.allowMemberInvites
    }
    if (args.allowIssueDelete !== undefined) {
      patch.allowIssueDelete = args.allowIssueDelete
    }

    await ctx.db.patch(args.projectId, patch)

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'project',
      entityId: args.projectId,
      action: 'project.updated',
      metadata: {
        changes: Object.keys(patch),
      },
    })

    return {
      before: project,
      after: normalizeProject((await ctx.db.get(args.projectId))!),
    }
  },
})

export const deleteStatus = mutation({
  args: {
    projectId: v.id('projects'),
    statusKey: v.string(),
    transferToStatusKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectWriteAccess(ctx, args.projectId)
    const normalizedProject = normalizeProject(project)

    if (args.statusKey === 'todo' || args.statusKey === 'done') {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Todo and Done cannot be deleted.',
      })
    }

    if (args.transferToStatusKey === args.statusKey) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Choose a different status to transfer tasks into.',
      })
    }

    const statusToDelete = normalizedProject.statuses.find(
      (status) => status.key === args.statusKey,
    )
    const transferStatus = normalizedProject.statuses.find(
      (status) => status.key === args.transferToStatusKey,
    )

    if (!statusToDelete) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Status not found in this project.',
      })
    }
    if (!transferStatus) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Transfer target is not part of this project workflow.',
      })
    }

    const now = Date.now()
    const issues = await ctx.db
      .query('issues')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const affectedIssues = issues.filter(
      (issue) => !issue.deletedAt && issue.status === args.statusKey,
    )

    await Promise.all(
      affectedIssues.map((issue) =>
        ctx.db.patch(issue._id, {
          status: args.transferToStatusKey,
          completedAt: args.transferToStatusKey === 'done' ? now : undefined,
          updatedAt: now,
        }),
      ),
    )

    await ctx.db.patch(args.projectId, {
      statuses: normalizedProject.statuses.filter(
        (status) => status.key !== args.statusKey,
      ),
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'project',
      entityId: args.projectId,
      action: 'project.updated',
      metadata: {
        deletedStatusKey: args.statusKey,
        transferToStatusKey: args.transferToStatusKey,
        transferredIssueCount: affectedIssues.length,
      },
    })

    return {
      deletedStatusKey: args.statusKey,
      transferToStatusKey: args.transferToStatusKey,
      transferredIssueCount: affectedIssues.length,
      project: normalizeProject((await ctx.db.get(args.projectId))!),
    }
  },
})

export const archive = mutation({
  args: {
    projectId: v.id('projects'),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)

    await ctx.db.patch(args.projectId, {
      archived: args.archived,
      updatedAt: Date.now(),
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'project',
      entityId: args.projectId,
      action: 'project.archived',
      metadata: {
        archived: args.archived,
      },
    })

    return await ctx.db.get(args.projectId)
  },
})

export const addMember = mutation({
  args: {
    projectId: v.id('projects'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectMemberManagementAccess(ctx, args.projectId)

    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Project not found.' })
    }

    const target = await ctx.db.get(args.userId)
    if (!target || !target.isActive) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Target user does not exist or is inactive.',
      })
    }

    const existing = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId_userId', (q) =>
        q.eq('projectId', args.projectId).eq('userId', args.userId),
      )
      .unique()

    if (existing) {
      return existing
    }

    const membershipId = await ctx.db.insert('projectMembers', {
      projectId: args.projectId,
      userId: args.userId,
      addedBy: user._id,
      joinedAt: Date.now(),
    })

    await ctx.db.patch(args.projectId, {
      updatedAt: Date.now(),
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'member',
      entityId: membershipId,
      action: 'project.member_added',
      metadata: {
        userId: args.userId,
      },
    })

    return await ctx.db.get(membershipId)
  },
})

export const removeMember = mutation({
  args: {
    projectId: v.id('projects'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectMemberManagementAccess(
      ctx,
      args.projectId,
    )

    if (project.createdBy === args.userId) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Project owner cannot be removed from membership.',
      })
    }

    const membership = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId_userId', (q) =>
        q.eq('projectId', args.projectId).eq('userId', args.userId),
      )
      .unique()

    if (!membership) {
      return null
    }

    await ctx.db.delete(membership._id)

    await ctx.db.patch(args.projectId, {
      updatedAt: Date.now(),
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'member',
      entityId: membership._id,
      action: 'project.member_removed',
      metadata: {
        userId: args.userId,
      },
    })

    return membership
  },
})

export const searchInviteCandidates = query({
  args: {
    projectId: v.id('projects'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectMemberManagementAccess(ctx, args.projectId)

    const allUsers = await ctx.db
      .query('users')
      .withIndex('by_isActive', (q) => q.eq('isActive', true))
      .collect()

    const memberships = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const memberIds = new Set(memberships.map((membership) => membership.userId))
    const search = args.search?.trim().toLowerCase()

    return allUsers
      .filter((candidate) => !memberIds.has(candidate._id))
      .filter((candidate) => {
        if (!search) {
          return true
        }
        return (
          candidate.name.toLowerCase().includes(search) ||
          candidate.email.toLowerCase().includes(search)
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25)
  },
})

export const activity = query({
  args: {
    projectId: v.id('projects'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      return []
    }

    await requireProjectViewAccess(ctx, args.projectId)

    const rows = await ctx.db
      .query('activities')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .order('desc')
      .take(Math.min(args.limit ?? 50, 200))

    return rows
  },
})
