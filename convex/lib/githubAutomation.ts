import {
  GITHUB_AUTOMATION_TRIGGERS,
  type GitHubAutomationRule,
  type GitHubAutomationTrigger,
  type GitHubPullRequestSnapshot,
} from '../constants'

// Pure automation logic: default rules, rule normalisation, transition
// resolution and webhook payload normalisation. No I/O, fully tested.

// ---------------------------------------------------------------------------
// Rules

export const AUTOMATION_TRIGGER_LABELS: Record<GitHubAutomationTrigger, string> = {
  branch_pushed: 'A branch named after the task is pushed',
  pr_opened: 'A pull request referencing the task is opened or marked ready',
  pr_draft: 'The pull request is converted to a draft',
  pr_merged: 'The pull request is merged',
  pr_closed: 'The pull request is closed without merging',
  review_approved: 'A review approves the pull request',
  changes_requested: 'A review requests changes',
}

export function defaultAutomationRules(): GitHubAutomationRule[] {
  return [
    { trigger: 'branch_pushed', enabled: true, targetStatus: 'in_progress', fromStatuses: ['todo', 'backlog'] },
    { trigger: 'pr_opened', enabled: true, targetStatus: 'in_review', fromStatuses: [] },
    { trigger: 'pr_draft', enabled: true, targetStatus: 'in_progress', fromStatuses: ['in_review'] },
    { trigger: 'pr_merged', enabled: true, targetStatus: 'done', fromStatuses: [] },
    { trigger: 'pr_closed', enabled: true },
    { trigger: 'review_approved', enabled: false, targetStatus: undefined, fromStatuses: ['in_review'] },
    { trigger: 'changes_requested', enabled: false, targetStatus: 'in_progress', fromStatuses: ['in_review'] },
  ]
}

const MAX_STATUS_KEY_LENGTH = 100

/**
 * Returns one rule per trigger in canonical order. Unknown triggers are
 * dropped, missing ones take their default, and status keys are trimmed.
 */
export function normalizeAutomationRules(
  rules: ReadonlyArray<GitHubAutomationRule> | null | undefined,
): GitHubAutomationRule[] {
  const byTrigger = new Map<GitHubAutomationTrigger, GitHubAutomationRule>()
  for (const rule of rules ?? []) {
    if (!GITHUB_AUTOMATION_TRIGGERS.includes(rule.trigger) || byTrigger.has(rule.trigger)) continue
    const cleanStatus = (value: string | undefined) => {
      const trimmed = value?.trim()
      return trimmed && trimmed.length <= MAX_STATUS_KEY_LENGTH ? trimmed : undefined
    }
    byTrigger.set(rule.trigger, {
      trigger: rule.trigger,
      enabled: Boolean(rule.enabled),
      targetStatus: rule.trigger === 'pr_closed' ? undefined : cleanStatus(rule.targetStatus),
      fromStatuses:
        rule.trigger === 'pr_closed'
          ? undefined
          : [...new Set((rule.fromStatuses ?? []).map(cleanStatus).filter((s): s is string => Boolean(s)))],
    })
  }
  return defaultAutomationRules().map((fallback) => byTrigger.get(fallback.trigger) ?? fallback)
}

export type AutomationRuleState = {
  rule: GitHubAutomationRule
  /** The target status exists in the project (always true for `pr_closed`). */
  targetExists: boolean
  /** Enabled and able to run. */
  active: boolean
}

export function describeAutomationRules(
  rules: ReadonlyArray<GitHubAutomationRule>,
  statusKeys: ReadonlyArray<string>,
): AutomationRuleState[] {
  return normalizeAutomationRules(rules).map((rule) => {
    const targetExists =
      rule.trigger === 'pr_closed' ? true : Boolean(rule.targetStatus && statusKeys.includes(rule.targetStatus))
    return { rule, targetExists, active: rule.enabled && targetExists }
  })
}

/**
 * The status a rule moves a task to, or null when the rule does not apply.
 * Tasks are never moved out of `done` by automation except by `pr_closed`
 * restoring an earlier status, which callers handle separately.
 */
export function resolveTransition(
  rule: GitHubAutomationRule,
  currentStatus: string,
  statusKeys: ReadonlyArray<string>,
): string | null {
  if (!rule.enabled || rule.trigger === 'pr_closed') return null
  const target = rule.targetStatus
  if (!target || !statusKeys.includes(target)) return null
  if (currentStatus === target) return null
  if (currentStatus === 'done') return null
  const from = rule.fromStatuses ?? []
  if (from.length && !from.includes(currentStatus)) return null
  return target
}

// ---------------------------------------------------------------------------
// Webhook payloads

