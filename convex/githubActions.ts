import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { type ActionCtx, action } from './_generated/server'
import {
  CONVERT_TO_DRAFT_MUTATION,
  GET_PULL_REQUEST_QUERY,
  githubError,
  githubGraphql,
  githubGraphqlPartial,
  githubRenderMarkdown,
  githubRequest,
  LIST_PULL_REQUESTS_QUERY,
  MARK_READY_FOR_REVIEW_MUTATION,
  normalizePullRequestDetail,
  normalizePullRequestSummary,
  PULL_REQUEST_NODE_QUERY,
  REPLY_TO_REVIEW_THREAD_MUTATION,
  RESOLVE_REVIEW_THREAD_MUTATION,
  REVIEW_THREAD_OWNER_QUERY,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
  type PullRequestDetail,
  type PullRequestSummary,
  parseRepositoryReference,
  parseScopes,
  pullRequestStatesFor,
  type RawPullRequestDetail,
  type RawPullRequestSummary,
  type RawRepositoryMergeSettings,
} from './lib/githubApi'
import {
  decryptToken,
  invalidInput,
  type LinkedGitHubClient,
  loadLinkedClient,
  notConnected,
  repoPath,
} from './lib/githubAccess'
import { encryptSecret, getEncryptionKey } from './lib/githubCrypto'

// GitHub network calls for the project GitHub section and pull request pages.
// Every call uses the signed-in user's own token, loaded after Tasker checks
// their project access. Tokens are never shared between users.

const PULL_REQUEST_PAGE_SIZE = 25
const MAX_COMMENT_LENGTH = 60_000

const pullRequestStateFilterValidator = v.union(
  v.literal('open'),
  v.literal('closed'),
  v.literal('merged'),
  v.literal('all'),
)

function assertPullNumber(number: number) {
  if (!Number.isInteger(number) || number <= 0) {
    throw invalidInput('Pull request number must be a positive integer.')
  }
}

// ---------------------------------------------------------------------------
// Credentials

type GitHubUser = { id: number; login: string; avatar_url?: string; html_url?: string }

async function loadOwnToken(ctx: ActionCtx) {
  const connection = await ctx.runQuery(internal.github.getOwnConnection, {})
  if (!connection) throw notConnected()
  return await decryptToken(connection)
}

export const connectAccount = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ login: string }> => {
    const token = args.token.trim()
    if (!token || /\s/.test(token) || token.length > 512) {
      throw invalidInput('Paste a valid GitHub personal access token.')
    }
    // Confirm a signed-in, active Tasker user before sending the token anywhere.
    await ctx.runQuery(internal.github.getOwnConnection, {})
    const key = await getEncryptionKey()
    const { data: viewer, headers } = await githubRequest<GitHubUser>(token, 'GET', '/user')
    await ctx.runMutation(internal.github.saveConnection, {
      accessToken: await encryptSecret(key, token),
      scopes: parseScopes(headers),
      githubUserId: viewer.id,
      githubLogin: viewer.login,
      githubAvatarUrl: viewer.avatar_url,
      githubProfileUrl: viewer.html_url,
    })
    return { login: viewer.login }
  },
})

type GitHubRepository = {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  html_url: string
  default_branch: string
  private: boolean
  description: string | null
  updated_at: string
  archived?: boolean
}

/** Repositories the signed-in user's token can see. */
export const listRepositories = action({
  args: {},
  handler: async (ctx) => {
    const token = await loadOwnToken(ctx)
    const repositories: GitHubRepository[] = []
    for (let page = 1; page <= 3; page++) {
      const { data } = await githubRequest<GitHubRepository[]>(
        token,
        'GET',
        `/user/repos?per_page=100&sort=updated&page=${page}`,
      )
      repositories.push(...data)
      if (data.length < 100) break
    }
    return repositories.map((repository) => ({
      fullName: repository.full_name,
      private: repository.private,
      archived: repository.archived ?? false,
      description: repository.description ?? null,
      updatedAt: Date.parse(repository.updated_at) || 0,
    }))
  },
})

