# Roadmap

Use this file to track feature progress. Check items off as they ship.

## Working Rule

- [ ] Keep [AGENT.md](/Users/osama/sources/private/tasker/AGENT.md) and [ROADMAP.md](/Users/osama/sources/private/tasker/ROADMAP.md) updated whenever implementation changes meaningfully, roadmap items move, or tasks are completed (This check list item should always be validated after each task completion and should not be marked as done unless all other tasks are also done)

## Highest Priority: Codebase Foundation

- [x] Refactor the codebase for maintainability before adding major new product surface area
- [x] Break up [src/routes/\_app.projects.$projectId.tsx](/Users/osama/sources/private/tasker/src/routes/_app.projects.$projectId.tsx) into manageable feature modules
- [x] Break up [src/routes/\_app.issues.$issueId.tsx](/Users/osama/sources/private/tasker/src/routes/_app.issues.$issueId.tsx) into manageable feature modules
- [x] Reduce route files so they act as route entry points and composition shells, not feature dumping grounds
- [x] Define a clear structure for route-level data loading, feature hooks, feature components, dialogs, forms, and utilities
- [x] Extract project detail page state and mutations into focused hooks
- [x] Extract issue detail page state and mutations into focused hooks
- [x] Split large inline UI sections into dedicated components with clear ownership
- [x] Move repeated task/project presentation patterns into reusable components where it genuinely reduces duplication
- [x] Separate pure view logic from Convex wiring and mutation orchestration
- [x] Consolidate route-specific helper functions into colocated modules or shared utilities where appropriate
- [x] Add tests around the refactor so behavior does not drift while files are being split, and keep test files, artifacts and related pieces well organized away from the main codebase to reduce bloat.
- [x] Establish code organization rules and update AGENT.md file so new work extends the same structure instead of recreating large route files

### Foundation Progress Log

- 2026-03-24: Created `plan/codebase-foundation-implementation-plan.md` with trackable refactor phases and tasks.
- 2026-03-24: Extracted shared issue hierarchy helpers (`buildDescendantStats`, `findDoneAncestorIssue`) to `src/features/tasker/issues/hierarchy.ts` and wired both project and issue detail routes to use the shared module.
- 2026-03-25: Extracted shared issue status orchestration to `src/features/tasker/issues/useIssueStatusFlow.ts`, removing duplicated done-ancestor validation and cascade-completion flow from both large route files.
- 2026-03-25: Extracted project task import/export state, menu behavior, and file parsing to `src/features/tasker/projects/useProjectTaskImportExport.ts`, reducing project-route-only workflow logic.
- 2026-03-25: Extracted the repeated task draft modal/form UI to `src/features/tasker/issues/components/IssueDraftDialog.tsx` and reused it for both project task creation and issue sub-task creation.
- 2026-03-25: Extracted project member management dialogs to `src/features/tasker/projects/components/ProjectMembersDialog.tsx` and `src/features/tasker/projects/components/ProjectInviteDialog.tsx`, removing another large route-owned UI block from the project page.
- 2026-03-25: Extracted issue discussion and activity rendering to `src/features/tasker/issues/components/IssueDiscussionPanel.tsx`, removing comment/edit UI and activity labeling from the issue route.
- 2026-03-25: Extracted project settings form UI to `src/features/tasker/projects/components/ProjectSettingsCard.tsx`, leaving the project route with state and mutation wiring instead of settings form markup.
- 2026-03-25: Extracted the project task board/filter card to `src/features/tasker/projects/components/ProjectTasksPanel.tsx`, removing the search/filter/layout shell from the project route while preserving route-owned task handlers.
- 2026-03-25: Extracted issue overview, sub-task list, and metadata controls to `src/features/tasker/issues/components/IssueDetailPanels.tsx`, removing the largest remaining inline UI block from the issue route.
- 2026-03-25: Extracted recursive project issue-tree rendering to `src/features/tasker/projects/components/ProjectIssueTree.tsx`, removing inline task row/card renderers and their helper controls from the project route.
- 2026-03-25: Extracted project detail orchestration to `src/features/tasker/projects/useProjectDetailPage.ts`, moving the project route’s queries, mutation handlers, modal state, and derived collections into a dedicated controller hook.
- 2026-03-25: Extracted issue detail orchestration to `src/features/tasker/issues/useIssueDetailPage.ts`, moving the issue route’s queries, mutation handlers, edit state, timeline derivation, and dialog state into a dedicated controller hook.
- 2026-03-25: Extracted project route search schema/normalization to `src/features/tasker/projects/projectSearch.ts` and moved the remaining project-page composition into `src/features/tasker/projects/components/ProjectDetailContent.tsx`, leaving the route as a search-aware entry shell.
- 2026-03-25: Added lean refactor coverage for `src/features/tasker/issues/hierarchy.ts` and `src/features/tasker/projects/projectSearch.ts`, plus a dedicated `vitest.config.ts` so `pnpm test` runs cleanly without inheriting the full app Vite plugin stack.
- 2026-03-25: Extracted project issue tree/grouping helpers to `src/features/tasker/projects/issueGrouping.ts` and added Vitest coverage for tree building, grouped issue derivation, kanban column derivation, and input-date formatting.
- 2026-03-25: Extracted project draft/settings defaults and invite result messaging to `src/features/tasker/projects/projectDrafts.ts`, reducing controller-hook-only logic and adding direct Vitest coverage for those defaults and inheritance rules.
- 2026-03-25: Wrapped the foundation refactor by reducing the project detail route to `75` lines and the issue detail route to `264` lines, with route-shell architecture, extracted feature modules, and passing `pnpm test`/`pnpm check`.
- 2026-03-25: Defined the default product shape in the roadmap and shipped the first post-foundation feature: a dedicated `My Work` view with opinionated personal sections backed by `convex/myWork.ts` and exposed in app navigation.

