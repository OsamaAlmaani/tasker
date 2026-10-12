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

Tasker serves a remote MCP endpoint at `/mcp` as part of the deployed app. Agents connect over Streamable HTTP without installing Tasker, Node, pnpm, or any CLI on their devices. Your agent can discover tasks assigned to you, other users, or nobody, read their context, claim work, and submit its finished result for human review. The agent performs the actual work with its own tools; Tasker manages the queue, claims, and review handoff.

1. Deploy the updated Convex schema/functions **before** the web app, including the `agentTokens.authenticate` query. The existing `pnpm build` / `pnpm start` deployment includes `/mcp`; no separate MCP service is needed. Serve the app through HTTPS. For an already configured development backend, use `pnpm exec convex dev --once`.
2. Open **Settings → Agent connection**, create a named personal token, and copy it while it is visible. Tokens expire after the selected period and can be revoked there.
3. Add the configuration from Settings to your agent's remote MCP settings. Replace the example app URL and token below. The client must support Streamable HTTP and a custom Authorization header; exact configuration syntax varies by client.

```json
{
  "mcpServers": {
    "tasker": {
      "url": "https://your-tasker-app.example/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AGENT_TOKEN"
      }
    }
  }
}
```

Settings fills in the current app's `/mcp` URL and newly created token. The client connects to the **Tasker app**, not directly to the Convex deployment. The server resolves its backend URL from `TASKER_CONVEX_URL`, runtime `VITE_CONVEX_URL`, or the existing build-time `VITE_CONVEX_URL`, in that order. This must be the Convex API/deployment URL, not its HTTP-action URL. Never put an agent token in a URL or a `VITE_` environment variable, and do not configure one shared server token.

Every request, including initialization and tool discovery, validates the caller's personal token against Convex. Requests use independent MCP instances, no persistent HTTP session, and JSON responses. GET/DELETE return 405; OPTIONS supports browser preflight. Responses are not cached. Missing/invalid/expired/revoked credentials return 401, inactive owners return 403, and unavailable authentication returns a sanitized 503. A newly revoked token fails on the next request. Tool calls additionally recheck existing backend permissions and task state.

Browser requests accept the app origin by default. For trusted browser-based agents on other origins, set the optional server variable `TASKER_MCP_ALLOWED_ORIGINS` to a comma-separated list of exact origins, such as `https://agent.example,https://another-agent.example`. Native/server-side clients normally omit Origin and need no CORS configuration. Your reverse proxy must preserve Authorization, request bodies, and MCP protocol headers. Clients that only support OAuth sign-in cannot use this personal-token endpoint; OAuth authorization/discovery is not implemented.

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

Example agent request:

> Find one unassigned task in my project using Tasker. Read its details, claim it with a unique run ID, implement the work, and verify the result. Renew the claim if needed. Submit a summary with the verification results and relevant links for review. If blocked, release the task and explain the blocker.

Local stdio remains available for existing integrations: install the repository, set `TASKER_CONVEX_URL` and `TASKER_API_TOKEN` in the process environment, and run `pnpm mcp`. Hosted clients do not need this setup. Run `pnpm mcp:check` to type-check the adapters. After building with the app's usual public Vite environment, run `pnpm mcp:smoke` to test the actual production app over HTTP against a disposable backend fixture (no live task data). Implementation references: [MCP SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server) and [Convex runtime APIs](https://docs.convex.dev/functions/runtimes).

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
