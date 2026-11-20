import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, internalQuery } from './_generated/server'

// Cache of C# index entries for deep workflow analysis
// (convex/lib/workflowDeepAnalysis.ts). Internal only: nothing here is
// reachable from the client, and the deep analysis action reads entries
// only for blob SHAs the caller's own token just listed. Entries hold
// derived identifiers, never source text.

const DAY = 24 * 60 * 60 * 1000
/** `usedAt` is refreshed at most this often, so reads rarely write. */
const TOUCH_AFTER = 7 * DAY
/** Entries unused for this long are deleted by the daily cron. */
const KEEP_FOR = 30 * DAY
const PRUNE_BATCH = 500

export const getEntries = internalQuery({
  args: { repositoryId: v.number(), version: v.number(), blobShas: v.array(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const entries: Array<{ id: string; blobSha: string; data: string; stale: boolean }> = []
    for (const blobSha of args.blobShas) {
      const row = await ctx.db
        .query('githubCsharpIndex')
        .withIndex('by_repositoryId_blobSha', (q) => q.eq('repositoryId', args.repositoryId).eq('blobSha', blobSha))
        .first()
      if (!row || row.version !== args.version) continue
      entries.push({ id: row._id, blobSha, data: row.data, stale: row.usedAt < now - TOUCH_AFTER })
    }
    return entries
  },
})

export const putEntries = internalMutation({
  args: {
    repositoryId: v.number(),
    version: v.number(),
    entries: v.array(v.object({ blobSha: v.string(), data: v.string() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query('githubCsharpIndex')
        .withIndex('by_repositoryId_blobSha', (q) => q.eq('repositoryId', args.repositoryId).eq('blobSha', entry.blobSha))
        .first()
      if (existing) {
        if (existing.version !== args.version) {
          await ctx.db.patch(existing._id, { version: args.version, data: entry.data, usedAt: now })
        }
        continue
      }
      await ctx.db.insert('githubCsharpIndex', {
        repositoryId: args.repositoryId,
        blobSha: entry.blobSha,
        version: args.version,
        data: entry.data,
        usedAt: now,
      })
    }
  },
})

export const touchEntries = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const id of args.ids) {
      const normalized = ctx.db.normalizeId('githubCsharpIndex', id)
      if (!normalized) continue
      const row = await ctx.db.get(normalized)
      if (row) await ctx.db.patch(row._id, { usedAt: now })
    }
  },
})

export const pruneUnused = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('githubCsharpIndex')
      .withIndex('by_usedAt', (q) => q.lt('usedAt', Date.now() - KEEP_FOR))
      .take(PRUNE_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.githubCsharpIndex.pruneUnused, {})
  },
})
