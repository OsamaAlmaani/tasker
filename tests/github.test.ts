import { describe, expect, it } from 'vitest'
import * as github from '../convex/github'
import * as issues from '../convex/issues'
import { DEFAULT_PROJECT_STATUSES } from '../convex/lib/projectStatuses'
import type { MutationCtx } from '../convex/_generated/server'

type Row = Record<string, any>
const handler = (fn: unknown) => (fn as { _handler: (ctx: MutationCtx, args: Row) => Promise<any> })._handler

function context(role = 'admin') {
  const records = new Map<string, Row>([
    ['user', { _id: 'user', clerkUserId: 'clerk', globalRole: role, isActive: true, name: 'Admin' }],
    ['project', { _id: 'project', key: 'TASK', createdBy: 'user', archived: false, statuses: DEFAULT_PROJECT_STATUSES }],
    ['issue', { _id: 'issue', projectId: 'project', issueNumber: 1, title: 'Fix login', status: 'todo', archived: false, updatedAt: 1 }],
  ])
  const tables = new Map([['user', 'users'], ['project', 'projects'], ['issue', 'issues']])
  const scheduled: Row[] = []
  let counter = 0
  const query = (table: string) => {
    const conditions: ((row: Row) => boolean)[] = []
    const rows = () => [...records.values()].filter(row => tables.get(row._id) === table && conditions.every(test => test(row)))
    const chain = {
      withIndex: (_name: string, callback?: (q: any) => unknown) => {
        const q = {
          eq: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return q },
          lte: (key: string, value: number) => { conditions.push(row => row[key] <= value); return q },
          lt: (key: string, value: number) => { conditions.push(row => row[key] < value); return q },
        }
        callback?.(q)
        return chain
      },
      unique: async () => { if (rows().length > 1) throw new Error('Duplicate records'); return rows()[0] ?? null },
      collect: async () => rows(),
      take: async (limit: number) => rows().slice(0, limit),
      order: () => chain,
    }
    return chain
  }
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'clerk' }) },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query,
      insert: async (table: string, fields: Row) => {
        const id = `${table}-${++counter}`
        records.set(id, { _id: id, ...fields }); tables.set(id, table); return id
      },
      patch: async (id: string, fields: Row) => { records.set(id, { ...records.get(id), ...fields }) },
      delete: async (id: string) => { records.delete(id) },
    },
    scheduler: { runAfter: async (_delay: number, _fn: unknown, args: Row) => { scheduled.push(args); return 'schedule' } },
  } as unknown as MutationCtx
  // Keep transactional rollback in the test harness, not in production handlers.
  const invoke = async (fn: unknown, args: Row) => {
    const before = structuredClone(records)
    try { return await handler(fn)(ctx, args) } catch (error) {
      records.clear(); for (const [key, value] of before) records.set(key, value)
      throw error
    }
  }
  const connectionArgs = { projectId: 'project', owner: 'owner', repo: 'repo', repositoryId: 123, installationId: 7, baseBranch: 'main', workStatus: 'in_progress', reviewStatus: 'in_review' }
  const connect = async (extra: Row = {}) => {
    const { connectionVersion: expectedVersion } = await invoke(github.authorizeConnection, { projectId: 'project' })
    return invoke(github.saveConnection, { ...connectionArgs, ...extra, expectedVersion })
  }
  const reserve = (extra: Row = {}) => invoke(github.reserveBranch, { issueId: 'issue', branch: 'feature/TASK-1', baseBranch: 'main', attempt: 'creation-1', mode: 'create', ...extra })
  const create = async () => {
    await connect()
    const prep = await reserve()
    await invoke(github.finishBranch, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version })
    return prep.link._id as string
  }
  const sync = async (linkId: string, snapshot: Row, nonce = 'sync-1') => {
    const prep = await invoke(github.prepareSync, { linkId, nonce })
    if (!prep) return null
    return invoke(github.finishSync, { linkId, nonce, connectionVersion: prep.connection.version, snapshot })
  }
  return { ctx, records, tables, scheduled, invoke, connect, reserve, create, sync, connectionArgs }
}

