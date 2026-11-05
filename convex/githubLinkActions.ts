import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { type ActionCtx, action } from './_generated/server'
import { decryptToken, invalidInput, loadLinkedClient, notConnected, repoPath } from './lib/githubAccess'
import {
  githubError,
  githubGraphqlPartial,
  githubRequest,
  normalizePullRequestSummary,
  PULL_REQUEST_SUMMARY_FIELDS,
  type PullRequestSummary,
  type RawPullRequestSummary,
} from './lib/githubApi'
import { generateWebhookSecret } from './lib/githubAutomation'
import { encryptSecret, getEncryptionKey } from './lib/githubCrypto'
import { linkCandidatesFromSummaries, type RestPullRequestLike, snapshotFromRest } from './lib/githubLinkSync'
import { renderBranchName, renderTemplate, sanitizeBranchName, type TemplateContext } from './lib/githubReferences'

// GitHub calls a user makes for a task: linking, creating branches and pull
// requests, live summaries and the repository access check. Webhook
// registration lives here too because it uses the registering user's token.

const WEBHOOK_EVENTS = ['pull_request', 'pull_request_review', 'push', 'check_suite', 'workflow_run']
const MAX_LINKED_PULL_REQUESTS = 20

function appBaseUrl() {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

type IssueContext = Awaited<ReturnType<typeof loadIssueContext>>

async function loadIssueContext(ctx: ActionCtx, issueId: Id<'issues'>, level: 'view' | 'write') {
  const context = await ctx.runQuery(internal.githubLinks.getIssueContext, { issueId, level })
  if (!context.repository) {
    throw new ConvexError({
      code: 'GITHUB_REPO_NOT_LINKED',
      message: 'Link a GitHub repository to this project first.',
    })
  }
  if (!context.connection) throw notConnected()
  const token = await decryptToken(context.connection)
  return { ...context, repository: context.repository, token }
}

function templateContext(context: IssueContext): TemplateContext {
  return {
    projectKey: context.project.key,
    issueNumber: context.issue.issueNumber,
    title: context.issue.title,
    description: context.issue.description,
    checklistItems: context.issue.checklistItems,
    url: `${appBaseUrl()}/issues/${context.issue._id}`,
    login: context.connection?.githubLogin ?? null,
  }
}

function webhookEndpoint() {
  const explicit = process.env.GITHUB_WEBHOOK_URL
  if (explicit) return explicit
  const site = process.env.CONVEX_SITE_URL
  return site ? `${site.replace(/\/$/, '')}/github/webhook` : null
}

/** Records whether the caller's own token can read the linked repository. */
export const verifyRepositoryAccess = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ canRead: boolean }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    let canRead = false
    try {
      const { data } = await githubRequest<{ id: number }>(token, 'GET', repoPath(repository))
      canRead = data.id === repository.repositoryId
    } catch (error) {
      const status = error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
      if (status !== 403 && status !== 404) throw error
    }
    await ctx.runMutation(internal.githubLinks.recordRepositoryAccess, {
      repositoryId: repository.repositoryId,
      canRead,
    })
    return { canRead }
  },
})

/** Pre-rendered branch name, title and body for the create dialogs. */
export const renderTemplates = action({
  args: { issueId: v.id('issues') },
  handler: async (ctx, args): Promise<{ branchName: string; title: string; body: string; defaultBranch: string }> => {
    const context = await loadIssueContext(ctx, args.issueId, 'view')
    const vars = templateContext(context)
    return {
      branchName: renderBranchName(context.templates.branch, vars),
      title: renderTemplate(context.templates.pullRequestTitle, vars),
      body: renderTemplate(context.templates.pullRequestBody, vars),
      defaultBranch: context.repository.defaultBranch,
    }
  },
})

