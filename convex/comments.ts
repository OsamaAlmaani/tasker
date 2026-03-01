import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { canWrite, requireIssueViewAccess, requireIssueWriteAccess } from './lib/auth'
import { createActivity } from './lib/activity'

export const listByIssue = query({
  args: {
    issueId: v.id('issues'),
  },
  handler: async (ctx, args) => {
    const { issue } = await requireIssueViewAccess(ctx, args.issueId)

    const comments = await ctx.db
      .query('comments')
      .withIndex('by_issueId', (q) => q.eq('issueId', args.issueId))
      .order('asc')
      .collect()

    const rows = []
    for (const comment of comments) {
      const author = await ctx.db.get(comment.authorId)
      rows.push({
        comment,
        author,
      })
    }

    return {
      issue,
      comments: rows,
    }
  },
})

export const create = mutation({
  args: {
    issueId: v.id('issues'),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const { issue, user } = await requireIssueWriteAccess(ctx, args.issueId)

    if (!canWrite(user.globalRole)) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Viewer accounts cannot comment.',
      })
    }

    const now = Date.now()
    const commentId = await ctx.db.insert('comments', {
      issueId: issue._id,
      projectId: issue.projectId,
      authorId: user._id,
      body: args.body.trim(),
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(issue._id, {
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: issue.projectId,
      issueId: issue._id,
      entityType: 'comment',
      entityId: commentId,
      action: 'comment.created',
    })

    return await ctx.db.get(commentId)
  },
})

export const update = mutation({
  args: {
    commentId: v.id('comments'),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId)

    if (!comment) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Comment not found.' })
    }

    const { user } = await requireIssueWriteAccess(ctx, comment.issueId)

    if (user.globalRole !== 'admin' && comment.authorId !== user._id) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'You can only edit your own comments.',
      })
    }

    const now = Date.now()
    await ctx.db.patch(args.commentId, {
      body: args.body.trim(),
      updatedAt: now,
      editedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: comment.projectId,
      issueId: comment.issueId,
      entityType: 'comment',
      entityId: comment._id,
      action: 'comment.edited',
    })

    return await ctx.db.get(args.commentId)
  },
})
