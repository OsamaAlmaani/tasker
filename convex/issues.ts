import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { issuePriorityValidator, issueStatusValidator } from './constants'
import {
  requireIssueViewAccess,
  requireIssueWriteAccess,
  requireProjectIssueDeleteAccess,
  requireProjectViewAccess,
  requireProjectWriteAccess,
} from './lib/auth'
import { createActivity } from './lib/activity'
import {
  ensureProjectCustomFieldsExist,
  normalizeIssueCustomFieldValues,
} from './lib/projectCustomFields'
import { ensureProjectLabelsExist } from './lib/projectLabels'
import {
  ensureProjectStatusExists,
  normalizeProject,
  normalizeProjectStatuses,
} from './lib/projectStatuses'

function buildSearchText(title: string, description?: string) {
  return `${title} ${description ?? ''}`.trim().toLowerCase()
}

function normalizeIssueLabels(labels: string[]) {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
}

type IssueUpdateChanges = {
  title?: string
  description?: string
  status?: Doc<'issues'>['status']
  priority?: Doc<'issues'>['priority']
  assigneeId?: Id<'users'> | null
  listId?: Id<'issueLists'> | null
  parentIssueId?: Id<'issues'> | null
  cascadeDescendantsToDone?: boolean
  labels?: string[]
  customFieldValues?: Record<string, string | number | boolean>
  dueDate?: number | null
  archived?: boolean
}

type IssueProgress = {
  childIssueCount: number
  completedChildIssueCount: number
  childCompletionRate: number
  hasChildren: boolean
}

function buildIssueProgressMap(issues: Doc<'issues'>[]) {
  const childrenByParent = new Map<string, Doc<'issues'>[]>()

  for (const issue of issues) {
    if (!issue.parentIssueId) {
      continue
    }

    const siblings = childrenByParent.get(issue.parentIssueId) ?? []
    siblings.push(issue)
    childrenByParent.set(issue.parentIssueId, siblings)
  }

  const progressByIssueId = new Map<string, IssueProgress>()
  for (const issue of issues) {
    const childIssues = childrenByParent.get(issue._id) ?? []
    const completedChildIssueCount = childIssues.filter(
      (childIssue) => childIssue.status === 'done',
    ).length

    progressByIssueId.set(issue._id, {
      childIssueCount: childIssues.length,
      completedChildIssueCount,
      childCompletionRate: childIssues.length
        ? completedChildIssueCount / childIssues.length
        : 0,
      hasChildren: childIssues.length > 0,
    })
  }

  return progressByIssueId
}

function decorateIssueWithProgress(
  issue: Doc<'issues'>,
  progressByIssueId: Map<string, IssueProgress>,
) {
  return {
    ...issue,
    ...(progressByIssueId.get(issue._id) ?? {
      childIssueCount: 0,
      completedChildIssueCount: 0,
      childCompletionRate: 0,
      hasChildren: false,
    }),
  }
}

async function ensureAssigneeAllowed(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  assigneeId: Id<'users'>,
) {
  const assignee = await ctx.db.get(assigneeId)
  if (!assignee || !assignee.isActive) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Assignee not found or inactive.',
    })
  }

  if (assignee.globalRole === 'admin') {
    return assignee
  }

  const membership = await ctx.db
    .query('projectMembers')
    .withIndex('by_projectId_userId', (q) =>
      q.eq('projectId', projectId).eq('userId', assigneeId),
    )
    .unique()

  if (!membership) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Assignee must be a member of this project.',
    })
  }

  return assignee
}

async function ensureIssueListBelongsToProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  listId: Id<'issueLists'>,
) {
  const issueList = await ctx.db.get(listId)
  if (!issueList || issueList.projectId !== projectId) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Issue list not found in this project.',
    })
  }

  return issueList
}

async function ensureParentIssueBelongsToProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  parentIssueId: Id<'issues'>,
) {
  const parentIssue = await ctx.db.get(parentIssueId)
  if (
    !parentIssue ||
    parentIssue.projectId !== projectId ||
    parentIssue.deletedAt ||
    parentIssue.archived
  ) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Parent issue not found in this project.',
    })
  }

  if (parentIssue.parentIssueId) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Only top-level issues can have sub-issues.',
    })
  }

  return parentIssue
}

