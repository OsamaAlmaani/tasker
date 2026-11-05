import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from './_generated/server'
import { createActivity } from './lib/activity'
import {
  canWrite,
  requireCurrentUser,
  requireProjectViewAccess,
  requireProjectWriteAccess,
} from './lib/auth'
import { TOKEN_ENCRYPTION_KEY_ENV } from './lib/githubCrypto'

// GitHub state. Each Tasker user has their own personal token; a project only
// stores which repository it tracks. GitHub network calls live in
// `githubActions.ts`; this module owns persistence and permission checks.

async function getConnectionRow(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) {
  return await ctx.db
    .query('githubConnections')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
}

async function getRepositoryLink(ctx: QueryCtx | MutationCtx, projectId: Id<'projects'>) {
  return await ctx.db
    .query('githubRepositoryLinks')
    .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
    .unique()
}

function isEncryptionConfigured() {
  return Boolean(process.env[TOKEN_ENCRYPTION_KEY_ENV])
}

/** Safe metadata for the UI. Never includes the token. */
function accountSummary(connection: Doc<'githubConnections'> | null) {
  return connection
    ? {
        login: connection.githubLogin,
        avatarUrl: connection.githubAvatarUrl ?? null,
        profileUrl: connection.githubProfileUrl ?? null,
        scopes: connection.scopes,
        connectedAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      }
    : null
}

/** The signed-in user's own GitHub connection. */
export const getAccount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    return {
      encryptionConfigured: isEncryptionConfigured(),
      account: accountSummary(await getConnectionRow(ctx, user._id)),
    }
  },
})

/** Project GitHub page state: the linked repository plus the viewer's own account. */
export const getIntegration = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.projectId))) return null
    const { user, project } = await requireProjectViewAccess(ctx, args.projectId)
    const link = await getRepositoryLink(ctx, args.projectId)
    const linkedBy = link ? await ctx.db.get(link.linkedBy) : null

    return {
      project: {
        _id: project._id,
        key: project.key,
        name: project.name,
        color: project.color ?? null,
        archived: project.archived,
      },
      canManage: canWrite(user.globalRole),
      encryptionConfigured: isEncryptionConfigured(),
      account: accountSummary(await getConnectionRow(ctx, user._id)),
      repository: link
        ? {
            owner: link.owner,
            name: link.name,
            fullName: link.fullName,
            htmlUrl: link.htmlUrl,
            defaultBranch: link.defaultBranch,
            private: link.private,
            linkedAt: link.linkedAt,
            linkedByName: linkedBy?.name ?? null,
            liveVersion: link.liveVersion ?? 0,
            webhookActive: Boolean(link.webhook),
          }
        : null,
    }
  },
})

/** Deletes the signed-in user's stored token. Other users are unaffected. */
export const disconnectAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const connection = await getConnectionRow(ctx, user._id)
    if (connection) await ctx.db.delete(connection._id)
    return null
  },
})

export const unlinkRepository = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const link = await getRepositoryLink(ctx, args.projectId)
    if (!link) return null
    await ctx.db.delete(link._id)
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: link._id,
      action: 'github.repo_unlinked',
      metadata: { repository: link.fullName },
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Internal helpers for actions. Actions run these with the caller's auth, so
// they only ever load the signed-in user's own token.

export type GitHubAccessContext = {
  connection: Doc<'githubConnections'> | null
  repository: Doc<'githubRepositoryLinks'> | null
  projectKey: string
}

export const resolveAccess = internalQuery({
  args: {
    projectId: v.id('projects'),
    level: v.union(v.literal('view'), v.literal('write')),
  },
  handler: async (ctx, args): Promise<GitHubAccessContext> => {
    const { user, project } =
      args.level === 'write'
        ? await requireProjectWriteAccess(ctx, args.projectId)
        : await requireProjectViewAccess(ctx, args.projectId)
    return {
      connection: await getConnectionRow(ctx, user._id),
      repository: await getRepositoryLink(ctx, args.projectId),
      projectKey: project.key,
    }
  },
})

export const getOwnConnection = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<'githubConnections'> | null> => {
    const user = await requireCurrentUser(ctx)
    return await getConnectionRow(ctx, user._id)
  },
})

export const saveConnection = internalMutation({
  args: {
    accessToken: v.string(),
    scopes: v.array(v.string()),
    githubUserId: v.number(),
    githubLogin: v.string(),
    githubAvatarUrl: v.optional(v.string()),
    githubProfileUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const now = Date.now()
    const existing = await getConnectionRow(ctx, user._id)
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now })
    } else {
      await ctx.db.insert('githubConnections', {
        userId: user._id,
        ...args,
        createdAt: now,
        updatedAt: now,
      })
    }
    return null
  },
})

export const setRepository = internalMutation({
  args: {
    projectId: v.id('projects'),
    repository: v.object({
      repositoryId: v.number(),
      owner: v.string(),
      name: v.string(),
      fullName: v.string(),
      htmlUrl: v.string(),
      defaultBranch: v.string(),
      private: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    const now = Date.now()
    const fields = { ...args.repository, linkedBy: user._id, linkedAt: now }
    const existing = await getRepositoryLink(ctx, args.projectId)
    let linkId: Id<'githubRepositoryLinks'>
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      linkId = existing._id
    } else {
      linkId = await ctx.db.insert('githubRepositoryLinks', { projectId: args.projectId, ...fields })
    }
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: linkId,
      action: 'github.repo_linked',
      metadata: { repository: args.repository.fullName },
    })
    return null
  },
})

export const recordPullRequestActivity = internalMutation({
  args: {
    projectId: v.id('projects'),
    action: v.union(
      v.literal('github.pr_merged'),
      v.literal('github.pr_closed'),
      v.literal('github.pr_reopened'),
    ),
    repository: v.string(),
    number: v.number(),
    title: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProjectWriteAccess(ctx, args.projectId)
    await createActivity(ctx, {
      actorId: user._id,
      projectId: args.projectId,
      entityType: 'github',
      entityId: `${args.repository}#${args.number}`,
      action: args.action,
      metadata: {
        repository: args.repository,
        number: args.number,
        title: args.title,
        url: args.url,
      },
    })
    return null
  },
})
