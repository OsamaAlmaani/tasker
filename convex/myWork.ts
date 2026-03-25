import { query } from './_generated/server'
import { getAccessibleProjectIds, requireCurrentUser } from './lib/auth'
import {
  getProjectStatusColor,
  getProjectStatusLabel,
  normalizeProject,
} from './lib/projectStatuses'

function sortByDueDateThenUpdated<
  TIssue extends { dueDate?: number; updatedAt: number },
>(left: TIssue, right: TIssue) {
  const leftDueDate = left.dueDate ?? Number.MAX_SAFE_INTEGER
  const rightDueDate = right.dueDate ?? Number.MAX_SAFE_INTEGER

  if (leftDueDate !== rightDueDate) {
    return leftDueDate - rightDueDate
  }

  return right.updatedAt - left.updatedAt
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)
    const now = Date.now()
    const dueSoonCutoff = now + 7 * 24 * 60 * 60 * 1000

    const accessibleProjects =
      user.globalRole === 'admin'
        ? await ctx.db.query('projects').collect()
        : await Promise.all(
            (await getAccessibleProjectIds(ctx, user._id)).map((projectId) =>
              ctx.db.get(projectId),
            ),
          )

    const visibleProjects = accessibleProjects
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .filter((project) => !project.archived)

    const projectById = new Map(
      visibleProjects.map((project) => {
        const normalizedProject = normalizeProject(project)
        return [normalizedProject._id, normalizedProject]
      }),
    )

    const assignedIssues = (
      await ctx.db
        .query('issues')
        .withIndex('by_assignee', (q) => q.eq('assigneeId', user._id))
        .collect()
    )
      .filter((issue) => !issue.deletedAt && !issue.archived)
      .filter((issue) => projectById.has(issue.projectId))
      .map((issue) => {
        const project = projectById.get(issue.projectId)
        return {
          ...issue,
          statusColor: getProjectStatusColor(project, issue.status),
          statusLabel: getProjectStatusLabel(project, issue.status),
          project: project
            ? {
                _id: project._id,
                key: project.key,
                name: project.name,
                statuses: project.statuses,
              }
            : null,
        }
      })

    const activeAssignedIssues = assignedIssues.filter(
      (issue) => issue.status !== 'done',
    )
    const focusIssues = activeAssignedIssues
      .filter((issue) => issue.status !== 'todo' && issue.status !== 'backlog')
      .sort(sortByDueDateThenUpdated)
    const overdueIssues = activeAssignedIssues
      .filter((issue) => issue.dueDate && issue.dueDate < now)
      .sort(sortByDueDateThenUpdated)
    const dueSoonIssues = activeAssignedIssues
      .filter(
        (issue) =>
          issue.dueDate && issue.dueDate >= now && issue.dueDate <= dueSoonCutoff,
      )
      .sort(sortByDueDateThenUpdated)
    const backlogIssues = activeAssignedIssues
      .filter((issue) => issue.status === 'backlog' || issue.status === 'todo')
      .sort(sortByDueDateThenUpdated)
    const recentlyCompletedIssues = assignedIssues
      .filter((issue) => issue.status === 'done')
      .sort(
        (left, right) =>
          (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt),
      )

    return {
      quickStats: {
        active: activeAssignedIssues.length,
        focus: focusIssues.length,
        dueSoon: dueSoonIssues.length,
        overdue: overdueIssues.length,
        completedRecently: recentlyCompletedIssues.length,
      },
      focusIssues: focusIssues.slice(0, 12),
      overdueIssues: overdueIssues.slice(0, 12),
      dueSoonIssues: dueSoonIssues.slice(0, 12),
      backlogIssues: backlogIssues.slice(0, 12),
      recentlyCompletedIssues: recentlyCompletedIssues.slice(0, 12),
    }
  },
})