async function ensureIssueCanBecomeChild(ctx: MutationCtx, issue: Doc<'issues'>) {
  const childIssues = await ctx.db
    .query('issues')
    .withIndex('by_parentIssueId', (q) => q.eq('parentIssueId', issue._id))
    .collect()

  const hasVisibleChildren = childIssues.some(
    (childIssue) => !childIssue.deletedAt && !childIssue.archived,
  )
  if (hasVisibleChildren) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'An issue with sub-issues cannot be converted into a child issue.',
    })
  }
}

async function ensureNoIssueCycle(
  ctx: MutationCtx,
  issueId: Id<'issues'>,
  parentIssueId: Id<'issues'>,
) {
  if (issueId === parentIssueId) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'An issue cannot be its own parent.',
    })
  }

  let cursor: Id<'issues'> | undefined = parentIssueId
  while (cursor) {
    if (cursor === issueId) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'This parent issue would create a cycle.',
      })
    }

    const currentIssue: Doc<'issues'> | null = await ctx.db.get(cursor)
    cursor = currentIssue?.parentIssueId
  }
}

async function collectIssueDescendants(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  rootIssueId: Id<'issues'>,
) {
  const issues = await ctx.db
    .query('issues')
    .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
    .collect()

  const descendantsByParent = new Map<string, Id<'issues'>[]>()
  for (const issue of issues) {
    if (!issue.parentIssueId || issue.deletedAt) {
      continue
    }

    const siblings = descendantsByParent.get(issue.parentIssueId) ?? []
    siblings.push(issue._id)
    descendantsByParent.set(issue.parentIssueId, siblings)
  }

  const issueIds: Id<'issues'>[] = []
  const queue: Id<'issues'>[] = [rootIssueId]
  const visited = new Set<string>()

  while (queue.length) {
    const currentIssueId = queue.shift()
    if (!currentIssueId || visited.has(currentIssueId)) {
      continue
    }

    visited.add(currentIssueId)
    issueIds.push(currentIssueId)
    queue.push(...(descendantsByParent.get(currentIssueId) ?? []))
  }

  return issueIds
}

async function getVisibleIssueDescendants(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  rootIssueId: Id<'issues'>,
) {
  const descendantIds = await collectIssueDescendants(ctx, projectId, rootIssueId)
  const descendants = (
    await Promise.all(descendantIds.map((issueId) => ctx.db.get(issueId)))
  ).filter((issue): issue is Doc<'issues'> => Boolean(issue))

  return descendants.filter((issue) => !issue.deletedAt && !issue.archived)
}

async function getVisibleIssueAncestors(
  ctx: MutationCtx,
  issue: Doc<'issues'>,
) {
  const ancestors: Doc<'issues'>[] = []
  let cursor = issue.parentIssueId

  while (cursor) {
    const parentIssue = await ctx.db.get(cursor)
    if (!parentIssue || parentIssue.deletedAt || parentIssue.archived) {
      break
    }

    ancestors.push(parentIssue)
    cursor = parentIssue.parentIssueId
  }

  return ancestors
}

function getIssueSelectionDepth(
  issueId: Id<'issues'>,
  issueById: Map<Id<'issues'>, Doc<'issues'>>,
  depthByIssueId: Map<Id<'issues'>, number>,
): number {
  const cachedDepth = depthByIssueId.get(issueId)
  if (cachedDepth !== undefined) {
    return cachedDepth
  }

  const issue = issueById.get(issueId)
  if (!issue?.parentIssueId || !issueById.has(issue.parentIssueId)) {
    depthByIssueId.set(issueId, 0)
    return 0
  }

  const depth =
    getIssueSelectionDepth(issue.parentIssueId, issueById, depthByIssueId) + 1
  depthByIssueId.set(issueId, depth)
  return depth
}

