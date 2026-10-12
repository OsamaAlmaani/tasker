import { describe, expect, it, vi } from 'vitest'
import type { MutationCtx } from '../convex/_generated/server'
import type { Id } from '../convex/_generated/dataModel'
import * as tasks from '../convex/agentTasks'
import * as issues from '../convex/issues'
import * as projects from '../convex/projects'
import * as tokens from '../convex/agentTokens'
import { hashToken } from '../convex/lib/agentTokens'
import { DEFAULT_PROJECT_STATUSES } from '../convex/lib/projectStatuses'

const token = `tsk_${'a'.repeat(64)}`
const userId = 'user' as Id<'users'>
const projectId = 'project' as Id<'projects'>
const issueId = 'issue' as Id<'issues'>
const tokenId = 'token' as Id<'agentTokens'>
const handler = (fn: unknown) => (fn as { _handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<any> })._handler

async function context(role = 'member') {
  const records = new Map<string, any>([
    [userId, { _id: userId, clerkUserId: 'clerk', isActive: true, globalRole: role, name: 'User' }],
    [projectId, { _id: projectId, createdBy: userId, key: 'TEST', name: 'Project', archived: false, statuses: DEFAULT_PROJECT_STATUSES }],
    [issueId, { _id: issueId, projectId, issueNumber: 1, title: 'Work', description: 'Do the work', status: 'todo', archived: false, assigneeId: userId, updatedAt: 1 }],
    [tokenId, { _id: tokenId, userId, tokenHash: await hashToken(token), name: 'Agent', tokenPrefix: token.slice(0, 12), createdAt: 1 }],
  ])
  const tableFor = (id: string) => id === userId ? 'users' : id === projectId || id.startsWith('project-') ? 'projects' : id === tokenId ? 'agentTokens' : id === issueId || id.startsWith('issue-') ? 'issues' : id.split('-')[0]
  const reads = { issueRows: 0, issueCollections: 0, pages: [] as { cursor: string | null, numItems: number, maximumRowsRead: number, maximumBytesRead: number }[] }
  const query = (table: string) => {
    const conditions: [string, unknown][] = []
    const rows = () => [...records.entries()].filter(([id, row]) => tableFor(id) === table && conditions.every(([key, value]) => row[key] === value)).map(([, row]) => row)
    const chain = {
      withIndex: (_name: string, cb: (q: any) => unknown) => {
        const q = { eq: (key: string, value: unknown) => { conditions.push([key, value]); return q } }
        cb(q)
        return chain
      },
      collect: async () => {
        if (table === 'issues') reads.issueCollections++
        return rows()
      }, unique: async () => rows()[0] ?? null,
      take: async (limit: number) => rows().slice(0, limit), order: () => chain,
      paginate: async (options: typeof reads.pages[number]) => {
        reads.pages.push(options)
        const all = rows()
        const start = options.cursor === null ? 0 : Number(options.cursor.slice('page:'.length))
        let end = start
        let bytes = 0
        while (end < all.length && end - start < Math.min(options.numItems, options.maximumRowsRead) && bytes < options.maximumBytesRead) {
          bytes += JSON.stringify(all[end]).length
          end++
        }
        reads.issueRows += end - start
        return { page: all.slice(start, end), isDone: end === all.length, continueCursor: `page:${end}` }
      },
    }
    return chain
  }
  const patch = vi.fn(async (id: string, changes: object) => records.set(id, { ...records.get(id), ...changes }))
  let counter = 0
  const insert = vi.fn(async (table: string, fields: object) => {
    const id = `${table}-${++counter}`
    records.set(id, { _id: id, ...fields })
    return id
  })
  const ctx = { auth: { getUserIdentity: async () => ({ subject: 'clerk' }) }, db: { get: async (id: string) => records.get(id) ?? null, query, patch, insert } } as unknown as MutationCtx
  return { ctx, records, patch, insert, reads }
}

