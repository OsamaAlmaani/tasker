import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  activityActionValidator,
  activityEntityTypeValidator,
  globalRoleValidator,
  inviteStatusValidator,
  issuePriorityValidator,
  issueStatusValidator,
} from './constants'

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    globalRole: globalRoleValidator,
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_clerkUserId', ['clerkUserId'])
    .index('by_email', ['email'])
    .index('by_globalRole', ['globalRole'])
    .index('by_isActive', ['isActive']),

  projects: defineTable({
    name: v.string(),
    key: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    createdBy: v.id('users'),
    archived: v.boolean(),
    allowMemberInvites: v.boolean(),
    allowIssueDelete: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_archived', ['archived'])
    .index('by_createdBy', ['createdBy']),

  projectMembers: defineTable({
    projectId: v.id('projects'),
    userId: v.id('users'),
    addedBy: v.id('users'),
    joinedAt: v.number(),
  })
    .index('by_projectId', ['projectId'])
    .index('by_userId', ['userId'])
    .index('by_projectId_userId', ['projectId', 'userId']),

  projectCounters: defineTable({
    projectId: v.id('projects'),
    nextIssueNumber: v.number(),
    updatedAt: v.number(),
  }).index('by_projectId', ['projectId']),

  issueLists: defineTable({
    projectId: v.id('projects'),
    name: v.string(),
    position: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_projectId', ['projectId'])
    .index('by_projectId_position', ['projectId', 'position']),

  issues: defineTable({
    projectId: v.id('projects'),
    listId: v.optional(v.id('issueLists')),
    parentIssueId: v.optional(v.id('issues')),
    issueNumber: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    searchText: v.string(),
    status: issueStatusValidator,
    priority: issuePriorityValidator,
    assigneeId: v.optional(v.id('users')),
    reporterId: v.id('users'),
    createdBy: v.id('users'),
    labels: v.array(v.string()),
    dueDate: v.optional(v.number()),
    archived: v.boolean(),
    deletedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_projectId', ['projectId'])
    .index('by_projectId_issueNumber', ['projectId', 'issueNumber'])
    .index('by_projectId_status', ['projectId', 'status'])
    .index('by_projectId_priority', ['projectId', 'priority'])
    .index('by_projectId_assignee', ['projectId', 'assigneeId'])
    .index('by_projectId_listId', ['projectId', 'listId'])
    .index('by_projectId_parentIssueId', ['projectId', 'parentIssueId'])
    .index('by_assignee', ['assigneeId'])
    .index('by_listId', ['listId'])
    .index('by_parentIssueId', ['parentIssueId'])
    .index('by_reporter', ['reporterId'])
    .index('by_createdBy', ['createdBy'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['projectId', 'archived'],
    }),

  comments: defineTable({
    issueId: v.id('issues'),
    projectId: v.id('projects'),
    authorId: v.id('users'),
    body: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index('by_issueId', ['issueId'])
    .index('by_projectId', ['projectId'])
    .index('by_authorId', ['authorId']),

  projectInvites: defineTable({
    projectId: v.id('projects'),
    email: v.string(),
    invitedBy: v.id('users'),
    status: inviteStatusValidator,
    clerkInvitationId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id('users')),
    revokedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index('by_projectId', ['projectId'])
    .index('by_email', ['email'])
    .index('by_projectId_status', ['projectId', 'status'])
    .index('by_email_status', ['email', 'status'])
    .index('by_projectId_email_status', ['projectId', 'email', 'status']),

  activities: defineTable({
    projectId: v.id('projects'),
    issueId: v.optional(v.id('issues')),
    actorId: v.optional(v.id('users')),
    entityType: activityEntityTypeValidator,
    entityId: v.string(),
    action: activityActionValidator,
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index('by_projectId', ['projectId'])
    .index('by_issueId', ['issueId'])
    .index('by_actorId', ['actorId'])
    .index('by_entity', ['entityType', 'entityId']),
})
