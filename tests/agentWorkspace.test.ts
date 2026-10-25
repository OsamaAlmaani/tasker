import { describe, it, expect, vi } from 'vitest'
import { v } from 'convex/values'
import type { MutationCtx } from '../convex/_generated/server'
import { read, write } from '../convex/agentWorkspace'
import {
  readOperations,
  writeOperations,
  requestValidator,
} from '../convex/lib/agentOperations'
import { hashToken } from '../convex/lib/agentTokens'
import { revision } from '../convex/lib/agentProtocol'
import { validatorToZod } from '../mcp/validators'
import { DEFAULT_PROJECT_STATUSES } from '../convex/lib/projectStatuses'

const token = `tsk_${'c'.repeat(64)}`
const invoke = (fn: unknown, ctx: MutationCtx, args: unknown) =>
  (
    fn as { _handler: (ctx: MutationCtx, args: unknown) => Promise<any> }
  )._handler(ctx, args)
async function fixture(role = 'member') {
  const rows = new Map<string, any>([
    [
      'users-me',
      {
        _id: 'users-me',
        name: 'Me',
        email: 'me@example.test',
        clerkUserId: 'clerk',
        globalRole: role,
        isActive: true,
        updatedAt: 1,
      },
    ],
    [
      'users-other',
      {
        _id: 'users-other',
        name: 'Other',
        email: 'other@example.test',
        globalRole: 'member',
        isActive: true,
        updatedAt: 1,
      },
    ],
    [
      'projects-one',
      {
        _id: 'projects-one',
        key: 'ONE',
        name: 'One',
        createdBy: 'users-me',
        archived: false,
        statuses: DEFAULT_PROJECT_STATUSES,
        labels: [],
        allowIssueDelete: true,
        updatedAt: 1,
      },
    ],
    [
      'projects-other',
      {
        _id: 'projects-other',
        key: 'OTHER',
        name: 'Other',
        createdBy: 'users-other',
        archived: false,
        updatedAt: 1,
      },
    ],
    [
      'issues-one',
      {
        _id: 'issues-one',
        projectId: 'projects-one',
        issueNumber: 1,
        title: 'Original',
        description: 'Task',
        searchText: 'original task',
        status: 'todo',
        priority: 'none',
        archived: false,
        labels: [],
        createdBy: 'users-me',
        updatedAt: 1,
      },
    ],
    [
      'agentTokens-one',
      {
        _id: 'agentTokens-one',
        userId: 'users-me',
        name: 'Test',
        tokenHash: await hashToken(token),
        createdAt: 1,
      },
    ],
    [
      'projectCounters-one',
      {
        _id: 'projectCounters-one',
        projectId: 'projects-one',
        nextIssueNumber: 2,
        updatedAt: 1,
      },
    ],
  ])
  let counter = 0
  const db = {
    get: vi.fn(async (id: string) => rows.get(id) ?? null),
    normalizeId: (table: string, id: string) =>
      id.startsWith(`${table}-`) ? id : null,
    insert: vi.fn(async (table: string, value: object) => {
      const id = `${table}-new${++counter}`
      rows.set(id, { ...value, _id: id })
      return id
    }),
    patch: vi.fn(async (id: string, value: object) => {
      rows.set(id, { ...rows.get(id), ...value })
    }),
    delete: vi.fn(async (id: string) => {
      rows.delete(id)
    }),
    query: (table: string) => {
      const filters: [string, unknown][] = []
      const list = () =>
        [...rows.entries()]
          .filter(
            ([id, row]) =>
              id.startsWith(`${table}-`) &&
              filters.every(([key, value]) => row[key] === value),
          )
          .map(([, row]) => row)
      const chain = {
        withIndex: (_name: string, fn: (q: any) => unknown) => {
          const q = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value])
              return q
            },
          }
          fn(q)
          return chain
        },
        order: () => chain,
        collect: async () => list(),
        take: async (n: number) => list().slice(0, n),
        unique: async () => list()[0] ?? null,
        paginate: async (opts: any) => {
          const all = list()
          const start = Number(opts.cursor ?? 0)
          const end = start + opts.numItems
          return {
            page: all.slice(start, end),
            isDone: end >= all.length,
            continueCursor: String(end),
          }
        },
      }
      return chain
    },
  }
  const runMutation = vi.fn(async () => null)
  const ctx = {
    db,
    runMutation,
    auth: { getUserIdentity: async () => null },
  } as unknown as MutationCtx
  const callRead = (operation: string, input = {}) =>
    invoke(read, ctx, { token, request: { operation, input } })
  const callWrite = async (
    operation: string,
    input: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    invoke(write, ctx, {
      token,
      request: { operation, input },
      requestId: 'request-1',
      ...extra,
    })
  const revisions = async (...ids: string[]) =>
    Object.fromEntries(
      await Promise.all(
        ids.map(async (id) => [id, await revision(rows.get(id))]),
      ),
    )
  return { ctx, rows, db, callRead, callWrite, revisions, runMutation }
}

