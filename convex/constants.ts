import { v } from 'convex/values'

export const GLOBAL_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export const ISSUE_STATUSES = [
  'todo',
  'backlog',
  'in_progress',
  'in_review',
  'done',
] as const
export const DEFAULT_PROJECT_STATUSES = [
  { key: 'todo', name: 'Todo', color: '#3b82f6', position: 0 },
  { key: 'backlog', name: 'Backlog', color: '#64748b', position: 1 },
  { key: 'in_progress', name: 'In Progress', color: '#f59e0b', position: 2 },
  { key: 'in_review', name: 'In Review', color: '#8b5cf6', position: 3 },
  { key: 'done', name: 'Done', color: '#10b981', position: 4 },
] as const
export const PROJECT_CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'checkbox',
  'select',
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
  'github',
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
  'github.repo_linked',
  'github.repo_unlinked',
  'github.pr_merged',
  'github.pr_closed',
  'github.pr_reopened',
  'github.workflows_started',
  'github.pr_linked',
  'github.pr_unlinked',
  'github.branch_created',
  'github.pr_created',
  'github.pr_event',
  'github.automation_applied',
  'github.automation_skipped',
  'github.webhook_registered',
  'github.webhook_removed',
  'github.automation_settings_changed',
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
export const NOTIFICATION_TYPES = [
  'issue_assigned',
  'github_review_requested',
  'github_changes_requested',
  'github_approved',
  'github_checks_failed',
  'github_merge_conflict',
  'github_pr_merged',
  'github_workflow_failed',
] as const

export const NOTIFICATION_EMAIL_STATUSES = [
  'pending',
  'sent',
  'failed',
  'skipped',
] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]
export type IssueStatus = string
export type ProjectStatusDefinition = {
  key: string
  name: string
  color: string
  position: number
}
export type ProjectLabelDefinition = {
  key: string
  name: string
  color: string
  position: number
}
export type ProjectCustomFieldType = (typeof PROJECT_CUSTOM_FIELD_TYPES)[number]
export type ProjectCustomFieldDefinition = {
  key: string
  name: string
  type: ProjectCustomFieldType
  position: number
  options?: string[]
}
export type IssueChecklistItem = {
  id: string
  text: string
  completed: boolean
  position: number
}
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]
export type InviteStatus = (typeof INVITE_STATUSES)[number]
export type MyWorkView = (typeof MY_WORK_VIEWS)[number]
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
export type NotificationEmailStatus =
  (typeof NOTIFICATION_EMAIL_STATUSES)[number]

export const globalRoleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('viewer'),
)

export const issueStatusValidator = v.string()

export const projectStatusValidator = v.object({
  key: v.string(),
  name: v.string(),
  color: v.string(),
  position: v.number(),
})

export const projectLabelValidator = v.object({
  key: v.string(),
  name: v.string(),
  color: v.string(),
  position: v.number(),
})

export const projectCustomFieldValidator = v.object({
  key: v.string(),
  name: v.string(),
  type: v.union(
    v.literal('text'),
    v.literal('number'),
    v.literal('date'),
    v.literal('checkbox'),
    v.literal('select'),
  ),
  position: v.number(),
  options: v.optional(v.array(v.string())),
})

export const issueCustomFieldValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
)

export const issueChecklistItemValidator = v.object({
  id: v.string(),
  text: v.string(),
  completed: v.boolean(),
  position: v.number(),
})

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
  v.literal('github'),
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
  v.literal('github.repo_linked'),
  v.literal('github.repo_unlinked'),
  v.literal('github.pr_merged'),
  v.literal('github.pr_closed'),
  v.literal('github.pr_reopened'),
  v.literal('github.workflows_started'),
  v.literal('github.pr_linked'),
  v.literal('github.pr_unlinked'),
  v.literal('github.branch_created'),
  v.literal('github.pr_created'),
  v.literal('github.pr_event'),
  v.literal('github.automation_applied'),
  v.literal('github.automation_skipped'),
  v.literal('github.webhook_registered'),
  v.literal('github.webhook_removed'),
  v.literal('github.automation_settings_changed'),
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

