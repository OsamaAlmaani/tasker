import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action } from './_generated/server'
import { invalidInput, type LinkedGitHubClient, loadLinkedClient, repoPath } from './lib/githubAccess'
import { githubDownloadText, githubError, githubGraphql, githubRequest } from './lib/githubApi'
import {
  extractErrorLines,
  normalizeJob,
  normalizeRun,
  normalizeWorkflow,
  type RawJob,
  type RawWorkflow,
  type RawWorkflowRun,
  type RunJob,
  type WorkflowRun,
  type WorkflowSummary,
} from './lib/githubWorkflowsApi'
import {
  analyzeWorkflows,
  type ChangedFile,
  computeImpact,
  diffTrees,
  type ImpactState,
  parseWorkflowFile,
  type WorkflowImpact,
} from './lib/workflowImpact'

// GitHub Actions for the project Workflows tab. Every call uses the signed-in
// user's own token after Tasker checks their project access (`view` for
// reads, `write` for starting, re-running and cancelling). Nothing GitHub
// returns is stored; releases only record which runs Tasker started.

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/
const MAX_RUN_IDS = 100
const MAX_PLAN_WORKFLOWS = 150
const MAX_LOG_BYTES = 4_000_000
const MAX_SUMMARY_LOG_BYTES = 1_500_000
const BLOB_BATCH_SIZE = 80

type Repository = LinkedGitHubClient['repository']

/** Runs `task` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string
    return typeof data === 'string' ? data : (data.message ?? fallback)
  }
  return error instanceof Error ? error.message : fallback
}

function assertRunId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw invalidInput('That run could not be found.')
}

function assertRef(ref: string) {
  const trimmed = ref.trim()
  if (!trimmed || trimmed.length > 255 || /\s|\.\.|[~^:?*[\\]/.test(trimmed)) {
    throw invalidInput('Choose a valid branch or tag.')
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// GitHub reads

async function listAllWorkflows(token: string, repository: Repository) {
  const workflows: RawWorkflow[] = []
  for (let page = 1; page <= 5; page++) {
    const { data } = await githubRequest<{ total_count: number; workflows: RawWorkflow[] }>(
      token,
      'GET',
      `${repoPath(repository)}/actions/workflows?per_page=100&page=${page}`,
    )
    workflows.push(...data.workflows)
    if (data.workflows.length < 100 || workflows.length >= data.total_count) break
  }
  return workflows
}

async function listRunsPage(token: string, repository: Repository, query: string) {
  const { data } = await githubRequest<{ total_count: number; workflow_runs: RawWorkflowRun[] }>(
    token,
    'GET',
    `${repoPath(repository)}/actions/runs?${query}`,
  )
  return { totalCount: data.total_count, runs: data.workflow_runs.map(normalizeRun) }
}

type CommitInfo = {
  sha: string
  message: string
  author: string | null
  committedAt: number | null
}

async function resolveCommit(token: string, repository: Repository, ref: string): Promise<CommitInfo> {
  const data = await githubGraphql<{
    repository: {
      object: {
        oid?: string
        messageHeadline?: string
        committedDate?: string
        author?: { name: string | null; user: { login: string } | null } | null
      } | null
    } | null
  }>(
    token,
    `query($owner: String!, $name: String!, $expression: String!) {
      repository(owner: $owner, name: $name) {
        object(expression: $expression) {
          ... on Commit { oid messageHeadline committedDate author { name user { login } } }
        }
      }
    }`,
    { owner: repository.owner, name: repository.name, expression: ref },
  )
  const commit = data.repository?.object
  if (!commit?.oid) throw githubError('GITHUB_NOT_FOUND', `Could not find ${ref} in ${repository.fullName}.`)
  return {
    sha: commit.oid,
    message: commit.messageHeadline ?? '',
    author: commit.author?.user?.login ?? commit.author?.name ?? null,
    committedAt: commit.committedDate ? Date.parse(commit.committedDate) : null,
  }
}

/** Reads file contents at `sha` through GraphQL, many files per request. */
async function readBlobs(token: string, repository: Repository, sha: string, paths: string[]) {
  const result = new Map<string, string | null>()
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += BLOB_BATCH_SIZE) {
    batches.push(paths.slice(index, index + BLOB_BATCH_SIZE))
  }
  await mapLimit(batches, 3, async (batch) => {
    const variables: Record<string, string> = { owner: repository.owner, name: repository.name }
    const declarations = batch.map((_, index) => `$e${index}: String!`).join(', ')
    const fields = batch
      .map((path, index) => {
        variables[`e${index}`] = `${sha}:${path}`
        return `f${index}: object(expression: $e${index}) { ... on Blob { text isBinary } }`
      })
      .join('\n')
    const data = await githubGraphql<{
      repository: Record<string, { text?: string | null; isBinary?: boolean } | null> | null
    }>(
      token,
      `query($owner: String!, $name: String!, ${declarations}) {
        repository(owner: $owner, name: $name) { ${fields} }
      }`,
      variables,
    )
    batch.forEach((path, index) => {
      const blob = data.repository?.[`f${index}`]
      result.set(path, blob && !blob.isBinary && typeof blob.text === 'string' ? blob.text : null)
    })
  })
  return result
}

