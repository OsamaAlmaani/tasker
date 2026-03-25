import { v } from 'convex/values'

export const GLOBAL_ROLES = ['admin', 'member', 'viewer'] as const
export const ISSUE_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
] as const
export const ISSUE_PRIORITIES = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
] as const

export const ACTIVITY_ENTITY_TYPES = [
  'project',
  'issue_list',
  'issue',
  'comment',
  'member',
  'invite',
  'user',
] as const

export const ACTIVITY_ACTIONS = [
  'project.created',
  'project.updated',
  'project.archived',
  'project.member_added',
  'project.member_removed',
  'project.invite_sent',
  'project.invite_revoked',
  'project.invite_accepted',
  'issue_list.created',
  'issue_list.updated',
  'issue_list.deleted',
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.list_changed',
  'issue.status_changed',
  'issue.priority_changed',
  'issue.assignee_changed',
  'comment.created',
  'comment.edited',
  'user.role_changed',
  'user.activated',
  'user.deactivated',
] as const

export const INVITE_STATUSES = [
  'pending',
  'accepted',
  'revoked',
  'expired',
] as const
export const MY_WORK_VIEWS = [
  'overview',
  'focus',
  'due_soon',
  'overdue',
  'backlog',
  'completed',
] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]
export type InviteStatus = (typeof INVITE_STATUSES)[number]
export type MyWorkView = (typeof MY_WORK_VIEWS)[number]

export const globalRoleValidator = v.union(
  v.literal('admin'),
  v.literal('member'),
  v.literal('viewer'),
)

export const issueStatusValidator = v.union(
  v.literal('backlog'),
  v.literal('todo'),
  v.literal('in_progress'),
  v.literal('in_review'),
  v.literal('done'),
)

export const issuePriorityValidator = v.union(
  v.literal('none'),
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
)

export const activityEntityTypeValidator = v.union(
  v.literal('project'),
  v.literal('issue_list'),
  v.literal('issue'),
  v.literal('comment'),
  v.literal('member'),
  v.literal('invite'),
  v.literal('user'),
)

export const activityActionValidator = v.union(
  v.literal('project.created'),
  v.literal('project.updated'),
  v.literal('project.archived'),
  v.literal('project.member_added'),
  v.literal('project.member_removed'),
  v.literal('project.invite_sent'),
  v.literal('project.invite_revoked'),
  v.literal('project.invite_accepted'),
  v.literal('issue_list.created'),
  v.literal('issue_list.updated'),
  v.literal('issue_list.deleted'),
  v.literal('issue.created'),
  v.literal('issue.updated'),
  v.literal('issue.deleted'),
  v.literal('issue.list_changed'),
  v.literal('issue.status_changed'),
  v.literal('issue.priority_changed'),
  v.literal('issue.assignee_changed'),
  v.literal('comment.created'),
  v.literal('comment.edited'),
  v.literal('user.role_changed'),
  v.literal('user.activated'),
  v.literal('user.deactivated'),
)

export const inviteStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('revoked'),
  v.literal('expired'),
)

export const myWorkViewValidator = v.union(
  v.literal('overview'),
  v.literal('focus'),
  v.literal('due_soon'),
  v.literal('overdue'),
  v.literal('backlog'),
  v.literal('completed'),
)
