import { describe, expect, it } from 'vitest'
import { deriveGithubStatus, parseRepository, suggestBranchName, validateBranchName, verifyWebhookSignature } from '../convex/lib/github'
import { createHmac } from 'node:crypto'

describe('GitHub task lifecycle rules', () => {
  it('accepts repository names without allowing URLs or path injection', () => {
    expect(parseRepository(' OpenAI/tasker ')).toEqual({ owner: 'OpenAI', repo: 'tasker' })
    for (const name of ['https://github.com/a/b', 'a/b/c', 'a/../b', 'a/b?x=1', '/b', 'a/']) {
      expect(() => parseRepository(name)).toThrow()
    }
  })
  it('suggests a ref with the stable issue identifier and a readable slug', () => {
    expect(suggestBranchName('TASK', 123, 'Fix Login: errors!')).toBe('feature/TASK-123-fix-login-errors')
    expect(suggestBranchName('TASK', 123, '登录')).toBe('feature/TASK-123-task')
  })
  it('rejects invalid and dangerous Git refs before making a request', () => {
    expect(validateBranchName('feature/TASK-1-login')).toBe('feature/TASK-1-login')
    for (const ref of ['', 'HEAD', '-bad', 'a..b', 'a@{b', 'a.lock', 'a/.hidden', 'a//b', 'a/', 'a b', 'a\\b', 'a~b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\nb', 'a.']) {
      expect(() => validateBranchName(ref), ref).toThrow()
    }
  })
  const mapping = { workStatus: 'building', reviewStatus: 'approval', baseBranch: 'main' }
  it.each([
    [{ branchExists: true }, 'building'],
    [{ branchExists: true, pullRequest: { state: 'draft', baseBranch: 'main' } }, 'building'],
    [{ branchExists: true, pullRequest: { state: 'open', baseBranch: 'main' } }, 'approval'],
    [{ branchExists: false, pullRequest: { state: 'merged', baseBranch: 'main' } }, 'done'],
    [{ branchExists: true, pullRequest: { state: 'closed', baseBranch: 'main' } }, 'building'],
    [{ branchExists: false, pullRequest: { state: 'closed', baseBranch: 'main' } }, 'building'],
    [{ branchExists: true, pullRequest: { state: 'merged', baseBranch: 'release' } }, null],
    [{ branchExists: false }, null],
  ] as const)('maps the current authoritative snapshot %j to %s', (snapshot, want) => {
    expect(deriveGithubStatus(snapshot, mapping)).toBe(want)
  })
  it('authenticates the exact webhook bytes and rejects missing, malformed or altered signatures', async () => {
    const body = '{"repository":{"id":1}}'
    const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`
    expect(await verifyWebhookSignature(body, signature, 'secret')).toBe(true)
    for (const bad of [null, '', 'sha1=abc', 'sha256=zz', signature.slice(0, -1)]) {
      expect(await verifyWebhookSignature(body, bad, 'secret')).toBe(false)
    }
    expect(await verifyWebhookSignature(`${body} `, signature, 'secret')).toBe(false)
    expect(await verifyWebhookSignature(body, signature, '')).toBe(false)
  })
})
