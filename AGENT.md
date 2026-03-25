# AGENT.md

## What This Project Is

Tasker is a production-minded project and task management app built with:

- TanStack Start + TanStack Router for the React app shell and file-based routes.
- Convex for the backend, database, auth-aware queries/mutations, and generated API types.
- Clerk for authentication.
- Tailwind CSS v4 + custom CSS variables/themes for styling.

It supports:

- Multi-project workspaces.
- Global roles: `admin`, `member`, `viewer`.
- Project membership and email invites.
- Task lists plus task status-based Kanban.
- One-level sub-tasks with progress rollups.
- Comments and activity history.
- Project archive state and issue soft-delete behavior.

## Working Rule For Future Agents

If you are implementing work from [`ROADMAP.md`](./ROADMAP.md), keep both [`AGENT.md`](./AGENT.md) and [`ROADMAP.md`](./ROADMAP.md) up to date as part of the task.

Expectations:

- Update `ROADMAP.md` when tasks start, change shape, or finish.
- Update `AGENT.md` when code structure, workflows, commands, invariants, ownership, or project conventions change.
- Do not leave roadmap progress or repo context stale after completing a task.
- Treat documentation updates as part of finishing the work, not as optional follow-up.

## Runtime / Tooling

- Package manager: `pnpm`
- Target Node: `22.x` from [`package.json`](./package.json)
- TS/path aliases from [`tsconfig.json`](./tsconfig.json):
  - `#/*` -> `src/*`
  - `#convex/*` -> `convex/*`
  - `@/*` -> `src/*`
- Current scripts:
  - `pnpm dev` -> Vite dev server on port `3000`
  - `pnpm build` -> production build
  - `pnpm start` -> runs `.output/server/index.mjs`
  - `pnpm check` -> `biome check`
  - `pnpm test` -> `vitest run`
- Build stack uses Vite + TanStack Start + Nitro via [`vite.config.ts`](./vite.config.ts).
- Tests use a dedicated [`vitest.config.ts`](./vitest.config.ts) with `vite-tsconfig-paths` and a `node` environment so pure-module tests do not inherit the full app plugin stack.
- Verified during scan:
  - `pnpm check` passes.
  - `pnpm test` passes.

## Required Env / Services

From code and README, local dev expects:

- Client env in `.env.local`:
  - `VITE_CONVEX_URL`
  - `VITE_CLERK_PUBLISHABLE_KEY`
  - `VITE_CLERK_JWT_TEMPLATE=convex` or compatible
  - README also references `CONVEX_DEPLOYMENT` and `VITE_CONVEX_SITE_URL`
- Convex server env:
  - `CLERK_SECRET_KEY`
  - `APP_BASE_URL`
  - optional `CLERK_API_URL`

Important auth wiring:

- Clerk publishable key is required in [`src/integrations/clerk/provider.tsx`](./src/integrations/clerk/provider.tsx).
- Convex client reads `VITE_CONVEX_URL` in [`src/integrations/convex/provider.tsx`](./src/integrations/convex/provider.tsx).
- Convex auth config is in [`convex/auth.config.ts`](./convex/auth.config.ts).
- Protected UI routes assume a Clerk JWT template named `convex`.

## High-Level Architecture

### Frontend

- Root document and providers live in [`src/routes/__root.tsx`](./src/routes/__root.tsx).
- Protected app layout is [`src/routes/_app.tsx`](./src/routes/_app.tsx), which wraps children in:
  - `RequireAuth`
  - `AppShell`
- Router setup is in [`src/router.tsx`](./src/router.tsx).
- File-based routes are generated into [`src/routeTree.gen.ts`](./src/routeTree.gen.ts).

Main route files:

- [`src/routes/index.tsx`](./src/routes/index.tsx): public landing page
- [`src/routes/_app.dashboard.tsx`](./src/routes/_app.dashboard.tsx): dashboard summary
- [`src/routes/_app.projects.index.tsx`](./src/routes/_app.projects.index.tsx): project list + project creation
- [`src/routes/_app.projects.$projectId.tsx`](./src/routes/_app.projects.$projectId.tsx): project detail, task list/kanban, filters, members, invites, import/export, project settings
- [`src/routes/_app.issues.$issueId.tsx`](./src/routes/_app.issues.$issueId.tsx): issue detail, sub-tasks, comments, activity
- [`src/routes/_app.admin.users.tsx`](./src/routes/_app.admin.users.tsx): admin-only user management
- [`src/routes/_app.settings.tsx`](./src/routes/_app.settings.tsx): profile + demo seed action