describe('GitHub connections and branch authorization', () => {
  it('rejects a connection save when a newer disconnect or settings save wins', async () => {
    for (const newer of ['disconnect', 'settings']) {
      const test = context()
      await test.connect()
      const { connectionVersion: expectedVersion } = await test.invoke(github.authorizeConnection, { projectId: 'project' })
      if (newer === 'disconnect') await test.invoke(github.disconnect, { projectId: 'project' })
      else await test.invoke(github.saveConnection, { ...test.connectionArgs, expectedVersion, baseBranch: 'develop' })
      const before = structuredClone([...test.records.values()].find(row => row.repositoryId === 123))
      await expect(test.invoke(github.saveConnection, { ...test.connectionArgs, expectedVersion })).rejects.toThrow(/settings changed/i)
      expect([...test.records.values()].find(row => row.repositoryId === 123)).toEqual(before)
    }
  })
  it('rejects a stale initial connection save after another admin has connected', async () => {
    const test = context()
    const { connectionVersion: expectedVersion } = await test.invoke(github.authorizeConnection, { projectId: 'project' })
    await test.connect()
    await expect(test.invoke(github.saveConnection, { ...test.connectionArgs, expectedVersion, baseBranch: 'develop' })).rejects.toThrow(/settings changed/i)
    expect([...test.records.values()].find(row => row.repositoryId === 123)!.baseBranch).toBe('main')
  })
  it('only lets admins configure connections and rejects invalid custom mappings', async () => {
    const test = context('member')
    await expect(test.connect()).rejects.toThrow()
    test.records.get('user')!.globalRole = 'admin'
    await expect(test.connect({ workStatus: 'missing' })).rejects.toThrow()
    await expect(test.connect({ workStatus: 'done' })).rejects.toThrow()
    await expect(test.connect({ reviewStatus: 'in_progress' })).rejects.toThrow()
    await test.connect()
    expect([...test.records.values()].filter(row => row.repositoryId === 123)).toHaveLength(1)
  })
  it('denies viewers, inaccessible projects, archived/done tasks and base branch reuse', async () => {
    const test = context()
    await test.connect()
    for (const patch of [{ archived: true }, { deletedAt: 1 }, { status: 'done' }]) {
      const original = { ...test.records.get('issue')! }
      Object.assign(test.records.get('issue')!, patch)
      await expect(test.reserve()).rejects.toThrow()
      test.records.set('issue', original)
    }
    test.records.get('user')!.globalRole = 'viewer'
    await expect(test.reserve()).rejects.toThrow()
    test.records.get('user')!.globalRole = 'member'
    test.records.get('project')!.createdBy = 'other'
    await expect(test.reserve()).rejects.toThrow()
    test.records.get('project')!.createdBy = 'user'
    await expect(test.reserve({ branch: 'main' })).rejects.toThrow()
  })
  it('reserves one branch per issue and prevents another task claiming the same ref', async () => {
    const test = context()
    await test.connect()
    await test.reserve()
    await expect(test.reserve({ attempt: 'creation-2' })).rejects.toThrow()
    test.records.set('issue-2', { ...test.records.get('issue')!, _id: 'issue-2', issueNumber: 2 })
    test.tables.set('issue-2', 'issues')
    await expect(test.reserve({ issueId: 'issue-2' })).rejects.toThrow()
  })
  it('rechecks current authorization before accepting the remote branch result', async () => {
    const test = context()
    await test.connect()
    const prep = await test.reserve()
    test.records.get('user')!.globalRole = 'viewer'
    await expect(test.invoke(github.finishBranch, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version })).rejects.toThrow()
    expect(test.records.get('issue')!.status).toBe('todo')
    expect(test.records.get(prep.link._id)!.creationState).toBe('pending')
  })
  it('rejects a stale branch result after settings change and refuses repository replacement with links', async () => {
    const test = context()
    await test.connect()
    const prep = await test.reserve()
    await test.connect({ baseBranch: 'develop' })
    await expect(test.invoke(github.finishBranch, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version })).rejects.toThrow()
    await expect(test.connect({ repositoryId: 999, repo: 'other' })).rejects.toThrow()
  })
  it('persists the historical PR boundary and retains it when explicitly recovering a created branch', async () => {
    const test = context()
    await test.connect()
    const prep = await test.reserve()
    await test.invoke(github.recordBranchBaseline, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version, minimumPullNumber: 7 })
    await test.invoke(github.failBranch, { linkId: prep.link._id, attempt: 'creation-1', error: 'Network response lost' })
    const recovery = await test.reserve({ mode: 'link', attempt: 'recovery' })
    expect(recovery.link.minimumPullNumber).toBe(7)
    await test.invoke(github.finishBranch, { linkId: prep.link._id, attempt: 'recovery', connectionVersion: prep.connection.version })
    const worker = await test.invoke(github.prepareSync, { linkId: prep.link._id, nonce: 'read' })
    await expect(test.invoke(github.finishSync, { linkId: prep.link._id, nonce: 'read', connectionVersion: worker.connection.version, snapshot: { branchExists: true, pullRequest: { number: 7, state: 'merged', baseBranch: 'main', url: 'https://github.com/owner/repo/pull/7' } } })).rejects.toThrow(/predates/)
    expect(test.records.get('issue')!.status).toBe('in_progress')
    await test.invoke(github.finishSync, { linkId: prep.link._id, nonce: 'read', connectionVersion: worker.connection.version, snapshot: { branchExists: true, pullRequest: { number: 8, state: 'open', baseBranch: 'main', url: 'https://github.com/owner/repo/pull/8' } } })
    expect(test.records.get('issue')!.status).toBe('in_review')
    expect(test.records.get(prep.link._id)!.pullNumber).toBe(8)
  })
  it('rejects baseline writes after creation ownership, authorization, or configuration changes', async () => {
    for (const change of ['attempt', 'access', 'config']) {
      const test = context()
      await test.connect()
      const prep = await test.reserve()
      if (change === 'attempt') test.records.get(prep.link._id)!.creationAttempt = 'replacement'
      if (change === 'access') test.records.get('user')!.globalRole = 'viewer'
      if (change === 'config') await test.connect({ baseBranch: 'develop' })
      await expect(test.invoke(github.recordBranchBaseline, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version, minimumPullNumber: 7 })).rejects.toThrow()
      expect(test.records.get(prep.link._id)!.minimumPullNumber).toBeUndefined()
    }
  })
})

