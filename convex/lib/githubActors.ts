import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { canWrite, getProjectMembership, isAdmin } from './auth'

// Who Tasker acts as when GitHub, not a signed-in user, causes a change.
// Shared by webhook processing and review thread sync.

/** Whether a user may see the project: admin, creator or member, and active. */
export async function canViewProject(ctx: MutationCtx, user: Doc<'users'> | null, project: Doc<'projects'>) {
  if (!user || !user.isActive) return false
  if (isAdmin(user.globalRole) || project.createdBy === user._id) return true
  return Boolean(await getProjectMembership(ctx, project._id, user._id))
}

/** Whether a user may change tasks in the project, as the UI would allow. */
export async function canActForProject(ctx: MutationCtx, user: Doc<'users'> | null, project: Doc<'projects'>) {
  return Boolean(user && canWrite(user.globalRole) && (await canViewProject(ctx, user, project)))
}

/**
 * Who automation acts as: the mapped GitHub sender when they could make the
 * change themselves, else the opted-in automation identity, else the person
 * who linked the repository. Null disables automation for this change.
 */
export async function resolveActor(
  ctx: MutationCtx,
  link: Doc<'githubRepositoryLinks'>,
  project: Doc<'projects'>,
  sender: Doc<'users'> | null,
) {
  const candidates = [
    sender,
    link.automationUserId ? await ctx.db.get(link.automationUserId) : null,
    await ctx.db.get(link.linkedBy),
  ]
  for (const candidate of candidates) {
    if (await canActForProject(ctx, candidate, project)) return candidate
  }
  return null
}
