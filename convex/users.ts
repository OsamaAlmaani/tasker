import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { GLOBAL_ROLES, globalRoleValidator } from './constants'
import { requireAdmin, requireAuth, requireCurrentUser } from './lib/auth'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export const ensureCurrentUser = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx)
    const now = Date.now()
    const emailFromIdentity = (identity as { email?: string }).email
    const nameFromIdentity = (identity as { name?: string }).name

    const email = normalizeEmail(
      args.email ?? emailFromIdentity ?? `${identity.subject}@local.invalid`,
    )
    const name = args.name?.trim() || nameFromIdentity?.trim() || 'Unnamed User'

    const existing = await ctx.db
      .query('users')
      .withIndex('by_clerkUserId', (q) => q.eq('clerkUserId', identity.subject))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        email,
        name,
        imageUrl: args.imageUrl,
        updatedAt: now,
      })
      return await ctx.db.get(existing._id)
    }

    const firstUser = await ctx.db.query('users').first()

    const userId = await ctx.db.insert('users', {
      clerkUserId: identity.subject,
      email,
      name,
      imageUrl: args.imageUrl,
      globalRole: firstUser ? 'member' : 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    return await ctx.db.get(userId)
  },
})

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const membershipCount = (
      await ctx.db
        .query('projectMembers')
        .withIndex('by_userId', (q) => q.eq('userId', user._id))
        .collect()
    ).length

    return {
      ...user,
      membershipCount,
    }
  },
})

export const list = query({
  args: {
    search: v.optional(v.string()),
    role: v.optional(globalRoleValidator),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const users = await ctx.db.query('users').collect()

    const search = args.search?.trim().toLowerCase()

    return users
      .filter((user) => {
        if (args.role && user.globalRole !== args.role) {
          return false
        }
        if (args.isActive !== undefined && user.isActive !== args.isActive) {
          return false
        }
        if (!search) {
          return true
        }
        return (
          user.name.toLowerCase().includes(search) ||
          user.email.toLowerCase().includes(search)
        )
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  },
})

export const listAssignableUsers = query({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx)

    if (currentUser.globalRole === 'admin') {
      return await ctx.db.query('users').withIndex('by_isActive', (q) => q.eq('isActive', true)).collect()
    }

    const membership = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId_userId', (q) =>
        q.eq('projectId', args.projectId).eq('userId', currentUser._id),
      )
      .unique()

    if (!membership) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'You do not have access to this project.',
      })
    }

    const members = await ctx.db
      .query('projectMembers')
      .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
      .collect()

    const results = []
    for (const member of members) {
      const user = await ctx.db.get(member.userId)
      if (user?.isActive) {
        results.push(user)
      }
    }

    return results
  },
})

export const updateRole = mutation({
  args: {
    userId: v.id('users'),
    role: globalRoleValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx)
    const target = await ctx.db.get(args.userId)

    if (!target) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'User not found.' })
    }

    if (!GLOBAL_ROLES.includes(args.role)) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid role supplied.',
      })
    }

    if (target.globalRole === 'admin' && args.role !== 'admin') {
      const admins = await ctx.db
        .query('users')
        .withIndex('by_globalRole', (q) => q.eq('globalRole', 'admin'))
        .collect()

      if (admins.length <= 1) {
        throw new ConvexError({
          code: 'FORBIDDEN',
          message: 'At least one admin is required.',
        })
      }
    }

    await ctx.db.patch(target._id, {
      globalRole: args.role,
      updatedAt: Date.now(),
    })

    return {
      changedBy: admin._id,
      userId: target._id,
      role: args.role,
    }
  },
})

export const setActive = mutation({
  args: {
    userId: v.id('users'),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const target = await ctx.db.get(args.userId)

    if (!target) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'User not found.' })
    }

    if (target.globalRole === 'admin' && !args.isActive) {
      const activeAdmins = (
        await ctx.db
          .query('users')
          .withIndex('by_globalRole', (q) => q.eq('globalRole', 'admin'))
          .collect()
      ).filter((user) => user.isActive)

      if (activeAdmins.length <= 1) {
        throw new ConvexError({
          code: 'FORBIDDEN',
          message: 'At least one active admin is required.',
        })
      }
    }

    await ctx.db.patch(target._id, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    })

    return await ctx.db.get(target._id)
  },
})

export const memberships = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    const memberships = await ctx.db
      .query('projectMembers')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()

    const rows = []
    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId)
      if (project) {
        rows.push({
          membership,
          project,
        })
      }
    }

    return rows.sort((a, b) => b.project.updatedAt - a.project.updatedAt)
  },
})