export const notificationTypeValidator = v.union(
  v.literal('issue_assigned'),
  v.literal('github_review_requested'),
  v.literal('github_changes_requested'),
  v.literal('github_approved'),
  v.literal('github_checks_failed'),
  v.literal('github_merge_conflict'),
  v.literal('github_pr_merged'),
  v.literal('github_workflow_failed'),
)

export const GITHUB_AUTOMATION_TRIGGERS = [
  'branch_pushed',
  'pr_opened',
  'pr_draft',
  'pr_merged',
  'pr_closed',
  'review_approved',
  'changes_requested',
] as const
export type GitHubAutomationTrigger = (typeof GITHUB_AUTOMATION_TRIGGERS)[number]

export const githubAutomationTriggerValidator = v.union(
  v.literal('branch_pushed'),
  v.literal('pr_opened'),
  v.literal('pr_draft'),
  v.literal('pr_merged'),
  v.literal('pr_closed'),
  v.literal('review_approved'),
  v.literal('changes_requested'),
)

/** One project automation rule: when `trigger` fires, move the task to `targetStatus`. */
export const githubAutomationRuleValidator = v.object({
  trigger: githubAutomationTriggerValidator,
  enabled: v.boolean(),
  // Omitted for `pr_closed`, which restores the status the automation replaced.
  targetStatus: v.optional(v.string()),
  // Only move tasks currently in one of these statuses; empty means any open status.
  fromStatuses: v.optional(v.array(v.string())),
})
export type GitHubAutomationRule = {
  trigger: GitHubAutomationTrigger
  enabled: boolean
  targetStatus?: string
  fromStatuses?: string[]
}

export const githubTemplatesValidator = v.object({
  branch: v.string(),
  pullRequestTitle: v.string(),
  pullRequestBody: v.string(),
})
export type GitHubTemplates = { branch: string; pullRequestTitle: string; pullRequestBody: string }

export const GITHUB_LINK_SOURCES = [
  'branch',
  'title',
  'body',
  'commit',
  'manual',
  'created_from_task',
  'webhook',
] as const
export const githubLinkSourceValidator = v.union(
  v.literal('branch'),
  v.literal('title'),
  v.literal('body'),
  v.literal('commit'),
  v.literal('manual'),
  v.literal('created_from_task'),
  v.literal('webhook'),
)
export type GitHubLinkSource = (typeof GITHUB_LINK_SOURCES)[number]

/** Webhook-sourced pull request state. Shown only to users whose own token can read the repository. */
export const githubPullRequestSnapshotValidator = v.object({
  title: v.string(),
  url: v.string(),
  state: v.union(v.literal('open'), v.literal('closed'), v.literal('merged')),
  isDraft: v.boolean(),
  headRefName: v.string(),
  baseRefName: v.string(),
  headSha: v.string(),
  authorLogin: v.union(v.string(), v.null()),
  reviewDecision: v.union(
    v.literal('approved'),
    v.literal('changes_requested'),
    v.literal('review_required'),
    v.null(),
  ),
  checks: v.union(v.literal('success'), v.literal('failure'), v.literal('pending'), v.null()),
  mergeable: v.union(v.literal('mergeable'), v.literal('conflicting'), v.literal('unknown')),
  updatedAt: v.number(),
})
export type GitHubPullRequestSnapshot = {
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  headSha: string
  authorLogin: string | null
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null
  checks: 'success' | 'failure' | 'pending' | null
  mergeable: 'mergeable' | 'conflicting' | 'unknown'
  updatedAt: number
}

export const notificationEmailStatusValidator = v.union(
  v.literal('pending'),
  v.literal('sent'),
  v.literal('failed'),
  v.literal('skipped'),
)
