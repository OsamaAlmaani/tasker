import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { createActivity } from './lib/activity'
import { requireProjectViewAccess, requireProjectWriteAccess } from './lib/auth'

function normalizeListName(name: string) {
  return name.trim()
}

function ensureValidName(name: string) {
  if (name.length < 1) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'List name is required.',
    })
  }
  if (name.length > 48) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'List name must be 48 characters or fewer.',
    })
  }
}

async function collectIssueTreeIds(
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

    const descendants = descendantsByParent.get(issue.parentIssueId) ?? []
    descendants.push(issue._id)
    descendantsByParent.set(issue.parentIssueId, descendants)
  }

  const issueIds: Id<'issues'>[] = []
  const queue: Id<'issues'>[] = [rootIssueId]
  const visited = new Set<string>()

  while (queue.length) {
    const issueId = queue.shift()
    if (!issueId || visited.has(issueId)) {
      continue
    }

    visited.add(issueId)
    issueIds.push(issueId)
    queue.push(...(descendantsByParent.get(issueId) ?? []))
  }

  return issueIds
}

async function collectListDeletionIssueIds(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  issuesInList: Doc<'issues'>[],
) {
  const visibleIssueIds = new Set(
    issuesInList.filter((issue) => !issue.deletedAt).map((issue) => issue._id),
  )

  const rootIssueIds = issuesInList
    .filter(
      (issue) =>
        !issue.deletedAt &&
        (!issue.parentIssueId || !visibleIssueIds.has(issue.parentIssueId)),
    )
    .map((issue) => issue._id)

  const issueIdsToDelete = new Set<Id<'issues'>>()
  for (const issueId of rootIssueIds) {
    const issueTreeIds = await collectIssueTreeIds(ctx, projectId, issueId)
    for (const descendantIssueId of issueTreeIds) {
      issueIdsToDelete.add(descendantIssueId)
    }
  }

  return [...issueIdsToDelete]
}

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) {
      return []
    }

    await requireProjectViewAccess(ctx, args.projectId)

    return await ctx.db
      .query('issueLists')
      .withIndex('by_projectId_position', (q) => q.eq('projectId', args.projectId))
      .collect()
  },
})

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)

    const name = normalizeListName(args.name)
    ensureValidName(name)

    const existingLists = await ctx.db
      .query('issueLists')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const duplicate = existingLists.find(
      (list) => list.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      throw new ConvexError({
        code: 'CONFLICT',
        message: 'A list with this name already exists in this project.',
      })
    }

    const now = Date.now()
    const nextPosition =
      existingLists.reduce((max, list) => Math.max(max, list.position), -1) + 1

    const issueListId = await ctx.db.insert('issueLists', {
      projectId: args.projectId,
      name,
      position: nextPosition,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(args.projectId, {
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'issue_list',
      entityId: issueListId,
      action: 'issue_list.created',
      metadata: {
        name,
      },
    })

    return await ctx.db.get(issueListId)
  },
})

export const update = mutation({
  args: {
    issueListId: v.id('issueLists'),
    name: v.optional(v.string()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const issueList = await ctx.db.get(args.issueListId)
    if (!issueList) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Issue list not found.',
      })
    }

    const { user } = await requireProjectWriteAccess(ctx, issueList.projectId)

    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    }

    if (args.name !== undefined) {
      const name = normalizeListName(args.name)
      ensureValidName(name)

      const siblings = await ctx.db
        .query('issueLists')
        .withIndex('by_projectId', (q) => q.eq('projectId', issueList.projectId))
        .collect()

      const duplicate = siblings.find(
        (list) =>
          list._id !== issueList._id &&
          list.name.toLowerCase() === name.toLowerCase(),
      )
      if (duplicate) {
        throw new ConvexError({
          code: 'CONFLICT',
          message: 'A list with this name already exists in this project.',
        })
      }

      patch.name = name
    }

    if (args.position !== undefined) {
      patch.position = args.position
    }

    await ctx.db.patch(issueList._id, patch)
    await ctx.db.patch(issueList.projectId, {
      updatedAt: Date.now(),
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: issueList.projectId,
      entityType: 'issue_list',
      entityId: issueList._id,
      action: 'issue_list.updated',
      metadata: {
        changedFields: Object.keys(patch),
      },
    })

    return await ctx.db.get(issueList._id)
  },
})

export const remove = mutation({
  args: {
    issueListId: v.id('issueLists'),
    mode: v.union(v.literal('delete_tasks'), v.literal('move_tasks')),
    destinationListId: v.optional(v.union(v.id('issueLists'), v.null())),
  },
  handler: async (ctx, args) => {
    const issueList = await ctx.db.get(args.issueListId)
    if (!issueList) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Issue list not found.',
      })
    }

    const { user } = await requireProjectWriteAccess(ctx, issueList.projectId)
    if (args.mode === 'move_tasks' && args.destinationListId === undefined) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Choose a destination list or No list before deleting this list.',
      })
    }

    if (args.destinationListId) {
      const destinationList = await ctx.db.get(args.destinationListId)
      if (!destinationList || destinationList.projectId !== issueList.projectId) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Destination list not found in this project.',
        })
      }

      if (destinationList._id === issueList._id) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Choose a different destination list.',
        })
      }
    }

    const now = Date.now()
    const issuesInList = await ctx.db
      .query('issues')
      .withIndex('by_listId', (q) => q.eq('listId', issueList._id))
      .collect()

    let deletedIssueCount = 0
    let movedIssueCount = 0

    if (args.mode === 'delete_tasks') {
      const issueIdsToDelete = await collectListDeletionIssueIds(
        ctx,
        issueList.projectId,
        issuesInList,
      )
      deletedIssueCount = issueIdsToDelete.length

      await Promise.all(
        issueIdsToDelete.map((issueId) =>
          ctx.db.patch(issueId, {
            deletedAt: now,
            archived: true,
            updatedAt: now,
          }),
        ),
      )
    } else {
      movedIssueCount = issuesInList.filter((issue) => !issue.deletedAt).length
      await Promise.all(
        issuesInList.map((issue) =>
          ctx.db.patch(issue._id, {
            listId: args.destinationListId ?? undefined,
            updatedAt: now,
          }),
        ),
      )
    }

    await ctx.db.delete(issueList._id)
    await ctx.db.patch(issueList.projectId, {
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: issueList.projectId,
      entityType: 'issue_list',
      entityId: issueList._id,
      action: 'issue_list.deleted',
      metadata: {
        name: issueList.name,
        deletedIssueCount,
        movedIssueCount,
        mode: args.mode,
        destinationListId: args.destinationListId ?? null,
      },
    })

    return {
      issueListId: issueList._id,
      deletedIssueCount,
      movedIssueCount,
    }
  },
})
