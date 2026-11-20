import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import {
  buildSymbolGraph,
  CSHARP_INDEX_VERSION,
  type ChangedSource,
  type CsharpFileIndex,
  indexCsharpFile,
  isCsharpSource,
  isTracedSource,
  type SourceScope,
  type SourceVersion,
  type TraceResult,
  traceImpact,
} from './csharpImpact'
import { type BlobRead, errorMessage, mapLimit, type Repository, readBlobDetails } from './githubWorkflowReads'
import type { ChangedFile, WorkflowAnalysis } from './workflowImpact'

// Deep analysis for a run plan: indexes the C# sources of every project the
// candidate workflows build, then traces whether their changed files reach
// each workflow's own code (convex/lib/csharpImpact.ts).
//
// Index entries are cached per repository and git blob SHA in
// `githubCsharpIndex`. A blob SHA names exact file contents, so an entry can
// never describe a different version of a file; CSHARP_INDEX_VERSION retires
// entries made by older parsing code. The cache holds derived identifiers,
// never source text, is read only here, and only for blob SHAs the caller's
// own token just listed in the repository tree.

const CACHE_READ_CHUNK = 300
const CACHE_WRITE_CHUNK = 100
const CACHE_TOUCH_CHUNK = 500
const DEEP_READ_CONCURRENCY = 4

export type DeepCandidate = {
  key: number
  analysis: WorkflowAnalysis
  baseSha: string
  /** Changed files the folder rules matched for this workflow. */
  changes: ChangedFile[]
}