describe('agent token authentication', () => {
  it('rejects invalid, revoked, expired tokens and inactive owners', async () => {
    const { ctx, records } = await context()
    await expect(handler(tasks.list)(ctx, { token: 'invalid' })).rejects.toThrow()
    for (const changes of [{ revokedAt: 1 }, { expiresAt: 1 }]) {
      const original = records.get(tokenId)
      records.set(tokenId, { ...original, ...changes })
      await expect(handler(tasks.list)(ctx, { token })).rejects.toThrow()
      records.set(tokenId, original)
    }
    records.get(userId).isActive = false
    await expect(handler(tasks.list)(ctx, { token })).rejects.toThrow()
  })
  it('stores only a token hash and lists safe metadata', async () => {
    const { ctx, records } = await context()
    const newToken = `tsk_${'b'.repeat(64)}`
    await handler(tokens.create)(ctx, { name: 'Second agent', token: newToken })
    const rows = await handler(tokens.list)(ctx, {})
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toContain('tokenHash')
    expect(JSON.stringify([...records.values()])).not.toContain(newToken)
  })
  it('cannot revoke another user’s token', async () => {
    const { ctx, records } = await context()
    records.get(tokenId).userId = 'someone-else'
    await expect(handler(tokens.revoke)(ctx, { tokenId })).rejects.toThrow()
  })
})

describe('agent task queue', () => {
  it('paginates without duplicates and only includes live claims when requested', async () => {
    const { ctx, records } = await context()
    records.set('issue-other', { ...records.get(issueId), _id: 'issue-other' })
    const first = await handler(tasks.list)(ctx, { token, limit: 1 })
    expect(first.nextCursor).toBe('page:1')
    const second = await handler(tasks.list)(ctx, { token, limit: 1, cursor: first.nextCursor })
    expect(second.tasks[0].issue._id).toBe('issue-other')
    expect(second.nextCursor).toBeNull()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    expect((await handler(tasks.list)(ctx, { token })).tasks).toHaveLength(1)
    expect((await handler(tasks.list)(ctx, { token, includeClaimed: true })).tasks).toHaveLength(2)
    records.get(issueId).agentClaim.expiresAt = 1
    expect((await handler(tasks.list)(ctx, { token })).tasks).toHaveLength(2)
  })
  it('reads the task context but defaults to skipping review work in the queue', async () => {
    const { ctx, records } = await context()
    records.get(issueId).status = 'in_review'
    expect((await handler(tasks.list)(ctx, { token })).tasks).toHaveLength(0)
    expect((await handler(tasks.list)(ctx, { token, statuses: ['in_review'] })).tasks).toHaveLength(1)
    const result = await handler(tasks.get)(ctx, { token, issueId })
    expect(result).toMatchObject({ issue: { title: 'Work' }, project: { key: 'TEST' }, assignee: { _id: userId, name: 'User' }, canWrite: true })
  })
  it('filters mine, others, unassigned, and a specific assignee without leaking other projects', async () => {
    const { ctx, records } = await context()
    records.set('issue-other', { ...records.get(issueId), _id: 'issue-other', assigneeId: 'other' })
    records.set('issue-unassigned', { ...records.get(issueId), _id: 'issue-unassigned', assigneeId: undefined })
    records.set('project-private', { ...records.get(projectId), _id: 'project-private', createdBy: 'other' })
    records.set('issue-private', { ...records.get(issueId), _id: 'issue-private', projectId: 'project-private' })
    for (const [scope, id] of [['mine', issueId], ['others', 'issue-other'], ['unassigned', 'issue-unassigned']]) {
      const result = await handler(tasks.list)(ctx, { token, assignment: scope })
      expect(result.tasks.map((row: any) => row.issue._id)).toEqual([id])
    }
    expect((await handler(tasks.list)(ctx, { token, assignment: 'all' })).tasks).toHaveLength(3)
    expect((await handler(tasks.list)(ctx, { token, assignment: 'assignee', assigneeId: 'other' })).tasks).toHaveLength(1)
    await expect(handler(tasks.get)(ctx, { token, issueId: 'issue-private' })).rejects.toThrow()
    await expect(handler(tasks.list)(ctx, { token, assignment: 'assignee' })).rejects.toThrow()
  })
  it('lets viewers read but rejects claims', async () => {
    const { ctx, patch } = await context('viewer')
    expect((await handler(tasks.list)(ctx, { token })).tasks).toHaveLength(1)
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })
  it('excludes done, deleted, archived tasks and archived projects', async () => {
    const { ctx, records } = await context()
    for (const change of [{ status: 'done' }, { archived: true }, { deletedAt: 1 }]) {
      const original = records.get(issueId)
      records.set(issueId, { ...original, ...change })
      expect((await handler(tasks.list)(ctx, { token })).tasks).toEqual([])
      await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow()
      records.set(issueId, original)
    }
    records.get(projectId).archived = true
    expect((await handler(tasks.list)(ctx, { token })).tasks).toEqual([])
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow()
  })
})