describe('GitHub status synchronization', () => {
  const pr = (state: string, baseBranch = 'main') => ({ number: 42, state, baseBranch, url: 'https://github.com/owner/repo/pull/42' })
  it('moves from branch creation through draft, review, closure and merge with GitHub activity', async () => {
    const test = context()
    const linkId = await test.create()
    expect(test.records.get('issue')!.status).toBe('in_progress')
    for (const [state, want] of [['draft', 'in_progress'], ['open', 'in_review'], ['closed', 'in_progress'], ['merged', 'done']]) {
      await test.sync(linkId, { branchExists: state !== 'merged', pullRequest: pr(state) }, state)
      expect(test.records.get('issue')!.status).toBe(want)
    }
    expect([...test.records.values()].some(row => row.action === 'issue.github_status_changed' && row.metadata.to === 'done')).toBe(true)
    expect(test.records.get(linkId)!.pullNumber).toBe(42)
  })
  it('does not complete tasks from a deleted branch or a merge into another base', async () => {
    const test = context()
    const linkId = await test.create()
    await test.sync(linkId, { branchExists: false })
    expect(test.records.get('issue')!.status).toBe('in_progress')
    expect(test.records.get(linkId)!.branchExists).toBe(false)
    await test.sync(linkId, { branchExists: true, pullRequest: pr('merged', 'release') }, 'other-target')
    expect(test.records.get('issue')!.status).toBe('in_progress')
  })
  it('pauses on a human status edit and resumes only on explicit request', async () => {
    const test = context()
    const linkId = await test.create()
    await test.invoke(issues.update, { issueId: 'issue', status: 'backlog' })
    expect(test.records.get(linkId)!.syncEnabled).toBe(false)
    await test.sync(linkId, { branchExists: true, pullRequest: pr('open') })
    expect(test.records.get('issue')!.status).toBe('backlog')
    await test.invoke(github.setIssueSync, { issueId: 'issue', enabled: true })
    await test.sync(linkId, { branchExists: true, pullRequest: pr('open') }, 'resumed')
    expect(test.records.get('issue')!.status).toBe('in_review')
  })
  it('preserves a manual edit made while creating a branch', async () => {
    const test = context()
    await test.connect()
    const prep = await test.reserve()
    await test.invoke(issues.update, { issueId: 'issue', status: 'backlog' })
    await test.invoke(github.finishBranch, { linkId: prep.link._id, attempt: 'creation-1', connectionVersion: prep.connection.version })
    expect(test.records.get('issue')!.status).toBe('backlog')
    expect(test.records.get(prep.link._id)!.syncEnabled).toBe(false)
  })
  it('blocks completion with unfinished children, reports the reason, and retries after they finish', async () => {
    const test = context()
    const linkId = await test.create()
    test.records.set('issue-child', { ...test.records.get('issue')!, _id: 'issue-child', parentIssueId: 'issue', status: 'todo' })
    test.tables.set('issue-child', 'issues')
    await test.sync(linkId, { branchExists: false, pullRequest: pr('merged') })
    expect(test.records.get('issue')!.status).toBe('in_progress')
    expect(test.records.get('issue-child')!.status).toBe('todo')
    expect(test.records.get(linkId)!.syncError).toMatch(/unfinished/i)
    test.records.get('issue-child')!.status = 'done'
    await test.sync(linkId, { branchExists: false, pullRequest: pr('merged') }, 'retry')
    expect(test.records.get('issue')!.status).toBe('done')
    expect(test.records.get(linkId)!.syncError).toBeUndefined()
  })
  it('ignores stale and duplicate worker results and blocks concurrent reads with a lease', async () => {
    const test = context()
    const linkId = await test.create()
    const first = await test.invoke(github.prepareSync, { linkId, nonce: 'old' })
    expect(await test.invoke(github.prepareSync, { linkId, nonce: 'other' })).toBeNull()
    test.records.get(linkId)!.syncLeaseUntil = 1
    const second = await test.invoke(github.prepareSync, { linkId, nonce: 'new' })
    await test.invoke(github.finishSync, { linkId, nonce: 'new', connectionVersion: second.connection.version, snapshot: { branchExists: true, pullRequest: pr('merged') } })
    await test.invoke(github.finishSync, { linkId, nonce: 'old', connectionVersion: first.connection.version, snapshot: { branchExists: true, pullRequest: pr('open') } })
    expect(test.records.get('issue')!.status).toBe('done')
  })
  it('invalidates an in-flight snapshot when a member pauses and resumes synchronization', async () => {
    const test = context()
    const linkId = await test.create()
    const old = await test.invoke(github.prepareSync, { linkId, nonce: 'old' })
    await test.invoke(github.setIssueSync, { issueId: 'issue', enabled: false })
    await test.invoke(github.setIssueSync, { issueId: 'issue', enabled: true })
    await test.invoke(github.finishSync, { linkId, nonce: 'old', connectionVersion: old.connection.version, snapshot: { branchExists: true, pullRequest: pr('open') } })
    expect(test.records.get('issue')!.status).toBe('in_progress')
    expect(await test.invoke(github.prepareSync, { linkId, nonce: 'new' })).not.toBeNull()
  })
  it('does not apply snapshots after connection disable, archive or creator role revocation', async () => {
    for (const change of ['disable', 'archive', 'revoke']) {
      const test = context()
      const linkId = await test.create()
      const prep = await test.invoke(github.prepareSync, { linkId, nonce: 'read' })
      if (change === 'disable') await test.invoke(github.disconnect, { projectId: 'project' })
      if (change === 'archive') test.records.get('project')!.archived = true
      if (change === 'revoke') test.records.get('user')!.globalRole = 'member'
      await test.invoke(github.finishSync, { linkId, nonce: 'read', connectionVersion: prep.connection.version, snapshot: { branchExists: true, pullRequest: pr('merged') } })
      expect(test.records.get('issue')!.status).toBe('in_progress')
    }
  })
  it('detects status edits that bypass the ordinary issue mutation', async () => {
    const test = context()
    const linkId = await test.create()
    test.records.get('issue')!.status = 'backlog'
    await test.sync(linkId, { branchExists: true, pullRequest: pr('open') })
    expect(test.records.get('issue')!.status).toBe('backlog')
    expect(test.records.get(linkId)!.syncEnabled).toBe(false)
  })
})

describe('GitHub delivery recovery', () => {
  it('deduplicates deliveries and schedules exact repository/branch links', async () => {
    const test = context()
    const linkId = await test.create()
    test.scheduled.length = 0
    const event = { deliveryId: 'delivery-1', repositoryId: 123, branch: 'feature/TASK-1' }
    await test.invoke(github.enqueueWebhook, event)
    await test.invoke(github.enqueueWebhook, event)
    expect(test.scheduled).toEqual([{ linkId }])
    await test.invoke(github.enqueueWebhook, { ...event, deliveryId: 'delivery-2', repositoryId: 999 })
    expect(test.scheduled).toHaveLength(1)
  })
  it('disables a connection when its installation is removed', async () => {
    const test = context()
    const linkId = await test.create()
    await test.invoke(github.enqueueWebhook, { deliveryId: 'removed', installationId: 7, disableInstallation: true })
    expect(await test.invoke(github.prepareSync, { linkId, nonce: 'read' })).toBeNull()
    expect([...test.records.values()].find(row => row.installationId === 7)!.enabled).toBe(false)
  })
})
