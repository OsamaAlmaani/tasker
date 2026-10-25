import { canonical, revision, decorate } from './lib/agentProtocol'
import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { hashToken, requireAgentUser } from './lib/agentTokens'
import { agentContext, requireAgentScope } from './lib/agentContext'
import {
  requireIssueViewAccess,
  requireProjectViewAccess,
  requireProjectIssueDeleteAccess,
} from './lib/auth'
import {
  readOperations,
  writeOperations,
  requestValidator,
} from './lib/agentOperations'

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message })
}
function boundedInput(input: unknown) {
  if (canonical(input).length > 200000)
    fail(
      'VALIDATION_ERROR',
      'Input exceeds 200,000 characters. Split the operation into smaller explicit requests.',
    )
}
export const read = query({
  args: { token: v.string(), request: requestValidator(readOperations) },
  handler: async (ctx, args) => {
    const identity = await requireAgentUser(ctx, args.token)
    const operation = readOperations[args.request.operation]
    requireAgentScope(identity.credential, 'read')
    requireAgentScope(identity.credential, operation.scope)
    boundedInput(args.request.input)
    return await decorate(
      ctx,
      await operation.handler(agentContext(ctx, identity), args.request.input),
    )
  },
})
// Request receipts are committed in the same transaction as their mutations. There is no TTL:
// even a late retry must never duplicate a task, comment or notification-producing assignment.
export const write = mutation({
  args: {
    token: v.string(),
    request: requestValidator(writeOperations),
    requestId: v.string(),
    expectedRevision: v.optional(v.record(v.string(), v.string())),
    confirmation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAgentUser(ctx, args.token)
    const operation = writeOperations[args.request.operation]
    requireAgentScope(identity.credential, 'write')
    requireAgentScope(identity.credential, operation.scope)
    const input = args.request.input as Record<string, any>
    boundedInput(input)
    if (!args.requestId.trim() || args.requestId.length > 200)
      fail(
        'VALIDATION_ERROR',
        'Use a nonempty requestId up to 200 characters and reuse it only for an identical retry.',
      )
    const scoped = agentContext(ctx, { ...identity, requestId: args.requestId })
    const destructive =
      operation.destructive || input.cascadeDescendantsToDone === true
    if (destructive) {
      requireAgentScope(identity.credential, 'delete')
      if (args.confirmation !== args.request.operation)
        fail(
          'CONFIRMATION_REQUIRED',
          `After obtaining user authorization, set confirmation to ${args.request.operation}.`,
        )
    }
    const inputHash = await hashToken(
      canonical({
        request: args.request,
        expectedRevision: args.expectedRevision,
        confirmation: args.confirmation,
      }),
    )
    const receipt = await ctx.db
      .query('agentRequests')
      .withIndex('by_tokenId_requestId', (q) =>
        q
          .eq('tokenId', identity.credential._id)
          .eq('requestId', args.requestId),
      )
      .unique()
    if (receipt) {
      if (receipt.inputHash !== inputHash)
        fail('CONFLICT', 'requestId was already used with different arguments.')
      // Revocation, current scope and project access must still hold on a replay.
      for (const id of receipt.projectIds)
        await requireProjectViewAccess(scoped, id)
      return {
        result: receipt.result,
        replayed: true,
        requestId: args.requestId,
      }
    }
    if (
      ['create_project', 'seed_demo_data'].includes(args.request.operation) &&
      identity.credential.projectIds
    )
      fail('FORBIDDEN', 'Project-restricted tokens cannot create new projects.')
    const projectIds = new Set<Id<'projects'>>()
    const checkProject = async (id: Id<'projects'>) => {
      await requireProjectViewAccess(scoped, id)
      projectIds.add(id)
    }
    if (input.projectId) await checkProject(input.projectId)
    for (const id of [input.issueId, ...(input.issueIds ?? [])].filter(
      Boolean,
    )) {
      const { issue } = await requireIssueViewAccess(scoped, id)
      projectIds.add(issue.projectId)
    }
    for (const [field, table] of [
      ['issueListId', 'issueLists'],
      ['commentId', 'comments'],
      ['notificationId', 'notifications'],
    ] as const) {
      if (!input[field]) continue
      const id = ctx.db.normalizeId(table, input[field])
      if (!id) fail('VALIDATION_ERROR', `Invalid ${field}.`)
      const row = await ctx.db.get(id)
      if (!row) fail('NOT_FOUND', 'Resource not found.')
      if (row.projectId) await checkProject(row.projectId)
    }
    // Authenticate owned resources before revision checks; do not disclose other users' revisions.
    if (input.noteId) {
      const note = await ctx.db.get(input.noteId as Id<'userNotes'>)
      if (!note || note.ownerId !== identity.user._id)
        fail('NOT_FOUND', 'Note not found.')
    }
    if (input.commentId) {
      const comment = await ctx.db.get(input.commentId as Id<'comments'>)
      if (comment) await requireIssueViewAccess(scoped, comment.issueId)
    }
    const requiredIds = (operation.targets ?? []).flatMap((field) =>
      Array.isArray(input[field])
        ? input[field]
        : input[field]
          ? [input[field]]
          : [],
    )
    // A project revision guards operations that can rewrite task trees or project definitions.
    if (
      destructive ||
      input.listId !== undefined ||
      input.parentIssueId !== undefined
    )
      requiredIds.push(...projectIds)
    for (const id of new Set<string>(requiredIds)) {
      const row = await ctx.db.get(id as Id<'issues'>)
      if (!row) fail('NOT_FOUND', 'Resource not found.')
      if (args.expectedRevision?.[id] === undefined)
        fail(
          'REVISION_REQUIRED',
          `Read the current record and supply expectedRevision for ${id}.`,
        )
      if ((await revision(row)) !== args.expectedRevision![id])
        fail(
          'CONFLICT',
          `Resource ${id} changed. Read it again before editing.`,
        )
    }
    if (
      args.request.operation === 'delete_task_list' &&
      input.mode === 'delete_tasks'
    )
      for (const id of projectIds)
        await requireProjectIssueDeleteAccess(scoped, id)
    validateContent(input)
    const result = await decorate(ctx, await operation.handler(scoped, input))
    if (
      args.request.operation === 'create_project' &&
      result &&
      typeof result === 'object' &&
      '_id' in result
    )
      projectIds.add(result._id as Id<'projects'>)
    if (args.request.operation === 'seed_demo_data' && result?.projectId)
      projectIds.add(result.projectId)
    await ctx.db.insert('agentRequests', {
      tokenId: identity.credential._id,
      userId: identity.user._id,
      requestId: args.requestId,
      operation: args.request.operation,
      inputHash,
      result: result ?? null,
      projectIds: [...projectIds],
      createdAt: Date.now(),
    })
    return {
      result: result ?? null,
      replayed: false,
      requestId: args.requestId,
    }
  },
})
function validateContent(input: Record<string, any>) {
  for (const field of ['title', 'name', 'body'])
    if (
      input[field] !== undefined &&
      typeof input[field] === 'string' &&
      !input[field].trim() &&
      (field !== 'body' || input.commentId || input.issueId)
    )
      fail('VALIDATION_ERROR', `${field} cannot be empty.`)
  for (const field of ['dueDate', 'startDate'])
    if (input[field] != null && !Number.isFinite(input[field]))
      fail(
        'VALIDATION_ERROR',
        `${field} must be a finite Unix timestamp in milliseconds.`,
      )
  if (
    input.startDate != null &&
    input.dueDate != null &&
    input.startDate > input.dueDate
  )
    fail('VALIDATION_ERROR', 'Start date cannot be after due date.')
}