describe('bounded task discovery', () => {
  it.each([['active', tasks.list, 'todo'], ['done', tasks.listDone, 'done']] as const)('%s pages read only a bounded slice and forward the database cursor', async (_name, endpoint, status) => {
    const { ctx, records, reads } = await context()
    records.get(issueId).status = status
    for (let i = 0; i < 250; i++) {
      records.set(`issue-${i}`, { ...records.get(issueId), _id: `issue-${i}` })
    }
    const first = await handler(endpoint)(ctx, { token, projectId, limit: 25 })
    expect(first.tasks).toHaveLength(25)
    expect(reads.issueRows).toBe(25)
    const second = await handler(endpoint)(ctx, { token, projectId, limit: 25, cursor: first.nextCursor })
    expect(second.tasks).toHaveLength(25)
    expect(new Set([...first.tasks, ...second.tasks].map((row: any) => row.issue._id)).size).toBe(50)
    expect(reads.issueRows).toBe(50)
    expect(reads.issueCollections).toBe(0)
    expect(reads.pages[1]).toEqual({ cursor: first.nextCursor, numItems: 25, maximumRowsRead: 100, maximumBytesRead: 1024 * 1024 })
  })
  it.each([['active', tasks.list, 'todo'], ['done', tasks.listDone, 'done']] as const)('%s continues past empty unauthorized pages and rechecks access', async (_name, endpoint, status) => {
    const { ctx, records, reads } = await context()
    records.set('project-private', { ...records.get(projectId), _id: 'project-private', createdBy: 'other' })
    records.get(issueId).status = status
    records.set('issue-visible', { ...records.get(issueId), _id: 'issue-visible' })
    records.get(issueId).projectId = 'project-private'
    const first = await handler(endpoint)(ctx, { token, assignment: 'all', limit: 1 })
    expect(first.tasks).toEqual([])
    expect(first.nextCursor).not.toBeNull()
    const args = { token, assignment: 'all', limit: 1, cursor: first.nextCursor }
    const second = await handler(endpoint)(ctx, args)
    expect(second.tasks.map((row: any) => row.issue._id)).toEqual(['issue-visible'])
    expect(second.nextCursor).toBeNull()
    records.get(projectId).createdBy = 'other'
    expect((await handler(endpoint)(ctx, args)).tasks).toEqual([])
    const pagesBefore = reads.pages.length
    await expect(handler(endpoint)(ctx, { token, projectId })).rejects.toThrow()
    expect(reads.pages).toHaveLength(pagesBefore)
  })
  it.each([['active', tasks.list, 'todo'], ['done', tasks.listDone, 'done']] as const)('%s honors the byte budget and skips archived rows without ending pagination', async (_name, endpoint, status) => {
    const { ctx, records, reads } = await context()
    Object.assign(records.get(issueId), { status, archived: true, description: 'x'.repeat(400_000) })
    for (let i = 0; i < 5; i++) {
      records.set(`issue-${i}`, { ...records.get(issueId), _id: `issue-${i}` })
    }
    records.get('issue-4').archived = false
    const first = await handler(endpoint)(ctx, { token, projectId, limit: 100 })
    expect(first.tasks).toEqual([])
    expect(first.nextCursor).not.toBeNull()
    expect(reads.issueRows).toBe(3)
    const second = await handler(endpoint)(ctx, { token, projectId, limit: 100, cursor: first.nextCursor })
    expect(second.tasks.map((row: any) => row.issue._id)).toEqual(['issue-4'])
    expect(second.nextCursor).toBeNull()
  })
  it('lists only non-deleted, non-archived done tasks using the assignment and project filters', async () => {
    const { ctx, records } = await context('viewer')
    records.get(issueId).status = 'done'
    for (const [id, changes] of [
      ['issue-other', { assigneeId: 'other' }],
      ['issue-unassigned', { assigneeId: undefined }],
      ['issue-active', { status: 'todo' }],
      ['issue-review', { status: 'in_review' }],
      ['issue-archived', { archived: true }],
      ['issue-deleted', { deletedAt: 1 }],
    ] as const) records.set(id, { ...records.get(issueId), _id: id, ...changes })
    for (const [assignment, expected] of [
      ['mine', [issueId]], ['others', ['issue-other']], ['unassigned', ['issue-unassigned']],
      ['assignee', ['issue-other']], ['all', [issueId, 'issue-other', 'issue-unassigned']],
    ] as const) {
      const args = { token, projectId, assignment, ...(assignment === 'assignee' ? { assigneeId: 'other' } : {}) }
      const result = await handler(tasks.listDone)(ctx, args)
      expect(result.tasks.map((row: any) => row.issue._id)).toEqual(expected)
      expect(result.tasks.every((row: any) => row.canWrite === false)).toBe(true)
    }
    records.get(projectId).archived = true
    expect((await handler(tasks.listDone)(ctx, { token, projectId, assignment: 'all' })).tasks).toEqual([])
    expect((await handler(tasks.listDone)(ctx, { token, assignment: 'all' })).tasks).toEqual([])
  })
  it('includes joined projects and permits admins to read other projects in done discovery', async () => {
    const { ctx, records } = await context()
    records.get(issueId).status = 'done'
    records.get(projectId).createdBy = 'other'
    records.set('projectMembers-1', { projectId, userId })
    expect((await handler(tasks.listDone)(ctx, { token })).tasks).toHaveLength(1)
    records.delete('projectMembers-1')
    expect((await handler(tasks.listDone)(ctx, { token })).tasks).toHaveLength(0)
    records.get(userId).globalRole = 'admin'
    expect((await handler(tasks.listDone)(ctx, { token, assignment: 'all' })).tasks).toHaveLength(1)
  })
  it('validates done discovery arguments and authenticates every page', async () => {
    const { ctx, records, reads } = await context()
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { assignment: 'assignee' }, { assigneeId: userId }]) {
      await expect(handler(tasks.listDone)(ctx, { token, ...args })).rejects.toThrow()
    }
    for (const change of [{ revokedAt: 1 }, { revokedAt: undefined, expiresAt: 1 }]) {
      Object.assign(records.get(tokenId), change)
      await expect(handler(tasks.listDone)(ctx, { token, cursor: 'page:1' })).rejects.toThrow()
    }
    records.get(tokenId).expiresAt = undefined
    records.get(userId).isActive = false
    await expect(handler(tasks.listDone)(ctx, { token })).rejects.toThrow()
    expect(reads.pages).toHaveLength(0)
  })
})