async function applyIssueUpdate(
  ctx: MutationCtx,
  {
    issue,
    user,
    changes,
    now = Date.now(),
  }: {
    issue: Doc<'issues'>
    user: Doc<'users'>
    changes: IssueUpdateChanges
    now?: number
  },
) {
  const project = await ctx.db.get(issue.projectId)
  if (!project) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Project not found.',
    })
  }

  const patch: Record<string, unknown> = {
    updatedAt: now,
  }

  if (changes.title !== undefined) {
    patch.title = changes.title.trim()
  }
  if (changes.description !== undefined) {
    patch.description = changes.description.trim()
  }
  if (changes.status !== undefined) {
    if (!ensureProjectStatusExists(project, changes.status)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'This status does not belong to the current project.',
      })
    }

    if (changes.status === 'done') {
      const visibleDescendants = await getVisibleIssueDescendants(
        ctx,
        issue.projectId,
        issue._id,
      )
      const unfinishedDescendants = visibleDescendants.filter(
        (descendant) => descendant._id !== issue._id && descendant.status !== 'done',
      )

      if (
        unfinishedDescendants.length > 0 &&
        !changes.cascadeDescendantsToDone
      ) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message:
            'This issue has unfinished sub-issues. Confirm to mark all descendants as done.',
        })
      }

      if (changes.cascadeDescendantsToDone) {
        await Promise.all(
          unfinishedDescendants.map((descendant) =>
            ctx.db.patch(descendant._id, {
              status: 'done',
              completedAt: now,
              updatedAt: now,
            }),
          ),
        )
      }
    } else {
      const visibleAncestors = await getVisibleIssueAncestors(ctx, issue)
      const doneAncestor = visibleAncestors.find(
        (ancestor) => ancestor.status === 'done',
      )

      if (doneAncestor) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: `Cannot move this sub-issue out of done while parent issue #${doneAncestor.issueNumber} is still done. Reopen the parent first.`,
        })
      }
    }

    patch.status = changes.status
    patch.completedAt = changes.status === 'done' ? now : undefined
  }
  if (changes.priority !== undefined) {
    patch.priority = changes.priority
  }
  if (changes.assigneeId !== undefined) {
    if (changes.assigneeId) {
      await ensureAssigneeAllowed(ctx, issue.projectId, changes.assigneeId)
    }
    patch.assigneeId = changes.assigneeId ?? undefined
  }
  if (changes.listId !== undefined) {
    if (changes.listId) {
      await ensureIssueListBelongsToProject(ctx, issue.projectId, changes.listId)
    }
    patch.listId = changes.listId ?? undefined
  }
  if (changes.parentIssueId !== undefined) {
    if (changes.parentIssueId) {
      await ensureParentIssueBelongsToProject(
        ctx,
        issue.projectId,
        changes.parentIssueId,
      )
      await ensureNoIssueCycle(ctx, issue._id, changes.parentIssueId)
      await ensureIssueCanBecomeChild(ctx, issue)
    }
    patch.parentIssueId = changes.parentIssueId ?? undefined
  }
  if (changes.labels !== undefined) {
    const nextLabels = normalizeIssueLabels(changes.labels)
    if (!ensureProjectLabelsExist(project, nextLabels)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'One or more labels do not belong to the current project.',
      })
    }
    patch.labels = nextLabels
  }

  if (changes.customFieldValues !== undefined) {
    if (
      !ensureProjectCustomFieldsExist(
        project,
        Object.keys(changes.customFieldValues),
      )
    ) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'One or more custom fields do not belong to the current project.',
      })
    }

    try {
      patch.customFieldValues = normalizeIssueCustomFieldValues(
        project.customFields,
        changes.customFieldValues,
      )
    } catch (error) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'One or more custom field values are invalid.',
      })
    }
  }
  if (changes.dueDate !== undefined) {
    patch.dueDate = changes.dueDate ?? undefined
  }
  if (changes.archived !== undefined) {
    patch.archived = changes.archived
  }

  const nextTitle = (patch.title as string | undefined) ?? issue.title
  const nextDescription =
    (patch.description as string | undefined) ?? issue.description
  patch.searchText = buildSearchText(nextTitle, nextDescription)

  await ctx.db.patch(issue._id, patch)
  await ctx.db.patch(issue.projectId, {
    updatedAt: now,
  })

  await createActivity(ctx, {
    actorId: user._id,
    projectId: issue.projectId,
    issueId: issue._id,
    entityType: 'issue',
    entityId: issue._id,
    action: 'issue.updated',
    metadata: {
      changedFields: Object.keys(patch),
    },
  })

  if (changes.status !== undefined && changes.status !== issue.status) {
    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'issue',
      entityId: issue._id,
      action: 'issue.status_changed',
      metadata: {
        from: issue.status,
        to: changes.status,
      },
    })
  }

  if (changes.priority !== undefined && changes.priority !== issue.priority) {
    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'issue',
      entityId: issue._id,
      action: 'issue.priority_changed',
      metadata: {
        from: issue.priority,
        to: changes.priority,
      },
    })
  }

  if (changes.assigneeId !== undefined && changes.assigneeId !== issue.assigneeId) {
    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'issue',
      entityId: issue._id,
      action: 'issue.assignee_changed',
      metadata: {
        from: issue.assigneeId,
        to: changes.assigneeId,
      },
    })
  }

  if (changes.listId !== undefined && changes.listId !== issue.listId) {
    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'issue',
      entityId: issue._id,
      action: 'issue.list_changed',
      metadata: {
        from: issue.listId,
        to: changes.listId,
      },
    })
  }

  return await ctx.db.get(issue._id)
}

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    search: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    statuses: v.optional(v.array(issueStatusValidator)),
    priority: v.optional(issuePriorityValidator),
    assigneeId: v.optional(v.id('users')),
    creatorId: v.optional(v.id('users')),
    listId: v.optional(v.union(v.id('issueLists'), v.null())),
    includeArchived: v.optional(v.boolean()),
    onlyMine: v.optional(v.boolean()),
    sortBy: v.optional(
      v.union(
        v.literal('updated_desc'),
        v.literal('created_desc'),
        v.literal('priority_desc'),
        v.literal('due_asc'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      return []
    }

    const { user } = await requireProjectViewAccess(ctx, args.projectId)

    const issues = await ctx.db
      .query('issues')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const progressSourceIssues = issues.filter((issue) => {
      if (issue.deletedAt) {
        return false
      }
      if (!args.includeArchived && issue.archived) {
        return false
      }
      return true
    })
    const progressByIssueId = buildIssueProgressMap(progressSourceIssues)

    let rows = issues.filter((issue) => {
      if (!args.includeArchived && issue.archived) {
        return false
      }
      if (issue.deletedAt) {
        return false
      }
      if (args.status && issue.status !== args.status) {
        return false
      }
      if (args.statuses?.length && !args.statuses.includes(issue.status)) {
        return false
      }
      if (args.priority && issue.priority !== args.priority) {
        return false
      }
      if (args.assigneeId && issue.assigneeId !== args.assigneeId) {
        return false
      }
      if (args.creatorId && issue.createdBy !== args.creatorId) {
        return false
      }
      if (args.listId !== undefined) {
        if (args.listId === null && issue.listId !== undefined) {
          return false
        }
        if (args.listId !== null && issue.listId !== args.listId) {
          return false
        }
      }
      if (args.search?.trim() && args.includeArchived) {
        const search = args.search.trim().toLowerCase()
        if (!issue.searchText.includes(search)) {
          return false
        }
      }
      if (args.onlyMine && issue.assigneeId !== user._id) {
        return false
      }
      return true
    })

    switch (args.sortBy ?? 'updated_desc') {
      case 'created_desc':
        rows = rows.sort((a, b) => b.createdAt - a.createdAt)
        break
      case 'priority_desc': {
        const weight = {
          none: 0,
          low: 1,
          medium: 2,
          high: 3,
          urgent: 4,
        }
        rows = rows.sort((a, b) => {
          const diff = weight[b.priority] - weight[a.priority]
          if (diff !== 0) {
            return diff
          }
          return b.updatedAt - a.updatedAt
        })
        break
      }
      case 'due_asc':
        rows = rows.sort((a, b) => {
          const aDue = a.dueDate ?? Number.MAX_SAFE_INTEGER
          const bDue = b.dueDate ?? Number.MAX_SAFE_INTEGER
          if (aDue === bDue) {
            return b.updatedAt - a.updatedAt
          }
          return aDue - bDue
        })
        break
      case 'updated_desc':
      default:
        rows = rows.sort((a, b) => b.updatedAt - a.updatedAt)
        break
    }

    return rows.map((issue) => decorateIssueWithProgress(issue, progressByIssueId))
  },
})

