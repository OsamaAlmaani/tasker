import { v, type PropertyValidators } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { AgentScope } from './agentContext'
import * as reads from '../agentReads'
import * as projects from '../projects'
import * as issues from '../issues'
import * as lists from '../issueLists'
import * as comments from '../comments'
import * as notes from '../userNotes'
import * as notifications from '../notifications'
import * as users from '../users'
import * as dashboard from '../dashboard'
import * as myWork from '../myWork'
import * as dev from '../dev'

type Definition<C> = {
  args: PropertyValidators
  handler: (ctx: C, args: any) => Promise<unknown>
}
export type Operation<C> = Definition<C> & {
  description: string
  scope: AgentScope
  destructive?: boolean
  targets?: string[]
}
function read(
  def: Definition<QueryCtx>,
  description: string,
  scope: AgentScope = 'read',
): Operation<QueryCtx> {
  return { ...def, description, scope }
}
function write(
  def: Definition<MutationCtx>,
  description: string,
  targets: string[] = [],
  destructive = false,
  scope: AgentScope = 'write',
): Operation<MutationCtx> {
  return { ...def, description, scope, targets, destructive }
}
// Access-policy flags are deliberately absent, even though the browser's handler supports them.
const {
  allowMemberInvites: _createInvites,
  allowIssueDelete: _createDelete,
  ...createProjectArgs
} = projects.createDefinition.args
const {
  allowMemberInvites: _updateInvites,
  allowIssueDelete: _updateDelete,
  ...updateProjectArgs
} = projects.updateDefinition.args
export const readOperations: Record<string, Operation<QueryCtx>> = {
  whoami: read(
    reads.whoami,
    'Read current agent identity, effective scopes and personal work preferences.',
  ),
  list_projects: read(
    reads.listProjects,
    'List accessible projects. Paginated; continue until nextCursor is null, including empty pages.',
  ),
  get_project: read(
    reads.getProject,
    'Read project metadata, workflow, labels and custom field definitions. Includes a revision token for concurrency checks.',
  ),
  list_assignees: read(
    reads.listAssignees,
    'Read eligible assignees in one accessible project; optional name/email search. Never changes membership.',
  ),
  search_tasks: read(
    reads.searchTasks,
    'Complete paginated task audit/search, including all assignees, statuses, completed tasks and claims by default. Archived work is opt-in. Search also matches project-key/number. Dates use YYYY-MM-DD. Continue empty pages until nextCursor is null.',
  ),
  read_task: read(
    reads.readTask,
    'Read one task and its project workflow, without unbounded discussion. Use list_comments and search_tasks(parentIssueId) for related pages.',
  ),
  list_comments: read(
    reads.listComments,
    'Read all task comments through cursor pagination.',
  ),
  list_task_lists: read(
    reads.listLists,
    'Read project task lists through cursor pagination.',
  ),
  list_activity: read(
    reads.listActivity,
    'Read project or task activity through cursor pagination.',
  ),
  list_notes: read(
    reads.listNotes,
    'Read/search only the token owner’s private notes, with pagination.',
    'notes',
  ),
  get_note: read(
    reads.getNote,
    'Read one private note owned by the token owner.',
    'notes',
  ),
  list_notifications: read(
    reads.listNotifications,
    'Read the owner’s inbox with complete pagination and optional unread filter.',
    'inbox',
  ),
  dashboard: read(
    dashboard.overviewDefinition,
    'Read the same bounded dashboard preview and statistics as the app. Use search_tasks for complete inventory.',
  ),
  my_work: read(
    myWork.overviewDefinition,
    'Read personal work summary and preview sections. Use search_tasks(onlyMine) for complete inventory.',
  ),
}
export const writeOperations: Record<string, Operation<MutationCtx>> = {
  seed_demo_data: write(
    dev.seedDemoDataDefinition,
    'Initialize the existing demo project/tasks only in an empty workspace. Requires explicit user authorization; never use for connection tests.',
    [],
    true,
  ),
  create_project: write(
    { ...projects.createDefinition, args: createProjectArgs },
    'Create a project with standard defaults; no invitation or deletion-policy controls.',
  ),
  update_project: write(
    { ...projects.updateDefinition, args: updateProjectArgs },
    'Update project metadata, statuses, labels and custom field definitions. Replacement arrays can remove values from tasks. Requires explicit confirmation and project revision.',
    ['projectId'],
    true,
  ),
  delete_project_status: write(
    projects.deleteStatusDefinition,
    'Delete a custom workflow status and transfer its tasks to another existing status.',
    ['projectId'],
    true,
  ),
  archive_project: write(
    projects.archiveDefinition,
    'Archive or unarchive a project.',
    ['projectId'],
    true,
  ),
  create_task: write(
    issues.createDefinition,
    'Create a task/subtask with description, status, priority, assignee, dates, labels and custom fields. Assignment triggers the normal notification. Unspecified assignee stays empty.',
  ),
  update_task: write(
    issues.updateDefinition,
    'Edit task fields, rich description, checklist, custom values, parent/list, status, priority, dates or assignee; null clears nullable fields. Assignment may notify. Cascade completion requires explicit confirmation.',
    ['issueId'],
  ),
  bulk_update_tasks: write(
    issues.bulkUpdateDefinition,
    'Update an explicitly enumerated set of up to 100 tasks. Supply every selected task revision. No implicit search-to-write.',
    ['issueIds'],
    true,
  ),
  delete_task: write(
    issues.removeDefinition,
    'Soft-delete a task and descendants, including hidden/archived children. Requires confirmation and task/project revisions.',
    ['issueId'],
    true,
  ),
  bulk_delete_tasks: write(
    issues.bulkRemoveDefinition,
    'Explicitly requested bulk soft-delete only: enumerated IDs, revisions and confirmation. Cascades to descendants. Never use automatically.',
    ['issueIds', 'projectId'],
    true,
  ),
  create_task_list: write(
    lists.createDefinition,
    'Create a task list in an accessible project.',
  ),
  update_task_list: write(
    lists.updateDefinition,
    'Rename or reorder a task list.',
    ['issueListId'],
  ),
  delete_task_list: write(
    lists.removeDefinition,
    'Delete a task list, explicitly moving its tasks or deleting their trees. Deletion policy is enforced.',
    ['issueListId'],
    true,
  ),
  add_comment: write(
    comments.createDefinition,
    'Add a normal task comment without changing status or claiming the task.',
  ),
  edit_comment: write(
    comments.updateDefinition,
    'Edit a comment subject to the normal author/admin restrictions.',
    ['commentId'],
  ),
  create_note: write(
    notes.createDefinition,
    'Create a private note for the token owner.',
    [],
    false,
    'notes',
  ),
  update_note: write(
    notes.updateDefinition,
    'Edit or pin an owned private note.',
    ['noteId'],
    false,
    'notes',
  ),
  delete_note: write(
    notes.removeDefinition,
    'Permanently delete an owned private note. Requires explicit confirmation.',
    ['noteId'],
    true,
    'notes',
  ),
  mark_notification_read: write(
    notifications.markReadDefinition,
    'Mark one owned inbox notification read.',
    [],
    false,
    'inbox',
  ),
  mark_all_notifications_read: write(
    notifications.markAllReadDefinition,
    'Mark the owner’s inbox read. Requires confirmation; restricted tokens only affect allowed projects.',
    [],
    true,
    'inbox',
  ),
  update_my_work_preferences: write(
    users.updateMyWorkPreferencesDefinition,
    'Update only the token owner’s default/last My Work view. No account or permission changes.',
  ),
}
export function requestValidator<C>(operations: Record<string, Operation<C>>) {
  const variants = Object.entries(operations).map(([operation, def]) =>
    v.object({ operation: v.literal(operation), input: v.object(def.args) }),
  )
  return v.union(...variants)
}