export type DeepStats = {
  /** Workflows the folder rules marked as changed that deep analysis traced. */
  traced: number
  unaffected: number
  /** C# files indexed for the trace, and how many came from the cache. */
  indexedFiles: number
  cachedFiles: number
  durationMs: number
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function inScopes(directories: Set<string>, files: Set<string>, path: string) {
  if (files.has(path) || directories.has('')) return true
  let index = path.indexOf('/')
  while (index !== -1) {
    if (directories.has(path.slice(0, index))) return true
    index = path.indexOf('/', index + 1)
  }
  return false
}

function versionOf(read: BlobRead | undefined): SourceVersion {
  if (read === undefined || read === 'missing') return null
  if (read === 'unreadable') return 'unreadable'
  return read.text
}

export async function traceCandidates(
  ctx: ActionCtx,
  {
    token,
    repository,
    headSha,
    headTree,
    candidates,
  }: {
    token: string
    repository: Repository
    headSha: string
    headTree: { files: Map<string, string>; truncated: boolean }
    candidates: DeepCandidate[]
  },
): Promise<{ results: Map<number, TraceResult>; stats: DeepStats }> {
  const startedAt = Date.now()
  const results = new Map<number, TraceResult>()
  const stats: DeepStats = { traced: candidates.length, unaffected: 0, indexedFiles: 0, cachedFiles: 0, durationMs: 0 }
  if (!candidates.length) return { results, stats }
  if (headTree.truncated) {
    for (const candidate of candidates) {
      results.set(candidate.key, {
        affected: true,
        reason: 'The repository is too large for Tasker to list every file, so deep analysis cannot check it.',
        path: null,
      })
    }
    stats.durationMs = Date.now() - startedAt
    return { results, stats }
  }

  try {
    // 1. Every traced C# source inside the projects the candidates build.
    const directories = new Set<string>()
    const linkedFiles = new Set<string>()
    for (const candidate of candidates) {
      for (const scope of candidate.analysis.sources) {
        if (scope.kind === 'directory') directories.add(scope.path)
        else linkedFiles.add(scope.path)
      }
    }
    const sources = new Map<string, string>() // path -> blob sha
    for (const [path, sha] of headTree.files) {
      if (isTracedSource(path) && inScopes(directories, linkedFiles, path)) sources.set(path, sha)
    }
    stats.indexedFiles = sources.size

    // 2. Cached index entries, by blob sha.
    const shas = [...new Set(sources.values())]
    const byBlob = new Map<string, CsharpFileIndex>()
    const stale: string[] = []
    await mapLimit(chunk(shas, CACHE_READ_CHUNK), 6, async (blobShas) => {
      const entries = await ctx.runQuery(internal.githubCsharpIndex.getEntries, {
        repositoryId: repository.repositoryId,
        version: CSHARP_INDEX_VERSION,
        blobShas,
      })
      for (const entry of entries) {
        try {
          byBlob.set(entry.blobSha, JSON.parse(entry.data) as CsharpFileIndex)
          if (entry.stale) stale.push(entry.id)
        } catch {
          // A damaged entry is read again below.
        }
      }
    })

    // 3. Read and index everything else, then cache it.
    const pathByBlob = new Map<string, string>()
    for (const [path, sha] of sources) if (!byBlob.has(sha) && !pathByBlob.has(sha)) pathByBlob.set(sha, path)
    const unreadable: string[] = []
    const fresh: Array<{ blobSha: string; data: string }> = []
    if (pathByBlob.size) {
      const reads = await readBlobDetails(token, repository, headSha, [...pathByBlob.values()], DEEP_READ_CONCURRENCY)
      for (const [sha, path] of pathByBlob) {
        const read = reads.get(path)
        if (!read || typeof read !== 'object') continue
        const index = indexCsharpFile(read.text)
        byBlob.set(sha, index)
        fresh.push({ blobSha: sha, data: JSON.stringify(index) })
      }
    }
    stats.cachedFiles = [...sources.values()].filter((sha) => !pathByBlob.has(sha)).length
    await mapLimit(chunk(fresh, CACHE_WRITE_CHUNK), 4, (entries) =>
      ctx.runMutation(internal.githubCsharpIndex.putEntries, {
        repositoryId: repository.repositoryId,
        version: CSHARP_INDEX_VERSION,
        entries,
      }),
    )
    await mapLimit(chunk(stale, CACHE_TOUCH_CHUNK), 4, (ids) =>
      ctx.runMutation(internal.githubCsharpIndex.touchEntries, { ids }),
    )

    const files = new Map<string, CsharpFileIndex>()
    for (const [path, sha] of sources) {
      const index = byBlob.get(sha)
      if (index) files.set(path, index)
      else unreadable.push(path)
    }
    const graph = buildSymbolGraph(files, unreadable)

    // 4. Before and after text of the changed C# files the trace will look at.
    const wanted = new Map<string, Set<string>>() // commit sha -> paths
    const want = (sha: string, path: string) => {
      const paths = wanted.get(sha) ?? new Set<string>()
      paths.add(path)
      wanted.set(sha, paths)
    }
    for (const candidate of candidates) {
      for (const change of candidate.changes) {
        if (!isTracedSource(change.path) || !needsText(candidate.analysis.sources, change)) continue
        if (headTree.files.has(change.path)) want(headSha, change.path)
        want(candidate.baseSha, change.previousPath ?? change.path)
      }
    }
    const texts = new Map<string, Map<string, BlobRead>>()
    await mapLimit([...wanted], 3, async ([sha, paths]) => {
      texts.set(sha, await readBlobDetails(token, repository, sha, [...paths], DEEP_READ_CONCURRENCY))
    })

    // 5. Trace each workflow.
    for (const candidate of candidates) {
      const changes: ChangedSource[] = candidate.changes.map((change) => ({
        path: change.path,
        previousPath: change.previousPath,
        before: isCsharpSource(change.path)
          ? versionOf(texts.get(candidate.baseSha)?.get(change.previousPath ?? change.path))
          : null,
        after:
          isCsharpSource(change.path) && headTree.files.has(change.path)
            ? (versionOf(texts.get(headSha)?.get(change.path)) ?? 'unreadable')
            : null,
      }))
      const result = traceImpact({ graph, scopes: candidate.analysis.sources, changes })
      if (!result.affected) stats.unaffected++
      results.set(candidate.key, result)
    }
  } catch (error) {
    throw new ConvexError({
      code: 'DEEP_ANALYSIS_FAILED',
      message: `Deep analysis could not finish: ${errorMessage(error, 'GitHub did not answer.')} Try again, or use the usual check.`,
    })
  }
  stats.durationMs = Date.now() - startedAt
  return { results, stats }
}

/** Only changed files in referenced (not root) projects are traced, so only they need their text. */
function needsText(scopes: SourceScope[], change: ChangedFile) {
  let best: SourceScope | null = null
  for (const scope of scopes) {
    const matches =
      scope.kind === 'file' ? scope.path === change.path : scope.path === '' || change.path.startsWith(`${scope.path}/`)
    if (!matches) continue
    if (!best || (scope.kind === 'file' && best.kind !== 'file') || scope.path.length > best.path.length) best = scope
  }
  return best !== null && !best.root
}
