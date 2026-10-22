# Tasker

Tasker is a production-minded project and task management system for focused execution.

## Built With Codex 🤫

This project was built end-to-end by **GPT-5.3-Codex**, covering architecture, backend modeling, authorization, frontend implementation, and iterative product refinement.

## Product Overview

- Project-based workspaces with scoped membership and permissions.
- Four task views: structured list, drag-and-drop Kanban by status, a month/week calendar with compact overflow, and a Gantt timeline with a resizable task grid, day/week/month scales, Today/Fit controls, and status/progress bars. Both scheduling views support start/due dates, inclusive ranges, drag-to-reschedule, and resizing from either edge, including single-date tasks.
- Fast task operations: status, priority, assignee, start date, due date, labels, and search/filtering.
- Parent tasks with one-level sub-task support, progress rollups, and nested list/Kanban presentation.
- Unified task timeline combining comments and system activity in chronological order.
- In-app inbox plus assignment email notifications.
- Admin controls for user role management and account activation state.

## Key Capabilities

- Real-time synced data layer for projects, tasks, comments, members, and activity.
- Role-based access with strict server-side authorization checks.
- Project-specific task numbering and soft-delete behavior.
- Member management with invite, revoke, and add-existing-user flows.
- Persistent project view preferences and filters in URL state.
- Async notification email delivery through Convex actions and SMTP env config.

## Roles and Access Model

- `admin`
- Full system access across all projects and users.

- `member`
- Write access to projects they created or were added to.

- `viewer`
- Read-only access to projects they were added to.

All read/write enforcement happens on the server in Convex permission helpers.

## Data Model

Core tables in `/convex/schema.ts`:

- `users`
- `projects`
- `projectMembers`
- `projectInvites`
- `projectCounters`
- `issues`
- `comments`
- `activities`

## Architecture Notes

- Auth is Clerk-based, with Convex identity mapped to internal `users` records.
- User bootstrap/sync is handled through `users.ensureCurrentUser`.
- Invite acceptance is auto-processed when a signed-in user email matches pending invites.
- Project activity and task activity are recorded for audit-friendly history.

## Repository Structure

- `/src/routes` - all route screens and page-level logic.
- `/src/features/tasker` - domain UI, auth guards, and shared feature modules.
- `/src/components/ui` - shared design system primitives and dialogs.
- `/convex` - schema, queries, mutations, actions, and auth/permission helpers.

## Scripts

```bash
pnpm dev
pnpm build
pnpm check
pnpm test
```

## License

This project is licensed under the Unlicense. See `/LICENSE`.

## Agents and MCP

Tasker includes a local stdio MCP server. Your agent can discover tasks assigned to you, other users, or nobody, read their context, claim work, and submit its finished result for human review. The agent performs the actual work with its own tools; Tasker manages the queue, claims, and review handoff.

1. Deploy the updated Convex schema/functions and app through your normal deployment workflow. For an already configured development deployment, use `pnpm exec convex dev --once`.
2. Open **Settings → Agent connection**, create a named personal token, and copy it while it is visible. Tokens expire after the selected period and can be revoked there.
3. Install this repository locally using Node 25.x and pnpm 11.x, then add the following to your MCP client's configuration. Replace the checkout path, Convex deployment URL, and token. On Windows, use a path such as `D:/projects/tasker`.

```json
{
  "mcpServers": {
    "tasker": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/tasker", "exec", "tsx", "mcp/index.ts"],
      "env": {
        "TASKER_CONVEX_URL": "https://your-deployment.convex.cloud",
        "TASKER_API_TOKEN": "YOUR_AGENT_TOKEN"
      }
    }
  }
}
```

Use the `.convex.cloud` deployment URL, not the `.convex.site` HTTP-action URL. `TASKER_API_TOKEN` belongs in the MCP client's environment; never prefix it with `VITE_`. Settings provides this configuration with the backend URL and newly created token filled in.

The server exposes six tools:

| Tool | Purpose |
| --- | --- |
| `list_tasks` | Filter by `assignment`: `mine` (default), `others`, `unassigned`, `assignee` (requires `assigneeId`), or `all`; optionally filter `projectId` and `statuses`. Pages contain up to 100 tasks; pass `nextCursor` as `cursor` for the next page. |
| `list_done_tasks` | Fetch completed tasks with the same assignment/project filters and pagination as `list_tasks`. Defaults to your completed tasks. Archived/deleted tasks and archived projects remain excluded. |
| `get_task` | Read the description, rich content, checklist, comments, parent/subtasks, assignee, and project workflow. |
| `claim_task` | Pass `issueId` and a unique `runId` to claim work and move it to `in_progress`. Repeat with the same token/run ID before the one-hour lease expires to renew it. |
| `submit_task_for_review` | Pass `issueId`, the claiming `runId`, and a nonempty `summary` containing results, verification, and artifact links. Atomically adds a comment, moves to `in_review`, and releases the claim. |
| `release_task` | Abandon a claim and restore the previous status if a person has not changed the status. |

