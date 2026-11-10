import type { GitHubActor } from './githubApi'
import {
  meaningfulLines,
  plainCommentText,
  type ReviewSeverity,
  severityOfLine,
  withoutCollapsedBlocks,
} from './githubReviewTasks'

export type { ReviewSeverity }

// Pure parts of the Reviews inbox: the GitHub queries, the lean conversation
// shape the list uses, previews and severity labels. No I/O.

/** Open pull requests checked, most recently updated first. */
export const INBOX_PULL_REQUESTS = 25

/** Conversations loaded per request; batches run in parallel. */
export const INBOX_BATCH_SIZE = 15

/**
 * Open pull requests with only the state of their conversations. Comment
 * bodies are expensive for GitHub to produce, and loading them for every
 * conversation of 25 pull requests in one request ran into GitHub's time limit
 * (502), so they come from `INBOX_THREADS_QUERY` in small batches.
 */
export const INBOX_PULL_REQUESTS_QUERY = `
  query TaskerReviewInbox($owner: String!, $name: String!, $first: Int!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          number title url isDraft createdAt updatedAt reviewDecision
          author { __typename login avatarUrl url }
          reviewRequests(first: 20) {
            nodes { requestedReviewer { __typename ... on User { login } } }
          }
          reviewThreads(first: 100) { nodes { id isResolved isOutdated resolvedBy { login } } }
        }
      }
    }
  }
`

/**
 * First and last comment of conversations. The raw markdown `body` is used
 * because GitHub renders `bodyHTML` and `bodyText` on request, which made
 * large batches slow enough to fail.
 */
export const INBOX_THREADS_QUERY = `
  query TaskerReviewInboxThreads($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewThread {
        id path line originalLine startLine originalStartLine subjectType isResolved isOutdated
        resolvedBy { login }
        pullRequest { number repository { nameWithOwner } }
        first: comments(first: 1) {
          totalCount
          nodes {
            id url body createdAt
            pullRequestReview { state }
            author { __typename login avatarUrl url }
          }
        }
        last: comments(last: 1) { nodes { createdAt author { login } } }
      }
    }
  }
`

// ---------------------------------------------------------------------------
// Shapes

type RawAuthor = { __typename?: string; login: string; avatarUrl?: string | null; url?: string | null } | null

export type RawInboxThread = {
  id?: string
  path?: string
  line?: number | null
  originalLine?: number | null
  startLine?: number | null
  originalStartLine?: number | null
  subjectType?: 'LINE' | 'FILE' | null
  isResolved?: boolean
  isOutdated?: boolean
  resolvedBy?: { login: string } | null
  pullRequest?: { number: number; repository: { nameWithOwner: string } } | null
  first?: {
    totalCount: number
    nodes: Array<{
      id: string
      url: string | null
      body: string
      createdAt: string
      pullRequestReview: { state: string } | null
      author: RawAuthor
    } | null> | null
  } | null
  last?: { nodes: Array<{ createdAt: string; author: { login: string } | null } | null> | null } | null
}

export type RawInboxPullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  reviewDecision: string | null
  author: RawAuthor
  reviewRequests: { nodes: Array<{ requestedReviewer: { __typename?: string; login?: string } | null } | null> | null } | null
  reviewThreads: {
    nodes: Array<{ id: string; isResolved: boolean; isOutdated: boolean; resolvedBy: { login: string } | null } | null> | null
  } | null
}

/** A conversation as the inbox list shows it: first comment preview and last activity. */
export type InboxThread = {
  id: string
  pullNumber: number
  path: string
  line: number | null
  startLine: number | null
  isFileComment: boolean
  isResolved: boolean
  isOutdated: boolean
  resolvedBy: string | null
  startedBy: GitHubActor | null
  startedAt: number
  url: string | null
  preview: string
  severity: ReviewSeverity | null
  replyCount: number
  lastCommentAt: number
  lastCommentBy: string | null
}

export type InboxPullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: number
  updatedAt: number
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null
  author: GitHubActor | null
  /** Users asked to review (teams are left out). */
  requestedReviewers: string[]
  threads: InboxThread[]
}