describe('agent claim and review lifecycle', () => {
  it('preserves a manual status round trip when an old claim is released', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(issues.update)(ctx, { issueId, status: 'in_review' })
    await handler(issues.update)(ctx, { issueId, status: 'in_progress' })
    await handler(tasks.release)(ctx, { token, issueId, runId: 'run' })
    expect(records.get(issueId).status).toBe('in_progress')
    expect(records.get(issueId).agentClaim).toBeUndefined()
  })
  it('rejects renewal and submission after a person changes status away and back', async () => {
    const { ctx, records, patch, insert } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(issues.update)(ctx, { issueId, status: 'in_review' })
    await handler(issues.update)(ctx, { issueId, status: 'in_progress' })
    const claimBefore = structuredClone(records.get(issueId).agentClaim)
    patch.mockClear(); insert.mockClear()
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow(/status changed/i)
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Old result' })).rejects.toThrow(/status changed/i)
    expect(records.get(issueId).status).toBe('in_progress')
    expect(records.get(issueId).agentClaim).toEqual(claimBefore)
    expect([...records.values()].some(row => row.body?.includes('Old result'))).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it('keeps the claim usable after a title edit or unchanged status update', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(issues.update)(ctx, { issueId, title: 'Updated task', status: 'in_progress' })
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Current result' })
    expect(records.get(issueId).status).toBe('in_review')
    expect(records.get(issueId).title).toBe('Updated task')
  })
  it('preserves status after a claimed child is completed through its parent and reopened', async () => {
    const { ctx, records } = await context()
    records.set('issue-parent', { ...records.get(issueId), _id: 'issue-parent' })
    records.get(issueId).parentIssueId = 'issue-parent'
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(issues.update)(ctx, { issueId: 'issue-parent', status: 'done', cascadeDescendantsToDone: true })
    await handler(issues.update)(ctx, { issueId: 'issue-parent', status: 'in_progress' })
    await handler(issues.update)(ctx, { issueId, status: 'in_progress' })
    await handler(tasks.release)(ctx, { token, issueId, runId: 'run' })
    expect(records.get(issueId).status).toBe('in_progress')
  })
  it('rejects an old claim after a workflow transfer even when its work status is recreated', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await handler(projects.deleteStatus)(ctx, { projectId, statusKey: 'in_progress', transferToStatusKey: 'backlog' })
    await handler(projects.update)(ctx, { projectId, statuses: DEFAULT_PROJECT_STATUSES })
    await handler(issues.update)(ctx, { issueId, status: 'in_progress' })
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Obsolete run' })).rejects.toThrow(/status changed/i)
    await handler(tasks.release)(ctx, { token, issueId, runId: 'run' })
    expect(records.get(issueId).status).toBe('in_progress')
  })
  it('checks token revocation, role changes, and project access again before submission', async () => {
    const { ctx, records, patch } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    patch.mockClear()
    records.get(tokenId).revokedAt = 1
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow()
    records.get(tokenId).revokedAt = undefined
    records.get(userId).globalRole = 'viewer'
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow()
    records.get(userId).globalRole = 'member'
    records.get(projectId).createdBy = 'other'
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
  })
  it('accepts explicit custom workflow keys and rejects identical work and review states', async () => {
    const { ctx, records } = await context()
    records.get(projectId).statuses = [
      { key: 'building', name: 'Building', color: '#64748b', position: 1 },
      { key: 'approval', name: 'Approval', color: '#64748b', position: 2 },
    ]
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run', workStatus: 'building' })
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done', reviewStatus: 'building' })).rejects.toThrow()
    await handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done', reviewStatus: 'approval' })
    expect(records.get(issueId).status).toBe('approval')
  })
  it('does not overwrite a person’s status edit when submitting or releasing', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    records.get(issueId).status = 'backlog'
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow()
    await handler(tasks.release)(ctx, { token, issueId, runId: 'run' })
    expect(records.get(issueId).status).toBe('backlog')
  })
  it('requires the same token even if another agent copies the run ID', async () => {
    const { ctx } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    const otherToken = `tsk_${'b'.repeat(64)}`
    await handler(tokens.create)(ctx, { token: otherToken, name: 'Other agent' })
    await expect(handler(tasks.claim)(ctx, { token: otherToken, issueId, runId: 'run' })).rejects.toThrow()
    await expect(handler(tasks.submitReview)(ctx, { token: otherToken, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow()
  })
  it('claims without reassignment, rejects competitors, renews and submits a review comment', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run-1' })
    expect(records.get(issueId)).toMatchObject({ status: 'in_progress', assigneeId: userId, agentClaim: { runId: 'run-1', tokenId } })
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run-2' })).rejects.toThrow()
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run-2', summary: 'Done' })).rejects.toThrow()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run-1' })
    await handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run-1', summary: 'Implemented and tested. PR: example' })
    expect(records.get(issueId)).toMatchObject({ status: 'in_review', assigneeId: userId })
    expect(records.get(issueId).agentClaim).toBeUndefined()
    expect([...records.values()].find(row => row.body)?.body).toContain('Implemented and tested')
    expect([...records.values()].some(row => row.action === 'issue.status_changed' && row.metadata.to === 'in_review')).toBe(true)
  })
  it('allows takeover after expiry but prevents an expired worker from submitting', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'old' })
    records.get(issueId).agentClaim.expiresAt = 1
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'old', summary: 'Done' })).rejects.toThrow()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'new' })
    expect(records.get(issueId).agentClaim.runId).toBe('new')
  })
  it('releases only its own claim and returns to the previous status', async () => {
    const { ctx, records } = await context()
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    await expect(handler(tasks.release)(ctx, { token, issueId, runId: 'other' })).rejects.toThrow()
    await handler(tasks.release)(ctx, { token, issueId, runId: 'run' })
    expect(records.get(issueId).status).toBe('todo')
    expect(records.get(issueId).agentClaim).toBeUndefined()
  })
  it('rejects missing statuses and empty summaries without writing', async () => {
    const { ctx, records, patch } = await context()
    records.get(projectId).statuses = []
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow()
    expect(patch).not.toHaveBeenCalled()
    records.get(projectId).statuses = DEFAULT_PROJECT_STATUSES
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    patch.mockClear()
    for (const args of [{ summary: ' ' }, { summary: 'Done', reviewStatus: 'done' }, { summary: 'Done', reviewStatus: 'missing' }]) {
      await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', ...args })).rejects.toThrow()
    }
    expect(patch).not.toHaveBeenCalled()
  })
  it('respects done ancestor guards when claiming or submitting', async () => {
    const { ctx, records } = await context()
    records.set('issue-parent', { ...records.get(issueId), _id: 'issue-parent', status: 'done' })
    records.get(issueId).parentIssueId = 'issue-parent'
    await expect(handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })).rejects.toThrow(/parent/)
    records.get('issue-parent').status = 'todo'
    await handler(tasks.claim)(ctx, { token, issueId, runId: 'run' })
    records.get('issue-parent').status = 'done'
    await expect(handler(tasks.submitReview)(ctx, { token, issueId, runId: 'run', summary: 'Done' })).rejects.toThrow(/parent/)
  })
})