describe('workspace agent boundary', () => {
  it('has a closed native validation allowlist without user management or policy flags', () => {
    const schema = validatorToZod(requestValidator(writeOperations))
    for (const operation of [
      'updateRole',
      'addMember',
      'createToken',
      'invite_user',
      'unknown_seed',
    ])
      expect(schema.safeParse({ operation, input: {} }).success).toBe(false)
    expect(
      schema.safeParse({
        operation: 'update_project',
        input: { projectId: 'projects-one', allowMemberInvites: true },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        operation: 'create_task',
        input: { projectId: 'projects-one', title: 'Test', unknownField: true },
      }).success,
    ).toBe(false)
    for (const op of [
      ...Object.values(readOperations),
      ...Object.values(writeOperations),
    ])
      expect(() => validatorToZod(v.object(op.args))).not.toThrow()
  })
  it('rejects revoked credentials, missing scope and inaccessible projects', async () => {
    const f = await fixture()
    f.rows.get('agentTokens-one').revokedAt = 1
    await expect(f.callRead('whoami')).rejects.toThrow()
    delete f.rows.get('agentTokens-one').revokedAt
    f.rows.get('agentTokens-one').scopes = ['read']
    await expect(
      f.callWrite('create_task', { projectId: 'projects-one', title: 'No' }),
    ).rejects.toThrow(/write/)
    await expect(
      f.callRead('get_project', { projectId: 'projects-other' }),
    ).rejects.toThrow(/access/)
    expect(f.db.insert).not.toHaveBeenCalled()
  })
  it('keeps project restrictions even for admins and private notes owner-only', async () => {
    const f = await fixture('admin')
    f.rows.get('agentTokens-one').projectIds = ['projects-one']
    await expect(
      f.callRead('get_project', { projectId: 'projects-other' }),
    ).rejects.toThrow(/scope/)
    expect(
      (await f.callRead('list_projects')).items.map((p: any) => p._id),
    ).toEqual(['projects-one'])
    f.rows.set('userNotes-other', {
      _id: 'userNotes-other',
      ownerId: 'users-other',
      title: 'Private',
      body: 'Secret',
      updatedAt: 1,
    })
    await expect(
      f.callRead('get_note', { noteId: 'userNotes-other' }),
    ).rejects.toThrow(/not found/)
    await expect(
      f.callWrite('update_note', { noteId: 'userNotes-other', title: 'No' }),
    ).rejects.toThrow(/not found/)
  })
  it('lets viewers read but preserves shared write restrictions', async () => {
    const f = await fixture('viewer')
    expect((await f.callRead('search_tasks')).items).toHaveLength(1)
    await expect(
      f.callWrite('create_task', { projectId: 'projects-one', title: 'No' }),
    ).rejects.toThrow(/read-only/)
  })
  it('audits every status and follows empty pages without hiding review/done/claims', async () => {
    const f = await fixture()
    f.rows.get('issues-one').archived = true
    f.rows.set('issues-review', {
      ...f.rows.get('issues-one'),
      _id: 'issues-review',
      status: 'in_review',
      archived: false,
      agentClaim: { expiresAt: Date.now() + 10000 },
    })
    f.rows.set('issues-done', {
      ...f.rows.get('issues-one'),
      _id: 'issues-done',
      status: 'done',
      archived: false,
    })
    let page = await f.callRead('search_tasks', { limit: 1 })
    expect(page.items).toEqual([])
    expect(page.nextCursor).not.toBeNull()
    const found = []
    while (page.nextCursor) {
      page = await f.callRead('search_tasks', {
        limit: 1,
        cursor: page.nextCursor,
      })
      found.push(...page.items)
    }
    expect(found.map((x: any) => x.status)).toEqual(['in_review', 'done'])
    expect(found.every((x: any) => x.path && x.revision)).toBe(true)
  })
  it('creates once, preserves an empty assignee and checklist, and replays without side effects', async () => {
    const f = await fixture()
    const input = {
      projectId: 'projects-one',
      title: 'New',
      checklistItems: [
        { id: 'a', text: ' Verify ', position: 0, completed: false },
      ],
    }
    const first = await f.callWrite('create_task', input)
    const second = await f.callWrite('create_task', input)
    expect(second.replayed).toBe(true)
    expect(first.result._id).toBe(second.result._id)
    expect(first.result.assigneeId).toBeUndefined()
    expect(first.result.checklistItems[0].text).toBe('Verify')
    expect(
      [...f.rows.keys()].filter((k) => k.startsWith('issues-new')),
    ).toHaveLength(1)
    expect(f.runMutation).not.toHaveBeenCalled()
    await expect(
      f.callWrite('create_task', { ...input, title: 'Different' }),
    ).rejects.toThrow(/different arguments/)
  })
  it('checks current project access on receipt replay', async () => {
    const f = await fixture()
    const input = { projectId: 'projects-one', title: 'New' }
    await f.callWrite('create_task', input)
    f.rows.get('projects-one').createdBy = 'users-other'
    await expect(f.callWrite('create_task', input)).rejects.toThrow(/access/)
  })
  it('checks revisions including same-timestamp edits and records agent provenance', async () => {
    const f = await fixture()
    const expectedRevision = await f.revisions('issues-one')
    f.rows.get('issues-one').title = 'Human edit'
    await expect(
      f.callWrite(
        'update_task',
        { issueId: 'issues-one', title: 'Agent edit' },
        { expectedRevision },
      ),
    ).rejects.toThrow(/changed/)
    const result = await f.callWrite(
      'update_task',
      { issueId: 'issues-one', title: 'Agent edit' },
      { expectedRevision: await f.revisions('issues-one') },
    )
    expect(result.result.title).toBe('Agent edit')
    const activity = [...f.rows.values()].find(
      (x) => x.action === 'issue.updated',
    )
    expect(activity.metadata).toMatchObject({
      source: 'mcp',
      tokenId: 'agentTokens-one',
      requestId: 'request-1',
    })
  })
  it('requires explicit delete confirmation and revisions; replay cannot repeat deletion', async () => {
    const f = await fixture()
    const input = { issueId: 'issues-one' }
    await expect(f.callWrite('delete_task', input)).rejects.toThrow(
      /confirmation/,
    )
    await expect(
      f.callWrite('delete_task', input, { confirmation: 'delete_task' }),
    ).rejects.toThrow(/expectedRevision/)
    const extra = {
      confirmation: 'delete_task',
      expectedRevision: await f.revisions('issues-one', 'projects-one'),
    }
    await f.callWrite('delete_task', input, extra)
    const count = f.db.patch.mock.calls.length
    expect((await f.callWrite('delete_task', input, extra)).replayed).toBe(true)
    expect(f.db.patch).toHaveBeenCalledTimes(count)
  })
  it('enforces list task deletion policy and isolates notification scope', async () => {
    const f = await fixture()
    f.rows.set('issueLists-one', {
      _id: 'issueLists-one',
      projectId: 'projects-one',
      name: 'List',
      updatedAt: 1,
    })
    f.rows.get('projects-one').allowIssueDelete = false
    await expect(
      f.callWrite(
        'delete_task_list',
        { issueListId: 'issueLists-one', mode: 'delete_tasks' },
        {
          confirmation: 'delete_task_list',
          expectedRevision: await f.revisions('issueLists-one', 'projects-one'),
        },
      ),
    ).rejects.toThrow(/disabled/)
    f.rows.get('agentTokens-one').projectIds = ['projects-one']
    f.rows.set('notifications-other', {
      _id: 'notifications-other',
      recipientUserId: 'users-me',
      projectId: 'projects-other',
      updatedAt: 1,
    })
    expect((await f.callRead('list_notifications')).items).toEqual([])
    await expect(
      f.callWrite('mark_notification_read', {
        notificationId: 'notifications-other',
      }),
    ).rejects.toThrow(/scope/)
  })
  it('reuses assignment notifications and validates comments and date ranges', async () => {
    const f = await fixture('admin')
    f.rows.set('projectMembers-other', {
      _id: 'projectMembers-other',
      projectId: 'projects-one',
      userId: 'users-other',
    })
    await f.callWrite(
      'update_task',
      { issueId: 'issues-one', assigneeId: 'users-other' },
      { expectedRevision: await f.revisions('issues-one') },
    )
    expect(f.runMutation).toHaveBeenCalledTimes(1)
    await expect(
      f.callWrite(
        'add_comment',
        { issueId: 'issues-one', body: ' ' },
        { requestId: 'bad-comment' },
      ),
    ).rejects.toThrow(/empty/)
    await expect(
      f.callRead('search_tasks', { dueFrom: '2026-02-30' }),
    ).rejects.toThrow(/date/)
  })
})
