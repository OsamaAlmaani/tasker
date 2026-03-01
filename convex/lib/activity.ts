import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { ActivityAction, ActivityEntityType } from '../constants'

export async function createActivity(
  ctx: MutationCtx,
  args: {
    actorId?: Id<'users'>
    projectId: Id<'projects'>
    issueId?: Id<'issues'>
    entityType: ActivityEntityType
    entityId: string
    action: ActivityAction
    metadata?: unknown
  },
) {
  await ctx.db.insert('activities', {
    actorId: args.actorId,
    projectId: args.projectId,
    issueId: args.issueId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    metadata: args.metadata,
    createdAt: Date.now(),
  })
}