### Backend

Convex is the source of truth for auth, permissions, data validation, and persistence.

Key backend files:

- [`convex/schema.ts`](./convex/schema.ts): tables and indexes
- [`convex/lib/auth.ts`](./convex/lib/auth.ts): permission helpers
- [`convex/lib/activity.ts`](./convex/lib/activity.ts): activity insertion helper
- [`convex/users.ts`](./convex/users.ts): user sync/bootstrap and admin controls
- [`convex/projects.ts`](./convex/projects.ts): project CRUD, members, sidebar, activity
- [`convex/issues.ts`](./convex/issues.ts): task CRUD, filtering, hierarchy, status rules
- [`convex/issueLists.ts`](./convex/issueLists.ts): per-project task lists
- [`convex/comments.ts`](./convex/comments.ts): comments
- [`convex/invitations.ts`](./convex/invitations.ts): invite state machine in Convex
- [`convex/invitationsActions.ts`](./convex/invitationsActions.ts): Clerk API side effects
- [`convex/dashboard.ts`](./convex/dashboard.ts): dashboard aggregation
- [`convex/dev.ts`](./convex/dev.ts): demo seed helper

## Data Model

Core tables in [`convex/schema.ts`](./convex/schema.ts):

- `users`
- `projects`
- `projectMembers`
- `projectCounters`
- `issueLists`
- `issues`
- `comments`
- `projectInvites`
- `activities`

Notable schema choices:

- `issues.deletedAt` is used for soft delete.
- `issues.archived` exists separately from `deletedAt`.
- Task search is backed by `issues.searchText` plus Convex `searchIndex`, though current query logic mainly filters in memory.
- Project issue numbering is per project via `projectCounters.nextIssueNumber`.

## Auth / Permission Model

Global roles are defined in both:

- [`convex/constants.ts`](./convex/constants.ts)
- [`src/features/tasker/model.ts`](./src/features/tasker/model.ts)

Rules enforced server-side in [`convex/lib/auth.ts`](./convex/lib/auth.ts):

- `admin`
  - full access to all projects and users
- `member`
  - write access to projects they created or joined
- `viewer`
  - read-only access to joined/created projects

Important details:

- First created user becomes `admin`; later users default to `member`.
- `users.ensureCurrentUser` syncs Clerk identity into the internal `users` table.
- Inactive users are blocked in `requireCurrentUser`.
- Pending invites are auto-claimed on sign-in if the user email matches a pending invite.

## Important Domain Rules

These are easy to miss and should be preserved unless intentionally changed.

### Task hierarchy

- Only top-level issues can have sub-issues.
- An issue that already has visible children cannot be converted into a child issue.
- Cycles are explicitly rejected.
- Effective result: one-level sub-task hierarchy is enforced.

Relevant code:

- [`convex/issues.ts`](./convex/issues.ts)

### Task completion / reopening rules

- Marking a parent issue as `done` with unfinished descendants requires confirmation.
- Backend supports `cascadeDescendantsToDone` to mark descendants done in one mutation.
- A child issue cannot be moved out of `done` while an ancestor is still `done`.
- Both project and issue detail pages mirror this behavior in UI state before calling the backend.

### Deletion behavior

- Deleting an issue is a soft delete:
  - sets `deletedAt`
  - sets `archived: true`
  - cascades through descendants
- Project issue deletion can be disabled per project with `allowIssueDelete`.
- Deleting an issue list supports:
  - moving tasks to another list or no list
  - deleting all task trees rooted in that list

### Project creation defaults

Creating a project also creates:

- a `projectCounters` row
- a default `General` issue list
- a `projectMembers` row for the creator
- a `project.created` activity record

### Invitations

Invite flow is split intentionally:

- Convex mutations decide whether the target is:
  - already a member
  - an existing active user who can be added directly
  - a new email that needs a Clerk invitation
- Node action in [`convex/invitationsActions.ts`](./convex/invitationsActions.ts) performs Clerk API calls
- Final Convex mutation persists invite state and activity

## Frontend Structure Notes

