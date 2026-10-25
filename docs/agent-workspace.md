# Tasker agent workspace interface

The local stdio MCP adapter exposes 41 tools: the original six queue/claim tools,
14 workspace reads and 21 workspace writes. The new backend entry points are
`agentWorkspace:read` and `agentWorkspace:write`. There is no hosted MCP transport.

## Coverage

| App capability | MCP tools / behavior |
| --- | --- |
| Identity and project discovery | `whoami`, `list_projects`, `get_project` |
| Assignee lookup | `list_assignees` in an accessible project; read-only eligible users |
| Projects | `create_project`, `update_project`, `archive_project` (also unarchives) |
| Workflow, labels, custom field definitions | `get_project`, `update_project`; `delete_project_status` transfers tasks using existing rules |
| Task inventory, search and export | `search_tasks`, `read_task`; all statuses/assignees and claims included by default; archive opt-in |
| Task creation/import | `create_task` per explicitly selected import row; stable request IDs prevent duplicate rows; create parents before children |
| Task fields | `update_task`: title, plain/rich description, status, priority, assignee, start/due dates, labels, custom values, archive |
| Hierarchy and lists | `parentIssueId` / `listId` on task mutations; one-level hierarchy and inheritance rules retained |
| Checklists | `checklistItems` on create/update; stable item IDs, text, completed flag and position |
| Bulk task changes | `bulk_update_tasks` for enumerated IDs; no implicit search-to-write |
| Task deletion | `delete_task`, `bulk_delete_tasks`; normal soft deletion, descendant cascade and project delete policy |
| Project task lists | `list_task_lists`, `create_task_list`, `update_task_list`, `delete_task_list` with explicit move/delete mode |
| Comments | `list_comments`, `add_comment`, `edit_comment`; author/admin edit rules retained |
| Activity | `list_activity`; mutation timeline includes agent token ID and request ID, never the secret |
| Private notes | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`; token owner's notes only |
| Inbox | `list_notifications`, `mark_notification_read`, `mark_all_notifications_read`; own inbox only |
| Dashboard and My Work | `dashboard`, `my_work`, `update_my_work_preferences`; summaries remain previews, use paginated search for complete data |
| Agent execution | `list_tasks`, `list_done_tasks`, `get_task`, `claim_task`, `submit_task_for_review`, `release_task` |
| Empty-workspace demo initializer | `seed_demo_data`, explicit confirmation and writer role; never a connection-test operation |

Not exposed: user creation/deletion, role/account changes, invitations, membership
changes, credential/token management, or project access/deletion-policy switches.
Creating a project retains the normal automatic membership for its creator.

Not implemented in the app, so no invented endpoints: native attachments/file
storage, arbitrary task dependency links, comment deletion, project hard deletion,
or deleted-task restoration. Calendar/Gantt/board/sheet layouts are views of the
same task data; date/list/status mutations operate them. JSON/Excel serialization
and file import are client-side conversions: agents can export paginated JSON or
convert local files and call the guarded task operations. Theme/sidebar controls
remain client UI settings, not shared workspace API operations.

## Inputs and reads

New tools accept an `input` object. Schemas are derived from the same native
Convex validators used by the backend, with unknown fields rejected. For example:

```json
{"input":{"projectId":"PROJECT_ID","search":"LockoutEnabled","limit":50}}
```

Every list returns `{items,nextCursor}`. Continue until `nextCursor` is null, even
on empty pages; retain the same operation and filters. Search scans bounded pages
(100 candidates / 1 MiB issue data), so a filtered page can be short. Inventory is
not a frozen multi-page snapshot: deduplicate by stable `_id` if concurrent edits
occur and re-read each target before writing. Search includes completed/review
work and all assignees by default. `includeArchived` also includes archived projects.
Deleted tasks remain excluded. Old `list_tasks` retains its work-queue defaults.

Records include stable IDs and revision hashes; tasks/projects include relative
paths and URLs when backend `APP_BASE_URL` is configured. `read_task` avoids an
unbounded comment/child read: use `list_comments` and `search_tasks` with
`parentIssueId`. Dashboard/My Work and the legacy `get_task` retain existing app
summary/context limits; they are not substitutes for complete pagination.

## Writes, retries and concurrency

Every new write requires `requestId` (1–200 characters). Generate one ID per intended
operation and reuse the *exact* input, confirmation and revisions on transport retry.
The backend stores a receipt with the result in the mutation transaction. Identical
replays return `{result,replayed:true,requestId}`; reusing the ID with different
arguments returns `CONFLICT`. Receipts are retained without automatic expiration,
including their result, to prevent late retries duplicating work. They are private
implementation/audit records, not a public query surface.

Updates/deletes require `expectedRevision`, keyed by the IDs returned from reads.
These are hashes of stored records, so even changes within one timestamp tick
are detected. Tree/list moves and destructive operations additionally require the
project revision. Re-read on `CONFLICT`; never silently overwrite a newer edit.

```json
{
  "input":{"issueId":"ISSUE_ID","title":"Updated title"},
  "requestId":"unique-operation-id",
  "expectedRevision":{"ISSUE_ID":"REVISION_FROM_READ"}
}
```

Destructive tools require `confirmation` equal to the exact tool name, plus
appropriate revisions and the `delete` scope. Confirmation is an explicit caller
attestation of user authorization, not a substitute for obtaining it. This includes
project-definition replacements (removing labels/fields can remove task values),
bulk operations, deletion and archive operations. `cascadeDescendantsToDone:true`
also requires confirmation. Bulk deletion must enumerate selected IDs; the server
never turns a search into an automatic delete.

New mutations invoke the same handlers as the UI. Shared authorization, hierarchy,
workflow rules, assignment notifications and activity records remain active.
Assignment can send the existing notification/email; leaving assignee absent on
create sends no assignment notification. Private note deletion is permanent;
task deletion is the app's normal soft deletion, which has no restore UI yet.

Errors include `{code,message,retryable}`. Transport errors are sanitized; don't
log credentials, request bodies or raw error responses. Success provides MCP
`structuredContent.data` and JSON text for compatibility.

## Authentication and scope

`TASKER_CONVEX_URL` and `TASKER_API_TOKEN` are process environment variables; the
entrypoint does not automatically load `.env.local`. Never use a self-hosted admin
key or a deployment key for agent interaction. The personal token is sent only to
the configured Convex endpoint in function arguments over HTTPS.

Every call rechecks token expiry/revocation, active owner and project access.
Optional token `scopes`: `read`, `write`, `delete`, `notes`, `inbox`. Workspace reads
require `read`; writes require `write`; private notes/inbox additionally require
`notes`/`inbox`; destructive operations require `delete`. Optional `projectIds`
restrict project operations and project-related inbox rows, including for admins.
They do not grant access or scope private notes to a project. Project-restricted
tokens cannot create/seed projects. The existing Clerk-authenticated token creation
API accepts these optional restrictions; no token management tool is exposed.
Existing tokens without restrictions retain access subject to their owner's role.
No token is changed or upgraded automatically by these source changes.

The original claim tools also enforce configured read/write/project scopes.
Claims renew leases and are intentionally not exactly-once operations. Existing
claim/review workflow semantics remain distinct from ordinary task editing.

## Activation and validation

1. Review/test the source changes locally.
2. Obtain deployment approval, then deploy the new schema/functions and adapter.
   Code changes alone do not publish `agentWorkspace` endpoints.
3. Separately configure the chosen local MCP client with the real repository path
   and approved personal token. Do not commit secrets or install persistent access
   without permission. Local stdio requires a client that can launch the process
   on that machine; a cloud-only client needs a separately designed remote transport.
4. Smoke-test initialize/list-tools and a bounded read only. Never create/delete
   a production test task to prove connectivity.

Tests use synthetic records and in-memory MCP transport. Stdio launch tests only
initialize and discover tools with dummy credentials; they do not query production.
Real Convex transaction contention, deployment and hosted transport are not covered
by these local mocks.