export const linkRepository = action({
  args: { projectId: v.id('projects'), repository: v.string() },
  handler: async (ctx, args): Promise<{ fullName: string }> => {
    const reference = parseRepositoryReference(args.repository)
    if (!reference) {
      throw invalidInput('Enter a repository as owner/name or a github.com URL.')
    }
    const { connection } = await ctx.runQuery(internal.github.resolveAccess, {
      projectId: args.projectId,
      level: 'write',
    })
    if (!connection) throw notConnected()
    const token = await decryptToken(connection)
    const { data } = await githubRequest<GitHubRepository>(
      token,
      'GET',
      `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}`,
    )
    await ctx.runMutation(internal.github.setRepository, {
      projectId: args.projectId,
      repository: {
        repositoryId: data.id,
        owner: data.owner.login,
        name: data.name,
        fullName: data.full_name,
        htmlUrl: data.html_url,
        defaultBranch: data.default_branch,
        private: data.private,
      },
    })
    return { fullName: data.full_name }
  },
})

// ---------------------------------------------------------------------------
// Pull request reads

export const listPullRequests = action({
  args: {
    projectId: v.id('projects'),
    state: pullRequestStateFilterValidator,
    cursor: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    repository: string
    totalCount: number
    items: PullRequestSummary[]
    nextCursor: string | null
  }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    // Keep the list when GitHub hides fields inside individual pull requests.
    const { data } = await githubGraphqlPartial<{
      repository: {
        pullRequests: {
          totalCount: number
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: Array<RawPullRequestSummary | null> | null
        }
      } | null
    }>(
      token,
      LIST_PULL_REQUESTS_QUERY,
      {
        owner: repository.owner,
        name: repository.name,
        states: pullRequestStatesFor(args.state),
        first: PULL_REQUEST_PAGE_SIZE,
        after: args.cursor ?? null,
      },
      3,
    )
    if (!data.repository) {
      throw githubError('GITHUB_NOT_FOUND', `Repository ${repository.fullName} was not found.`)
    }
    const connection = data.repository.pullRequests
    return {
      repository: repository.fullName,
      totalCount: connection.totalCount,
      items: (connection.nodes ?? [])
        .filter((node): node is RawPullRequestSummary => node !== null)
        .map(normalizePullRequestSummary),
      nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
    }
  },
})

export const getPullRequest = action({
  args: { projectId: v.id('projects'), number: v.number() },
  handler: async (ctx, args): Promise<{ repository: string; pullRequest: PullRequestDetail }> => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    // Fine-grained tokens cannot read some nested data (notably check runs),
    // so keep whatever GitHub returns below the pull request itself.
    const { data, hiddenPaths } = await githubGraphqlPartial<{
      repository: (RawRepositoryMergeSettings & { pullRequest: RawPullRequestDetail | null }) | null
    }>(
      token,
      GET_PULL_REQUEST_QUERY,
      { owner: repository.owner, name: repository.name, number: args.number },
      2,
    )
    if (!data.repository?.pullRequest) {
      throw githubError('GITHUB_NOT_FOUND', `Pull request #${args.number} was not found.`)
    }
    const { pullRequest, ...settings } = data.repository
    return {
      repository: repository.fullName,
      pullRequest: normalizePullRequestDetail(
        pullRequest,
        settings,
        hiddenPaths.map((path) => path.slice(2)),
      ),
    }
  },
})

// ---------------------------------------------------------------------------
// Pull request writes

type RestPullRequest = {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  merged: boolean
  head: { ref: string; sha: string; repo: { full_name: string } | null }
}

export const addPullRequestComment = action({
  args: { projectId: v.id('projects'), number: v.number(), body: v.string() },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const body = args.body.trim()
    if (!body) throw invalidInput('Comment cannot be empty.')
    if (body.length > MAX_COMMENT_LENGTH) throw invalidInput('Comment is too long.')
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await githubRequest(token, 'POST', `${repoPath(repository)}/issues/${args.number}/comments`, {
      body,
    })
    return null
  },
})

