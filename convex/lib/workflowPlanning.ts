import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { invalidInput, loadLinkedClient, repoPath } from './githubAccess'
import { githubRequest } from './githubApi'
import {
  assertRef,
  assertRunId,
  type CommitInfo,
  errorMessage,
  listAllWorkflows,
  listRunsPage,
  loadTree,
  mapLimit,
  readBlobs,
  type Repository,
  resolveCommit,
} from './githubWorkflowReads'
import { normalizeRun, normalizeWorkflow, type RawWorkflowRun, type WorkflowRun, type WorkflowSummary } from './githubWorkflowsApi'
import { type DeepCandidate, type DeepStats, traceCandidates } from './workflowDeepAnalysis'
import {
  analyzeWorkflows,
  type ChangedFile,
  computeImpact,
  diffTrees,
  type ImpactState,
  matchChanges,
  parseWorkflowFile,
  type WorkflowAnalysis,
  type WorkflowImpact,
} from './workflowImpact'

// Plans a workflow run: which selected workflows the changes since their
// last successful build affect. Shared by `githubWorkflows.planRun` (folder
// rules) and `githubWorkflowsDeep.planDeepRun` (folder rules narrowed by
// C# name tracing, see workflowDeepAnalysis.ts).

export const MAX_PLAN_WORKFLOWS = 150

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
  /** Which check produced this plan. */
  analysis: 'standard' | 'deep'
  deep: DeepStats | null
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

export type PlanArgs = { projectId: Id<'projects'>; workflowIds: number[]; ref: string }

export async function planWorkflowRun(ctx: ActionCtx, args: PlanArgs, options: { deep: boolean }): Promise<RunPlan> {
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

  const entries = workflowIds.map((id, index) => {
    const raw = selected[index]
    if (!raw) return { id, raw: null, analysis: null, baseRun: null, changes: null, impact: null }
    const analysis: WorkflowAnalysis = analyses.get(raw.path) ?? {
      rules: [],
      sources: [],
      complete: false,
      notes: [`${raw.path} is not on ${ref}.`],
      builds: [],
    }
    const baseRun = lastSuccess.get(id) ?? null
    const changes = baseRun && baseRun.headSha !== head.sha ? (changesByBase.get(baseRun.headSha)?.changes ?? null) : null
    const impact = computeImpact({ analysis, baseSha: baseRun?.headSha ?? null, headSha: head.sha, changes })
    return { id, raw, analysis, baseRun, changes, impact }
  })

  let deep: DeepStats | null = null
  if (options.deep) {
    const candidates: DeepCandidate[] = []
    for (const entry of entries) {
      if (!entry.impact || entry.impact.state !== 'changed' || !entry.analysis || !entry.baseRun || !entry.changes) continue
      if (!entry.analysis.complete || !entry.analysis.sources.length) {
        entry.impact = {
          ...entry.impact,
          notes: [...entry.impact.notes, 'Deep analysis only narrows .NET builds Tasker can follow completely.'],
        }
        continue
      }
      candidates.push({
        key: entry.id,
        analysis: entry.analysis,
        baseSha: entry.baseRun.headSha,
        changes: matchChanges(entry.analysis.rules, entry.changes.files).map((match) => match.file),
      })
    }
    const traced = await traceCandidates(ctx, { token, repository, headSha: head.sha, headTree, candidates })
    deep = traced.stats
    for (const entry of entries) {
      const result = traced.results.get(entry.id)
      if (!result || !entry.impact) continue
      entry.impact = result.affected
        ? { ...entry.impact, trace: { reason: result.reason, path: result.path, traced: [] } }
        : {
            ...entry.impact,
            state: 'unaffected',
            summary: `${entry.impact.files.length + entry.impact.moreFiles} changed files are in projects it references, but none of the changes reach its own code.`,
            trace: { reason: 'No changed type is used by its own code.', path: null, traced: result.traced },
          }
    }
  }

  const counts: RunPlan['counts'] = {
    changed: 0,
    unchanged: 0,
    unaffected: 0,
    unknown: 0,
    'never-built': 0,
    blocked: 0,
  }
  const planned: PlannedWorkflow[] = []
  for (const { id, raw, impact, baseRun } of entries) {
    if (!raw || !impact) {
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
      continue
    }
    const workflow = normalizeWorkflow(raw)
    const parsed = parsedByPath.get(raw.path) ?? null
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
  }

  return {
    ref,
    head,
    workflows: planned,
    bases: [...changesByBase.values()].map((entry) => entry.base),
    counts,
    analysis: options.deep ? 'deep' : 'standard',
    deep,
  }
}