// ---------------------------------------------------------------------------
// Helpers

const MAX_PREVIEW_LENGTH = 500

/** Markdown reduced to a short plain-text preview. */
export function inboxPreview(body: string) {
  const text = meaningfulLines(body).join(' ')
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…` : text
}

/** Severity label of a review comment, read from its first line (see `severityOfLine`). */
export function parseSeverity(body: string): ReviewSeverity | null {
  const first = plainCommentText(withoutCollapsedBlocks(body))
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return first ? severityOfLine(first) : null
}

const SEVERITY_PRIORITY: Record<ReviewSeverity, 'urgent' | 'high' | 'medium' | 'low'> = {
  critical: 'urgent',
  major: 'high',
  minor: 'medium',
  nitpick: 'low',
}

export function severityPriority(severity: ReviewSeverity) {
  return SEVERITY_PRIORITY[severity]
}

/** Splits ids into request-sized batches. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
  return batches
}

function toTime(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function actor(raw: RawAuthor): GitHubActor | null {
  if (!raw) return null
  return {
    login: raw.login,
    avatarUrl: raw.avatarUrl ?? null,
    url: raw.url ?? null,
    isBot: raw.__typename === 'Bot' || raw.login.endsWith('[bot]'),
  }
}

/**
 * A conversation for the inbox, or null for nodes that are not review
 * threads, have no comment, or belong to a review its author has not
 * submitted yet.
 */
export function inboxThreadFromRaw(raw: RawInboxThread | null | undefined): InboxThread | null {
  if (!raw?.id || typeof raw.path !== 'string' || !raw.pullRequest) return null
  const first = raw.first?.nodes?.find((node) => node)
  if (!first || first.pullRequestReview?.state === 'PENDING') return null
  const last = raw.last?.nodes?.find((node) => node) ?? null
  const line = raw.line ?? raw.originalLine ?? null
  const startLine = raw.startLine ?? raw.originalStartLine ?? null
  const startedAt = toTime(first.createdAt)
  const totalCount = raw.first?.totalCount ?? 1
  return {
    id: raw.id,
    pullNumber: raw.pullRequest.number,
    path: raw.path,
    line: raw.subjectType === 'FILE' ? null : line,
    startLine: startLine !== null && startLine !== line ? startLine : null,
    isFileComment: raw.subjectType === 'FILE',
    isResolved: raw.isResolved === true,
    isOutdated: raw.isOutdated === true,
    resolvedBy: raw.resolvedBy?.login ?? null,
    startedBy: actor(first.author),
    startedAt,
    url: first.url ?? null,
    preview: inboxPreview(first.body),
    severity: parseSeverity(first.body),
    replyCount: Math.max(0, totalCount - 1),
    lastCommentAt: totalCount > 1 && last ? toTime(last.createdAt) || startedAt : startedAt,
    lastCommentBy: totalCount > 1 && last ? (last.author?.login ?? null) : (first.author?.login ?? null),
  }
}

function reviewDecision(value: string | null): InboxPullRequest['reviewDecision'] {
  switch (value) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return null
  }
}

/** A pull request with its loaded conversations, oldest first. */
export function inboxPullRequestFromRaw(
  raw: RawInboxPullRequest,
  threadsById: ReadonlyMap<string, InboxThread>,
): InboxPullRequest {
  const threads = (raw.reviewThreads?.nodes ?? [])
    .map((node) => (node ? threadsById.get(node.id) : undefined))
    .filter((thread): thread is InboxThread => Boolean(thread))
    .sort((a, b) => a.startedAt - b.startedAt)
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    isDraft: raw.isDraft,
    createdAt: toTime(raw.createdAt),
    updatedAt: toTime(raw.updatedAt),
    reviewDecision: reviewDecision(raw.reviewDecision),
    author: actor(raw.author),
    requestedReviewers: (raw.reviewRequests?.nodes ?? [])
      .map((node) => node?.requestedReviewer?.login)
      .filter((login): login is string => Boolean(login)),
    threads,
  }
}
