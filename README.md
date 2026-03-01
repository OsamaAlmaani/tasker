# Tasker

Tasker is a production-minded project and issue management system for focused execution.

## Product Overview

- Project-based workspaces with scoped membership and permissions.
- Dual issue views: structured list view and drag-and-drop Kanban by status.
- Fast issue operations: status, priority, assignee, due date, labels, and search/filtering.
- Unified issue timeline combining comments and system activity in chronological order.
- Admin controls for user role management and account activation state.

## Key Capabilities

- Real-time synced data layer for projects, issues, comments, members, and activity.
- Role-based access with strict server-side authorization checks.
- Project-specific issue numbering and soft-delete behavior.
- Member management with invite, revoke, and add-existing-user flows.
- Persistent project view preferences and filters in URL state.

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
- Project activity and issue activity are recorded for audit-friendly history.

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

4. Configure Convex server env vars (required for invite actions).

```bash
pnpm dlx convex env set CLERK_SECRET_KEY sk_...
pnpm dlx convex env set APP_BASE_URL http://localhost:3000
```

Optional:

```bash
pnpm dlx convex env set CLERK_API_URL https://api.clerk.com/v1
```

5. Verify Convex auth provider values for your Clerk instance in `/convex/auth.config.ts`.

- `domain` and `issuer` must match your Clerk account domain.
- `applicationID` should match the JWT template/application id (`convex` in this setup).

6. Start development services.

```bash
pnpm dlx convex dev
pnpm dev
```

7. Open `http://localhost:3000`, sign in, and optionally seed demo data from `/settings`.
