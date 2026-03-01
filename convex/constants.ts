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
  'issue',
  'comment',
  'member',
  'user',
] as const

export const ACTIVITY_ACTIONS = [
  'project.created',
  'project.updated',
  'project.archived',
  'project.member_added',
  'project.member_removed',
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.status_changed',
  'issue.priority_changed',
  'issue.assignee_changed',
  'comment.created',
  'comment.edited',
  'user.role_changed',
  'user.activated',
  'user.deactivated',
] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

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
  v.literal('issue'),
  v.literal('comment'),
  v.literal('member'),
  v.literal('user'),
)

export const activityActionValidator = v.union(
  v.literal('project.created'),
  v.literal('project.updated'),
  v.literal('project.archived'),
  v.literal('project.member_added'),
  v.literal('project.member_removed'),
  v.literal('issue.created'),
  v.literal('issue.updated'),
  v.literal('issue.deleted'),
  v.literal('issue.status_changed'),
  v.literal('issue.priority_changed'),
  v.literal('issue.assignee_changed'),
  v.literal('comment.created'),
  v.literal('comment.edited'),
  v.literal('user.role_changed'),
  v.literal('user.activated'),
  v.literal('user.deactivated'),
)
