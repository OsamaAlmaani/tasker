import type { ObjectType, PropertyValidators } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'

// The UI and agent gateway invoke exactly the same authenticated business handlers.
export function defineMutation<V extends PropertyValidators, R>(definition: {
  args: V
  handler: (ctx: MutationCtx, args: ObjectType<V>) => Promise<R>
}) {
  return definition
}
export function defineQuery<V extends PropertyValidators, R>(definition: {
  args: V
  handler: (ctx: QueryCtx, args: ObjectType<V>) => Promise<R>
}) {
  return definition
}