By default, discovery excludes archived/deleted/completed tasks, archived projects, tasks already in `in_review`, and live claims. Set `includeClaimed: true` to inspect claimed tasks. For custom workflows, filter `statuses` explicitly and pass existing `workStatus` / `reviewStatus` keys to the corresponding tools. Missing workflow keys fail without modifying the task; `todo` and `done` cannot be work/review targets.

Both list tools use database pagination with bounded reads (up to 100 candidate rows and a 1 MiB issue-read budget per call). Filtering and access checks can produce short or empty pages. Continue passing `nextCursor` as `cursor` until it is `null`; an empty `tasks` array does not mean discovery is finished. Keep the same tool and filters for each continuation. Cursors are opaque database cursors, not task IDs; restart any pagination started before this update. `list_done_tasks` maps to the Convex query `agentTasks.listDone` and does not make completed tasks claimable. Deploy the updated schema, including the `issues.by_status` index, before using the new endpoint.

Claims preserve the human assignee. All calls check the token owner's current account state, role, and project access. Viewers can read but cannot claim or submit. Competing live claims fail atomically. If a claim expires, reacquire it before submitting; if a response is lost, inspect `get_task` before retrying. Status changes and result comments appear in the existing task timeline.

Manual status changes invalidate a live claim even if the task later returns to its work status. Renewal and submission then fail; release the claim, read the task again, and acquire a new claim. Release preserves the latest task status after an intervening change. Title edits and unchanged status updates keep the claim usable.

Example agent request:

> Find one unassigned task in my project using Tasker. Read its details, claim it with a unique run ID, implement the work, and verify the result. Renew the claim if needed. Submit a summary with the verification results and relevant links for review. If blocked, release the task and explain the blocker.

For a direct launch, set `TASKER_CONVEX_URL` and `TASKER_API_TOKEN` in the process environment and run `pnpm mcp`. Run `pnpm mcp:check` to type-check the adapter. Implementation references: [MCP SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server) and [Convex runtime APIs](https://docs.convex.dev/functions/runtimes).

## GitHub branch workflow

Project owners/admins can connect a GitHub repository and map work/review statuses. Issue writers can create or link a branch from the issue page; PR draft, review, close, and merge events update task status. Manual status edits pause automation, and merging respects unfinished-subtask rules.

This requires a deployment-owned GitHub App and server credentials. See [GitHub integration setup and lifecycle](docs/github-integration.md) for configuration, permissions, recovery, and current limits.

## Local Setup (Required)

Use Node.js `25.x` and pnpm `11.x`. Deployment uses `nixpacks.toml` with pnpm 11 and a frozen lockfile.

1. Install dependencies.

```bash
pnpm install
```

2. Configure client env vars in `.env.local`.

```bash
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=...
VITE_CLERK_PUBLISHABLE_KEY=...
VITE_CONVEX_SITE_URL=...
VITE_CLERK_JWT_TEMPLATE=convex
```

3. Configure Clerk authentication prerequisites.

- Create a Clerk JWT template named `convex` (used by Convex auth).
- Enable email sign-in in Clerk, because project invite delivery and acceptance rely on email identity.

4. Configure Convex server env vars (required for invite actions and SMTP notifications).

```bash
pnpm dlx convex env set CLERK_SECRET_KEY sk_...
pnpm dlx convex env set APP_BASE_URL https://tasker.yourcompany.com
pnpm dlx convex env set SMTP_HOST smtp.sendgrid.net
pnpm dlx convex env set SMTP_PORT 587
pnpm dlx convex env set SMTP_SECURE false
pnpm dlx convex env set SMTP_USER apikey
pnpm dlx convex env set SMTP_PASS your-sendgrid-smtp-password
pnpm dlx convex env set SMTP_FROM_EMAIL tasker@yourcompany.com
pnpm dlx convex env set SMTP_FROM_NAME Tasker
```

Notes:

- `APP_BASE_URL` must be the public app origin used in email links and invite redirects, for example `https://tasker.yourcompany.com`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS` are server-side SMTP transport settings for assignment notification emails.
- `SMTP_USER` is typically `apikey` for SendGrid SMTP.
- `SMTP_PASS` should be your SendGrid SMTP password / API key value.
- `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` control the visible sender on assignment emails.
- These values stay in Convex server env only. Do not put them in `.env.local`.

Optional:

```bash
pnpm dlx convex env set CLERK_API_URL https://api.clerk.com/v1
```

5. Verify Convex auth provider values for your Clerk instance in `/convex/auth.config.ts`.

- `domain` and `issuer` must match your Clerk account domain.
- `applicationID` should match the JWT template/application id (`convex` in this setup).
- SMTP notification delivery is configured only through Convex server env vars; no SMTP settings are exposed in the app UI.

6. Start development services.

```bash
pnpm dlx convex dev
pnpm dev
```

7. Open `http://localhost:3000`, sign in, and optionally seed demo data from `/settings`.
