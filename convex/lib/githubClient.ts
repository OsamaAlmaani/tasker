'use node'

import { createSign } from 'node:crypto'
import { ConvexError } from 'convex/values'
import type { GithubPullRequest, GithubSnapshot } from './github'

export class GithubHttpError extends Error {
  constructor(public status: number) {
    const hint = status === 404 ? 'Repository, branch, or App installation was not found.'
      : status === 401 || status === 403 ? 'Check the App installation permissions and GitHub rate limits.'
      : status === 422 ? 'The branch already exists or GitHub rejected the branch name.'
      : 'GitHub could not complete this request. Try again.'
    super(`GitHub (${status}): ${hint}`)
  }
}

export function createAppJwt() {
  const issuer = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!issuer || !privateKey) throw new ConvexError({ code: 'CONFIG_ERROR', message: 'The GitHub App is not configured on this deployment.' })
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: issuer })).toString('base64url')
  try {
    const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url')
    return `${header}.${payload}.${signature}`
  } catch {
    throw new ConvexError({ code: 'CONFIG_ERROR', message: 'The GitHub App private key is invalid.' })
  }
}

type ApiPull = {
  number: number
  state: 'open' | 'closed'
  draft: boolean
  merged?: boolean
  merged_at?: string | null
  base: { ref: string; repo: { id: number } | null }
  head: { ref: string; repo: { id: number } | null }
}

export class GithubClient {
  constructor(private token: string) {}

  async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2026-03-10',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      })
    } catch {
      throw new Error('Could not reach GitHub. Try again shortly.')
    }
    if (!response.ok) throw new GithubHttpError(response.status)
    try { return await response.json() as T } catch { throw new Error('GitHub returned an invalid response. Try again.') }
  }

  async branchSha(owner: string, repo: string, branch: string) {
    try {
      const data = await this.request<{ object: { sha: string } }>(`${repoPath(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`)
      if (!/^[a-f0-9]{40}$/.test(data.object?.sha)) throw new Error('GitHub returned an invalid branch reference.')
      return data.object.sha
    } catch (cause) {
      if (cause instanceof GithubHttpError && cause.status === 404) return null
      throw cause
    }
  }

  async createBranch(owner: string, repo: string, branch: string, sha: string) {
    await this.request(`${repoPath(owner, repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha })
  }

  async pullRequestBaseline(owner: string, repo: string, branch: string) {
    let maximum = 0
    for (let page = 1; page <= 10; page++) {
      const pulls = await this.request<ApiPull[]>(`${repoPath(owner, repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&sort=created&direction=desc&per_page=100&page=${page}`)
      for (const pull of pulls) {
        if (!Number.isSafeInteger(pull.number) || pull.number <= 0) throw new Error('GitHub returned an invalid pull request number.')
        maximum = Math.max(maximum, pull.number)
      }
      if (pulls.length < 100) return maximum
    }
    throw new Error('This branch name has too much pull request history. Choose a new branch name.')
  }

  async snapshot(args: { owner: string; repo: string; repositoryId: number; branch: string; baseBranch?: string; pullNumber?: number; minimumPullNumber?: number }): Promise<GithubSnapshot> {
    const { owner, repo, branch, repositoryId, pullNumber } = args
    const branchExists = (await this.branchSha(owner, repo, branch)) !== null
    const matches = (pr: ApiPull) => pr.head.ref === branch && pr.head.repo?.id === repositoryId && pr.base.repo?.id === repositoryId && pr.number > (args.minimumPullNumber ?? 0)
    let pr: ApiPull | undefined
    if (pullNumber) {
      pr = await this.request<ApiPull>(`${repoPath(owner, repo)}/pulls/${pullNumber}`)
      if (!matches(pr)) throw new Error('The linked pull request no longer matches this task branch.')
    } else {
      const base = args.baseBranch ? `&base=${encodeURIComponent(args.baseBranch)}` : ''
      const pulls = await this.request<ApiPull[]>(`${repoPath(owner, repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&sort=created&direction=desc&per_page=10${base}`)
      const candidate = pulls.find(matches)
      // The list response does not reliably include merged; read the selected PR.
      if (candidate) pr = await this.request<ApiPull>(`${repoPath(owner, repo)}/pulls/${candidate.number}`)
      if (pr && !matches(pr)) throw new Error('The pull request changed while syncing. Refresh again.')
    }
    if (!pr) return { branchExists }
    const state: GithubPullRequest['state'] = pr.merged || pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open'
    return { branchExists, pullRequest: { number: pr.number, state, baseBranch: pr.base.ref, url: `https://github.com/${owner}/${repo}/pull/${pr.number}` } }
  }
}

export function repoPath(owner: string, repo: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

export async function installationClient(installationId: number, repositoryId?: number) {
  const result = await new GithubClient(createAppJwt()).request<{ token: string }>(`/app/installations/${installationId}/access_tokens`, {
    ...(repositoryId ? { repository_ids: [repositoryId] } : {}),
    permissions: { contents: repositoryId ? 'write' : 'read', pull_requests: 'read' },
  })
  if (!result.token) throw new Error('GitHub did not provide installation credentials.')
  return new GithubClient(result.token)
}
