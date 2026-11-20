import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action } from './_generated/server'
import { invalidInput, loadLinkedClient, repoPath } from './lib/githubAccess'
import { githubDownloadText, githubError, githubRequest } from './lib/githubApi'
import {
  assertRef,
  assertRunId,
  errorMessage,
  listAllWorkflows,
  listRunsPage,
  loadWorkflowSummaries,
  mapLimit,
  type Repository,
  resolveCommit,
} from './lib/githubWorkflowReads'
import {
  extractErrorLines,
  normalizeJob,
  normalizeRun,
  type RawJob,
  type RawWorkflowRun,
  type RunJob,
  type WorkflowRun,
  type WorkflowSummary,
} from './lib/githubWorkflowsApi'
import { MAX_PLAN_WORKFLOWS, planWorkflowRun, type RunPlan } from './lib/workflowPlanning'

export type { PlanBase, PlannedWorkflow, RunPlan } from './lib/workflowPlanning'

// GitHub Actions for the project Workflows tab. Every call uses the signed-in
// user's own token after Tasker checks their project access (`view` for
// reads, `write` for starting, re-running and cancelling). Nothing GitHub
// returns is stored; releases only record which runs Tasker started. The one
// exception is deep analysis's index of C# names (convex/githubCsharpIndex.ts).

const MAX_RUN_IDS = 100
const MAX_LOG_BYTES = 4_000_000
const MAX_SUMMARY_LOG_BYTES = 1_500_000

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

/** Whether the dialog offers deep analysis: the repository has C# code. */
export const getPlanOptions = action({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args): Promise<{ deepAnalysis: boolean }> => {
    const { token, repository } = await loadLinkedClient(ctx, args.projectId, 'view')
    try {
      const { data } = await githubRequest<Record<string, number>>(token, 'GET', `${repoPath(repository)}/languages`)
      return { deepAnalysis: (data['C#'] ?? 0) > 0 }
    } catch (error) {
      console.warn('Could not load repository languages', errorMessage(error, ''))
      return { deepAnalysis: false }
    }
  },
})

/** The usual check: folder and project-file rules. Deep analysis is `githubWorkflowsDeep.planDeepRun`. */
export const planRun = action({
  args: { projectId: v.id('projects'), workflowIds: v.array(v.number()), ref: v.string() },
  handler: async (ctx, args): Promise<RunPlan> => await planWorkflowRun(ctx, args, { deep: false }),
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
        reason: v.union(v.literal('unchanged'), v.literal('unaffected'), v.literal('removed')),
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
