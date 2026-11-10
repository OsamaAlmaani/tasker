import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  activityActionValidator,
  activityEntityTypeValidator,
  globalRoleValidator,
  inviteStatusValidator,
  issuePriorityValidator,
  issueChecklistItemValidator,
  issueStatusValidator,
  myWorkViewValidator,
  projectCustomFieldValidator,
  projectLabelValidator,
  projectStatusValidator,
  issueCustomFieldValueValidator,
  notificationEmailStatusValidator,
  notificationTypeValidator,
  githubAutomationRuleValidator,
  githubLinkSourceValidator,
  githubPullRequestSnapshotValidator,
  githubReviewTaskKindValidator,
  githubReviewTaskSettingsValidator,
  githubTemplatesValidator,
} from './constants'

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    myWorkDefaultView: v.optional(myWorkViewValidator),
    myWorkLastView: v.optional(myWorkViewValidator),
    globalRole: globalRoleValidator,
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_clerkUserId', ['clerkUserId'])
    .index('by_email', ['email'])
    .index('by_globalRole', ['globalRole'])
    .index('by_isActive', ['isActive']),

  agentTokens: defineTable({
    userId: v.id('users'),
    name: v.string(),
    tokenHash: v.string(),
    scopes: v.optional(v.array(v.union(v.literal('read'), v.literal('write'), v.literal('delete'), v.literal('notes'), v.literal('inbox')))),
    projectIds: v.optional(v.array(v.id('projects'))),
    tokenPrefix: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_tokenHash', ['tokenHash']),

  agentRequests: defineTable({
    tokenId: v.id('agentTokens'), userId: v.id('users'), requestId: v.string(),
    operation: v.string(), inputHash: v.string(), result: v.any(),
    projectIds: v.array(v.id('projects')), createdAt: v.number(),
  }).index('by_tokenId_requestId', ['tokenId', 'requestId']),

  userNotes: defineTable({
    ownerId: v.id('users'),
    title: v.string(),
    body: v.string(),
    excerpt: v.string(),
    searchText: v.string(),
    pinned: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_ownerId', ['ownerId'])
    .index('by_ownerId_updatedAt', ['ownerId', 'updatedAt']),

  projects: defineTable({
    name: v.string(),
    key: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    customFields: v.optional(v.array(projectCustomFieldValidator)),
    labels: v.optional(v.array(projectLabelValidator)),
    statuses: v.optional(v.array(projectStatusValidator)),
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

  // One personal GitHub token per Tasker user. Only that user's requests ever
  // decrypt it; nobody else reads or acts through it.
  githubConnections: defineTable({
    userId: v.id('users'),
    // Encrypted with GITHUB_TOKEN_ENCRYPTION_KEY; never returned to clients.
    accessToken: v.string(),
    scopes: v.array(v.string()),
    githubUserId: v.number(),
    githubLogin: v.string(),
    githubAvatarUrl: v.optional(v.string()),
    githubProfileUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_githubLogin', ['githubLogin']),

  // Which repository a project tracks. Holds no credentials or GitHub data;
  // each member reads it with their own token.
  githubRepositoryLinks: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    owner: v.string(),
    name: v.string(),
    fullName: v.string(),
    htmlUrl: v.string(),
    defaultBranch: v.string(),
    private: v.boolean(),
    linkedBy: v.id('users'),
    linkedAt: v.number(),
    // Bumped on every accepted webhook delivery so open pages refetch with
    // their own token. Never carries GitHub data itself.
    liveVersion: v.optional(v.number()),
    // Webhook registered on the repository. The secret is encrypted with
    // GITHUB_TOKEN_ENCRYPTION_KEY and only used to verify deliveries.
    webhook: v.optional(
      v.object({
        hookId: v.union(v.number(), v.null()),
        secret: v.string(),
        url: v.string(),
        registeredBy: v.id('users'),
        registeredAt: v.number(),
        lastDeliveryAt: v.optional(v.number()),
        lastDeliveryEvent: v.optional(v.string()),
        lastError: v.optional(v.string()),
        // Events the hook was registered with; missing on hooks created
        // before review thread sync, which the GitHub tab offers to update.
        events: v.optional(v.array(v.string())),
      }),
    ),
    // Status automation rules mapped to this project's own statuses.
    automationRules: v.optional(v.array(githubAutomationRuleValidator)),
    // A project writer who opted in to act for automations that write to
    // GitHub. Every such action is labelled with their login in activity.
    automationUserId: v.optional(v.id('users')),
    templates: v.optional(githubTemplatesValidator),
    reviewTaskSettings: v.optional(githubReviewTaskSettingsValidator),
  })
    .index('by_projectId', ['projectId'])
    .index('by_repositoryId', ['repositoryId']),

  // A pull request that belongs to a task. Only identifiers are stored, plus a
  // webhook-sourced snapshot that queries reveal only to users whose own token
  // can read the repository.
  githubPullRequestLinks: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    issueId: v.id('issues'),
    pullNumber: v.number(),
    source: githubLinkSourceValidator,
    linkedBy: v.optional(v.id('users')),
    linkedAt: v.number(),
    snapshot: v.optional(githubPullRequestSnapshotValidator),
    // Status the last automation moved the task from, restored when the pull
    // request closes without merging.
    automationPreviousStatus: v.optional(v.string()),
  })
    .index('by_issueId', ['issueId'])
    .index('by_projectId', ['projectId'])
    .index('by_projectId_pullNumber', ['projectId', 'pullNumber'])
    .index('by_repositoryId_pullNumber', ['repositoryId', 'pullNumber']),

  // A pull request review conversation tracked as a task. `fix` threads keep
  // their task in sync (resolved <-> done); `follow_up` threads were resolved
  // on GitHub when the task was created and stay independent of it.
  githubReviewThreadLinks: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    pullNumber: v.number(),
    issueId: v.id('issues'),
    // GraphQL node id of the PullRequestReviewThread.
    threadId: v.string(),
    // REST id of the thread's first comment, for matching comment webhooks.
    rootCommentId: v.optional(v.number()),
    kind: githubReviewTaskKindValidator,
    path: v.string(),
    line: v.optional(v.number()),
    authorLogin: v.optional(v.string()),
    isResolved: v.boolean(),
    isOutdated: v.boolean(),
    // Status the task had before a resolved thread completed it, restored
    // when the thread is unresolved.
    statusBeforeResolve: v.optional(v.string()),
    // Replies seen through webhooks. Only counts and logins are kept; the
    // text is always read live with the viewer's own token.
    replyCount: v.optional(v.number()),
    lastReplyAt: v.optional(v.number()),
    lastReplyLogin: v.optional(v.string()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_issueId', ['issueId'])
    .index('by_projectId_pullNumber', ['projectId', 'pullNumber'])
    .index('by_threadId', ['threadId'])
    .index('by_repositoryId_rootCommentId', ['repositoryId', 'rootCommentId']),

  // A branch that belongs to a task, known before any pull request exists.
  githubBranchLinks: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    issueId: v.id('issues'),
    branchName: v.string(),
    source: v.union(v.literal('push'), v.literal('created_from_task'), v.literal('manual')),
    createdBy: v.optional(v.id('users')),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_issueId', ['issueId'])
    .index('by_projectId', ['projectId'])
    .index('by_repositoryId_branchName', ['repositoryId', 'branchName']),

  // Whether a user's own token could read a repository, checked at most once
  // per day. Gates what webhook-sourced metadata that user may see.
  githubRepositoryAccess: defineTable({
    userId: v.id('users'),
    repositoryId: v.number(),
    canRead: v.boolean(),
    checkedAt: v.number(),
  }).index('by_userId_repositoryId', ['userId', 'repositoryId']),

  // Delivery log for debugging and replay protection. Never stores bodies.
  githubWebhookDeliveries: defineTable({
    repositoryId: v.number(),
    deliveryId: v.string(),
    event: v.string(),
    action: v.union(v.string(), v.null()),
    pullNumber: v.optional(v.number()),
    ref: v.optional(v.string()),
    sha: v.optional(v.string()),
    senderLogin: v.optional(v.string()),
    receivedAt: v.number(),
    outcome: v.string(),
  })
    .index('by_deliveryId', ['deliveryId'])
    .index('by_repositoryId_receivedAt', ['repositoryId', 'receivedAt']),

  // Named sets of workflows a project runs together. A workflow may be in any
  // number of groups. Workflow names are read live from GitHub; only ids and
  // paths (as a fallback label) are stored.
  githubWorkflowGroups: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    name: v.string(),
    workflows: v.array(v.object({ id: v.number(), path: v.string() })),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_projectId', ['projectId']),

  // Workflows started together from Tasker. GitHub records each as a separate
  // run, so this row is what ties them into one release. Run state is always
  // read live from GitHub with the viewer's own token.
  githubWorkflowReleases: defineTable({
    projectId: v.id('projects'),
    repositoryId: v.number(),
    name: v.string(),
    ref: v.string(),
    headSha: v.string(),
    groupIds: v.array(v.id('githubWorkflowGroups')),
    runs: v.array(
      v.object({
        workflowId: v.number(),
        workflowName: v.string(),
        workflowPath: v.string(),
        runId: v.union(v.number(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
    ),
    skipped: v.array(
      v.object({
        workflowId: v.number(),
        workflowName: v.string(),
        reason: v.union(v.literal('unchanged'), v.literal('removed')),
      }),
    ),
    status: v.union(v.literal('starting'), v.literal('started')),
    startedBy: v.id('users'),
    startedAt: v.number(),
  }).index('by_projectId_startedAt', ['projectId', 'startedAt']),

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
    descriptionDoc: v.optional(v.object({ type: v.literal('doc'), content: v.array(v.any()) })),
    searchText: v.string(),
    status: issueStatusValidator,
    priority: issuePriorityValidator,
    assigneeId: v.optional(v.id('users')),
    reporterId: v.id('users'),
    createdBy: v.id('users'),
    labels: v.array(v.string()),
    checklistItems: v.optional(v.array(issueChecklistItemValidator)),
    customFieldValues: v.optional(v.record(v.string(), issueCustomFieldValueValidator)),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    archived: v.boolean(),
    deletedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    agentClaim: v.optional(v.object({
      tokenId: v.id('agentTokens'),
      userId: v.id('users'),
      runId: v.string(),
      expiresAt: v.number(),
      previousStatus: v.string(),
      workStatus: v.string(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_projectId', ['projectId'])
    .index('by_projectId_issueNumber', ['projectId', 'issueNumber'])
    .index('by_projectId_status', ['projectId', 'status'])
    .index('by_status', ['status'])
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

  notifications: defineTable({
    recipientUserId: v.id('users'),
    actorUserId: v.optional(v.id('users')),
    projectId: v.optional(v.id('projects')),
    issueId: v.optional(v.id('issues')),
    type: notificationTypeValidator,
    title: v.string(),
    body: v.string(),
    link: v.string(),
    metadata: v.optional(v.any()),
    readAt: v.optional(v.number()),
    emailStatus: notificationEmailStatusValidator,
    emailAttempts: v.number(),
    lastEmailAttemptAt: v.optional(v.number()),
    emailSentAt: v.optional(v.number()),
    lastEmailError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_recipientUserId_createdAt', ['recipientUserId', 'createdAt'])
    .index('by_recipientUserId_readAt', ['recipientUserId', 'readAt'])
    .index('by_recipientUserId_emailStatus', ['recipientUserId', 'emailStatus'])
    .index('by_issueId', ['issueId'])
    .index('by_projectId', ['projectId']),
})