/** Live summaries of a task's linked pull requests, read with the caller's token. */
export const getIssuePullRequests = action({
  args: { issueId: v.id('issues') },
  handler: async (ctx, args): Promise<{ items: PullRequestSummary[] }> => {
    const context = await loadIssueContext(ctx, args.issueId, 'view')
    const numbers = context.pullNumbers.slice(0, MAX_LINKED_PULL_REQUESTS)
    if (!numbers.length) return { items: [] }
    const fields = numbers
      .map(
        (number, index) =>
          `pr${index}: pullRequest(number: ${number}) { ${PULL_REQUEST_SUMMARY_FIELDS} commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`,
      )
      .join('\n')
    const query = `query TaskerIssuePullRequests($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
    const { data } = await githubGraphqlPartial<{ repository: Record<string, RawPullRequestSummary | null> | null }>(
      context.token,
      query,
      { owner: context.repository.owner, name: context.repository.name },
      2,
    )
    if (!data.repository) {
      throw githubError('GITHUB_NOT_FOUND', `Repository ${context.repository.fullName} was not found.`)
    }
    const items = Object.values(data.repository)
      .filter((node): node is RawPullRequestSummary => Boolean(node))
      .map(normalizePullRequestSummary)
    await ctx.runMutation(internal.githubLinks.syncPullRequestLinks, {
      projectId: context.project._id,
      source: 'title',
      items: linkCandidatesFromSummaries(items, context.project.key),
    })
    await ctx.runMutation(internal.githubLinks.recordRepositoryAccess, {
      repositoryId: context.repository.repositoryId,
      canRead: true,
    })
    return { items }
  },
})

/** Links an existing pull request to a task after confirming it exists. */
export const linkPullRequest = action({
  args: { issueId: v.id('issues'), pullNumber: v.number() },
  handler: async (ctx, args): Promise<{ created: number }> => {
    if (!Number.isInteger(args.pullNumber) || args.pullNumber <= 0) {
      throw invalidInput('Pull request number must be a positive integer.')
    }
    const context = await loadIssueContext(ctx, args.issueId, 'write')
    const { data } = await githubRequest<RestPullRequestLike>(
      context.token,
      'GET',
      `${repoPath(context.repository)}/pulls/${args.pullNumber}`,
    )
    const result = await ctx.runMutation(internal.githubLinks.recordManualLink, {
      issueId: args.issueId,
      pullNumber: data.number,
      snapshot: snapshotFromRest(data),
    })
    return { created: result?.created ?? 0 }
  },
})

/** Creates a branch for the task from the repository's default branch. */
export const createBranch = action({
  args: { issueId: v.id('issues'), branchName: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ branchName: string; url: string }> => {
    const context = await loadIssueContext(ctx, args.issueId, 'write')
    const branchName = args.branchName?.trim()
      ? sanitizeBranchName(args.branchName)
      : renderBranchName(context.templates.branch, templateContext(context))
    if (!branchName) throw invalidInput('Enter a valid branch name.')
    if (branchName === context.repository.defaultBranch) {
      throw invalidInput('Choose a name other than the default branch.')
    }
    const base = context.repository.defaultBranch.split('/').map(encodeURIComponent).join('/')
    const { data: ref } = await githubRequest<{ object: { sha: string } }>(
      context.token,
      'GET',
      `${repoPath(context.repository)}/git/ref/heads/${base}`,
    )
    try {
      await githubRequest(context.token, 'POST', `${repoPath(context.repository)}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      })
    } catch (error) {
      if (error instanceof ConvexError && (error.data as { status?: number }).status === 422) {
        throw githubError('GITHUB_ERROR', `Branch ${branchName} already exists.`, 422)
      }
      throw error
    }
    const url = `${context.repository.htmlUrl}/tree/${branchName.split('/').map(encodeURIComponent).join('/')}`
    await ctx.runMutation(internal.githubLinks.recordCreatedBranch, { issueId: args.issueId, branchName, url })
    return { branchName, url }
  },
})

