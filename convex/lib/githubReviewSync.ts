import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { normalizeReviewTaskSettings } from './githubReviewTasks'

// Task -> GitHub direction of review thread sync. Kept apart from
// `githubReviewTasks.ts` so `issues.ts` can call it without an import cycle.

/**
 * Schedules resolving (or reopening) the GitHub conversations of `fix` review
 * tasks whose done state changed, using the acting user's own token. Threads
 * already in the matching state are skipped, which also stops echoes when the
 * change came from GitHub in the first place.
 */
export async function queueReviewThreadSync(
  ctx: MutationCtx,
  args: { issueIds: Id<'issues'>[]; done: boolean; userId: Id<'users'> },
) {
  for (const issueId of args.issueIds) {
    const links = await ctx.db
      .query('githubReviewThreadLinks')
      .withIndex('by_issueId', (q) => q.eq('issueId', issueId))
      .collect()
    for (const link of links) {
      if (link.kind !== 'fix' || link.isResolved === args.done) continue
      const repository = await ctx.db
        .query('githubRepositoryLinks')
        .withIndex('by_projectId', (q) => q.eq('projectId', link.projectId))
        .unique()
      if (!repository || repository.repositoryId !== link.repositoryId) continue
      if (!normalizeReviewTaskSettings(repository.reviewTaskSettings).resolveThreadOnDone) continue
      await ctx.scheduler.runAfter(0, internal.githubReviewTaskActions.syncThreadResolution, {
        linkId: link._id,
        userId: args.userId,
        resolved: args.done,
      })
    }
  }
}
