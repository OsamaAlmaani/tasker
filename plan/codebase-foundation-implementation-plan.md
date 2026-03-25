# Codebase Foundation Implementation Plan

_Last updated: 2026-03-25_

## Objective
Refactor oversized route files into maintainable feature modules while preserving behavior.

## Phase 1: Planning and first extraction (current)
- [x] Create `plan/` workspace and initial trackable implementation plan.
- [x] Audit `Highest Priority: Codebase Foundation` section and map first concrete extraction task.
- [x] Extract shared issue hierarchy helpers from route files into feature modules.
- [x] Update project and issue routes to consume shared helpers.
- [x] Run static checks and fix any regressions.
- [x] Update `AGENT.md` and `ROADMAP.md` with progress and structure rules.

## Phase 2: Route decomposition
- [x] Introduce route-local composition shells for project and issue pages.
- [x] Move route state/mutation orchestration into focused hooks.
  - [x] Extract shared issue status update and cascade-completion orchestration from large routes.
  - [x] Extract project task import/export state and file handling from the project route.
  - [x] Extract project detail page state, queries, and mutation handlers into a dedicated controller hook.
  - [x] Extract issue detail page state, queries, and mutation handlers into a dedicated controller hook.
- [x] Split inline UI regions into dedicated feature components.
  - [x] Extract the repeated task draft dialog/form into a shared issue component.
  - [x] Extract project members and invite modals into dedicated project components.
  - [x] Extract issue discussion/activity UI into a dedicated issue component.
  - [x] Extract the project settings card into a dedicated project component.
  - [x] Extract the project task board/filter card into a dedicated project component.
  - [x] Extract the issue overview/sub-task and metadata panels into dedicated issue components.
  - [x] Extract project issue-tree renderers into dedicated project components.
- [ ] Consolidate repeated project/task presentation patterns.

## Phase 3: Stabilization
- [x] Add lean tests around extracted pure logic (non-UI heavy).
- [ ] Document code organization conventions for future feature work.
- [ ] Mark roadmap foundation items completed once route sizes are materially reduced.

## Notes
- Keep refactors incremental and behavior-preserving.
- Keep this plan updated as tasks start and finish.
- Initial extraction complete: `buildDescendantStats` and `findDoneAncestorIssue` now live in `src/features/tasker/issues/hierarchy.ts`.
- Latest extraction complete: shared issue status update flow now lives in `src/features/tasker/issues/useIssueStatusFlow.ts`.
- Latest extraction complete: project task import/export flow now lives in `src/features/tasker/projects/useProjectTaskImportExport.ts`.
- Latest extraction complete: shared task draft dialog/form now lives in `src/features/tasker/issues/components/IssueDraftDialog.tsx`.
- Latest extraction complete: project members and invite dialogs now live in `src/features/tasker/projects/components/`.
- Latest extraction complete: issue discussion/activity UI now lives in `src/features/tasker/issues/components/IssueDiscussionPanel.tsx`.
- Latest extraction complete: project settings card UI now lives in `src/features/tasker/projects/components/ProjectSettingsCard.tsx`.
- Latest extraction complete: project task board/filter UI now lives in `src/features/tasker/projects/components/ProjectTasksPanel.tsx`.
- Latest extraction complete: issue overview/sub-task and metadata UI now lives in `src/features/tasker/issues/components/IssueDetailPanels.tsx`.
- Latest extraction complete: project issue-tree rendering UI now lives in `src/features/tasker/projects/components/ProjectIssueTree.tsx`.
- Latest extraction complete: project detail page state, queries, and mutation handlers now live in `src/features/tasker/projects/useProjectDetailPage.ts`.
- Latest extraction complete: issue detail page state, queries, and mutation handlers now live in `src/features/tasker/issues/useIssueDetailPage.ts`.
- Latest extraction complete: project search schema/normalization now live in `src/features/tasker/projects/projectSearch.ts`, and the project route now composes `src/features/tasker/projects/components/ProjectDetailContent.tsx` as a route shell.
- Latest stabilization step complete: lean Vitest coverage now exercises `src/features/tasker/issues/hierarchy.ts` and `src/features/tasker/projects/projectSearch.ts`, with dedicated config in `vitest.config.ts`.
- Latest extraction complete: project issue tree/grouping and input-date helpers now live in `src/features/tasker/projects/issueGrouping.ts`, with matching Vitest coverage.
- Latest extraction complete: project draft/settings defaults and invite-result mapping now live in `src/features/tasker/projects/projectDrafts.ts`, further shrinking `useProjectDetailPage.ts` with matching Vitest coverage.