export const submitPullRequestReview = action({
  args: {
    projectId: v.id('projects'),
    number: v.number(),
    event: v.union(v.literal('approve'), v.literal('request_changes'), v.literal('comment')),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const body = args.body?.trim() ?? ''
    if (args.event !== 'approve' && !body) {
      throw invalidInput(
        args.event === 'request_changes'
          ? 'Explain which changes are needed.'
          : 'Review comment cannot be empty.',
      )
    }
    if (body.length > MAX_COMMENT_LENGTH) throw invalidInput('Review is too long.')
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await githubRequest(token, 'POST', `${repoPath(repository)}/pulls/${args.number}/reviews`, {
      event: args.event.toUpperCase(),
      ...(body ? { body } : {}),
    })
    return null
  },
})

export const mergePullRequest = action({
  args: {
    projectId: v.id('projects'),
    number: v.number(),
    method: v.union(v.literal('merge'), v.literal('squash'), v.literal('rebase')),
    expectedHeadSha: v.string(),
    commitTitle: v.optional(v.string()),
    commitMessage: v.optional(v.string()),
    deleteBranch: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ sha: string | null; branchDeleted: boolean; branchDeleteError: string | null }> => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const path = `${repoPath(repository)}/pulls/${args.number}`
    const { data: pullRequest } = await githubRequest<RestPullRequest>(token, 'GET', path)

    let merged: { sha?: string }
    try {
      merged = (
        await githubRequest<{ sha?: string; merged?: boolean }>(token, 'PUT', `${path}/merge`, {
          merge_method: args.method,
          // GitHub refuses the merge if new commits arrived since the user loaded the PR.
          sha: args.expectedHeadSha,
          ...(args.commitTitle?.trim() ? { commit_title: args.commitTitle.trim() } : {}),
          ...(args.commitMessage?.trim() ? { commit_message: args.commitMessage.trim() } : {}),
        })
      ).data
    } catch (error) {
      if (error instanceof ConvexError && (error.data as { status?: number }).status === 409) {
        throw githubError(
          'GITHUB_ERROR',
          'New commits were pushed since you loaded this pull request. Refresh and review them before merging.',
          409,
        )
      }
      throw error
    }

    await ctx.runMutation(internal.github.recordPullRequestActivity, {
      projectId: args.projectId,
      action: 'github.pr_merged',
      repository: repository.fullName,
      number: args.number,
      title: pullRequest.title,
      url: pullRequest.html_url,
    })

    let branchDeleted = false
    let branchDeleteError: string | null = null
    if (args.deleteBranch) {
      if (pullRequest.head.repo?.full_name !== repository.fullName) {
        branchDeleteError = 'The branch lives in a fork, so Tasker did not delete it.'
      } else if (pullRequest.head.ref === repository.defaultBranch) {
        branchDeleteError = 'The default branch is never deleted.'
      } else {
        try {
          const ref = pullRequest.head.ref.split('/').map(encodeURIComponent).join('/')
          await githubRequest(token, 'DELETE', `${repoPath(repository)}/git/refs/heads/${ref}`)
          branchDeleted = true
        } catch (error) {
          branchDeleteError =
            error instanceof ConvexError
              ? ((error.data as { message?: string }).message ?? 'Branch deletion failed.')
              : 'Branch deletion failed.'
        }
      }
    }

    return { sha: merged.sha ?? null, branchDeleted, branchDeleteError }
  },
})

export const setPullRequestState = action({
  args: {
    projectId: v.id('projects'),
    number: v.number(),
    state: v.union(v.literal('open'), v.literal('closed')),
  },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const { data } = await githubRequest<RestPullRequest>(
      token,
      'PATCH',
      `${repoPath(repository)}/pulls/${args.number}`,
      { state: args.state },
    )
    await ctx.runMutation(internal.github.recordPullRequestActivity, {
      projectId: args.projectId,
      action: args.state === 'closed' ? 'github.pr_closed' : 'github.pr_reopened',
      repository: repository.fullName,
      number: args.number,
      title: data.title,
      url: data.html_url,
    })
    return null
  },
})