export type WebhookRepository = {
  repositoryId: number
  fullName: string
  defaultBranch: string | null
}

export type PullRequestWebhookAction =
  | 'opened'
  | 'reopened'
  | 'closed'
  | 'edited'
  | 'synchronize'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'review_requested'
  | 'review_request_removed'
  | 'other'

export type NormalizedPullRequest = {
  number: number
  title: string
  body: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  headSha: string
  authorLogin: string | null
  mergeable: 'mergeable' | 'conflicting' | 'unknown'
  mergedAt: number | null
  updatedAt: number
}

export type WebhookEvent =
  | { kind: 'ping'; hookId: number | null; repository: WebhookRepository | null; senderLogin: string | null }
  | {
      kind: 'pull_request'
      action: PullRequestWebhookAction
      pullRequest: NormalizedPullRequest
      requestedReviewerLogin: string | null
      repository: WebhookRepository
      senderLogin: string | null
    }
  | {
      kind: 'pull_request_review'
      action: 'submitted' | 'other'
      state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'other'
      reviewerLogin: string | null
      pullRequest: NormalizedPullRequest
      repository: WebhookRepository
      senderLogin: string | null
    }
  | {
      kind: 'push'
      ref: string
      branchName: string | null
      created: boolean
      deleted: boolean
      headSha: string | null
      commitMessages: string[]
      pusherLogin: string | null
      repository: WebhookRepository
      senderLogin: string | null
    }
  | {
      kind: 'check_suite'
      action: string
      conclusion: string | null
      status: string | null
      headSha: string
      pullNumbers: number[]
      appName: string | null
      repository: WebhookRepository
      senderLogin: string | null
    }
  | {
      kind: 'workflow_run'
      action: string
      conclusion: string | null
      status: string | null
      headBranch: string | null
      headSha: string
      runId: number
      name: string
      url: string
      actorLogin: string | null
      pullNumbers: number[]
      repository: WebhookRepository
      senderLogin: string | null
    }

type Dict = Record<string, unknown>

function dict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : null
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function time(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeRepository(raw: unknown): WebhookRepository | null {
  const repository = dict(raw)
  const repositoryId = num(repository?.id)
  const fullName = str(repository?.full_name)
  if (!repository || repositoryId === null || !fullName) return null
  return { repositoryId, fullName, defaultBranch: str(repository.default_branch) }
}

function normalizePullRequest(raw: unknown): NormalizedPullRequest | null {
  const pr = dict(raw)
  const number = num(pr?.number)
  const head = dict(pr?.head)
  const base = dict(pr?.base)
  if (!pr || number === null || number <= 0 || !head || !base) return null
  const merged = pr.merged === true || Boolean(str(pr.merged_at))
  const state = str(pr.state) === 'closed' ? (merged ? 'merged' : 'closed') : 'open'
  const mergeable =
    pr.mergeable === true ? 'mergeable' : pr.mergeable === false ? 'conflicting' : 'unknown'
  return {
    number,
    title: str(pr.title) ?? '',
    body: str(pr.body) ?? '',
    url: str(pr.html_url) ?? '',
    state,
    isDraft: pr.draft === true,
    headRefName: str(head.ref) ?? '',
    baseRefName: str(base.ref) ?? '',
    headSha: str(head.sha) ?? '',
    authorLogin: str(dict(pr.user)?.login),
    mergeable,
    mergedAt: time(pr.merged_at),
    updatedAt: time(pr.updated_at) ?? Date.now(),
  }
}

function pullNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => num(dict(entry)?.number))
    .filter((number): number is number => number !== null && number > 0)
}

const PULL_REQUEST_ACTIONS: PullRequestWebhookAction[] = [
  'opened',
  'reopened',
  'closed',
  'edited',
  'synchronize',
  'ready_for_review',
  'converted_to_draft',
  'review_requested',
  'review_request_removed',
]

