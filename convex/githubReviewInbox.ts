import { ConvexError, v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { mutation, type MutationCtx, query } from './_generated/server'
import { requireCurrentUser, requireProjectViewAccess } from './lib/auth'

// Per-user Reviews inbox state: what has been seen, the counts behind the tab
// badge, and saved reply snippets. Nothing here comes from GitHub except the
// counts, which the user's own page computed from their own token.

/** Shown until the user saves their own snippets. */
export const DEFAULT_REPLY_SNIPPETS = [
  'Fixed in the latest push, please take another look.',
  'Good catch, thanks. Done.',
  'Tracked as a follow-up so it does not block this pull request.',
  'Could you say a bit more about what you would prefer here?',
]

const MAX_SNIPPETS = 12
const MAX_SNIPPET_LENGTH = 2000
const MAX_SEEN_PER_CALL = 200
/** Badge counts older than this are not shown. */
const BADGE_MAX_AGE = 3 * 24 * 60 * 60 * 1000

async function getState(ctx: MutationCtx, userId: Id<'users'>, projectId: Id<'projects'>) {
  return await ctx.db
    .query('githubReviewInboxStates')
    .withIndex('by_userId_projectId', (q) => q.eq('userId', userId).eq('projectId', projectId))
    .unique()
}

/** Seen markers and snippets for the signed-in user. */
export const getInboxState = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    const [state, views, preferences] = await Promise.all([
      ctx.db
        .query('githubReviewInboxStates')
        .withIndex('by_userId_projectId', (q) => q.eq('userId', user._id).eq('projectId', args.projectId))
        .unique(),
      ctx.db
        .query('githubReviewThreadViews')
        .withIndex('by_userId_projectId', (q) => q.eq('userId', user._id).eq('projectId', args.projectId))
        .collect(),
      ctx.db
        .query('githubReviewPreferences')
        .withIndex('by_userId', (q) => q.eq('userId', user._id))
        .unique(),
    ])
    return {
      seenBaselineAt: state?.seenBaselineAt ?? null,
      seen: views.map((view) => ({ threadId: view.threadId, seenAt: view.seenAt })),
      snippets: preferences ? preferences.replySnippets : DEFAULT_REPLY_SNIPPETS,
      snippetsCustomized: Boolean(preferences),
    }
  },
})

/** Counts for the Reviews tab, or null when the inbox has not loaded recently. */
export const getInboxBadge = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return null
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    const state = await ctx.db
      .query('githubReviewInboxStates')
      .withIndex('by_userId_projectId', (q) => q.eq('userId', user._id).eq('projectId', args.projectId))
      .unique()
    if (!state || Date.now() - state.countedAt > BADGE_MAX_AGE) return null
    return { attention: state.attentionCount, reviewRequests: state.reviewRequestCount }
  },
})

function assertCount(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new ConvexError({ code: 'VALIDATION_ERROR', message: 'Invalid count.' })
  }
}

/** Saves the counts the inbox computed. The first call starts the seen baseline. */
export const recordInboxCounts = mutation({
  args: { projectId: v.id('projects'), attentionCount: v.number(), reviewRequestCount: v.number() },
  handler: async (ctx, args) => {
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    assertCount(args.attentionCount)
    assertCount(args.reviewRequestCount)
    const now = Date.now()
    const state = await getState(ctx, user._id, args.projectId)
    if (!state) {
      await ctx.db.insert('githubReviewInboxStates', {
        userId: user._id,
        projectId: args.projectId,
        seenBaselineAt: now,
        attentionCount: args.attentionCount,
        reviewRequestCount: args.reviewRequestCount,
        countedAt: now,
      })
    } else if (
      state.attentionCount !== args.attentionCount ||
      state.reviewRequestCount !== args.reviewRequestCount ||
      now - state.countedAt > 60_000
    ) {
      await ctx.db.patch(state._id, {
        attentionCount: args.attentionCount,
        reviewRequestCount: args.reviewRequestCount,
        countedAt: now,
      })
    }
    return null
  },
})

/** Marks conversations as seen now. */
export const markThreadsSeen = mutation({
  args: { projectId: v.id('projects'), threadIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    if (args.threadIds.length > MAX_SEEN_PER_CALL || args.threadIds.some((id) => !id || id.length > 200)) {
      throw new ConvexError({ code: 'VALIDATION_ERROR', message: 'Invalid conversations.' })
    }
    const now = Date.now()
    for (const threadId of new Set(args.threadIds)) {
      const existing = (
        await ctx.db
          .query('githubReviewThreadViews')
          .withIndex('by_userId_threadId', (q) => q.eq('userId', user._id).eq('threadId', threadId))
          .collect()
      ).find((row) => row.projectId === args.projectId)
      if (existing) await ctx.db.patch(existing._id, { seenAt: now })
      else await ctx.db.insert('githubReviewThreadViews', { userId: user._id, projectId: args.projectId, threadId, seenAt: now })
    }
    return null
  },
})

/** Everything up to now counts as seen; per-conversation markers are cleared. */
export const markAllSeen = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { user } = await requireProjectViewAccess(ctx, args.projectId)
    const now = Date.now()
    const state = await getState(ctx, user._id, args.projectId)
    if (state) await ctx.db.patch(state._id, { seenBaselineAt: now })
    else {
      await ctx.db.insert('githubReviewInboxStates', {
        userId: user._id,
        projectId: args.projectId,
        seenBaselineAt: now,
        attentionCount: 0,
        reviewRequestCount: 0,
        countedAt: 0,
      })
    }
    const views = await ctx.db
      .query('githubReviewThreadViews')
      .withIndex('by_userId_projectId', (q) => q.eq('userId', user._id).eq('projectId', args.projectId))
      .collect()
    for (const view of views) await ctx.db.delete(view._id)
    return null
  },
})

/** Replaces the user's reply snippets. An empty list restores the defaults. */
export const saveReplySnippets = mutation({
  args: { snippets: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const snippets = [...new Set(args.snippets.map((snippet) => snippet.trim()).filter(Boolean))]
    if (snippets.length > MAX_SNIPPETS) {
      throw new ConvexError({ code: 'VALIDATION_ERROR', message: `Keep at most ${MAX_SNIPPETS} snippets.` })
    }
    if (snippets.some((snippet) => snippet.length > MAX_SNIPPET_LENGTH)) {
      throw new ConvexError({ code: 'VALIDATION_ERROR', message: 'A snippet is too long.' })
    }
    const existing = await ctx.db
      .query('githubReviewPreferences')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .unique()
    if (!snippets.length) {
      if (existing) await ctx.db.delete(existing._id)
      return null
    }
    if (existing) await ctx.db.patch(existing._id, { replySnippets: snippets, updatedAt: Date.now() })
    else await ctx.db.insert('githubReviewPreferences', { userId: user._id, replySnippets: snippets, updatedAt: Date.now() })
    return null
  },
})
