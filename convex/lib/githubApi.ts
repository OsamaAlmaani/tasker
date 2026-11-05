import { ConvexError } from 'convex/values'

// Thin GitHub REST/GraphQL client plus normalizers that turn GitHub payloads
// into the plain shapes returned to the Tasker UI. Every value uses `null`
// instead of `undefined` so it survives Convex serialization unchanged.

const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

export type GitHubErrorCode =
  | 'GITHUB_UNAUTHORIZED'
  | 'GITHUB_FORBIDDEN'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_NOT_FOUND'
  | 'GITHUB_UNAVAILABLE'
  | 'GITHUB_ERROR'

export function githubError(code: GitHubErrorCode, message: string, status?: number) {
  return new ConvexError({ code, message, ...(status ? { status } : {}) })
}

type GitHubErrorBody = {
  message?: string
  errors?: Array<{ message?: string; code?: string; field?: string } | string>
}

function describeGitHubErrorBody(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const { message, errors } = body as GitHubErrorBody
  const details = (errors ?? [])
    .map((entry) =>
      typeof entry === 'string' ? entry : entry.message ?? [entry.field, entry.code].filter(Boolean).join(' '),
    )
    .filter(Boolean)
  return [message, ...details].filter(Boolean).join(' — ') || null
}

export function toGitHubError(status: number, headers: Headers, body: unknown) {
  const detail = describeGitHubErrorBody(body)
  if (status === 401) {
    return githubError(
      'GITHUB_UNAUTHORIZED',
      "GitHub rejected your personal access token. It may have expired or been revoked. Add a new token on the project's GitHub tab or in Settings.",
      status,
    )
  }
  if (status === 429 || (status === 403 && headers.get('x-ratelimit-remaining') === '0')) {
    const reset = Number(headers.get('x-ratelimit-reset'))
    const when = Number.isFinite(reset) && reset > 0 ? ` after ${new Date(reset * 1000).toISOString()}` : ' later'
    return githubError('GITHUB_RATE_LIMITED', `GitHub rate limit reached. Try again${when}.`, status)
  }
  if (status === 403) {
    return githubError(
      'GITHUB_FORBIDDEN',
      `GitHub denied the request${detail ? `: ${detail}` : ''}. Check that your token has access.`,
      status,
    )
  }
  if (status === 404) {
    return githubError(
      'GITHUB_NOT_FOUND',
      'Not found on GitHub, or your token cannot access it.',
      status,
    )
  }
  return githubError('GITHUB_ERROR', detail ?? `GitHub request failed (${status}).`, status)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export type GitHubResponse<T> = { data: T; headers: Headers; status: number }

export async function githubRequest<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<GitHubResponse<T>> {
  let response: Response
  try {
    response = await fetch(`${GITHUB_API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Tasker',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw githubError('GITHUB_UNAVAILABLE', 'Could not reach GitHub. Try again in a moment.')
  }
  const text = await response.text()
  const data = text ? parseJson(text) : null
  if (!response.ok) {
    throw toGitHubError(response.status, response.headers, data)
  }
  return { data: data as T, headers: response.headers, status: response.status }
}

type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{ message: string; type?: string }>
}

export async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { data } = await githubRequest<GraphqlResponse<T>>(token, 'POST', '/graphql', {
    query,
    variables,
  })
  if (data?.errors?.length) {
    const notFound = data.errors.find((error) => error.type === 'NOT_FOUND')
    if (notFound) {
      throw githubError('GITHUB_NOT_FOUND', notFound.message)
    }
    const forbidden = data.errors.find((error) => error.type === 'FORBIDDEN')
    throw githubError(
      forbidden ? 'GITHUB_FORBIDDEN' : 'GITHUB_ERROR',
      data.errors.map((error) => error.message).join(' — '),
    )
  }
  if (!data?.data) {
    throw githubError('GITHUB_ERROR', 'GitHub returned an empty response.')
  }
  return data.data
}

export function parseScopes(headers: Headers) {
  return (headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
}

const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

/** Accepts `owner/name`, a github.com URL, or a `.git` clone URL. */
export function parseRepositoryReference(input: string) {
  const trimmed = input.trim()
  const withoutHost = trimmed
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const [owner, name, ...rest] = withoutHost.split('/')
  if (
    !owner ||
    !name ||
    rest.length > 0 ||
    !REPOSITORY_NAME_PATTERN.test(owner) ||
    !REPOSITORY_NAME_PATTERN.test(name)
  ) {
    return null
  }
  return { owner, name }
}

// ---------------------------------------------------------------------------
// Normalized shapes returned to the client

export type GitHubActor = { login: string; avatarUrl: string | null; url: string | null }
export type PullRequestState = 'open' | 'closed' | 'merged'
export type PullRequestStateFilter = PullRequestState | 'all'
export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | null
export type Mergeable = 'mergeable' | 'conflicting' | 'unknown'
export type CheckState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'
export type ChecksSummary = 'success' | 'failure' | 'pending' | null
export type MergeMethod = 'merge' | 'squash' | 'rebase'

export type PullRequestSummary = {
  number: number
  title: string
  url: string
  state: PullRequestState
  isDraft: boolean
  author: GitHubActor | null
  headRefName: string
  baseRefName: string
  createdAt: number
  updatedAt: number
  closedAt: number | null
  mergedAt: number | null
  reviewDecision: ReviewDecision
  mergeable: Mergeable
  checks: ChecksSummary
  additions: number
  deletions: number
  changedFiles: number
  commentCount: number
  labels: Array<{ name: string; color: string }>
  reviewRequests: string[]
  assignees: GitHubActor[]
}

export type PullRequestCheck = {
  name: string
  state: CheckState
  url: string | null
  description: string | null
}

export type PullRequestFile = {
  path: string
  additions: number
  deletions: number
  changeType: string
}

export type PullRequestTimelineItem =
  | {
      kind: 'comment'
      id: string
      author: GitHubActor | null
      body: string
      createdAt: number
      url: string | null
    }
  | {
      kind: 'review'
      id: string
      author: GitHubActor | null
      body: string
      createdAt: number
      url: string | null
      state: string
    }

export type PullRequestDetail = PullRequestSummary & {
  nodeId: string
  body: string
  headSha: string
  headRepository: string | null
  isCrossRepository: boolean
  mergeStateStatus: string
  mergedBy: string | null
  commitCount: number
  checkRuns: PullRequestCheck[]
  files: PullRequestFile[]
  fileCount: number
  timeline: PullRequestTimelineItem[]
  repository: {
    mergeCommitAllowed: boolean
    squashMergeAllowed: boolean
    rebaseMergeAllowed: boolean
    deleteBranchOnMerge: boolean
    defaultMergeMethod: MergeMethod
    viewerPermission: string | null
  }
}

// ---------------------------------------------------------------------------
// GraphQL documents

const PULL_REQUEST_SUMMARY_FIELDS = `
  number
  title
  url
  state
  isDraft
  createdAt
  updatedAt
  closedAt
  mergedAt
  author { login avatarUrl url }
  headRefName
  baseRefName
  reviewDecision
  mergeable
  additions
  deletions
  changedFiles
  comments { totalCount }
  labels(first: 10) { nodes { name color } }
  assignees(first: 10) { nodes { login avatarUrl url } }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { name }
      }
    }
  }
`

export const LIST_PULL_REQUESTS_QUERY = `
  query TaskerPullRequests($owner: String!, $name: String!, $states: [PullRequestState!], $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: $states, first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          ${PULL_REQUEST_SUMMARY_FIELDS}
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        }
      }
    }
  }
