import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireCurrentUser } from './lib/auth'
import { hashToken, requireAgentUser, validateTokenFormat } from './lib/agentTokens'

// Authenticate HTTP initialization and discovery without returning credential data.
export const authenticate = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAgentUser(ctx, args.token)
    return null
  },
})

export const list = query({
  args: {},
  handler: async ctx => {
    const user = await requireCurrentUser(ctx)
    const rows = await ctx.db.query('agentTokens').withIndex('by_userId', q => q.eq('userId', user._id)).collect()
    return rows.map(({ _id, name, tokenPrefix, createdAt, expiresAt, revokedAt }) => ({ _id, name, tokenPrefix, createdAt, expiresAt, revokedAt }))
  },
})

export const create = mutation({
  args: { name: v.string(), token: v.string(), expiresAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    validateTokenFormat(args.token)
    const name = args.name.trim()
    if (!name || name.length > 100 || (args.expiresAt !== undefined && (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now()))) {
      throw new ConvexError({ code: 'VALIDATION_ERROR', message: 'Provide a token name up to 100 characters and a future expiry.' })
    }
    const tokenHash = await hashToken(args.token)
    const existing = await ctx.db.query('agentTokens').withIndex('by_tokenHash', q => q.eq('tokenHash', tokenHash)).unique()
    if (existing) {
      throw new ConvexError({ code: 'VALIDATION_ERROR', message: 'Generate a new token and try again.' })
    }
    return await ctx.db.insert('agentTokens', { userId: user._id, name, tokenHash, tokenPrefix: args.token.slice(0, 12), createdAt: Date.now(), expiresAt: args.expiresAt })
  },
})

export const revoke = mutation({
  args: { tokenId: v.id('agentTokens') },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const credential = await ctx.db.get(args.tokenId)
    if (!credential || credential.userId !== user._id) {
      throw new ConvexError({ code: 'FORBIDDEN', message: 'You can only revoke your own agent tokens.' })
    }
    if (credential.revokedAt === undefined) await ctx.db.patch(credential._id, { revokedAt: Date.now() })
  },
})