export const getById = query({
  args: {
    issueId: v.id('issues'),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId)
    if (!issue || issue.deletedAt) {
      return null
    }

    const projectExists = await ctx.db.get(issue.projectId)
    if (!projectExists) {
      return null
    }

    const { project } = await requireProjectViewAccess(ctx, issue.projectId)
    const normalizedProject = normalizeProject(project)

    const projectIssues = await ctx.db
      .query('issues')
      .withIndex('by_projectId', (q) => q.eq('projectId', issue.projectId))
      .collect()
    const visibleIssues = projectIssues.filter(
      (projectIssue) => !projectIssue.deletedAt && !projectIssue.archived,
    )
    const progressByIssueId = buildIssueProgressMap(visibleIssues)

    const assignee = issue.assigneeId ? await ctx.db.get(issue.assigneeId) : null
    const reporter = await ctx.db.get(issue.reporterId)
    const parentIssue =
      issue.parentIssueId && !issue.archived
        ? projectIssues.find(
            (projectIssue) =>
              projectIssue._id === issue.parentIssueId &&
              !projectIssue.deletedAt &&
              !projectIssue.archived,
          ) ?? null
        : null
    const childIssues = (
      await Promise.all(
        visibleIssues
          .filter((projectIssue) => projectIssue.parentIssueId === issue._id)
          .sort((left, right) => left.issueNumber - right.issueNumber)
          .map(async (childIssue) => ({
            issue: decorateIssueWithProgress(childIssue, progressByIssueId),
            assignee: childIssue.assigneeId
              ? await ctx.db.get(childIssue.assigneeId)
              : null,
          })),
      )
    ).filter((row) => row.issue)

    return {
      issue: decorateIssueWithProgress(issue, progressByIssueId),
      project: normalizedProject,
      assignee,
      reporter,
      parentIssue: parentIssue
        ? decorateIssueWithProgress(parentIssue, progressByIssueId)
        : null,
      childIssues,
    }
  },
})

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeId: v.optional(v.id('users')),
    listId: v.optional(v.id('issueLists')),
    parentIssueId: v.optional(v.id('issues')),
    labels: v.optional(v.array(v.string())),
    customFieldValues: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Project not found.',
      })
    }
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const normalizedProjectStatuses = normalizeProjectStatuses(project.statuses)
    const defaultStatusKey =
      normalizedProjectStatuses.find((status) => status.key === 'todo')?.key ??
      'todo'
    const nextStatus = args.status ?? defaultStatusKey

    if (!ensureProjectStatusExists(project, nextStatus)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'This status does not belong to the current project.',
      })
    }

    if (args.assigneeId) {
      await ensureAssigneeAllowed(ctx, args.projectId, args.assigneeId)
    }
    if (args.listId) {
      await ensureIssueListBelongsToProject(ctx, args.projectId, args.listId)
    }
    if (args.parentIssueId) {
      await ensureParentIssueBelongsToProject(
        ctx,
        args.projectId,
        args.parentIssueId,
      )
    }
    const nextLabels = normalizeIssueLabels(args.labels ?? [])
    if (!ensureProjectLabelsExist(project, nextLabels)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'One or more labels do not belong to the current project.',
      })
    }

    const nextCustomFieldValues = (() => {
      if (!args.customFieldValues) {
        return {}
      }

      if (
        !ensureProjectCustomFieldsExist(project, Object.keys(args.customFieldValues))
      ) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'One or more custom fields do not belong to the current project.',
        })
      }

      try {
        return normalizeIssueCustomFieldValues(
          project.customFields,
          args.customFieldValues,
        )
      } catch (error) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'One or more custom field values are invalid.',
        })
      }
    })()

    const now = Date.now()
    let counter = await ctx.db
      .query('projectCounters')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .unique()

    if (!counter) {
      const counterId = await ctx.db.insert('projectCounters', {
        projectId: args.projectId,
        nextIssueNumber: 1,
        updatedAt: now,
      })
      counter = await ctx.db.get(counterId)
    }

    if (!counter) {
      throw new ConvexError({
        code: 'INTERNAL_ERROR',
        message: 'Failed to initialize project issue counter.',
      })
    }

    const issueNumber = counter.nextIssueNumber
    await ctx.db.patch(counter._id, {
      nextIssueNumber: issueNumber + 1,
      updatedAt: now,
    })

    const issueId = await ctx.db.insert('issues', {
      projectId: args.projectId,
      issueNumber,
      title: args.title.trim(),
      description: args.description?.trim(),
      searchText: buildSearchText(args.title, args.description),
      listId: args.listId,
      parentIssueId: args.parentIssueId,
      status: nextStatus,
      priority: args.priority ?? 'none',
      assigneeId: args.assigneeId,
      reporterId: user._id,
      createdBy: user._id,
      labels: nextLabels,
      customFieldValues: nextCustomFieldValues,
      dueDate: args.dueDate,
      archived: false,
      createdAt: now,
      updatedAt: now,
      completedAt: nextStatus === 'done' ? now : undefined,
    })

    await ctx.db.patch(args.projectId, {
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      issueId,
      entityType: 'issue',
      entityId: issueId,
      action: 'issue.created',
      metadata: {
        issueNumber,
        title: args.title,
        parentIssueId: args.parentIssueId,
      },
    })

    return await ctx.db.get(issueId)
  },
})

