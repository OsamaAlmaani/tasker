import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { defineQuery } from './lib/definitions'
import { getAgentIdentity } from './lib/agentContext'
import {
  getProjectMembership,
  isAdmin,
  requireCurrentUser,
  requireIssueViewAccess,
  requireProjectViewAccess,
} from './lib/auth'
import { normalizeProject } from './lib/projectStatuses'
import { matchesIssueFilters, validateDateFilters } from './lib/issueFilters'

const pageArgs = {
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
}
function pagination(args: { cursor?: string; limit?: number }) {
  const limit = args.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'limit must be 1–100.',
    })
  return {
    cursor: args.cursor ?? null,
    numItems: limit,
    maximumRowsRead: 100,
    maximumBytesRead: 1024 * 1024,
  }
}
function pageResult<T>(
  page: { isDone: boolean; continueCursor: string },
  items: T[],
) {
  return { items, nextCursor: page.isDone ? null : page.continueCursor }
}
async function visibleProject(ctx: QueryCtx, id: Id<'projects'>) {
  const user = await requireCurrentUser(ctx)
  const allowed = getAgentIdentity(ctx)?.credential.projectIds
  if (allowed && !allowed.includes(id)) return null
  const project = await ctx.db.get(id)
  if (!project) return null
  return isAdmin(user.globalRole) ||
    project.createdBy === user._id ||
    (await getProjectMembership(ctx, id, user._id))
    ? project
    : null
}
export function linkedIssue(issue: Doc<'issues'>, project: Doc<'projects'>) {
  return {
    ...issue,
    identifier: `${project.key}-${issue.issueNumber}`,
    path: `/issues/${issue._id}`,
    project: { _id: project._id, name: project.name, key: project.key },
  }
}
export const whoami = defineQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const token = getAgentIdentity(ctx)!.credential
    return {
      _id: user._id,
      name: user.name,
      globalRole: user.globalRole,
      scopes: token.scopes ?? ['read', 'write', 'delete', 'notes', 'inbox'],
      projectIds: token.projectIds ?? null,
      myWorkDefaultView: user.myWorkDefaultView,
      myWorkLastView: user.myWorkLastView,
    }
  },
})
export const listProjects = defineQuery({
  args: {
    ...pageArgs,
    search: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('projects')
      .order('asc')
      .paginate(pagination(args))
    const items = []
    for (const row of page.page) {
      if (
        (!args.includeArchived && row.archived) ||
        (args.search &&
          !`${row.name} ${row.key}`
            .toLowerCase()
            .includes(args.search.toLowerCase()))
      )
        continue
      const project = await visibleProject(ctx, row._id)
      if (project)
        items.push({
          ...normalizeProject(project),
          path: `/projects/${project._id}`,
        })
    }
    return pageResult(page, items)
  },
})
export const getProject = defineQuery({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { project } = await requireProjectViewAccess(ctx, args.projectId)
    return { ...normalizeProject(project), path: `/projects/${project._id}` }
  },
})
export const listAssignees = defineQuery({
  args: {
    ...pageArgs,
    projectId: v.id('projects'),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectViewAccess(ctx, args.projectId)
    const page = await ctx.db
      .query('users')
      .withIndex('by_isActive', (q) => q.eq('isActive', true))
      .paginate(pagination(args))
    const items = []
    for (const row of page.page) {
      if (
        !isAdmin(row.globalRole) &&
        !(await getProjectMembership(ctx, project._id, row._id))
      )
        continue
      if (
        args.search &&
        !`${row.name} ${row.email}`
          .toLowerCase()
          .includes(args.search.toLowerCase())
      )
        continue
      items.push({ _id: row._id, name: row.name, email: row.email })
    }
    return pageResult(page, items)
  },
})
export const searchTasks = defineQuery({
  args: {
    ...pageArgs,
    projectId: v.optional(v.id('projects')),
    search: v.optional(v.string()),
    statuses: v.optional(v.array(v.string())),
    priority: v.optional(v.string()),
    assigneeId: v.optional(v.union(v.id('users'), v.null())),
    onlyMine: v.optional(v.boolean()),
    creatorId: v.optional(v.id('users')),
    listId: v.optional(v.union(v.id('issueLists'), v.null())),
    parentIssueId: v.optional(v.union(v.id('issues'), v.null())),
    label: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
    startFrom: v.optional(v.string()),
    startTo: v.optional(v.string()),
    dueFrom: v.optional(v.string()),
    dueTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    try {
      validateDateFilters(args)
    } catch {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Use valid ordered YYYY-MM-DD date ranges.',
      })
    }
    if (args.projectId) await requireProjectViewAccess(ctx, args.projectId)
    const query = args.projectId
      ? ctx.db
          .query('issues')
          .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId!))
      : ctx.db.query('issues').order('asc')
    const page = await query.paginate(pagination(args))
    const items = []
    for (const row of page.page) {
      if (
        row.deletedAt !== undefined ||
        (!args.includeArchived && row.archived)
      )
        continue
      if (args.statuses?.length && !args.statuses.includes(row.status)) continue
      if (args.priority && row.priority !== args.priority) continue
      if (
        !matchesIssueFilters(row, args) ||
        (args.onlyMine && row.assigneeId !== user._id)
      )
        continue
      if (args.creatorId && row.createdBy !== args.creatorId) continue
      if (args.listId !== undefined && (row.listId ?? null) !== args.listId)
        continue
      if (
        args.parentIssueId !== undefined &&
        (row.parentIssueId ?? null) !== args.parentIssueId
      )
        continue
      if (args.label && !row.labels.includes(args.label)) continue
      const project = await visibleProject(ctx, row.projectId)
      if (!project || (!args.includeArchived && project.archived)) continue
      if (
        args.search &&
        !`${project.key}-${row.issueNumber} ${row.title} ${row.description ?? ''}`
          .toLowerCase()
          .includes(args.search.trim().toLowerCase())
      )
        continue
      items.push(linkedIssue(row, project))
    }
    return pageResult(page, items)
  },
})
export const readTask = defineQuery({
  args: { issueId: v.id('issues') },
  handler: async (ctx, args) => {
    const { issue, project } = await requireIssueViewAccess(ctx, args.issueId)
    return {
      ...linkedIssue(issue, project),
      project: normalizeProject(project),
    }
  },
})
export const listComments = defineQuery({
  args: { ...pageArgs, issueId: v.id('issues') },
  handler: async (ctx, args) => {
    await requireIssueViewAccess(ctx, args.issueId)
    const page = await ctx.db
      .query('comments')
      .withIndex('by_issueId', (q) => q.eq('issueId', args.issueId))
      .order('asc')
      .paginate(pagination(args))
    const items = await Promise.all(
      page.page.map(async (comment) => {
        const author = await ctx.db.get(comment.authorId)
        return {
          ...comment,
          author: author ? { _id: author._id, name: author.name } : null,
        }
      }),
    )
    return pageResult(page, items)
  },
})
export const listLists = defineQuery({
  args: { ...pageArgs, projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireProjectViewAccess(ctx, args.projectId)
    const page = await ctx.db
      .query('issueLists')
      .withIndex('by_projectId_position', (q) =>
        q.eq('projectId', args.projectId),
      )
      .paginate(pagination(args))
    return pageResult(page, page.page)
  },
})
export const listActivity = defineQuery({
  args: {
    ...pageArgs,
    projectId: v.id('projects'),
    issueId: v.optional(v.id('issues')),
  },
  handler: async (ctx, args) => {
    await requireProjectViewAccess(ctx, args.projectId)
    if (args.issueId) {
      const { issue } = await requireIssueViewAccess(ctx, args.issueId)
      if (issue.projectId !== args.projectId)
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Task belongs to another project.',
        })
    }
    const query = args.issueId
      ? ctx.db
          .query('activities')
          .withIndex('by_issueId', (q) => q.eq('issueId', args.issueId!))
      : ctx.db
          .query('activities')
          .withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
    const page = await query.order('desc').paginate(pagination(args))
    return pageResult(page, page.page)
  },
})
export const listNotes = defineQuery({
  args: { ...pageArgs, search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const page = await ctx.db
      .query('userNotes')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', user._id))
      .paginate(pagination(args))
    return pageResult(
      page,
      page.page.filter(
        (row) =>
          !args.search || row.searchText.includes(args.search.toLowerCase()),
      ),
    )
  },
})
export const getNote = defineQuery({
  args: { noteId: v.id('userNotes') },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const note = await ctx.db.get(args.noteId)
    if (!note || note.ownerId !== user._id)
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Note not found.' })
    return note
  },
})
export const listNotifications = defineQuery({
  args: { ...pageArgs, unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const page = await ctx.db
      .query('notifications')
      .withIndex('by_recipientUserId_createdAt', (q) =>
        q.eq('recipientUserId', user._id),
      )
      .order('desc')
      .paginate(pagination(args))
    const items = []
    for (const row of page.page) {
      if (args.unreadOnly && row.readAt) continue
      if (row.projectId && !(await visibleProject(ctx, row.projectId))) continue
      items.push(row)
    }
    return pageResult(page, items)
  },
})
