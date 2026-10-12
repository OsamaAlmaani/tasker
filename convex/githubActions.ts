'use node'

import { randomUUID } from 'node:crypto'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, internalAction, type ActionCtx } from './_generated/server'
import { parseRepository, validateBranchName } from './lib/github'
import { createAppJwt, GithubClient, installationClient, repoPath } from './lib/githubClient'

type Preparation = { link: Doc<'githubLinks'>; connection: Doc<'githubConnections'> }

function errorMessage(cause: unknown) {
  if (cause instanceof ConvexError && typeof cause.data === 'object' && cause.data?.message) return String(cause.data.message).slice(0, 500)
  return cause instanceof Error ? cause.message.slice(0, 500) : 'GitHub could not complete this request. Try again.'
}

export const connectRepository = action({
  args: { projectId: v.id('projects'), repository: v.string(), baseBranch: v.optional(v.string()), workStatus: v.string(), reviewStatus: v.string() },
  handler: async (ctx, args): Promise<Id<'githubConnections'>> => {
    const { connectionVersion: expectedVersion } = await ctx.runQuery(internal.github.authorizeConnection, { projectId: args.projectId })
    if (!process.env.GITHUB_WEBHOOK_SECRET) throw new ConvexError({ code: 'CONFIG_ERROR', message: 'The GitHub App webhook secret is not configured on this deployment.' })
    const { owner, repo } = parseRepository(args.repository)
    try {
      const installation = await new GithubClient(createAppJwt()).request<{ id: number; suspended_at: string | null; permissions: { contents?: string; pull_requests?: string } }>(`${repoPath(owner, repo)}/installation`)
      if (installation.suspended_at || installation.permissions.contents !== 'write' || !['read', 'write'].includes(installation.permissions.pull_requests ?? '')) {
        throw new Error('Install or update the GitHub App with Contents write and Pull requests read permissions.')
      }
      // Discover metadata with a read-only token, then restrict the write token to this repository ID.
      const discovery = await installationClient(installation.id)
      const repository = await discovery.request<{ id: number; owner: { login: string }; name: string; default_branch: string; archived: boolean; disabled: boolean }>(repoPath(owner, repo))
      if (repository.archived || repository.disabled) throw new Error('Choose an active GitHub repository.')
      const baseBranch = validateBranchName(args.baseBranch || repository.default_branch)
      const client = await installationClient(installation.id, repository.id)
      if (!await client.branchSha(repository.owner.login, repository.name, baseBranch)) throw new Error('The base branch was not found. Initialize the repository or choose another branch.')
      return await ctx.runMutation(internal.github.saveConnection, {
        projectId: args.projectId, expectedVersion, owner: repository.owner.login, repo: repository.name,
        repositoryId: repository.id, installationId: installation.id, baseBranch,
        workStatus: args.workStatus, reviewStatus: args.reviewStatus,
      })
    } catch (cause) {
      throw new ConvexError({ code: 'GITHUB_ERROR', message: errorMessage(cause) })
    }
  },
})

export const createBranch = action({
  args: { issueId: v.id('issues'), branch: v.string(), baseBranch: v.string(), mode: v.union(v.literal('create'), v.literal('link')) },
  handler: async (ctx, args): Promise<Id<'githubLinks'>> => {
    const attempt = randomUUID()
    const prep: Preparation = await ctx.runMutation(internal.github.reserveBranch, { ...args, attempt })
    let remoteCreated = false
    try {
      const client = await installationClient(prep.connection.installationId, prep.connection.repositoryId)
      const { owner, repo } = prep.connection
      const baseSha = await client.branchSha(owner, repo, args.baseBranch)
      if (!baseSha) throw new Error('The base branch was not found in GitHub.')
      const exists = await client.branchSha(owner, repo, args.branch)
      if (args.mode === 'create') {
        if (exists) throw new Error('This branch already exists. Use Link existing branch to associate it with this task.')
        const minimumPullNumber = await client.pullRequestBaseline(owner, repo, args.branch)
        await ctx.runMutation(internal.github.recordBranchBaseline, { linkId: prep.link._id, attempt, connectionVersion: prep.connection.version, minimumPullNumber })
        await client.createBranch(owner, repo, args.branch, baseSha)
        remoteCreated = true
      } else if (!exists) throw new Error('The branch was not found. Check its name or create a new branch.')
      return await ctx.runMutation(internal.github.finishBranch, { linkId: prep.link._id, attempt, connectionVersion: prep.connection.version })
    } catch (cause) {
      const message = remoteCreated ? `The branch was created in GitHub, but linking failed. ${errorMessage(cause)}` : errorMessage(cause)
      await ctx.runMutation(internal.github.failBranch, { linkId: prep.link._id, attempt, error: message })
      throw new ConvexError({ code: 'GITHUB_ERROR', message })
    }
  },
})

async function synchronizeLink(ctx: ActionCtx, linkId: Id<'githubLinks'>): Promise<void> {
  const nonce = randomUUID()
  const prep: Preparation | null = await ctx.runMutation(internal.github.prepareSync, { linkId, nonce })
  if (!prep) return
  try {
    const { connection, link } = prep
    const client = await installationClient(connection.installationId, connection.repositoryId)
    const snapshot = await client.snapshot({ owner: connection.owner, repo: connection.repo, repositoryId: connection.repositoryId, branch: link.branch, baseBranch: link.baseBranch, pullNumber: link.pullNumber, minimumPullNumber: link.minimumPullNumber })
    await ctx.runMutation(internal.github.finishSync, { linkId, nonce, connectionVersion: connection.version, snapshot })
  } catch (cause) {
    const message = errorMessage(cause)
    await ctx.runMutation(internal.github.failSync, { linkId, nonce, error: message })
    throw new ConvexError({ code: 'GITHUB_ERROR', message })
  }
}

export const refreshIssue = action({
  args: { issueId: v.id('issues') },
  handler: async (ctx, { issueId }): Promise<void> => {
    const linkId: Id<'githubLinks'> = await ctx.runQuery(internal.github.authorizeIssue, { issueId })
    await synchronizeLink(ctx, linkId)
  },
})

export const synchronize = internalAction({
  args: { linkId: v.id('githubLinks') },
  handler: async (ctx, { linkId }): Promise<void> => {
    await synchronizeLink(ctx, linkId)
  },
})