`

export const GET_PULL_REQUEST_QUERY = `
  query TaskerPullRequest($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      deleteBranchOnMerge
      viewerDefaultMergeMethod
      viewerPermission
      pullRequest(number: $number) {
        ${PULL_REQUEST_SUMMARY_FIELDS}
        id
        body
        headRefOid
        headRepository { nameWithOwner }
        isCrossRepository
        mergeStateStatus
        mergedBy { login }
        commits(last: 1) {
          totalCount
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl title }
                    ... on StatusContext { context state targetUrl description }
                  }
                }
              }
            }
          }
        }
        files(first: 100) { totalCount nodes { path additions deletions changeType } }
        timelineComments: comments(last: 100) {
          nodes { id url body createdAt author { login avatarUrl url } }
        }
        reviews(last: 50) {
          nodes { id url body state submittedAt createdAt author { login avatarUrl url } }
        }
      }
    }
  }
`

export const PULL_REQUEST_NODE_QUERY = `
  query TaskerPullRequestNode($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { id isDraft }
    }
  }
`

export const MARK_READY_FOR_REVIEW_MUTATION = `
  mutation TaskerMarkReady($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
  }
`

export const CONVERT_TO_DRAFT_MUTATION = `
  mutation TaskerConvertToDraft($id: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } }
  }
