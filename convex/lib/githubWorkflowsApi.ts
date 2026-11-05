// GitHub Actions payloads normalized for the Tasker UI, plus pure helpers for
// logs. Every value uses `null` instead of `undefined` so it survives Convex
// serialization unchanged.

export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending'

export type RunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'

export type WorkflowSummary = {
  id: number
  name: string
  path: string
  state: 'active' | 'disabled_manually' | 'disabled_inactivity' | 'disabled_fork' | 'deleted' | 'unknown'
  htmlUrl: string | null
  /** From the workflow file on the default branch; null when it could not be read. */
  dispatchable: boolean | null
  inputs: Array<{
    name: string
    description: string | null
    required: boolean
    default: string | null
    type: 'string' | 'boolean' | 'choice' | 'number' | 'environment'
    options: string[]
  }>
  /** Workflow names whose runs start this workflow. */
  listensTo: string[]
}

export type RunActor = { login: string; avatarUrl: string | null }

export type WorkflowRun = {
  id: number
  workflowId: number
  /** Workflow name at the time of the run. */
  name: string
  title: string
  runNumber: number
  attempt: number
  event: string
  status: RunStatus
  conclusion: RunConclusion | null
  branch: string | null
  headSha: string
  commitMessage: string | null
  actor: RunActor | null
  triggeringActor: RunActor | null
  createdAt: number
  startedAt: number
  updatedAt: number
  htmlUrl: string
  path: string
  pullRequests: number[]
}

export type RunStep = {
  number: number
  name: string
  status: RunStatus
  conclusion: RunConclusion | null
  startedAt: number | null
  completedAt: number | null
}

export type RunJob = {
  id: number
  name: string
  status: RunStatus
  conclusion: RunConclusion | null
  startedAt: number | null
  completedAt: number | null
  htmlUrl: string | null
  runnerName: string | null
  labels: string[]
  steps: RunStep[]
}

export type RawWorkflow = {
  id: number
  name: string
  path: string
  state: string
  html_url?: string
}

export type RawActor = { login: string; avatar_url?: string } | null | undefined

export type RawWorkflowRun = {
  id: number
  workflow_id: number
  name?: string | null
  display_title?: string | null
  run_number: number
  run_attempt?: number
  event: string
  status: string | null
  conclusion: string | null
  head_branch: string | null
  head_sha: string
  head_commit?: { message?: string | null } | null
  actor?: RawActor
  triggering_actor?: RawActor
  created_at: string
  run_started_at?: string | null
  updated_at: string
  html_url: string
  path?: string
  pull_requests?: Array<{ number: number }> | null
}

export type RawJob = {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at?: string | null
  completed_at?: string | null
  html_url?: string | null
  runner_name?: string | null
  labels?: string[]
  steps?: Array<{
    number: number
    name: string
    status: string
    conclusion: string | null
    started_at?: string | null
    completed_at?: string | null
  }>
}

const WORKFLOW_STATES = new Set([
  'active',
  'disabled_manually',
  'disabled_inactivity',
  'disabled_fork',
  'deleted',
])

const RUN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'])
const RUN_CONCLUSIONS = new Set([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
])