### Code organization rules (foundation refactor)

- Keep route files as entry/composition shells; move reusable pure logic to feature modules.
- Place issue hierarchy logic in `src/features/tasker/issues/` and import it from routes/components instead of duplicating helper functions.
- Place shared issue status transition/cascade-confirmation orchestration in `src/features/tasker/issues/useIssueStatusFlow.ts` and reuse it instead of reimplementing route-local mutation guards.
- Place shared task draft modal/form UI in `src/features/tasker/issues/components/IssueDraftDialog.tsx` and reuse it across project and issue flows instead of duplicating form markup.
- Place issue discussion/activity rendering and comment editing UI in `src/features/tasker/issues/components/IssueDiscussionPanel.tsx` instead of keeping that block inline in the issue route.
- Place issue overview, sub-task list, and metadata UI in `src/features/tasker/issues/components/IssueDetailPanels.tsx` and keep the issue route focused on local edit state and mutation callbacks.
- Place issue detail page queries, derived state, edit state, dialog state, and mutation handlers in `src/features/tasker/issues/useIssueDetailPage.ts` so the route stays focused on params, back-navigation, and page composition.
- Place project route search schema and normalization helpers in `src/features/tasker/projects/projectSearch.ts` instead of redefining query-string helpers inside route files.
- Place the remaining project-page composition, dialogs, and project-view switching UI in `src/features/tasker/projects/components/ProjectDetailContent.tsx` so the route stays focused on params, search-state updates, and loading/not-found handling.
- Place project task import/export state, menu behavior, and file parsing in `src/features/tasker/projects/useProjectTaskImportExport.ts` instead of keeping that workflow inline in route files.
- Place project detail page queries, derived state, modal state, and mutation handlers in `src/features/tasker/projects/useProjectDetailPage.ts` so the route stays focused on search-state normalization and composition.
- Place project members/invite modal UI in `src/features/tasker/projects/components/` and keep the route focused on modal state plus mutation wiring.
- Place the project settings form card in `src/features/tasker/projects/components/ProjectSettingsCard.tsx` and keep the route focused on settings state, submit handlers, and archive confirmation state.
- Place the project task board/filter shell in `src/features/tasker/projects/components/ProjectTasksPanel.tsx` and keep the route focused on task data, render callbacks, and mutation/update handlers.
- Place recursive project issue-tree rendering plus inline row/card controls in `src/features/tasker/projects/components/ProjectIssueTree.tsx` instead of keeping those render functions and helpers inside the route.
- Prefer incremental extractions that preserve behavior over broad rewrites.
- When roadmap work starts or completes, update:
  - `plan/codebase-foundation-implementation-plan.md` task status
  - `ROADMAP.md` checklist/progress log
  - `AGENT.md` structure notes when architecture conventions change

### App shell

[`src/features/tasker/layout/AppShell.tsx`](./src/features/tasker/layout/AppShell.tsx) owns a lot of cross-app UI:

- left navigation
- command palette / quick navigation
- theme picker
- sidebar project + list management
- list create/rename/delete modals

This file is large and stateful. If changing shell behavior, isolate edits carefully.

### Project detail route

[`src/routes/_app.projects.$projectId.tsx`](./src/routes/_app.projects.$projectId.tsx) is now a route shell that owns:

- URL-backed filters and view state
- search updates and normalization for the project page
- loading/not-found route handling
- handoff to the project detail controller hook and `ProjectDetailContent.tsx`

Most project detail state, mutations, dialogs, and derived collections now live in `src/features/tasker/projects/useProjectDetailPage.ts`; most project-page composition now lives in `src/features/tasker/projects/components/ProjectDetailContent.tsx`; and shared project search helpers now live in `src/features/tasker/projects/projectSearch.ts`.

### Issue detail route

[`src/routes/_app.issues.$issueId.tsx`](./src/routes/_app.issues.$issueId.tsx) is now a route shell that owns:

- route params and back-navigation behavior
- issue-page composition using extracted issue feature modules
- not-found/loading handling and confirmation-dialog wiring

Most issue detail queries, derived timeline data, edit state, dialog state, and mutation handlers now live in `src/features/tasker/issues/useIssueDetailPage.ts`.

## Styling / UI Conventions

