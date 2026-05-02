import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { notificationEmailStatusValidator } from './constants'
import { requireCurrentUser } from './lib/auth'
import { buildAssignmentNotificationContent } from './lib/notifications'

type AssignmentNotificationMetadata = {
  actorName: string
  issueNumber: number
  issueTitle: string
  projectKey: string
  projectName: string
}

export const list = query({
  args: {
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_recipientUserId_createdAt', (q) =>
        q.eq('recipientUserId', user._id),
      )
      .order('desc')
      .take(Math.min(args.limit ?? 50, 200))

    return rows
      .filter((row) => (args.unreadOnly ? !row.readAt : true))
      .map((row) => ({
        ...row,
        isUnread: !row.readAt,
      }))
  },
})

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_recipientUserId_createdAt', (q) =>
        q.eq('recipientUserId', user._id),
      )
      .collect()

    return rows.filter((row) => !row.readAt).length
  },
})

export const markRead = mutation({
  args: {
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const notification = await ctx.db.get(args.notificationId)
    if (!notification || notification.recipientUserId !== user._id) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Notification not found.',
      })
    }

    if (notification.readAt) {
      return notification
    }

    const now = Date.now()
    await ctx.db.patch(notification._id, {
      readAt: now,
      updatedAt: now,
    })

    return await ctx.db.get(notification._id)
  },
})

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_recipientUserId_createdAt', (q) =>
        q.eq('recipientUserId', user._id),
      )
      .collect()

    const unreadNotifications = notifications.filter((row) => !row.readAt)
    if (!unreadNotifications.length) {
      return { updatedCount: 0 }
    }

    const now = Date.now()
    await Promise.all(
      unreadNotifications.map((notification) =>
        ctx.db.patch(notification._id, {
          readAt: now,
          updatedAt: now,
        }),
      ),
    )

    return {
      updatedCount: unreadNotifications.length,
    }
  },
})

export const createAssignmentNotification = internalMutation({
  args: {
    recipientUserId: v.id('users'),
    actorUserId: v.optional(v.id('users')),
    actorName: v.string(),
    projectId: v.id('projects'),
    projectKey: v.string(),
    projectName: v.string(),
    issueId: v.id('issues'),
    issueNumber: v.number(),
    issueTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const content = buildAssignmentNotificationContent({
      actorName: args.actorName,
      appBaseUrl: 'http://localhost',
      issueId: args.issueId,
      issueNumber: args.issueNumber,
      issueTitle: args.issueTitle,
      projectKey: args.projectKey,
      projectName: args.projectName,
    })

    const notificationId = await ctx.db.insert('notifications', {
      recipientUserId: args.recipientUserId,
      actorUserId: args.actorUserId,
      projectId: args.projectId,
      issueId: args.issueId,
      type: 'issue_assigned',
      title: content.title,
      body: content.body,
      link: content.link,
      metadata: {
        actorName: args.actorName,
        issueNumber: args.issueNumber,
        issueTitle: args.issueTitle,
        projectKey: args.projectKey,
        projectName: args.projectName,
      } satisfies AssignmentNotificationMetadata,
      emailStatus: 'pending',
      emailAttempts: 0,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(
      0,
      internal.notificationsActions.deliverNotificationEmail,
      {
        notificationId,
      },
    )

    return notificationId
  },
})

export const getDeliveryPayload = internalQuery({
  args: {
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId)
    if (!notification) {
      return null
    }

    const recipient = await ctx.db.get(notification.recipientUserId)
    if (!recipient) {
      return null
    }

    return {
      notification,
      recipient: {
        _id: recipient._id,
        email: recipient.email,
        isActive: recipient.isActive,
        name: recipient.name,
      },
      metadata: notification.metadata as AssignmentNotificationMetadata | undefined,
    }
  },
})

export const recordEmailDeliveryResult = internalMutation({
  args: {
    notificationId: v.id('notifications'),
    status: notificationEmailStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId)
    if (!notification) {
      return null
    }

    const now = Date.now()
    const nextPatch: Partial<Doc<'notifications'>> = {
      emailStatus: args.status,
      emailAttempts: notification.emailAttempts + 1,
      lastEmailAttemptAt: now,
      updatedAt: now,
      lastEmailError:
        args.status === 'failed' ? args.errorMessage ?? 'Unknown email error.' : undefined,
      emailSentAt: args.status === 'sent' ? now : undefined,
    }

    await ctx.db.patch(notification._id, nextPatch)
    return await ctx.db.get(notification._id)
  },
})
