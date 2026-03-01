import { ConvexError } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { GlobalRole } from '../constants'

type Ctx = QueryCtx | MutationCtx

function unauthorized(
  message = 'You must be signed in and have a valid Convex Clerk token (template: "convex").',
) {
  return new ConvexError({ code: 'UNAUTHORIZED', message })
}

function forbidden(message = 'You do not have permission to perform this action.') {
  return new ConvexError({ code: 'FORBIDDEN', message })
}

function notFound(message = 'The requested resource was not found.') {
  return new ConvexError({ code: 'NOT_FOUND', message })
}

export async function requireAuth(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity?.subject) {
    throw unauthorized()
  }
  return identity
}

export async function requireCurrentUser(ctx: Ctx) {
  const identity = await requireAuth(ctx)
  const user = await ctx.db
    .query('users')
    .withIndex('by_clerkUserId', (q) => q.eq('clerkUserId', identity.subject))
    .unique()

  if (!user) {
    throw unauthorized('Your account is not provisioned yet. Please refresh and try again.')
  }

  if (!user.isActive) {
    throw forbidden('Your account is currently deactivated.')
  }

  return user
}

export function isAdmin(role: GlobalRole) {
  return role === 'admin'
}

export function canWrite(role: GlobalRole) {
  return role === 'admin' || role === 'member'
}

export async function requireAdmin(ctx: Ctx) {
  const user = await requireCurrentUser(ctx)
  if (!isAdmin(user.globalRole)) {
    throw forbidden('Admin access is required for this operation.')
  }
  return user
}

export async function getProjectMembership(
  ctx: Ctx,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
) {
  return await ctx.db
    .query('projectMembers')
    .withIndex('by_projectId_userId', (q) =>
      q.eq('projectId', projectId).eq('userId', userId),
    )
    .unique()
}

export async function getAccessibleProjectIds(ctx: Ctx, userId: Id<'users'>) {
  const memberships = await ctx.db
    .query('projectMembers')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect()

  const createdProjects = await ctx.db
    .query('projects')
    .withIndex('by_createdBy', (q) => q.eq('createdBy', userId))
    .collect()

  const ids = new Set<Id<'projects'>>()
  for (const membership of memberships) {
    ids.add(membership.projectId)
  }
  for (const project of createdProjects) {
    ids.add(project._id)
  }

  return [...ids]
}

export async function requireProjectViewAccess(ctx: Ctx, projectId: Id<'projects'>) {
  const user = await requireCurrentUser(ctx)
  const project = await ctx.db.get(projectId)

  if (!project) {
    throw notFound('Project not found.')
  }

  if (isAdmin(user.globalRole)) {
    return { user, project, membership: null }
  }

  if (project.createdBy === user._id) {
    return { user, project, membership: null }
  }

  const membership = await getProjectMembership(ctx, projectId, user._id)
  if (!membership) {
    throw forbidden('You do not have access to this project.')
  }

  return { user, project, membership }
}

export async function requireProjectWriteAccess(ctx: Ctx, projectId: Id<'projects'>) {
  const { user, project, membership } = await requireProjectViewAccess(ctx, projectId)

  if (!canWrite(user.globalRole)) {
    throw forbidden('This project is read-only for your role.')
  }

  return { user, project, membership }
}

export async function requireProjectMemberManagementAccess(
  ctx: Ctx,
  projectId: Id<'projects'>,
) {
  const { user, project, membership } = await requireProjectWriteAccess(ctx, projectId)

  if (isAdmin(user.globalRole)) {
    return { user, project, membership }
  }

  if (!project.allowMemberInvites) {
    throw forbidden('Only admins can manage members in this project.')
  }

  return { user, project, membership }
}

export async function requireProjectIssueDeleteAccess(
  ctx: Ctx,
  projectId: Id<'projects'>,
) {
  const { user, project, membership } = await requireProjectWriteAccess(ctx, projectId)

  if (isAdmin(user.globalRole)) {
    return { user, project, membership }
  }

  if (!project.allowIssueDelete) {
    throw forbidden('Issue deletion is restricted for this project.')
  }

  return { user, project, membership }
}

export async function requireIssueViewAccess(ctx: Ctx, issueId: Id<'issues'>) {
  const issue = await ctx.db.get(issueId)
  if (!issue || issue.deletedAt) {
    throw notFound('Issue not found.')
  }

  const access = await requireProjectViewAccess(ctx, issue.projectId)
  return {
    ...access,
    issue,
  }
}

export async function requireIssueWriteAccess(ctx: Ctx, issueId: Id<'issues'>) {
  const { issue, ...access } = await requireIssueViewAccess(ctx, issueId)

  if (!canWrite(access.user.globalRole)) {
    throw forbidden('This issue is read-only for your role.')
  }

  return {
    ...access,
    issue,
  }
}
