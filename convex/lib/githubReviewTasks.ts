import type { GitHubReviewTaskSettings } from '../constants'
import type { PullRequestReviewThread } from './githubApi'
import type { DescriptionDoc, DescriptionNode } from './issueDescriptions'

// Pure helpers for turning pull request review conversations into tasks:
// settings defaults, the GraphQL lookup, and the task text built from a
// thread's first comment. No I/O.

export const MAX_TRACKED_THREADS = 50
const MAX_TITLE_LENGTH = 100
const MAX_QUOTED_BODY_LENGTH = 4000
const DIFF_TAIL_LINES = 8

export function normalizeReviewTaskSettings(
  settings: Partial<GitHubReviewTaskSettings> | null | undefined,
): GitHubReviewTaskSettings {
  return {
    completeTaskOnResolve: settings?.completeTaskOnResolve ?? true,
    resolveThreadOnDone: settings?.resolveThreadOnDone ?? true,
  }
}

// ---------------------------------------------------------------------------
// GraphQL

export const REVIEW_THREADS_QUERY = `
  query TaskerReviewThreads($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewThread {
        id
        path
        line
        originalLine
        subjectType
        isResolved
        isOutdated
        pullRequest {
          number
          title
          url
          author { login }
          repository { nameWithOwner }
        }
        comments(first: 1) {
          nodes { databaseId body url diffHunk author { login } }
        }
      }
    }
  }
`

/** Thread fields matching `normalizeReviewThread`, with up to `comments` comments. */
function threadFields(comments: number) {
  return `
    id path line originalLine startLine originalStartLine subjectType
    isResolved isOutdated resolvedBy { login }
    viewerCanReply viewerCanResolve viewerCanUnresolve
    comments(first: ${comments}) {
      totalCount
      nodes {
        id url bodyHTML createdAt diffHunk
        pullRequestReview { id state }
        author { __typename login avatarUrl url }
        reactionGroups { content viewerHasReacted reactors { totalCount } }
      }
    }
  `
}

/** Full conversations by id, for the task page. */
export const REVIEW_THREAD_DETAILS_QUERY = `
  query TaskerReviewThreadDetails($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewThread {
        ${threadFields(50)}
        pullRequest { number repository { nameWithOwner } }
      }
    }
  }
`

export const OPEN_REVIEW_PULL_REQUESTS = 25

/**
 * Open pull requests with only the state of their conversations, for the
 * Reviews page. Comment bodies are expensive for GitHub to produce; loading
 * them for every conversation of 25 pull requests in one request ran into
 * GitHub's time limit (502), so they are fetched separately for open
 * conversations only (`REVIEW_INBOX_THREADS_QUERY`).
 */
export const OPEN_REVIEW_PULL_REQUESTS_QUERY = `
  query TaskerOpenReviewPullRequests($owner: String!, $name: String!, $first: Int!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          number title url isDraft updatedAt
          author { __typename login avatarUrl url }
          reviewThreads(first: 100) { nodes { id isResolved isOutdated resolvedBy { login } } }
        }
      }
    }
  }
`

/** Conversations loaded per request on the Reviews page; batches run in parallel. */
export const REVIEW_INBOX_BATCH_SIZE = 15

/**
 * First comment of open conversations, for the Reviews page. The raw markdown
 * `body` is used because GitHub renders `bodyHTML` and `bodyText` on request,
 * which made large batches slow enough to fail.
 */
export const REVIEW_INBOX_THREADS_QUERY = `
  query TaskerReviewInboxThreads($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewThread {
        id path line originalLine startLine originalStartLine subjectType isResolved isOutdated
        pullRequest { number repository { nameWithOwner } }
        comments(first: 1) {
          totalCount
          nodes {
            id url body createdAt
            pullRequestReview { state }
            author { __typename login avatarUrl url }
          }
        }
      }
    }
  }
`

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
  pullRequest?: { number: number; repository: { nameWithOwner: string } } | null
  comments?: {
    totalCount: number
    nodes: Array<{
      id: string
      url: string | null
      body: string
      createdAt: string
      pullRequestReview: { state: string } | null
      author: { __typename?: string; login: string; avatarUrl?: string | null; url?: string | null } | null
    } | null> | null
  } | null
}

