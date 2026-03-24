# Roadmap

Use this file to track feature progress. Check items off as they ship.

## Working Rule

- [ ] Keep [AGENT.md](/Users/osama/sources/private/tasker/AGENT.md) and [ROADMAP.md](/Users/osama/sources/private/tasker/ROADMAP.md) updated whenever implementation changes meaningfully, roadmap items move, or tasks are completed

## Highest Priority: Codebase Foundation

- [ ] Refactor the codebase for maintainability before adding major new product surface area
- [ ] Break up [src/routes/\_app.projects.$projectId.tsx](/Users/osama/sources/private/tasker/src/routes/_app.projects.$projectId.tsx) into manageable feature modules
- [ ] Break up [src/routes/\_app.issues.$issueId.tsx](/Users/osama/sources/private/tasker/src/routes/_app.issues.$issueId.tsx) into manageable feature modules
- [ ] Reduce route files so they act as route entry points and composition shells, not feature dumping grounds
- [ ] Define a clear structure for route-level data loading, feature hooks, feature components, dialogs, forms, and utilities
- [ ] Extract project detail page state and mutations into focused hooks
- [ ] Extract issue detail page state and mutations into focused hooks
- [ ] Split large inline UI sections into dedicated components with clear ownership
- [ ] Move repeated task/project presentation patterns into reusable components where it genuinely reduces duplication
- [ ] Separate pure view logic from Convex wiring and mutation orchestration
- [ ] Consolidate route-specific helper functions into colocated modules or shared utilities where appropriate
- [ ] Add tests around the refactor so behavior does not drift while files are being split, and keep test files, artifacts and related pieces well organized away from the main codebase to reduce bloat.
- [ ] Establish code organization rules and update AGENT.md file so new work extends the same structure instead of recreating large route files

## Product Direction

- [ ] Define opinionated defaults for project setup, task structure, views, and permissions
- [ ] Keep the product simple enough for chaotic teams who mainly want a fast todo-list experience
- [ ] Keep the product extensible enough for advanced teams who want planning, automation, reporting, and integrations
- [ ] Design a layered UX so basic teams are not overwhelmed by advanced capabilities

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

- [ ] Add a dedicated "My Work" view
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