async function loadTree(token: string, repository: Repository, sha: string) {
  const { data } = await githubRequest<{
    truncated: boolean
    tree: Array<{ path: string; type: string; sha: string }>
  }>(token, 'GET', `${repoPath(repository)}/git/trees/${sha}?recursive=1`)
  const files = new Map<string, string>()
  for (const entry of data.tree) {
    if (entry.type === 'blob') files.set(entry.path, entry.sha)
  }
  return { files, truncated: data.truncated }
}

/** Workflow list plus what each workflow file says about manual starts. */
async function loadWorkflowSummaries(
  token: string,
  repository: Repository,
  ref: string,
): Promise<WorkflowSummary[]> {
  const raw = await listAllWorkflows(token, repository)
  const filePaths = raw.map((workflow) => workflow.path).filter((path) => WORKFLOW_FILE.test(path))
  let texts = new Map<string, string | null>()
  try {
    texts = await readBlobs(token, repository, ref, filePaths)
  } catch (error) {
    console.warn('Could not read workflow files', errorMessage(error, ''))
  }
  return raw
    .filter((workflow) => workflow.state !== 'deleted')
    .map((workflow) => {
      const text = texts.get(workflow.path)
      const parsed = typeof text === 'string' ? parseWorkflowFile(text) : null
      return {
        ...normalizeWorkflow(workflow),
        // Dynamic workflows (Dependabot, Copilot) have no file and cannot be started.
        dispatchable: WORKFLOW_FILE.test(workflow.path) ? (parsed ? parsed.dispatchable : null) : false,
        inputs: parsed?.inputs ?? [],
        listensTo: parsed?.listensTo ?? [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
}

// ---------------------------------------------------------------------------
// Reads for the tab

export const getOverview = action({
  args: { projectId: v.id('projects') },
  handler: async (
    ctx,
    args,
  ): Promise<{
    repository: string
    htmlUrl: string
    defaultBranch: string
    workflows: WorkflowSummary[]
    runs: WorkflowRun[]
    totalRuns: number
  }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const [workflows, firstPage, secondPage] = await Promise.all([
      loadWorkflowSummaries(token, repository, repository.defaultBranch),
      listRunsPage(token, repository, 'per_page=100&page=1'),
      listRunsPage(token, repository, 'per_page=100&page=2'),
    ])
    return {
      repository: repository.fullName,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      workflows,
      runs: [...firstPage.runs, ...secondPage.runs],
      totalRuns: firstPage.totalCount,
    }
  },
})

export const listRuns = action({
  args: {
    projectId: v.id('projects'),
    page: v.number(),
    workflowId: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ runs: WorkflowRun[]; totalCount: number }> => {
    const page = Math.min(Math.max(Math.trunc(args.page), 1), 50)
    const perPage = Math.min(Math.max(Math.trunc(args.perPage ?? 100), 1), 100)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    if (args.workflowId !== undefined) {
      assertRunId(args.workflowId)
      const { data } = await githubRequest<{ total_count: number; workflow_runs: RawWorkflowRun[] }>(
        token,
        'GET',
        `${repoPath(repository)}/actions/workflows/${args.workflowId}/runs?per_page=${perPage}&page=${page}`,
      )
      return { runs: data.workflow_runs.map(normalizeRun), totalCount: data.total_count }
    }
    return await listRunsPage(token, repository, `per_page=${perPage}&page=${page}`)
  },
})

/** Loads specific runs, such as a release's runs that are older than the loaded pages. */
export const getRunsById = action({
  args: { projectId: v.id('projects'), runIds: v.array(v.number()) },
  handler: async (ctx, args): Promise<WorkflowRun[]> => {
    const ids = [...new Set(args.runIds)].slice(0, MAX_RUN_IDS)
    ids.forEach(assertRunId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const runs = await mapLimit(ids, 8, async (id) => {
      try {
        const { data } = await githubRequest<RawWorkflowRun>(token, 'GET', `${repoPath(repository)}/actions/runs/${id}`)
        return normalizeRun(data)
      } catch (error) {
        if (error instanceof ConvexError && (error.data as { code?: string }).code === 'GITHUB_NOT_FOUND') return null
        throw error
      }
    })
    return runs.filter((run): run is WorkflowRun => run !== null)
  },
})

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

async function listJobs(token: string, repository: Repository, runId: number) {
  const { data } = await githubRequest<{ jobs: RawJob[] }>(
    token,
    'GET',
    `${repoPath(repository)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
  )
  return data.jobs.map(normalizeJob)
}

export const getRun = action({
  args: { projectId: v.id('projects'), runId: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    repository: string
    run: WorkflowRun
    jobs: RunJob[]
    typicalDurationMs: number | null
    lastSuccess: { id: number; runNumber: number; headSha: string; at: number } | null
  }> => {
    assertRunId(args.runId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const [{ data: rawRun }, jobs] = await Promise.all([
      githubRequest<RawWorkflowRun>(token, 'GET', `${repoPath(repository)}/actions/runs/${args.runId}`),
      listJobs(token, repository, args.runId),
    ])
    const run = normalizeRun(rawRun)
    let typicalDurationMs: number | null = null
    let lastSuccess: { id: number; runNumber: number; headSha: string; at: number } | null = null
    try {
      const { data } = await githubRequest<{ workflow_runs: RawWorkflowRun[] }>(
        token,
        'GET',
        `${repoPath(repository)}/actions/workflows/${run.workflowId}/runs?status=success&per_page=20`,
      )
      const successes = data.workflow_runs.map(normalizeRun).filter((candidate) => candidate.id !== run.id)
      typicalDurationMs = median(successes.map((candidate) => candidate.updatedAt - candidate.startedAt))
      const previous = successes.find((candidate) => candidate.createdAt < run.createdAt)
      if (previous) {
        lastSuccess = {
          id: previous.id,
          runNumber: previous.runNumber,
          headSha: previous.headSha,
          at: previous.updatedAt,
        }
      }
    } catch (error) {
      console.warn('Could not load run history', errorMessage(error, ''))
    }
    return { repository: repository.fullName, run, jobs, typicalDurationMs, lastSuccess }
  },
})

export const getJobLog = action({
  args: { projectId: v.id('projects'), jobId: v.number() },
  handler: async (ctx, args): Promise<{ text: string; truncated: boolean; totalBytes: number }> => {
    assertRunId(args.jobId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    try {
      return await githubDownloadText(token, `${repoPath(repository)}/actions/jobs/${args.jobId}/logs`, MAX_LOG_BYTES)
    } catch (error) {
      if (error instanceof ConvexError && (error.data as { code?: string }).code === 'GITHUB_NOT_FOUND') {
        throw githubError(
          'GITHUB_NOT_FOUND',
          'GitHub has no log for this job yet. Logs appear once the job finishes, and expire after the retention period.',
        )
      }
      throw error
    }
  },
})

export type FailureSummary = {
  runId: number
  jobId: number | null
  jobName: string | null
  stepName: string | null
  lines: string[]
  error: string | null
}

/** The failing step and its error lines for each failed run. */
export const getFailureSummaries = action({
  args: { projectId: v.id('projects'), runIds: v.array(v.number()) },
  handler: async (ctx, args): Promise<FailureSummary[]> => {
    const ids = [...new Set(args.runIds)].slice(0, 50)
    ids.forEach(assertRunId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    return await mapLimit(ids, 5, async (runId): Promise<FailureSummary> => {
      try {
        const jobs = await listJobs(token, repository, runId)
        const failed = jobs.find((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out') ?? null
        if (!failed) {
          return { runId, jobId: null, jobName: null, stepName: null, lines: [], error: null }
        }
        const step = failed.steps.find((candidate) => candidate.conclusion === 'failure') ?? null
        const { text } = await githubDownloadText(
          token,
          `${repoPath(repository)}/actions/jobs/${failed.id}/logs`,
          MAX_SUMMARY_LOG_BYTES,
        )
        return {
          runId,
          jobId: failed.id,
          jobName: failed.name,
          stepName: step?.name ?? null,
          lines: extractErrorLines(text),
          error: null,
        }
      } catch (error) {
        return {
          runId,
          jobId: null,
          jobName: null,
          stepName: null,
          lines: [],
          error: errorMessage(error, 'Could not load the log.'),
        }
      }
    })
  },
})

export const listBranches = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ defaultBranch: string; branches: string[] }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    const branches: string[] = []
    for (let page = 1; page <= 3; page++) {
      const { data } = await githubRequest<Array<{ name: string }>>(
        token,
        'GET',
        `${repoPath(repository)}/branches?per_page=100&page=${page}`,
      )
      branches.push(...data.map((branch) => branch.name))
      if (data.length < 100) break
    }
    const others = branches.filter((name) => name !== repository.defaultBranch).sort()
    return { defaultBranch: repository.defaultBranch, branches: [repository.defaultBranch, ...others] }
  },
})

// ---------------------------------------------------------------------------
// Planning a run

export type PlannedWorkflow = {
  workflowId: number
  name: string
  path: string
  state: WorkflowSummary['state']
  dispatchable: boolean
  inputs: WorkflowSummary['inputs']
  /** Workflows that start whenever this one runs. */
  startsOthers: string[]
  impact: WorkflowImpact
  base: { runId: number; runNumber: number; sha: string; branch: string | null; at: number } | null
}

export type PlanBase = {
  sha: string
  status: 'ahead' | 'behind' | 'diverged' | 'identical' | 'unknown'
  totalCommits: number
  commits: Array<{ sha: string; message: string; author: string | null; at: number | null }>
}

export type RunPlan = {
  ref: string
  head: CommitInfo
  workflows: PlannedWorkflow[]
  bases: PlanBase[]
  counts: Record<ImpactState | 'blocked', number>
}

/** The newest successful run of each workflow, from any branch. */
async function findLastSuccessfulRuns(token: string, repository: Repository, workflowIds: number[]) {
  const found = new Map<number, WorkflowRun>()
  const wanted = new Set(workflowIds)
  for (let page = 1; page <= 4 && found.size < wanted.size; page++) {
    const { runs } = await listRunsPage(token, repository, `status=success&per_page=100&page=${page}`)
    for (const run of runs) {
      if (wanted.has(run.workflowId) && !found.has(run.workflowId)) found.set(run.workflowId, run)
    }
    if (runs.length < 100) break
  }
  const missing = workflowIds.filter((id) => !found.has(id)).slice(0, 60)
  await mapLimit(missing, 6, async (id) => {
    const { data } = await githubRequest<{ workflow_runs: RawWorkflowRun[] }>(
      token,
      'GET',
      `${repoPath(repository)}/actions/workflows/${id}/runs?status=success&per_page=1`,
    )
    const run = data.workflow_runs[0]
    if (run) found.set(id, normalizeRun(run))
  })
  return found
}

type RawCompare = {
  status: PlanBase['status']
  total_commits: number
  files?: Array<{ filename: string; previous_filename?: string }>
  commits: Array<{
    sha: string
    commit: { message: string; author?: { name?: string; date?: string } | null }
    author?: { login: string } | null
  }>
}

async function compareCommits(token: string, repository: Repository, base: string, head: string) {
  const path = `${repoPath(repository)}/compare/${base}...${head}`
  const { data } = await githubRequest<RawCompare>(token, 'GET', `${path}?per_page=100`)
  let commits = data.commits
  if (data.total_commits > 100) {
    // Page 1 holds the oldest commits; show the newest.
    const lastPage = Math.ceil(data.total_commits / 100)
    const { data: last } = await githubRequest<RawCompare>(token, 'GET', `${path}?per_page=100&page=${lastPage}`)
    commits = last.commits
  }
  return { data, commits }
}

async function loadChanges(
  token: string,
  repository: Repository,
  baseSha: string,
  head: { sha: string; tree: { files: Map<string, string>; truncated: boolean } },
): Promise<{ base: PlanBase; changes: { files: ChangedFile[]; complete: boolean } | null }> {
  let compare: Awaited<ReturnType<typeof compareCommits>> | null = null
  try {
    compare = await compareCommits(token, repository, baseSha, head.sha)
  } catch (error) {
    console.warn('Compare failed', errorMessage(error, ''))
  }
  const base: PlanBase = {
    sha: baseSha,
    status: compare?.data.status ?? 'unknown',
    totalCommits: compare?.data.total_commits ?? 0,
    commits: (compare?.commits ?? [])
      .map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message.split('\n')[0],
        author: commit.author?.login ?? commit.commit.author?.name ?? null,
        at: commit.commit.author?.date ? Date.parse(commit.commit.author.date) : null,
      }))
      .reverse()
      .slice(0, 100),
  }
  // A three-dot compare from an ancestor lists exactly the changed files, up
  // to GitHub's limit of 300. Otherwise compare the two trees directly.
  const compareFiles = compare?.data.files
  if (compare && compare.data.status === 'ahead' && compareFiles && compareFiles.length < 300) {
    return {
      base,
      changes: {
        files: compareFiles.map((file) => ({ path: file.filename, previousPath: file.previous_filename ?? null })),
        complete: true,
      },
    }
  }
  if (compare?.data.status === 'identical') return { base, changes: { files: [], complete: true } }
  try {
    const baseTree = await loadTree(token, repository, baseSha)
    return {
      base,
      changes: {
        files: diffTrees(baseTree.files, head.tree.files),
        complete: !baseTree.truncated && !head.tree.truncated,
      },
    }
  } catch (error) {
    console.warn('Tree diff failed', errorMessage(error, ''))
    if (compareFiles) {
      return {
        base,
        changes: {
          files: compareFiles.map((file) => ({ path: file.filename, previousPath: file.previous_filename ?? null })),
          complete: false,
        },
      }
    }
    return { base, changes: null }
  }
}

export const planRun = action({
  args: { projectId: v.id('projects'), workflowIds: v.array(v.number()), ref: v.string() },
  handler: async (ctx, args): Promise<RunPlan> => {
    const ref = assertRef(args.ref)
    const workflowIds = [...new Set(args.workflowIds)]
    if (!workflowIds.length) throw invalidInput('Choose at least one workflow.')
    if (workflowIds.length > MAX_PLAN_WORKFLOWS) {
      throw invalidInput(`Choose up to ${MAX_PLAN_WORKFLOWS} workflows at a time.`)
    }
    workflowIds.forEach(assertRunId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')

    const head = await resolveCommit(token, repository, ref)
    const [rawWorkflows, headTree, lastSuccess] = await Promise.all([
      listAllWorkflows(token, repository),
      loadTree(token, repository, head.sha),
      findLastSuccessfulRuns(token, repository, workflowIds),
    ])
    const byId = new Map(rawWorkflows.map((workflow) => [workflow.id, workflow]))
    const allFiles = rawWorkflows.map((workflow) => workflow.path).filter((path) => headTree.files.has(path))
    const workflowTexts = await readBlobs(token, repository, head.sha, allFiles)

    // Which workflows start when another runs (`on.workflow_run`).
    const listeners = new Map<string, string[]>()
    const parsedByPath = new Map<string, ReturnType<typeof parseWorkflowFile>>()
    for (const workflow of rawWorkflows) {
      const text = workflowTexts.get(workflow.path)
      if (typeof text !== 'string') continue
      const parsed = parseWorkflowFile(text)
      parsedByPath.set(workflow.path, parsed)
      for (const name of parsed.listensTo) listeners.set(name, [...(listeners.get(name) ?? []), workflow.name])
    }

    const selected = workflowIds.map((id) => byId.get(id) ?? null)
    const selectedTexts = new Map<string, string>()
    for (const workflow of selected) {
      const text = workflow ? workflowTexts.get(workflow.path) : null
      if (workflow && typeof text === 'string') selectedTexts.set(workflow.path, text)
    }
    const files = new Set(headTree.files.keys())
    const analyses = await analyzeWorkflows(selectedTexts, {
      files,
      read: (paths) => readBlobs(token, repository, head.sha, paths),
    })

    const baseShas = [
      ...new Set(
        [...lastSuccess.values()].map((run) => run.headSha).filter((sha) => sha !== head.sha),
      ),
    ]
    const changesByBase = new Map<string, Awaited<ReturnType<typeof loadChanges>>>()
    await mapLimit(baseShas, 3, async (sha) => {
      changesByBase.set(sha, await loadChanges(token, repository, sha, { sha: head.sha, tree: headTree }))
    })

    const counts: RunPlan['counts'] = { changed: 0, unchanged: 0, unknown: 0, 'never-built': 0, blocked: 0 }
    const planned: PlannedWorkflow[] = []
    workflowIds.forEach((id, index) => {
      const raw = selected[index]
      if (!raw) {
        counts.blocked++
        planned.push({
          workflowId: id,
          name: `Workflow ${id}`,
          path: '',
          state: 'deleted',
          dispatchable: false,
          inputs: [],
          startsOthers: [],
          impact: { state: 'unknown', summary: 'This workflow no longer exists.', files: [], moreFiles: 0, notes: [] },
          base: null,
        })
        return
      }
      const workflow = normalizeWorkflow(raw)
      const parsed = parsedByPath.get(raw.path) ?? null
      const analysis = analyses.get(raw.path) ?? {
        rules: [],
        complete: false,
        notes: [`${raw.path} is not on ${ref}.`],
        builds: [],
      }
      const baseRun = lastSuccess.get(id) ?? null
      const changes = baseRun && baseRun.headSha !== head.sha ? (changesByBase.get(baseRun.headSha)?.changes ?? null) : null
      const impact = computeImpact({ analysis, baseSha: baseRun?.headSha ?? null, headSha: head.sha, changes })
      const dispatchable = Boolean(parsed?.dispatchable) && workflow.state === 'active'
      if (dispatchable) counts[impact.state]++
      else counts.blocked++
      planned.push({
        workflowId: id,
        name: workflow.name,
        path: workflow.path,
        state: workflow.state,
        dispatchable,
        inputs: parsed?.inputs ?? [],
        startsOthers: listeners.get(raw.name) ?? [],
        impact,
        base: baseRun
          ? {
              runId: baseRun.id,
              runNumber: baseRun.runNumber,
              sha: baseRun.headSha,
              branch: baseRun.branch,
              at: baseRun.updatedAt,
            }
          : null,
      })
    })

    return {
      ref,
      head,
      workflows: planned,
      bases: [...changesByBase.values()].map((entry) => entry.base),
      counts,
    }
  },
})

// ---------------------------------------------------------------------------
// Writes

const MAX_INPUTS = 25

export const startRun = action({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    ref: v.string(),
    expectedHeadSha: v.string(),
    groupIds: v.array(v.id('githubWorkflowGroups')),
    items: v.array(v.object({ workflowId: v.number(), inputs: v.record(v.string(), v.string()) })),
    skipped: v.array(
      v.object({
        workflowId: v.number(),
        workflowName: v.string(),
        reason: v.union(v.literal('unchanged'), v.literal('removed')),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    releaseId: Id<'githubWorkflowReleases'>
    runs: Array<{ workflowId: number; workflowName: string; runId: number | null; error: string | null }>
  }> => {
    const ref = assertRef(args.ref)
    const name = args.name.trim().replace(/\s+/g, ' ').slice(0, 100) || 'Release'
    const items = args.items.filter(
      (item, index) => args.items.findIndex((other) => other.workflowId === item.workflowId) === index,
    )
    if (!items.length) throw invalidInput('Choose at least one workflow to start.')
    if (items.length > MAX_PLAN_WORKFLOWS) throw invalidInput(`Start up to ${MAX_PLAN_WORKFLOWS} workflows at a time.`)
    for (const item of items) {
      assertRunId(item.workflowId)
      const entries = Object.entries(item.inputs)
      if (entries.length > MAX_INPUTS) throw invalidInput(`Workflows accept up to ${MAX_INPUTS} inputs.`)
      if (entries.some(([key, value]) => key.length > 100 || value.length > 2000)) {
        throw invalidInput('An input value is too long.')
      }
    }
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')

    const head = await resolveCommit(token, repository, ref)
    if (head.sha !== args.expectedHeadSha) {
      throw new ConvexError({
        code: 'GITHUB_REF_MOVED',
        message: `${ref} moved to ${head.sha.slice(0, 7)} since you reviewed it. Check the changes again before starting.`,
        headSha: head.sha,
      })
    }

    const workflows = new Map((await listAllWorkflows(token, repository)).map((workflow) => [workflow.id, workflow]))
    const runs = items.map((item) => {
      const workflow = workflows.get(item.workflowId)
      return {
        workflowId: item.workflowId,
        workflowName: workflow?.name ?? `Workflow ${item.workflowId}`,
        workflowPath: workflow?.path ?? '',
        runId: null as number | null,
        error: workflow ? null : 'This workflow no longer exists.',
      }
    })

    const releaseId = await ctx.runMutation(internal.githubWorkflowGroups.createRelease, {
      projectId: args.projectId,
      repositoryId: repository.repositoryId,
      name,
      ref,
      headSha: head.sha,
      groupIds: args.groupIds,
      runs,
      skipped: args.skipped.slice(0, 200).map((entry) => ({
        ...entry,
        workflowName: entry.workflowName.slice(0, 200),
      })),
    })

    const startedAt = Date.now()
    await mapLimit(items, 4, async (item, index) => {
      if (runs[index].error) return
      try {
        const { data } = await githubRequest<{ workflow_run_id?: number } | null>(
          token,
          'POST',
          `${repoPath(repository)}/actions/workflows/${item.workflowId}/dispatches`,
          {
            ref,
            ...(Object.keys(item.inputs).length ? { inputs: item.inputs } : {}),
            return_run_details: true,
          },
        )
        runs[index].runId = data?.workflow_run_id ?? null
      } catch (error) {
        runs[index].error = errorMessage(error, 'GitHub did not start this workflow.')
      }
    })

    // Older GitHub versions do not return run ids; match new runs instead.
    const unmatched = runs.filter((run) => run.runId === null && run.error === null)
    if (unmatched.length) {
      try {
        const since = new Date(startedAt - 60_000).toISOString()
        const { runs: recent } = await listRunsPage(
          token,
          repository,
          `event=workflow_dispatch&per_page=100&created=${encodeURIComponent(`>=${since}`)}`,
        )
        for (const run of unmatched) {
          const match = recent.find(
            (candidate) =>
              candidate.workflowId === run.workflowId &&
              candidate.headSha === head.sha &&
              !runs.some((other) => other.runId === candidate.id),
          )
          if (match) run.runId = match.id
          else run.error = 'Started, but GitHub did not say which run it created.'
        }
      } catch {
        for (const run of unmatched) run.error = 'Started, but GitHub did not say which run it created.'
      }
    }

    await ctx.runMutation(internal.githubWorkflowGroups.finishRelease, {
      projectId: args.projectId,
      releaseId,
      runs,
      repository: repository.fullName,
    })
    return { releaseId, runs }
  },
})

type RunActionResult = { runId: number; ok: boolean; error: string | null }

async function forEachRun(
  runIds: number[],
  task: (runId: number) => Promise<unknown>,
): Promise<RunActionResult[]> {
  const ids = [...new Set(runIds)].slice(0, MAX_RUN_IDS)
  ids.forEach(assertRunId)
  return await mapLimit(ids, 4, async (runId) => {
    try {
      await task(runId)
      return { runId, ok: true, error: null }
    } catch (error) {
      return { runId, ok: false, error: errorMessage(error, 'GitHub rejected the request.') }
    }
  })
}

export const rerunRuns = action({
  args: { projectId: v.id('projects'), runIds: v.array(v.number()), failedOnly: v.boolean() },
  handler: async (ctx, args): Promise<RunActionResult[]> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    return await forEachRun(args.runIds, (runId) =>
      githubRequest(
        token,
        'POST',
        `${repoPath(repository)}/actions/runs/${runId}/${args.failedOnly ? 'rerun-failed-jobs' : 'rerun'}`,
      ),
    )
  },
})

export const cancelRuns = action({
  args: { projectId: v.id('projects'), runIds: v.array(v.number()) },
  handler: async (ctx, args): Promise<RunActionResult[]> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    return await forEachRun(args.runIds, (runId) =>
      githubRequest(token, 'POST', `${repoPath(repository)}/actions/runs/${runId}/cancel`),
    )
  },
})

export const setWorkflowEnabled = action({
  args: { projectId: v.id('projects'), workflowId: v.number(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    assertRunId(args.workflowId)
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'write')
    await githubRequest(
      token,
      'PUT',
      `${repoPath(repository)}/actions/workflows/${args.workflowId}/${args.enabled ? 'enable' : 'disable'}`,
    )
    return null
  },
})
