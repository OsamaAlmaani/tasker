import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
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

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
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

    const now = Date.now()
    const issuesInList = await ctx.db
      .query('issues')
      .withIndex('by_listId', (q) => q.eq('listId', issueList._id))
      .collect()

    await Promise.all(
      issuesInList.map((issue) =>
        ctx.db.patch(issue._id, {
          listId: undefined,
          updatedAt: now,
        }),
      ),
    )

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
        movedIssueCount: issuesInList.length,
      },
    })

    return {
      issueListId: issueList._id,
      movedIssueCount: issuesInList.length,
    }
  },
})
