import type { GitHubReviewTaskSettings } from '../constants'
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

/**
 * Removes collapsed `<details>` blocks. Review bots put their analysis,
 * suggested fixes and agent prompts there; it is noise in titles and previews.
 */
export function withoutCollapsedBlocks(body: string) {
  let text = body.replace(/\r\n?/g, '\n')
  let previous: string
  do {
    previous = text
    // Innermost first, so nested blocks come out whole.
    text = text.replace(/<details\b[^>]*>(?:(?!<details\b)[\s\S])*?<\/details>/gi, '\n')
  } while (text !== previous)
  return text
}

export type ReviewSeverity = 'critical' | 'major' | 'minor' | 'nitpick'

/**
 * Severity of a comment's first line, as review bots write them at the start
 * ("Major · Stability", "⚠️ Potential issue | 🟠 Major", "🧹 Nitpick") or as
 * people prefix nitpicks ("nit: rename"). A longer line is a sentence, not a
 * label, so "a major refactor" never counts.
 */
export function severityOfLine(line: string): ReviewSeverity | null {
  const first = line.trim()
  if (!first) return null
  if (/^(nit|nitpick)\b/i.test(first)) return 'nitpick'
  if (first.length > 80) return null
  if (/\bcritical\b/i.test(first)) return 'critical'
  if (/\bmajor\b/i.test(first)) return 'major'
  if (/\bminor\b/i.test(first)) return 'minor'
  if (/\b(nitpick|trivial)\b/i.test(first)) return 'nitpick'
  return null
}

/**
 * The comment as plain lines worth reading: without collapsed blocks, and
 * without a leading bot severity label when something follows it (the label
 * is shown as a badge instead).
 */
export function meaningfulLines(body: string) {
  const lines = plainCommentText(withoutCollapsedBlocks(body))
    .split('\n')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const labelOnly = lines.length > 1 && severityOfLine(lines[0]) && !/^nit\b\s*:/i.test(lines[0])
  return labelOnly ? lines.slice(1) : lines
}

/** Title for a review task: the first meaningful line of the comment. */
export function reviewTaskTitle(body: string, path: string, line?: number | null) {
  const lines = meaningfulLines(body)
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