/** Turns a raw webhook payload into a typed event, or null for events Tasker ignores. */
export function normalizeWebhookEvent(eventName: string, payload: unknown): WebhookEvent | null {
  const body = dict(payload)
  if (!body) return null
  const senderLogin = str(dict(body.sender)?.login)
  const repository = normalizeRepository(body.repository)

  if (eventName === 'ping') {
    return { kind: 'ping', hookId: num(body.hook_id), repository, senderLogin }
  }
  if (!repository) return null

  switch (eventName) {
    case 'pull_request': {
      const pullRequest = normalizePullRequest(body.pull_request)
      if (!pullRequest) return null
      const rawAction = str(body.action) ?? 'other'
      const action = PULL_REQUEST_ACTIONS.includes(rawAction as PullRequestWebhookAction)
        ? (rawAction as PullRequestWebhookAction)
        : 'other'
      return {
        kind: 'pull_request',
        action,
        pullRequest,
        requestedReviewerLogin: str(dict(body.requested_reviewer)?.login),
        repository,
        senderLogin,
      }
    }
    case 'pull_request_review': {
      const pullRequest = normalizePullRequest(body.pull_request)
      const review = dict(body.review)
      if (!pullRequest || !review) return null
      const rawState = (str(review.state) ?? '').toLowerCase()
      const state =
        rawState === 'approved' || rawState === 'changes_requested' || rawState === 'commented' || rawState === 'dismissed'
          ? rawState
          : 'other'
      return {
        kind: 'pull_request_review',
        action: str(body.action) === 'submitted' ? 'submitted' : 'other',
        state,
        reviewerLogin: str(dict(review.user)?.login),
        pullRequest,
        repository,
        senderLogin,
      }
    }
    case 'push': {
      const ref = str(body.ref)
      if (!ref) return null
      const commits = Array.isArray(body.commits) ? body.commits : []
      return {
        kind: 'push',
        ref,
        branchName: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null,
        created: body.created === true,
        deleted: body.deleted === true,
        headSha: str(body.after),
        commitMessages: commits
          .map((commit) => str(dict(commit)?.message))
          .filter((message): message is string => Boolean(message))
          .slice(0, 50),
        pusherLogin: str(dict(body.pusher)?.name) ?? senderLogin,
        repository,
        senderLogin,
      }
    }
    case 'check_suite': {
      const suite = dict(body.check_suite)
      const headSha = str(suite?.head_sha)
      if (!suite || !headSha) return null
      return {
        kind: 'check_suite',
        action: str(body.action) ?? 'other',
        conclusion: str(suite.conclusion),
        status: str(suite.status),
        headSha,
        pullNumbers: pullNumbers(suite.pull_requests),
        appName: str(dict(suite.app)?.name),
        repository,
        senderLogin,
      }
    }
    case 'workflow_run': {
      const run = dict(body.workflow_run)
      const runId = num(run?.id)
      const headSha = str(run?.head_sha)
      if (!run || runId === null || !headSha) return null
      return {
        kind: 'workflow_run',
        action: str(body.action) ?? 'other',
        conclusion: str(run.conclusion),
        status: str(run.status),
        headBranch: str(run.head_branch),
        headSha,
        runId,
        name: str(run.name) ?? str(dict(body.workflow)?.name) ?? 'Workflow',
        url: str(run.html_url) ?? '',
        actorLogin: str(dict(run.triggering_actor)?.login) ?? str(dict(run.actor)?.login),
        pullNumbers: pullNumbers(run.pull_requests),
        repository,
        senderLogin,
      }
    }
    default:
      return null
  }
}

/** Maps a check suite or workflow conclusion to the summary shown on chips. */
export function checksSummaryFromConclusion(
  status: string | null,
  conclusion: string | null,
): GitHubPullRequestSnapshot['checks'] {
  if (status && status !== 'completed') return 'pending'
  switch (conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'success'
    case 'failure':
    case 'timed_out':
    case 'cancelled':
    case 'action_required':
    case 'startup_failure':
    case 'stale':
      return 'failure'
    case null:
      return 'pending'
    default:
      return null
  }
}

export function snapshotFromPullRequest(
  pullRequest: NormalizedPullRequest,
  previous?: GitHubPullRequestSnapshot | null,
): GitHubPullRequestSnapshot {
  const sameHead = previous?.headSha === pullRequest.headSha
  return {
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    headRefName: pullRequest.headRefName,
    baseRefName: pullRequest.baseRefName,
    headSha: pullRequest.headSha,
    authorLogin: pullRequest.authorLogin,
    // Reviews and checks belong to a head commit; a new push resets them.
    reviewDecision: sameHead ? (previous?.reviewDecision ?? null) : null,
    checks: sameHead ? (previous?.checks ?? null) : null,
    mergeable:
      pullRequest.mergeable === 'unknown' && sameHead ? (previous?.mergeable ?? 'unknown') : pullRequest.mergeable,
    updatedAt: pullRequest.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Signatures

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export async function signWebhookBody(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))}`
}

/** Verifies GitHub's `X-Hub-Signature-256` header for a raw request body. */
export async function verifyWebhookSignature(secret: string, body: string, signature: string | null) {
  if (!signature || !signature.startsWith('sha256=')) return false
  const expected = await signWebhookBody(secret, body)
  return constantTimeEqual(expected, signature.trim())
}

export function generateWebhookSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return hex(bytes.buffer)
}
