import type { GitHubPullRequestSnapshot } from '../constants'
import type { PullRequestSummary } from './githubApi'
import { parseTaskReferences } from './githubReferences'

// Pure bridge between GitHub pull request data loaded with a user's token and
// the link candidates stored by `githubLinks.syncPullRequestLinks`.

export function snapshotFromSummary(summary: PullRequestSummary): GitHubPullRequestSnapshot {
  return {
    title: summary.title,
    url: summary.url,
    state: summary.state,
    isDraft: summary.isDraft,
    headRefName: summary.headRefName,
    baseRefName: summary.baseRefName,
    headSha: summary.headSha,
    authorLogin: summary.author?.login ?? null,
    reviewDecision: summary.reviewDecision,
    checks: summary.checks,
    mergeable: summary.mergeable,
    updatedAt: summary.updatedAt,
  }
}

export type LinkCandidateInput = {
  pullNumber: number
  issueNumbers: number[]
  issueIds: string[]
  snapshot: GitHubPullRequestSnapshot
}

/** Task references from the title and head branch (plus the body when given). */
export function linkCandidatesFromSummaries(
  summaries: PullRequestSummary[],
  projectKey: string,
  body?: string,
): LinkCandidateInput[] {
  return summaries.map((summary) => {
    const text = parseTaskReferences(`${summary.title}\n${body ?? ''}`, { projectKey })
    const branch = parseTaskReferences(summary.headRefName, { projectKey })
    return {
      pullNumber: summary.number,
      issueNumbers: [...new Set([...text.issueNumbers, ...branch.issueNumbers])],
      issueIds: text.issueIds,
      snapshot: snapshotFromSummary(summary),
    }
  })
}

/** Snapshot from GitHub's REST pull request representation. */
export type RestPullRequestLike = {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  merged?: boolean
  merged_at?: string | null
  draft?: boolean
  mergeable?: boolean | null
  updated_at?: string
  user?: { login: string } | null
  head: { ref: string; sha: string }
  base: { ref: string }
}

export function snapshotFromRest(pullRequest: RestPullRequestLike): GitHubPullRequestSnapshot {
  const merged = pullRequest.merged === true || Boolean(pullRequest.merged_at)
  const updatedAt = pullRequest.updated_at ? Date.parse(pullRequest.updated_at) : Number.NaN
  return {
    title: pullRequest.title,
    url: pullRequest.html_url,
    state: pullRequest.state === 'closed' ? (merged ? 'merged' : 'closed') : 'open',
    isDraft: pullRequest.draft === true,
    headRefName: pullRequest.head.ref,
    baseRefName: pullRequest.base.ref,
    headSha: pullRequest.head.sha,
    authorLogin: pullRequest.user?.login ?? null,
    reviewDecision: null,
    checks: null,
    mergeable: pullRequest.mergeable === true ? 'mergeable' : pullRequest.mergeable === false ? 'conflicting' : 'unknown',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}
