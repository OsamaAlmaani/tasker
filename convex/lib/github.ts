import { ConvexError } from 'convex/values'

function invalid(message: string): never {
  throw new ConvexError({ code: 'VALIDATION_ERROR', message })
}

export function parseRepository(value: string) {
  const match = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9_.-]{1,100})$/.exec(value.trim())
  if (!match || match[2] === '.' || match[2] === '..') {
    invalid('Enter a GitHub repository as owner/repository.')
  }
  return { owner: match[1], repo: match[2] }
}

export function validateBranchName(value: string) {
  if (!value || value.length > 200 || value === 'HEAD' || value === '@' || value.startsWith('-') ||
    /[\s\x00-\x20\x7f~^:?*\[\\]/.test(value) || value.includes('..') || value.includes('@{') ||
    value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.'))) {
    invalid('Enter a valid Git branch name (up to 200 characters).')
  }
  return value
}

export function suggestBranchName(projectKey: string, issueNumber: number, title: string) {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/g, '') || 'task'
  return `feature/${projectKey}-${issueNumber}-${slug}`
}

export type GithubPullRequest = {
  number: number
  state: 'draft' | 'open' | 'closed' | 'merged'
  baseBranch: string
  url: string
}

export type GithubSnapshot = { branchExists: boolean; pullRequest?: GithubPullRequest }

export function deriveGithubStatus(
  snapshot: { branchExists: boolean; pullRequest?: Pick<GithubPullRequest, 'state' | 'baseBranch'> },
  mapping: { workStatus: string; reviewStatus: string; baseBranch: string },
) {
  const pr = snapshot.pullRequest
  if (pr && pr.baseBranch !== mapping.baseBranch) return null
  if (pr?.state === 'merged') return 'done'
  if (pr) return pr.state === 'open' ? mapping.reviewStatus : mapping.workStatus
  return snapshot.branchExists ? mapping.workStatus : null
}

export async function verifyWebhookSignature(body: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, byte => Number.parseInt(byte, 16))
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body))
}