## Product Direction

- [x] Define opinionated defaults for project setup, task structure, views, and permissions
- [ ] Keep the product simple enough for chaotic teams who mainly want a fast todo-list experience
- [ ] Keep the product extensible enough for advanced teams who want planning, automation, reporting, and integrations
- [ ] Design a layered UX so basic teams are not overwhelmed by advanced capabilities

### Default Product Shape

- New projects start active with member invites enabled and task deletion enabled.
- The default task workflow is `backlog -> todo -> in_progress -> in_review -> done`.
- The default project working view is task-first: list layout, grouped by list, sorted by recently updated.
- The default personal working surfaces are `Dashboard`, `My Work`, and `Projects`.
- `My Work` defaults to opinionated sections instead of a blank filter builder: `Focus`, `Due Soon`, `Overdue`, `Backlog & Todo`, and `Recently Completed`.
- Permissions remain intentionally simple by default: `admin` has full access, `member` can write in accessible projects, and `viewer` is read-only.

## Core Workflow

- [ ] Add notifications, an in-app inbox, and due date reminders for assignments, comments, status changes, and invites
- [ ] Add per-user notification preferences
- [ ] Add recurring tasks plus reusable task and project templates
- [ ] Add bulk task actions for status, assignee, priority, list, archive, and delete
- [ ] Add undo and recovery flows for destructive actions
- [ ] Add a proper trash / restore flow for deleted tasks and projects if deletion remains part of the product

## Planning

- [ ] Add calendar view
- [ ] Add workload and capacity planning by assignee
- [ ] Add timeline view with milestones
- [ ] Add task dependencies and blocker relationships
- [ ] Add archived-task visibility within each project

## Personal Productivity

- [x] Add a dedicated "My Work" view
- [ ] Add saved filters and saved views
- [ ] Add personal bookmarks / pinning
- [ ] Add private notes on tasks
- [ ] Add private user notes that are not tied to any specific project
- [ ] Add focus mode for working through assigned tasks

## Collaboration

- [ ] Add @mentions in comments
- [ ] Add watchers / followers on tasks
- [ ] Add file attachments
- [ ] Add richer comment formatting and editing history
- [ ] Improve activity feed labels to be more human-readable
- [ ] Add guest / external collaborator access where appropriate

## Workflow Model

- [ ] Add status model flexibility with custom workflows per project
- [ ] Add custom labels management per project
- [ ] Add custom task fields per project
- [ ] Add checklist items inside tasks
- [ ] Add task estimates and optional time tracking
- [ ] Support deeper sub-task nesting if still needed after real usage

## Project and Permissions

- [ ] Add project duplication
- [ ] Add project ownership transfer
- [ ] Add project-level roles and permission controls beyond global roles
- [ ] Add project-level defaults for statuses, priorities, labels, and permissions
- [ ] Add project deletion flow if intended product behavior

## Search and Navigation

- [ ] Add global search across projects, tasks, comments, and members
- [ ] Add advanced filter builder
- [ ] Add stronger keyboard shortcuts for common task actions
- [ ] Add recent items and quick-jump history

## Reporting

- [ ] Expand the dashboard with more useful charts and summaries
- [ ] Add per-project reporting
- [ ] Add assignee workload and throughput reporting
- [ ] Add completion trend and overdue trend reporting
- [ ] Add exportable reports

## Automation

- [ ] Add workflow rules and automations for task status changes, assignments, reminders, and recurring generation
- [ ] Add webhook or external automation hooks

## Integrations and Data Portability

- [ ] Add notification integrations such as email, Slack, Discord, and similar channels
- [ ] Add operations integrations such as GitHub
- [ ] Add calendar sync
- [ ] Extend import/export from task-level JSON to full project-level import/export
- [ ] Add CSV / Excel-compatible import and export support
- [ ] Add import from other task tools if migration becomes important
- [ ] Add API tokens or external API access if this becomes a platform

## Quality and Experience

- [ ] Improve onboarding, empty states, and first-project setup
- [ ] Add better loading, optimistic, and failure states around task operations
- [ ] Improve the mobile experience for everyday use, not just basic compatibility
- [ ] Address performance ceilings for larger projects, heavier activity, and denser dashboards
- [ ] Add accessibility improvements for keyboard and screen reader support
- [ ] Add end-to-end coverage for core user flows
- [ ] Add stronger permission and destructive-action test coverage

## Ideas to Validate Before Building

- [ ] Validate whether deeper sub-task nesting is actually needed
- [ ] Validate whether timeline is more valuable than workload view for target users
- [ ] Validate which notification channels users actually want
- [ ] Validate whether time tracking belongs in the core product or should stay out
- [ ] Validate whether guest access is more valuable than deeper internal permission controls