- Shared UI primitives are in [`src/components/ui`](./src/components/ui).
- Styling is mostly Tailwind utility classes plus extensive CSS variables in [`src/styles.css`](./src/styles.css).
- The app has a real multi-theme system, not just light/dark:
  - `light`, `dark`, `auto`
  - `fun`, `sunset`, `lagoon`, `chaos`, `sketch`, `blocks`, `win95`, `glass`, `neobrutalism`, `dont_use_me`
- Theme bootstrapping happens before hydration in [`src/routes/__root.tsx`](./src/routes/__root.tsx).
- Theme UI lives in [`src/components/ThemeToggle.tsx`](./src/components/ThemeToggle.tsx).

Practical guidance:

- Do not flatten the theme system back to basic light/dark unless requested.
- Prefer existing CSS variables like `--surface`, `--text`, `--muted-text`, `--line`, `--accent`.

## Validation / Shared Model Helpers

- Frontend enums and labels: [`src/features/tasker/model.ts`](./src/features/tasker/model.ts)
- Frontend form validation: [`src/features/tasker/validation.ts`](./src/features/tasker/validation.ts)
- Formatting helpers: [`src/features/tasker/format.ts`](./src/features/tasker/format.ts)
- Client Convex error parsing: [`src/lib/utils.ts`](./src/lib/utils.ts)

## Generated / Derived Files

Treat these as generated unless there is a very specific reason not to:

- [`src/routeTree.gen.ts`](./src/routeTree.gen.ts)
- [`convex/_generated`](./convex/_generated)

Repo/tooling notes:

- [`biome.json`](./biome.json) excludes `src/routeTree.gen.ts` and `src/styles.css` from normal formatting/lint coverage.

## Testing / Quality Reality

- Current non-UI coverage is intentionally lean and focused on extracted pure modules:
  - [`src/features/tasker/issues/hierarchy.test.ts`](./src/features/tasker/issues/hierarchy.test.ts)
  - [`src/features/tasker/projects/projectSearch.test.ts`](./src/features/tasker/projects/projectSearch.test.ts)
- `pnpm test` now passes with the dedicated [`vitest.config.ts`](./vitest.config.ts).
- `pnpm check` is still the main routine static check and is currently clean.

When making changes, prefer:

1. `pnpm check`
2. targeted manual validation of the affected route/backend flow
3. add tests only if introducing test coverage is part of the task

## Recommended Starting Points For Future Agents

If the task is about:

- Auth / access issues:
  - [`convex/lib/auth.ts`](./convex/lib/auth.ts)
  - [`src/features/tasker/auth/RequireAuth.tsx`](./src/features/tasker/auth/RequireAuth.tsx)
  - [`src/features/tasker/auth/UserBootstrap.tsx`](./src/features/tasker/auth/UserBootstrap.tsx)
- User provisioning / roles:
  - [`convex/users.ts`](./convex/users.ts)
  - [`src/routes/_app.admin.users.tsx`](./src/routes/_app.admin.users.tsx)
- Project membership / invites:
  - [`convex/projects.ts`](./convex/projects.ts)
  - [`convex/invitations.ts`](./convex/invitations.ts)
  - [`convex/invitationsActions.ts`](./convex/invitationsActions.ts)
  - [`src/routes/_app.projects.$projectId.tsx`](./src/routes/_app.projects.$projectId.tsx)
- Task filtering / task state / hierarchy:
  - [`convex/issues.ts`](./convex/issues.ts)
  - [`src/routes/_app.projects.$projectId.tsx`](./src/routes/_app.projects.$projectId.tsx)
  - [`src/routes/_app.issues.$issueId.tsx`](./src/routes/_app.issues.$issueId.tsx)
- Lists:
  - [`convex/issueLists.ts`](./convex/issueLists.ts)
  - [`src/features/tasker/layout/AppShell.tsx`](./src/features/tasker/layout/AppShell.tsx)
- Dashboard:
  - [`convex/dashboard.ts`](./convex/dashboard.ts)
  - [`src/routes/_app.dashboard.tsx`](./src/routes/_app.dashboard.tsx)

## Short Summary

This repo is a full-stack task manager where most business rules live in Convex and the biggest UI state lives in the project and issue route files. The critical invariants are server-side auth, one-level sub-task rules, soft-delete/cascade behavior, invite flow split between Convex and Clerk, and preservation of the custom multi-theme UI system.
