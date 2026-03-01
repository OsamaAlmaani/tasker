import { mutation } from './_generated/server'
import { requireCurrentUser } from './lib/auth'

export const seedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx)

    const existing = await ctx.db.query('projects').first()
    if (existing) {
      return { seeded: false, reason: 'Projects already exist.' }
    }

    const now = Date.now()
    const projectId = await ctx.db.insert('projects', {
      name: 'Core Platform',
      key: 'CORE',
      description: 'Core product engineering work and roadmap.',
      color: '#4f46e5',
      icon: 'Layers',
      createdBy: user._id,
      archived: false,
      allowMemberInvites: true,
      allowIssueDelete: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('projectMembers', {
      projectId,
      userId: user._id,
      addedBy: user._id,
      joinedAt: now,
    })

    await ctx.db.insert('projectCounters', {
      projectId,
      nextIssueNumber: 4,
      updatedAt: now,
    })

    await ctx.db.insert('issues', {
      projectId,
      issueNumber: 1,
      title: 'Set up role-aware project permissions',
      description:
        'Implement and test admin/member/viewer access in all queries and mutations.',
      searchText: 'set up role-aware project permissions implement and test admin/member/viewer access in all queries and mutations.',
      status: 'in_progress',
      priority: 'high',
      assigneeId: user._id,
      reporterId: user._id,
      createdBy: user._id,
      labels: ['auth', 'backend'],
      archived: false,
      createdAt: now - 1000 * 60 * 60 * 36,
      updatedAt: now - 1000 * 60 * 35,
    })

    await ctx.db.insert('issues', {
      projectId,
      issueNumber: 2,
      title: 'Design project dashboard cards',
      description: 'Build fast, keyboard-friendly dashboard modules.',
      searchText: 'design project dashboard cards build fast keyboard-friendly dashboard modules',
      status: 'todo',
      priority: 'medium',
      assigneeId: user._id,
      reporterId: user._id,
      createdBy: user._id,
      labels: ['frontend', 'ux'],
      dueDate: now + 1000 * 60 * 60 * 24 * 2,
      archived: false,
      createdAt: now - 1000 * 60 * 60 * 18,
      updatedAt: now - 1000 * 60 * 45,
    })

    await ctx.db.insert('issues', {
      projectId,
      issueNumber: 3,
      title: 'Polish issue detail timeline',
      description: 'Improve activity readability and event labels.',
      searchText: 'polish issue detail timeline improve activity readability and event labels',
      status: 'backlog',
      priority: 'low',
      reporterId: user._id,
      createdBy: user._id,
      labels: ['ui'],
      archived: false,
      createdAt: now - 1000 * 60 * 60 * 5,
      updatedAt: now - 1000 * 60 * 30,
    })

    return { seeded: true, projectId }
  },
})
