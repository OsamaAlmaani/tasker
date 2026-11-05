import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { decryptSecret, getEncryptionKey } from './githubCrypto'

// Loads the caller's own GitHub token for a project action. Shared by every
// action module that calls GitHub.

export function invalidInput(message: string) {
  return new ConvexError({ code: 'INVALID_INPUT', message })
}

export function notConnected() {
  return new ConvexError({
    code: 'GITHUB_NOT_CONNECTED',
    message: 'Connect your GitHub account with a personal access token first.',
  })
}

export async function decryptToken(connection: Doc<'githubConnections'>) {
  return await decryptSecret(await getEncryptionKey(), connection.accessToken)
}

export type LinkedGitHubClient = {
  token: string
  repository: Doc<'githubRepositoryLinks'>
}

export async function loadLinkedClient(
  ctx: ActionCtx,
  projectId: Id<'projects'>,
  level: 'view' | 'write',
): Promise<LinkedGitHubClient> {
  const { connection, repository } = await ctx.runQuery(internal.github.resolveAccess, {
    projectId,
    level,
  })
  if (!repository) {
    throw new ConvexError({
      code: 'GITHUB_REPO_NOT_LINKED',
      message: 'Link a GitHub repository to this project first.',
    })
  }
  if (!connection) throw notConnected()
  return { token: await decryptToken(connection), repository }
}

export function repoPath(repository: LinkedGitHubClient['repository']) {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
}
