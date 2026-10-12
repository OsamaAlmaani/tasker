import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export async function pauseGithubSync(ctx: MutationCtx, issueId: Id<'issues'>) {
  const link = await ctx.db.query('githubLinks').withIndex('by_issueId', q => q.eq('issueId', issueId)).unique()
  if (link?.syncEnabled) {
    await ctx.db.patch(link._id, {
      syncEnabled: false,
      syncLease: undefined,
      syncLeaseUntil: undefined,
      pauseReason: 'Paused after a task status change. Resume to follow GitHub again.',
      updatedAt: Date.now(),
    })
  }
}