export const update = mutation({
  args: {
    issueId: v.id('issues'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeId: v.optional(v.union(v.id('users'), v.null())),
    listId: v.optional(v.union(v.id('issueLists'), v.null())),
    parentIssueId: v.optional(v.union(v.id('issues'), v.null())),
    cascadeDescendantsToDone: v.optional(v.boolean()),
    labels: v.optional(v.array(v.string())),
    customFieldValues: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    dueDate: v.optional(v.union(v.number(), v.null())),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { issue, user } = await requireIssueWriteAccess(ctx, args.issueId)
    return await applyIssueUpdate(ctx, {
      issue,
      user,
      changes: args,
    })
  },
})

export const bulkUpdate = mutation({
  args: {
    issueIds: v.array(v.id('issues')),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeId: v.optional(v.union(v.id('users'), v.null())),
    archived: v.optional(v.boolean()),
    cascadeDescendantsToDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const uniqueIssueIds = [...new Set(args.issueIds)]
    if (!uniqueIssueIds.length) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Select at least one task.',
      })
    }

    if (
      args.status === undefined &&
      args.priority === undefined &&
      args.assigneeId === undefined &&
      args.archived === undefined
    ) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Choose at least one bulk action.',
      })
    }

    if (uniqueIssueIds.length > 100) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Bulk actions are limited to 100 tasks at a time.',
      })
    }

    const selectedIssues = []
    for (const issueId of uniqueIssueIds) {
      selectedIssues.push(await requireIssueWriteAccess(ctx, issueId))
    }

    const issueById = new Map(
      selectedIssues.map(({ issue }) => [issue._id, issue]),
    )
    const depthByIssueId = new Map<Id<'issues'>, number>()
    const orderedSelections = [...selectedIssues].sort((left, right) => {
      const leftDepth = getIssueSelectionDepth(
        left.issue._id,
        issueById,
        depthByIssueId,
      )
      const rightDepth = getIssueSelectionDepth(
        right.issue._id,
        issueById,
        depthByIssueId,
      )

      if (args.status && args.status !== 'done') {
        return leftDepth - rightDepth
      }

      return rightDepth - leftDepth
    })

    const results = []
    for (const { issue, user } of orderedSelections) {
      results.push(
        await applyIssueUpdate(ctx, {
          issue,
          user,
          changes: {
            status: args.status,
            priority: args.priority,
            assigneeId: args.assigneeId,
            archived: args.archived,
            cascadeDescendantsToDone: args.cascadeDescendantsToDone,
          },
        }),
      )
    }

    return {
      issueIds: uniqueIssueIds,
      updatedIssueCount: results.length,
    }
  },
})