function toTime(value: string | null | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function normalizeStatus(value: string | null | undefined): RunStatus {
  return value && RUN_STATUSES.has(value) ? (value as RunStatus) : 'queued'
}

function normalizeConclusion(value: string | null | undefined): RunConclusion | null {
  return value && RUN_CONCLUSIONS.has(value) ? (value as RunConclusion) : null
}

function normalizeRunActor(actor: RawActor): RunActor | null {
  return actor ? { login: actor.login, avatarUrl: actor.avatar_url ?? null } : null
}

export function normalizeWorkflow(raw: RawWorkflow): Omit<WorkflowSummary, 'dispatchable' | 'inputs' | 'listensTo'> {
  return {
    id: raw.id,
    name: raw.name || raw.path,
    path: raw.path,
    state: WORKFLOW_STATES.has(raw.state) ? (raw.state as WorkflowSummary['state']) : 'unknown',
    htmlUrl: raw.html_url ?? null,
  }
}

export function normalizeRun(raw: RawWorkflowRun): WorkflowRun {
  const createdAt = toTime(raw.created_at) ?? 0
  const commitMessage = raw.head_commit?.message ?? null
  return {
    id: raw.id,
    workflowId: raw.workflow_id,
    name: raw.name ?? raw.path ?? 'Workflow',
    title: raw.display_title ?? commitMessage?.split('\n')[0] ?? raw.name ?? '',
    runNumber: raw.run_number,
    attempt: raw.run_attempt ?? 1,
    event: raw.event,
    status: normalizeStatus(raw.status),
    conclusion: normalizeConclusion(raw.conclusion),
    branch: raw.head_branch,
    headSha: raw.head_sha,
    commitMessage,
    actor: normalizeRunActor(raw.actor),
    triggeringActor: normalizeRunActor(raw.triggering_actor),
    createdAt,
    startedAt: toTime(raw.run_started_at) ?? createdAt,
    updatedAt: toTime(raw.updated_at) ?? createdAt,
    htmlUrl: raw.html_url,
    path: (raw.path ?? '').replace(/@.*$/, ''),
    pullRequests: (raw.pull_requests ?? []).map((pullRequest) => pullRequest.number),
  }
}

export function normalizeJob(raw: RawJob): RunJob {
  return {
    id: raw.id,
    name: raw.name,
    status: normalizeStatus(raw.status),
    conclusion: normalizeConclusion(raw.conclusion),
    startedAt: toTime(raw.started_at),
    completedAt: toTime(raw.completed_at),
    htmlUrl: raw.html_url ?? null,
    runnerName: raw.runner_name ?? null,
    labels: raw.labels ?? [],
    steps: (raw.steps ?? [])
      .map((step) => ({
        number: step.number,
        name: step.name,
        status: normalizeStatus(step.status),
        conclusion: normalizeConclusion(step.conclusion),
        startedAt: toTime(step.started_at),
        completedAt: toTime(step.completed_at),
      }))
      .sort((a, b) => a.number - b.number),
  }
}

// ---------------------------------------------------------------------------
// Logs

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

export function stripLogLine(line: string) {
  return line.replace(TIMESTAMP, '').replace(ANSI, '').replace(/\r$/, '')
}

const COMPILER_ERROR =
  /\b(error|ERROR)\s+[A-Z]{2,}\d{2,}\s*:|npm ERR!|ERR_PNPM_[A-Z_]+|\bTS\d{4}:|\bFATAL\b|Traceback \(most recent call last\)|\bpanic:/

/**
 * Picks the lines that explain a failure: compiler and package-manager errors
 * first, then GitHub's own `##[error]` lines, then the last lines of output.
 */
export function extractErrorLines(log: string, limit = 6): string[] {
  const lines = log.split('\n').map(stripLogLine)
  const specific: string[] = []
  const annotations: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('##[error]')) {
      annotations.push(trimmed.slice('##[error]'.length).trim())
      continue
    }
    if (trimmed.startsWith('##[')) continue
    if (COMPILER_ERROR.test(trimmed)) specific.push(trimmed)
  }
  const unique = (values: string[]) => [...new Set(values)]
  const picked = unique([...specific, ...annotations]).slice(0, limit)
  if (picked.length) return picked.map((line) => (line.length > 600 ? `${line.slice(0, 599)}…` : line))
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('##['))
    .slice(-limit)
}

/**
 * Normalizes an error line so the same failure in different services groups
 * together: image names, paths, URLs, hashes and numbers become placeholders.
 */
export function errorSignature(line: string) {
  return line
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[a-z0-9.-]+\.[a-z]{2,}(\/[\w.-]+)+(:[\w.-]+)?/gi, '<image>')
    .replace(/(\/[\w.@-]+){2,}\/?/g, '<path>')
    .replace(/\[[^\]]*\.(csproj|fsproj|sln)\]/gi, '[<project>]')
    .replace(/\b[0-9a-f]{7,64}\b/gi, '<hash>')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
}
