# Tasker

Production-ready task management workspace focused on clear ownership,
fast planning, and reliable execution.

## What is implemented

### Core product

- Authenticated app shell with sidebar/top bar, command bar (`Ctrl/Cmd + K`), user menu, theme toggle.
- Dashboard with:
  - quick stats
  - recent projects
  - assigned issues
  - created-by-me issues
  - overdue issues
  - recent activity
- Projects:
  - create project
  - edit project settings
  - archive/unarchive project
  - list accessible projects
  - project detail page with filters, issues, members, and activity
  - member add/remove workflow
  - email invite workflow via Clerk (send/revoke/pending list)
- Issues:
  - create/update issue
  - soft delete issue
  - project-scoped issue numbers
  - status/priority/assignee updates
  - filters and search
- Comments:
  - add comments
  - edit own comments (admins can edit any)
- Activity timeline:
  - project and issue activity feeds
- Admin area:
  - user listing
  - search/filter users
  - update global role
  - activate/deactivate user
  - inspect project memberships
- Settings page:
  - current profile summary
  - local dev seed utility

## Role model

Global roles (stored on `users.globalRole`):

- `admin`
  - full access to all projects and data
  - can manage users/roles/account state
  - can manage any project/member/issue/comment
- `member`
  - write access only to projects they created or are members of
  - can create/update issues and comments in accessible projects
  - can manage members if project allows `allowMemberInvites`
- `viewer`
  - read-only access to projects they created or are members of
  - cannot create/edit/delete issues/projects/comments

## Access control design

All authorization is enforced server-side in Convex helpers:

- `requireAuth`
- `requireCurrentUser`
- `requireAdmin`
- `requireProjectViewAccess`
- `requireProjectWriteAccess`
- `requireProjectMemberManagementAccess`
- `requireProjectIssueDeleteAccess`
- `requireIssueViewAccess`
- `requireIssueWriteAccess`

These are used in queries/mutations across users/projects/issues/comments/dashboard.

## Convex data model

Defined in [`convex/schema.ts`](./convex/schema.ts):

- `users`
- `projects`
- `projectMembers`
- `projectCounters`
- `projectInvites`
- `issues`
- `comments`
- `activities`

Indexes and search index are included for role checks, project scoping, assignee/reporter lookups, and issue text search.

## Frontend structure

- `src/features/tasker/auth` - auth guard + Clerk→Convex user bootstrap
- `src/features/tasker/layout` - app shell and command bar
- `src/features/tasker/components` - reusable task UI components
- `src/features/tasker/model.ts` - shared role/status/priority enums and labels
- `src/features/tasker/validation.ts` - zod schemas for forms
- `src/routes` - route pages:
  - `/`
  - `/sign-in`, `/sign-up`
  - `/_app` layout with protected pages:
    - `/dashboard`
    - `/projects`
    - `/projects/$projectId`
    - `/issues/$issueId`
    - `/admin/users`
    - `/settings`
  - `/unauthorized`

## Local setup

1. Install deps:

```bash
pnpm install
```

2. Configure environment (`.env.local`):

```bash
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=...
VITE_CLERK_PUBLISHABLE_KEY=...
VITE_CONVEX_SITE_URL=...
VITE_CLERK_JWT_TEMPLATE=convex
```

3. Set required Convex server env vars:

```bash
pnpm dlx convex env set CLERK_SECRET_KEY sk_test_...
pnpm dlx convex env set APP_BASE_URL http://localhost:3000
```

4. Ensure Convex + Clerk auth integration is configured for your deployment (JWT template for Convex in Clerk).

5. Run Convex and app:

```bash
pnpm dlx convex dev
pnpm dev
```

6. Optional (seed sample data after signing in):
- Open `/settings`
- Click **Seed demo data**

## Scripts

```bash
pnpm dev
pnpm build
pnpm check
pnpm test
```

## Notes

- Internal user records are created/synced via `users.ensureCurrentUser` during sign-in bootstrap.
- Pending email invites are auto-claimed on login when invite email matches user email.
- First signed-in user becomes `admin`; subsequent users default to `member`.
- Issues are soft-deleted via `deletedAt`/`archived`.
- Viewer role is strictly read-only by server checks.