export const remove = mutation({
  args: {
    issueId: v.id('issues'),
  },
  handler: async (ctx, args) => {
    const { issue, user } = await requireIssueWriteAccess(ctx, args.issueId)
    await requireProjectIssueDeleteAccess(ctx, issue.projectId)

    const now = Date.now()
    const issueIdsToDelete = await collectIssueDescendants(
      ctx,
      issue.projectId,
      args.issueId,
    )

    await Promise.all(
      issueIdsToDelete.map((issueId) =>
        ctx.db.patch(issueId, {
          deletedAt: now,
          archived: true,
          updatedAt: now,
        }),
      ),
    )

    await ctx.db.patch(issue.projectId, {
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'issue',
      entityId: issue._id,
      action: 'issue.deleted',
      metadata: {
        issueNumber: issue.issueNumber,
        deletedIssueCount: issueIdsToDelete.length,
      },
    })

    return {
      issueId: issue._id,
      deletedIssueCount: issueIdsToDelete.length,
      deletedAt: now,
    }
  },
})

export const activity = query({
  args: {
    issueId: v.id('issues'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId)
    if (!issue || issue.deletedAt) {
      return []
    }

    await requireIssueViewAccess(ctx, args.issueId)

    return await ctx.db
      .query('activities')
      .withIndex('by_issueId', (q) => q.eq('issueId', args.issueId))
      .order('desc')
      .take(Math.min(args.limit ?? 50, 200))
  },
})