const MAX_PREVIEW_LENGTH = 500

/** Markdown reduced to a short plain-text preview. */
export function inboxPreview(body: string) {
  const text = plainCommentText(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…` : text
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * A Reviews page conversation in the same shape as the pull request page uses,
 * with the first comment only and a short plain-text preview as escaped HTML. Returns null
 * for nodes that are not review threads, have no comment, or belong to a
 * review its author has not submitted.
 */
export function inboxThreadFromRaw(raw: RawInboxThread | null | undefined): PullRequestReviewThread | null {
  if (!raw?.id || typeof raw.path !== 'string') return null
  const first = raw.comments?.nodes?.find((node) => node)
  if (!first || first.pullRequestReview?.state === 'PENDING') return null
  const line = raw.line ?? raw.originalLine ?? null
  const startLine = raw.startLine ?? raw.originalStartLine ?? null
  const createdAt = Date.parse(first.createdAt) || 0
  const preview = inboxPreview(first.body)
  const author = first.author
    ? {
        login: first.author.login,
        avatarUrl: first.author.avatarUrl ?? null,
        url: first.author.url ?? null,
        isBot: first.author.__typename === 'Bot' || first.author.login.endsWith('[bot]'),
      }
    : null
  return {
    id: raw.id,
    path: raw.path,
    line,
    startLine: startLine !== null && startLine !== line ? startLine : null,
    isFileComment: raw.subjectType === 'FILE',
    isResolved: raw.isResolved === true,
    isOutdated: raw.isOutdated === true,
    resolvedBy: null,
    diffHunk: null,
    viewerCanReply: false,
    viewerCanResolve: false,
    viewerCanUnresolve: false,
    createdAt,
    comments: [
      {
        id: first.id,
        author,
        bodyHtml: preview ? `<p>${escapeHtml(preview)}</p>` : '',
        createdAt,
        url: first.url ?? null,
        reactions: [],
      },
    ],
    totalComments: raw.comments?.totalCount ?? 1,
  }
}

/** Splits ids into request-sized batches. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
  return batches
}

export type RawTrackedThread = {
  id?: string
  path?: string
  line?: number | null
  originalLine?: number | null
  subjectType?: 'LINE' | 'FILE' | null
  isResolved?: boolean
  isOutdated?: boolean
  pullRequest?: {
    number: number
    title: string
    url: string
    author: { login: string } | null
    repository: { nameWithOwner: string }
  } | null
  comments?: {
    nodes: Array<{
      databaseId: number | null
      body: string
      url: string
      diffHunk: string | null
      author: { login: string } | null
    } | null> | null
  } | null
}

export type TrackedThread = {
  threadId: string
  repository: string
  pullNumber: number
  pullTitle: string
  pullUrl: string
  pullAuthorLogin: string | null
  path: string
  line: number | null
  isFileComment: boolean
  isResolved: boolean
  isOutdated: boolean
  rootCommentId: number | null
  body: string
  url: string
  authorLogin: string | null
  diffHunk: string | null
}

/** A thread from `REVIEW_THREADS_QUERY`, or null when it is not a review thread. */
export function normalizeTrackedThread(raw: RawTrackedThread | null | undefined): TrackedThread | null {
  if (!raw?.id || !raw.pullRequest || typeof raw.path !== 'string') return null
  const first = raw.comments?.nodes?.find((node) => node) ?? null
  const line = raw.line ?? raw.originalLine ?? null
  return {
    threadId: raw.id,
    repository: raw.pullRequest.repository.nameWithOwner,
    pullNumber: raw.pullRequest.number,
    pullTitle: raw.pullRequest.title,
    pullUrl: raw.pullRequest.url,
    pullAuthorLogin: raw.pullRequest.author?.login ?? null,
    path: raw.path,
    line: raw.subjectType === 'FILE' ? null : line,
    isFileComment: raw.subjectType === 'FILE',
    isResolved: raw.isResolved === true,
    isOutdated: raw.isOutdated === true,
    rootCommentId: first?.databaseId ?? null,
    body: first?.body ?? '',
    url: first?.url ?? raw.pullRequest.url,
    authorLogin: first?.author?.login ?? null,
    diffHunk: first?.diffHunk ?? null,
  }
}

// ---------------------------------------------------------------------------
// Task text

export function fileName(path: string) {
  return path.split('/').pop() || path
}

export function locationLabel(path: string, line: number | null | undefined) {
  return line ? `${path}:${line}` : path
}

/** Markdown reduced to plain text for a one-line title. */
export function plainCommentText(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/gm, '$1$2')
}

/** Title for a review task: the first meaningful line of the comment. */
export function reviewTaskTitle(body: string, path: string, line?: number | null) {
  const lines = plainCommentText(body)
    .split('\n')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const first = lines[0]
  if (!first) {
    const where = locationLabel(fileName(path), line)
    return /```suggestion/.test(body) ? `Apply suggested change in ${where}` : `Address review comment in ${where}`
  }
  if (first.length <= MAX_TITLE_LENGTH) return first
  const sentence = first.match(/^(.{20,}?[.!?])\s/)?.[1]
  if (sentence && sentence.length <= MAX_TITLE_LENGTH) return sentence
  return `${first.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

function text(value: string, marks?: DescriptionNode['marks']): DescriptionNode {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
}

function paragraph(content: DescriptionNode[]): DescriptionNode {
  const filled = content.filter((node) => node.type !== 'text' || node.text)
  return filled.length ? { type: 'paragraph', content: filled } : { type: 'paragraph' }
}

function link(value: string, href: string, extraMarks: DescriptionNode['marks'] = []) {
  return text(value, [...(extraMarks ?? []), { type: 'link', attrs: { href } }])
}

/** The last lines of a diff hunk, which end at the commented line. */
export function diffHunkTail(diffHunk: string | null | undefined, lines = DIFF_TAIL_LINES) {
  if (!diffHunk) return null
  const body = diffHunk
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((value) => !value.startsWith('@@'))
  const tail = body.slice(-lines).join('\n').trimEnd()
  return tail || null
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Task description: where the comment was made, the comment itself quoted,
 * and the code it points at.
 */
export function reviewTaskDescription(thread: TrackedThread): DescriptionDoc {
  const location = locationLabel(thread.path, thread.line)
  const intro: DescriptionNode[] = [text('Review comment')]
  if (thread.authorLogin) intro.push(text(` by @${thread.authorLogin}`))
  intro.push(text(' on '))
  intro.push(isHttpUrl(thread.url) ? link(location, thread.url, [{ type: 'code' }]) : text(location, [{ type: 'code' }]))
  intro.push(text(' in '))
  const prLabel = `#${thread.pullNumber} ${thread.pullTitle}`.trim()
  intro.push(isHttpUrl(thread.pullUrl) ? link(prLabel, thread.pullUrl) : text(prLabel))

  const content: DescriptionNode[] = [paragraph(intro)]

  const body = thread.body.replace(/\r\n?/g, '\n').trim()
  if (body) {
    const quoted = body.length > MAX_QUOTED_BODY_LENGTH ? `${body.slice(0, MAX_QUOTED_BODY_LENGTH)}…` : body
    content.push({
      type: 'blockquote',
      content: quoted.split('\n').map((value) => paragraph([text(value)])),
    })
  }

  const tail = thread.isFileComment ? null : diffHunkTail(thread.diffHunk)
  if (tail) {
    content.push({ type: 'codeBlock', attrs: { language: 'diff' }, content: [text(tail)] })
  }
  return { type: 'doc', content }
}

/** Reply posted on GitHub when a conversation becomes a follow-up task. */
export function followUpReplyBody(taskKey: string, taskUrl: string) {
  return `Tracked as a follow-up in [${taskKey}](${taskUrl}).`
}