/** Opens a pull request for the task and links it. */
export const createPullRequest = action({
  args: {
    issueId: v.id('issues'),
    head: v.string(),
    base: v.optional(v.string()),
    title: v.string(),
    body: v.optional(v.string()),
    draft: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ number: number; url: string }> => {
    const head = args.head.trim()
    const title = args.title.trim()
    if (!head) throw invalidInput('Choose the branch with your changes.')
    if (!title) throw invalidInput('Give the pull request a title.')
    if (title.length > 256) throw invalidInput('Pull request title is too long.')
    if ((args.body ?? '').length > 60_000) throw invalidInput('Pull request description is too long.')
    const context = await loadIssueContext(ctx, args.issueId, 'write')
    const base = args.base?.trim() || context.repository.defaultBranch
    if (head === base) throw invalidInput('The head and base branches must differ.')
    const { data } = await githubRequest<RestPullRequestLike>(
      context.token,
      'POST',
      `${repoPath(context.repository)}/pulls`,
      { title, head, base, body: args.body ?? '', draft: args.draft ?? false },
    )
    await ctx.runMutation(internal.githubLinks.recordCreatedPullRequest, {
      issueId: args.issueId,
      pullNumber: data.number,
      snapshot: snapshotFromRest(data),
    })
    return { number: data.number, url: data.html_url }
  },
})

// ---------------------------------------------------------------------------
// Webhooks

/** Registers a webhook on the repository with the caller's token. */
export const registerWebhook = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ hookId: number }> => {
    const endpoint = webhookEndpoint()
    if (!endpoint) {
      throw new ConvexError({
        code: 'CONFIG_ERROR',
        message: 'Set CONVEX_SITE_URL or GITHUB_WEBHOOK_URL on the Convex deployment before registering webhooks.',
      })
    }
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    const secret = generateWebhookSecret()
    let hookId: number
    try {
      const { data } = await githubRequest<{ id: number }>(token, 'POST', `${repoPath(repository)}/hooks`, {
        name: 'web',
        active: true,
        events: WEBHOOK_EVENTS,
        config: { url: endpoint, content_type: 'json', secret, insecure_ssl: '0' },
      })
      hookId = data.id
    } catch (error) {
      const status = error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
      if (status === 403 || status === 404) {
        throw githubError(
          'GITHUB_FORBIDDEN',
          'Your token cannot manage webhooks on this repository. Grant it the "Webhooks" repository permission, or use manual setup.',
          status,
        )
      }
      throw error
    }
    await ctx.runMutation(internal.githubWebhooks.saveWebhook, {
      projectId: args.projectId,
      hookId,
      secret: await encryptSecret(await getEncryptionKey(), secret),
      url: endpoint,
    })
    return { hookId }
  },
})

/** Generates a secret for a webhook the user creates on GitHub by hand. Returned once. */
export const createManualWebhook = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ url: string; secret: string; events: string[] }> => {
    const endpoint = webhookEndpoint()
    if (!endpoint) {
      throw new ConvexError({
        code: 'CONFIG_ERROR',
        message: 'Set CONVEX_SITE_URL or GITHUB_WEBHOOK_URL on the Convex deployment before setting up webhooks.',
      })
    }
    await loadLinkedClient(ctx, args.projectId, 'write')
    const secret = generateWebhookSecret()
    await ctx.runMutation(internal.githubWebhooks.saveWebhook, {
      projectId: args.projectId,
      hookId: null,
      secret: await encryptSecret(await getEncryptionKey(), secret),
      url: endpoint,
    })
    return { url: endpoint, secret, events: WEBHOOK_EVENTS }
  },
})

export const removeWebhook = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ removedFromGitHub: boolean }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    let removedFromGitHub = false
    if (repository.webhook?.hookId) {
      try {
        await githubRequest(token, 'DELETE', `${repoPath(repository)}/hooks/${repository.webhook.hookId}`)
        removedFromGitHub = true
      } catch (error) {
        const status = error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
        if (status !== 404) throw error
      }
    }
    await ctx.runMutation(internal.githubWebhooks.clearWebhook, { projectId: args.projectId })
    return { removedFromGitHub }
  },
})
