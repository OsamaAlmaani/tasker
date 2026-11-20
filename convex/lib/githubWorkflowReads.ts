import { ConvexError } from 'convex/values'
import { invalidInput, type LinkedGitHubClient, repoPath } from './githubAccess'
import { githubError, githubGraphql, githubRequest } from './githubApi'
import { normalizeRun, normalizeWorkflow, type RawWorkflow, type RawWorkflowRun, type WorkflowSummary } from './githubWorkflowsApi'
import { parseWorkflowFile } from './workflowImpact'

// GitHub reads shared by the Actions workflow functions in
// convex/githubWorkflows.ts and the deep analysis action in
// convex/githubWorkflowsDeep.ts. Every call uses the caller's own token.

export const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/
export const BLOB_BATCH_SIZE = 80

export type Repository = LinkedGitHubClient['repository']

/** Runs `task` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
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

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string
    return typeof data === 'string' ? data : (data.message ?? fallback)
  }
  return error instanceof Error ? error.message : fallback
}

export function assertRunId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw invalidInput('That run could not be found.')
}

export function assertRef(ref: string) {
  const trimmed = ref.trim()
  if (!trimmed || trimmed.length > 255 || /\s|\.\.|[~^:?*[\\]/.test(trimmed)) {
    throw invalidInput('Choose a valid branch or tag.')
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// GitHub reads

export async function listAllWorkflows(token: string, repository: Repository) {
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

export async function listRunsPage(token: string, repository: Repository, query: string) {
  const { data } = await githubRequest<{ total_count: number; workflow_runs: RawWorkflowRun[] }>(
    token,
    'GET',
    `${repoPath(repository)}/actions/runs?${query}`,
  )
  return { totalCount: data.total_count, runs: data.workflow_runs.map(normalizeRun) }
}

export type CommitInfo = {
  sha: string
  message: string
  author: string | null
  committedAt: number | null
}

export async function resolveCommit(token: string, repository: Repository, ref: string): Promise<CommitInfo> {
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

/** A file read at a commit: its text, `unreadable` (binary or too large), or `missing`. */
export type BlobRead = { text: string } | 'unreadable' | 'missing'

/** Reads files at `sha` through GraphQL, many files per request. */
export async function readBlobDetails(
  token: string,
  repository: Repository,
  sha: string,
  paths: string[],
  concurrency = 3,
) {
  const result = new Map<string, BlobRead>()
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += BLOB_BATCH_SIZE) {
    batches.push(paths.slice(index, index + BLOB_BATCH_SIZE))
  }
  await mapLimit(batches, concurrency, async (batch) => {
    const variables: Record<string, string> = { owner: repository.owner, name: repository.name }
    const declarations = batch.map((_, index) => `$e${index}: String!`).join(', ')
    const fields = batch
      .map((path, index) => {
        variables[`e${index}`] = `${sha}:${path}`
        return `f${index}: object(expression: $e${index}) { ... on Blob { text isBinary isTruncated } }`
      })
      .join('\n')
    const data = await githubGraphql<{
      repository: Record<string, { text?: string | null; isBinary?: boolean; isTruncated?: boolean } | null> | null
    }>(
      token,
      `query($owner: String!, $name: String!, ${declarations}) {
        repository(owner: $owner, name: $name) { ${fields} }
      }`,
      variables,
    )
    batch.forEach((path, index) => {
      const blob = data.repository?.[`f${index}`]
      if (!blob) result.set(path, 'missing')
      else if (blob.isBinary || blob.isTruncated || typeof blob.text !== 'string') result.set(path, 'unreadable')
      else result.set(path, { text: blob.text })
    })
  })
  return result
}

/** Reads file contents at `sha`; missing, binary and truncated files map to null. */
export async function readBlobs(token: string, repository: Repository, sha: string, paths: string[]) {
  const result = new Map<string, string | null>()
  for (const [path, read] of await readBlobDetails(token, repository, sha, paths)) {
    result.set(path, typeof read === 'object' ? read.text : null)
  }
  return result
}

export async function loadTree(token: string, repository: Repository, sha: string) {
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
export async function loadWorkflowSummaries(
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
