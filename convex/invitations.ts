import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { inviteStatusValidator } from './constants'
import { requireProjectMemberManagementAccess, requireProjectWriteAccess } from './lib/auth'
import { createActivity } from './lib/activity'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const prepareInviteSend = mutation({
  args: {
    projectId: v.id('projects'),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectMemberManagementAccess(ctx, args.projectId)

    const email = normalizeEmail(args.email)
    if (!isValidEmail(email)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Please provide a valid email address.',
      })
    }

    const existingUser = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()

    if (existingUser) {
      if (!existingUser.isActive) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'This user is inactive. Ask an admin to reactivate the account.',
        })
      }

      const existingMembership = await ctx.db
        .query('projectMembers')
        .withIndex('by_projectId_userId', (q) =>
          q.eq('projectId', args.projectId).eq('userId', existingUser._id),
        )
        .unique()

      if (existingMembership) {
        return {
          resultType: 'already_member' as const,
          email,
          userId: existingUser._id,
        }
      }

      await ctx.db.insert('projectMembers', {
        projectId: args.projectId,
        userId: existingUser._id,
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
        entityId: existingUser._id,
        action: 'project.member_added',
        metadata: {
          userId: existingUser._id,
          source: 'email_invite_existing_user',
        },
      })

      return {
        resultType: 'added_existing_user' as const,
        email,
        userId: existingUser._id,
      }
    }

    const pendingInvites = await ctx.db
      .query('projectInvites')
      .withIndex('by_projectId_email_status', (q) =>
        q.eq('projectId', args.projectId).eq('email', email).eq('status', 'pending'),
      )
      .collect()

    const now = Date.now()
    const activePending = pendingInvites
      .filter((invite) => !invite.expiresAt || invite.expiresAt > now)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]

    if (activePending) {
      return {
        resultType: 'already_invited' as const,
        email,
        invitationId: activePending._id,
      }
    }

    for (const staleInvite of pendingInvites) {
      await ctx.db.patch(staleInvite._id, {
        status: 'expired',
        updatedAt: now,
      })
    }

    return {
      resultType: 'needs_clerk_invite' as const,
      email,
    }
  },
})

export const finalizeInviteSend = mutation({
  args: {
    projectId: v.id('projects'),
    email: v.string(),
    clerkInvitationId: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectMemberManagementAccess(ctx, args.projectId)
    const now = Date.now()
    const email = normalizeEmail(args.email)

    const pendingInvites = await ctx.db
      .query('projectInvites')
      .withIndex('by_projectId_email_status', (q) =>
        q.eq('projectId', args.projectId).eq('email', email).eq('status', 'pending'),
      )
      .collect()

    const latestPending = pendingInvites.sort((a, b) => b.updatedAt - a.updatedAt)[0]

    let invitationId
    if (latestPending) {
      invitationId = latestPending._id
      await ctx.db.patch(latestPending._id, {
        invitedBy: user._id,
        clerkInvitationId: args.clerkInvitationId,
        expiresAt: args.expiresAt,
        updatedAt: now,
      })
    } else {
      invitationId = await ctx.db.insert('projectInvites', {
        projectId: args.projectId,
        email,
        invitedBy: user._id,
        status: 'pending',
        clerkInvitationId: args.clerkInvitationId,
        createdAt: now,
        updatedAt: now,
        expiresAt: args.expiresAt,
      })
    }

    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'invite',
      entityId: invitationId,
      action: 'project.invite_sent',
      metadata: {
        email,
        clerkInvitationId: args.clerkInvitationId,
      },
    })

    return await ctx.db.get(invitationId)
  },
})

export const prepareInviteRevoke = mutation({
  args: {
    projectInviteId: v.id('projectInvites'),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.projectInviteId)
    if (!invite) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Invite not found.' })
    }

    await requireProjectMemberManagementAccess(ctx, invite.projectId)

    if (invite.status !== 'pending') {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Only pending invites can be revoked.',
      })
    }

    return {
      clerkInvitationId: invite.clerkInvitationId,
    }
  },
})

export const finalizeInviteRevoke = mutation({
  args: {
    projectInviteId: v.id('projectInvites'),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.projectInviteId)
    if (!invite) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Invite not found.' })
    }

    const { user } = await requireProjectMemberManagementAccess(ctx, invite.projectId)

    if (invite.status !== 'pending') {
      return invite
    }

    const now = Date.now()
    await ctx.db.patch(invite._id, {
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    })

    await createActivity(ctx, {
      actorId: user._id,
      projectId: invite.projectId,
      entityType: 'invite',
      entityId: invite._id,
      action: 'project.invite_revoked',
      metadata: {
        email: invite.email,
      },
    })

    return await ctx.db.get(invite._id)
  },
})

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    status: v.optional(inviteStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireProjectWriteAccess(ctx, args.projectId)

    const invites = args.status
      ? await ctx.db
          .query('projectInvites')
          .withIndex('by_projectId_status', (q) =>
            q.eq('projectId', args.projectId).eq('status', args.status!),
          )
          .collect()
      : await ctx.db
          .query('projectInvites')
          .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
          .collect()

    const rows = []
    for (const invite of invites) {
      const invitedBy = await ctx.db.get(invite.invitedBy)
      const acceptedBy = invite.acceptedBy ? await ctx.db.get(invite.acceptedBy) : null

      rows.push({
        invite,
        invitedBy,
        acceptedBy,
      })
    }

    return rows.sort((a, b) => b.invite.createdAt - a.invite.createdAt)
  },
})
