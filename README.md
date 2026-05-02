# Tasker

Tasker is a production-minded project and task management system for focused execution.

## Built With Codex 🤫

This project was built end-to-end by **GPT-5.3-Codex**, covering architecture, backend modeling, authorization, frontend implementation, and iterative product refinement.

## Product Overview

- Project-based workspaces with scoped membership and permissions.
- Dual task views: structured list view and drag-and-drop Kanban by status.
- Fast task operations: status, priority, assignee, due date, labels, and search/filtering.
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

## Local Setup (Required)

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
