import { query } from './_generated/server'
import { getAccessibleProjectIds, requireCurrentUser } from './lib/auth'
import {
  getProjectStatusColor,
  getProjectStatusLabel,
  normalizeProject,
} from './lib/projectStatuses'

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const now = Date.now()

    const accessibleProjects =
      user.globalRole === 'admin'
        ? await ctx.db.query('projects').collect()
        : await Promise.all(
            (await getAccessibleProjectIds(ctx, user._id)).map((projectId) =>
              ctx.db.get(projectId),
            ),
          )

    const projects = accessibleProjects
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .filter((project) => !project.archived)
      .map((project) => normalizeProject(project))

    const projectIds = new Set(projects.map((project) => project._id))
    const projectById = new Map(projects.map((project) => [project._id, project]))

    const myAssigned = (
      await ctx.db
        .query('issues')
        .withIndex('by_assignee', (q) => q.eq('assigneeId', user._id))
        .collect()
    )
      .filter((issue) => !issue.deletedAt && !issue.archived)
      .filter((issue) => projectIds.has(issue.projectId))
      .map((issue) => ({
        ...issue,
        statusColor: getProjectStatusColor(projectById.get(issue.projectId), issue.status),
        statusLabel: getProjectStatusLabel(projectById.get(issue.projectId), issue.status),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    const createdByMe = (
      await ctx.db
        .query('issues')
        .withIndex('by_createdBy', (q) => q.eq('createdBy', user._id))
        .collect()
    )
      .filter((issue) => !issue.deletedAt && !issue.archived)
      .filter((issue) => projectIds.has(issue.projectId))
      .map((issue) => ({
        ...issue,
        statusColor: getProjectStatusColor(projectById.get(issue.projectId), issue.status),
        statusLabel: getProjectStatusLabel(projectById.get(issue.projectId), issue.status),
      }))
      .sort((a, b) => b.createdAt - a.createdAt)

    const projectIssues = []
    for (const projectId of projectIds) {
      const issues = await ctx.db
        .query('issues')
        .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
        .collect()
      projectIssues.push(...issues)
    }

    const visibleIssues = projectIssues.filter(
      (issue) => !issue.deletedAt && !issue.archived,
    )

    const overdueIssues = visibleIssues
      .filter((issue) => issue.dueDate && issue.dueDate < now && issue.status !== 'done')
      .map((issue) => ({
        ...issue,
        statusColor: getProjectStatusColor(projectById.get(issue.projectId), issue.status),
        statusLabel: getProjectStatusLabel(projectById.get(issue.projectId), issue.status),
      }))
      .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))

    const quickStats = {
      projects: projects.length,
      openIssues: visibleIssues.filter((issue) => issue.status !== 'done').length,
      completedIssues: visibleIssues.filter((issue) => issue.status === 'done').length,
      assignedToMe: myAssigned.length,
      overdue: overdueIssues.length,
    }

    const activityRows = []
    for (const projectId of projectIds) {
      const rows = await ctx.db
        .query('activities')
        .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
        .order('desc')
        .take(8)
      activityRows.push(...rows)
    }

    const recentActivity = activityRows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)

    return {
      quickStats,
      recentProjects: projects.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
      myAssignedIssues: myAssigned.slice(0, 12),
      createdByMe: createdByMe.slice(0, 12),
      overdueIssues: overdueIssues.slice(0, 12),
      recentActivity,
    }
  },
})