`

export function pullRequestStatesFor(filter: PullRequestStateFilter) {
  switch (filter) {
    case 'open':
      return ['OPEN']
    case 'closed':
      return ['CLOSED']
    case 'merged':
      return ['MERGED']
    default:
      return ['OPEN', 'CLOSED', 'MERGED']
  }
}

// ---------------------------------------------------------------------------
// Normalizers

type RawActor = { login: string; avatarUrl?: string | null; url?: string | null } | null | undefined

type RawCheckContext =
  | {
      __typename: 'CheckRun'
      name: string
      status: string
      conclusion: string | null
      detailsUrl: string | null
      title?: string | null
    }
  | {
      __typename: 'StatusContext'
      context: string
      state: string
      targetUrl: string | null
      description: string | null
    }

export type RawPullRequestSummary = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  createdAt: string
  updatedAt: string
  closedAt: string | null
  mergedAt: string | null
  author: RawActor
  headRefName: string
  baseRefName: string
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  additions: number
  deletions: number
  changedFiles: number
  comments: { totalCount: number }
  labels: { nodes: Array<{ name: string; color: string } | null> | null } | null
  assignees: { nodes: Array<RawActor> | null } | null
  reviewRequests: {
    nodes: Array<{
      requestedReviewer: { __typename: string; login?: string; name?: string } | null
    } | null> | null
  } | null
  commits: {
    totalCount?: number
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: string
          contexts?: { nodes: Array<RawCheckContext | null> | null }
        } | null
      }
    } | null> | null
  }
}

export type RawPullRequestDetail = RawPullRequestSummary & {
  id: string
  body: string
  headRefOid: string
  headRepository: { nameWithOwner: string } | null
  isCrossRepository: boolean
  mergeStateStatus: string
  mergedBy: { login: string } | null
  files: {
    totalCount: number
    nodes: Array<{ path: string; additions: number; deletions: number; changeType: string } | null> | null
  } | null
  timelineComments: {
    nodes: Array<{
      id: string
      url: string | null
      body: string
      createdAt: string
      author: RawActor
    } | null> | null
  }
  reviews: {
    nodes: Array<{
      id: string
      url: string | null
      body: string
      state: string
      submittedAt: string | null
      createdAt: string
      author: RawActor
    } | null> | null
  } | null
}

export type RawRepositoryMergeSettings = {
  mergeCommitAllowed: boolean
  squashMergeAllowed: boolean
  rebaseMergeAllowed: boolean
  deleteBranchOnMerge: boolean
  viewerDefaultMergeMethod: 'MERGE' | 'SQUASH' | 'REBASE' | null
  viewerPermission: string | null
}

function compact<T>(items: Array<T | null | undefined> | null | undefined): T[] {
  return (items ?? []).filter((item): item is T => item !== null && item !== undefined)
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function normalizeActor(actor: RawActor): GitHubActor | null {
  if (!actor) return null
  return { login: actor.login, avatarUrl: actor.avatarUrl ?? null, url: actor.url ?? null }
}

export function normalizeChecksSummary(state: string | null | undefined): ChecksSummary {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return null
  }
}

export function normalizeCheckContext(context: RawCheckContext): PullRequestCheck {
  if (context.__typename === 'StatusContext') {
    const state: CheckState =
      context.state === 'SUCCESS'
        ? 'success'
        : context.state === 'FAILURE' || context.state === 'ERROR'
          ? 'failure'
          : 'pending'
    return {
      name: context.context,
      state,
      url: context.targetUrl ?? null,
      description: context.description ?? null,
    }
  }

  let state: CheckState
  if (context.status !== 'COMPLETED') {
    state = 'pending'
  } else {
    switch (context.conclusion) {
      case 'SUCCESS':
        state = 'success'
        break
      case 'NEUTRAL':
        state = 'neutral'
        break
      case 'SKIPPED':
        state = 'skipped'
        break
      default:
        // FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STALE, STARTUP_FAILURE
        state = 'failure'
    }
  }
  return {
    name: context.name,
    state,
    url: context.detailsUrl ?? null,
    description: context.title ?? null,
  }
}

const CHECK_ORDER: Record<CheckState, number> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
  skipped: 4,
}

export function normalizePullRequestSummary(raw: RawPullRequestSummary): PullRequestSummary {
  const rollup = compact(raw.commits?.nodes)[0]?.commit.statusCheckRollup
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state === 'MERGED' ? 'merged' : raw.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: raw.isDraft,
    author: normalizeActor(raw.author),
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    createdAt: toTimestamp(raw.createdAt) ?? 0,
    updatedAt: toTimestamp(raw.updatedAt) ?? 0,
    closedAt: toTimestamp(raw.closedAt),
    mergedAt: toTimestamp(raw.mergedAt),
    reviewDecision:
      raw.reviewDecision === 'APPROVED'
        ? 'approved'
        : raw.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes_requested'
          : raw.reviewDecision === 'REVIEW_REQUIRED'
            ? 'review_required'
            : null,
    mergeable:
      raw.mergeable === 'MERGEABLE'
        ? 'mergeable'
        : raw.mergeable === 'CONFLICTING'
          ? 'conflicting'
          : 'unknown',
    checks: normalizeChecksSummary(rollup?.state),
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commentCount: raw.comments?.totalCount ?? 0,
    labels: compact(raw.labels?.nodes).map((label) => ({ name: label.name, color: label.color })),
    reviewRequests: compact(raw.reviewRequests?.nodes)
      .map((request) => request.requestedReviewer?.login ?? request.requestedReviewer?.name ?? null)
      .filter((name): name is string => Boolean(name)),
    assignees: compact(raw.assignees?.nodes)
      .map((assignee) => normalizeActor(assignee))
      .filter((assignee): assignee is GitHubActor => assignee !== null),
  }
}

function normalizeMergeMethod(
  preferred: RawRepositoryMergeSettings['viewerDefaultMergeMethod'],
  settings: RawRepositoryMergeSettings,
): MergeMethod {
  const allowed: Record<MergeMethod, boolean> = {
    merge: settings.mergeCommitAllowed,
    squash: settings.squashMergeAllowed,
    rebase: settings.rebaseMergeAllowed,
  }
  const candidate = preferred ? (preferred.toLowerCase() as MergeMethod) : 'merge'
  if (allowed[candidate]) return candidate
  return (['squash', 'merge', 'rebase'] as const).find((method) => allowed[method]) ?? 'merge'
}

export function normalizePullRequestDetail(
  raw: RawPullRequestDetail,
  repository: RawRepositoryMergeSettings,
): PullRequestDetail {
  const summary = normalizePullRequestSummary(raw)
  const rollup = compact(raw.commits?.nodes)[0]?.commit.statusCheckRollup
  const checkRuns = compact(rollup?.contexts?.nodes)
    .map(normalizeCheckContext)
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))

  const comments: PullRequestTimelineItem[] = compact(raw.timelineComments?.nodes).map((comment) => ({
    kind: 'comment',
    id: comment.id,
    author: normalizeActor(comment.author),
    body: comment.body,
    createdAt: toTimestamp(comment.createdAt) ?? 0,
    url: comment.url ?? null,
  }))
  const reviews: PullRequestTimelineItem[] = compact(raw.reviews?.nodes)
    // Pending reviews are private drafts of the token owner.
    .filter((review) => review.state !== 'PENDING')
    // Reviews that only carry inline comments have no body; keep state changes.
    .filter((review) => review.body.trim() || review.state !== 'COMMENTED')
    .map((review) => ({
      kind: 'review',
      id: review.id,
      author: normalizeActor(review.author),
      body: review.body,
      createdAt: toTimestamp(review.submittedAt ?? review.createdAt) ?? 0,
      url: review.url ?? null,
      state: review.state,
    }))

  return {
    ...summary,
    nodeId: raw.id,
    body: raw.body ?? '',
    headSha: raw.headRefOid,
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    isCrossRepository: raw.isCrossRepository,
    mergeStateStatus: raw.mergeStateStatus,
    mergedBy: raw.mergedBy?.login ?? null,
    commitCount: raw.commits?.totalCount ?? 0,
    checkRuns,
    files: compact(raw.files?.nodes).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      changeType: file.changeType,
    })),
    fileCount: raw.files?.totalCount ?? raw.changedFiles,
    timeline: [...comments, ...reviews].sort((a, b) => a.createdAt - b.createdAt),
    repository: {
      mergeCommitAllowed: repository.mergeCommitAllowed,
      squashMergeAllowed: repository.squashMergeAllowed,
      rebaseMergeAllowed: repository.rebaseMergeAllowed,
      deleteBranchOnMerge: repository.deleteBranchOnMerge,
      defaultMergeMethod: normalizeMergeMethod(repository.viewerDefaultMergeMethod, repository),
      viewerPermission: repository.viewerPermission ?? null,
    },
  }
}