export const updatePullRequestBranch = action({
  args: { projectId: v.id('projects'), number: v.number(), expectedHeadSha: v.string() },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await githubRequest(token, 'PUT', `${repoPath(repository)}/pulls/${args.number}/update-branch`, {
      expected_head_sha: args.expectedHeadSha,
    })
    return null
  },
})

export const setPullRequestDraft = action({
  args: { projectId: v.id('projects'), number: v.number(), draft: v.boolean() },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    // Resolve the node ID inside the linked repository instead of trusting a client ID.
    const data = await githubGraphql<{
      repository: { pullRequest: { id: string; isDraft: boolean } | null } | null
    }>(token, PULL_REQUEST_NODE_QUERY, {
      owner: repository.owner,
      name: repository.name,
      number: args.number,
    })
    const pullRequest = data.repository?.pullRequest
    if (!pullRequest) {
      throw githubError('GITHUB_NOT_FOUND', `Pull request #${args.number} was not found.`)
    }
    if (pullRequest.isDraft === args.draft) return null
    await githubGraphql(
      token,
      args.draft ? CONVERT_TO_DRAFT_MUTATION : MARK_READY_FOR_REVIEW_MUTATION,
      { id: pullRequest.id },
    )
    return null
  },
})

// ---------------------------------------------------------------------------
// Inline review conversations

const MAX_NODE_ID_LENGTH = 200

/**
 * Confirms a review thread belongs to the given pull request in the project's
 * linked repository, so a client cannot act on threads elsewhere.
 */
async function assertThreadInPullRequest(
  token: string,
  repository: LinkedGitHubClient['repository'],
  number: number,
  threadId: string,
) {
  if (!threadId || threadId.length > MAX_NODE_ID_LENGTH) {
    throw invalidInput('That conversation could not be found.')
  }
  const data = await githubGraphql<{
    node: { id?: string; pullRequest?: { number: number; repository: { nameWithOwner: string } } } | null
  }>(token, REVIEW_THREAD_OWNER_QUERY, { id: threadId })
  const pullRequest = data.node?.pullRequest
  if (
    !pullRequest ||
    pullRequest.number !== number ||
    pullRequest.repository.nameWithOwner.toLowerCase() !== repository.fullName.toLowerCase()
  ) {
    throw githubError('GITHUB_NOT_FOUND', 'That conversation is not part of this pull request.')
  }
}

export const replyToReviewThread = action({
  args: { projectId: v.id('projects'), number: v.number(), threadId: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const body = args.body.trim()
    if (!body) throw invalidInput('Reply cannot be empty.')
    if (body.length > MAX_COMMENT_LENGTH) throw invalidInput('Reply is too long.')
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await assertThreadInPullRequest(token, repository, args.number, args.threadId)
    await githubGraphql(token, REPLY_TO_REVIEW_THREAD_MUTATION, { threadId: args.threadId, body })
    return null
  },
})

export const setReviewThreadResolved = action({
  args: {
    projectId: v.id('projects'),
    number: v.number(),
    threadId: v.string(),
    resolved: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertPullNumber(args.number)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await assertThreadInPullRequest(token, repository, args.number, args.threadId)
    await githubGraphql(
      token,
      args.resolved ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION,
      { threadId: args.threadId },
    )
    return null
  },
})

/** Renders a draft comment the way GitHub will show it. */
export const previewMarkdown = action({
  args: { projectId: v.id('projects'), body: v.string() },
  handler: async (ctx, args): Promise<{ html: string }> => {
    if (args.body.length > MAX_COMMENT_LENGTH) throw invalidInput('Comment is too long.')
    if (!args.body.trim()) return { html: '' }
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    return { html: await githubRenderMarkdown(token, args.body, repository.fullName) }
  },
})
