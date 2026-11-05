# GitHub Phase 2: Links and Signals

Implementation plan for phase 2 of [`github-integration-vision.md`](./github-integration-vision.md).
Started 2026-11-05, implemented 2026-11-06. Check items off as they ship and keep
`AGENT.md` and `ROADMAP.md` in step.

## Known limits after phase 2

- Check failures notify only authors of pull requests already linked to a task,
  because `check_suite` payloads carry no author. Workflow failures on the
  default branch notify the mapped triggering actor.
- Merge-conflict notifications depend on GitHub including `mergeable: false` in
  a pull request event; GitHub computes it lazily, so some conflicts surface only
  on the next pull request event or page load.
- Nothing writes to GitHub with the automation identity yet; it is stored and
  shown so later phases (status checks, comments) can use it.
- `processEvent` receives the already normalised event as `v.any()`; the HTTP
  route is the only caller and validates the raw payload first.

## Decisions (made 2026-11-05)

- **Webhook metadata visibility:** repository-access users only. Webhook-derived
  PR state (title, state, draft, branch, author login, checks, review) is shown
  only to users whose own token was verified to read the repository (cached per
  user per repository for 24 hours). Everyone else sees "linked pull request"
  with the number only.
- **Identity for GitHub writes with no user present:** the webhook is registered
  with the token of the user who links it. A project writer can opt in as the
  project's automation identity; it is used only for enumerated automation
  actions, each labelled with their login in activity. Leaving the project or
  removing the token disables those actions. Designed so a GitHub App can
  replace it later.
- **Project key:** already exists (`projects.key`, required, unique, 2 to 8
  characters). Task references are `KEY-123` and Tasker task URLs. Bare `#123`
  was dropped during review because on GitHub it means a GitHub issue, so it
  would link and move unrelated tasks.
- **Multi-repo:** schema keys every new row on `repositoryId` so a project can
  hold several repositories later; the UI keeps one repository per project.
- **Automation rules:** on by default, editable per project, mapped to the
  project's own statuses. Rules pointing to a deleted status are disabled with
  a warning.
- **Inbox:** review requested, changes requested, approved, checks failed on
  your PR, merge conflict, your PR merged, workflow failed on the default
  branch. Inbox rows plus email through the existing SMTP path.
- **Templates:** branch `feat/{key}-{slug}`, PR title `{key}: {title}`, PR body
  with task link, description and checklist mirror. Editable per project.
- **Scope:** everything below ships in phase 2, including chips on calendar and
  Gantt and the automation settings UI.

## Architecture

- `convex/githubLinks.ts`: persistence and queries for PR links, branch links,
  repository access cache, templates, automation rules and identity.
- `convex/githubLinkActions.ts`: GitHub calls made by a user: sync links from
  loaded PRs, link/unlink by number, create branch, create PR, live summaries
  for an issue's PRs, verify repository access, register/remove webhook.
- `convex/githubWebhooks.ts`: webhook processing (internal mutations) plus
  automation and notification fan-out.
- `convex/http.ts`: `POST /github/webhook` HTTP action with HMAC verification.
- `convex/lib/githubReferences.ts`: pure task-reference parsing and templates.
- `convex/lib/githubAutomation.ts`: pure rule defaults, event normalisation and
  transition resolution.
- Frontend in `src/features/tasker/github/`: `IssueDevelopmentPanel`,
  `PullRequestChip`, `LinkedTasksCard`, `GitHubAutomationSettings`,
  `useRepositoryLive` (live-version refetch), display helpers in
  `linkDisplay.ts`.

## Tasks

### A. Schema and constants

- [x] `githubPullRequestLinks` (projectId, repositoryId, issueId, pullNumber,
      source, linkedBy?, linkedAt, snapshot?) with indexes by issue, by project
      and pull number, by repository and pull number.
- [x] `githubBranchLinks` (projectId, repositoryId, issueId, branchName, source,
      createdBy?, createdAt, deletedAt?).
- [x] `githubRepositoryAccess` (userId, repositoryId, canRead, checkedAt).
- [x] `githubWebhookDeliveries` (repositoryId, deliveryId, event, action,
      pullNumber?, ref?, sha?, senderLogin?, receivedAt, outcome).
- [x] `githubRepositoryLinks` gains `liveVersion`, `webhook` (hookId, encrypted
      secret, registeredBy, registeredAt, lastDeliveryAt, lastDeliveryEvent,
      lastError), `automationRules`, `automationUserId`, `templates`, and a
      `by_repositoryId` index.
- [x] Activity actions: `github.pr_linked`, `github.pr_unlinked`,
      `github.branch_created`, `github.pr_created`, `github.pr_event`,
      `github.automation_applied`, `github.automation_skipped`,
      `github.webhook_registered`, `github.webhook_removed`,
      `github.automation_settings_changed`.
- [x] Notification types: `github_review_requested`, `github_changes_requested`,
      `github_approved`, `github_checks_failed`, `github_merge_conflict`,
      `github_pr_merged`, `github_workflow_failed`.

### B. Pure logic (tested)

- [x] `parseTaskReferences(text, { projectKey })` returns issue numbers and
      task ids from `KEY-123` and `/issues/<id>` URLs.
- [x] `slugify`, `renderBranchName`, `renderPullRequestTitle`,
      `renderPullRequestBody` with checklist mirror.
- [x] `defaultAutomationRules()`, `normalizeAutomationRules(rules, statuses)`,
      `resolveTransition(rule, currentStatus)`.
- [x] `normalizeWebhookEvent(eventName, payload)` to a typed union; unknown
      events return null.
- [x] `verifyWebhookSignature(secret, body, header)` with constant-time compare.
- [x] Tests in `tests/githubLinks.test.ts`, `tests/githubWebhooks.test.ts` and
      `tests/githubWebhookProcessing.test.ts` (in-memory database, end-to-end
      opened -> closed -> reopened -> merged flow, pushes, checks, workflows).

### C. Links backend

- [x] Queries: `githubLinks.listForIssue`, `githubLinks.listForProject`,
      `githubLinks.listForPullRequest`, `githubLinks.getSettings`.
- [x] Mutations: `unlinkPullRequest`, `updateAutomationSettings`,
      `setAutomationIdentity`, internal `upsertPullRequestLinks`,
      `upsertBranchLink`, `recordRepositoryAccess`.
- [x] Actions: `syncLinksFromPullRequests` runs inside `listPullRequests` and
      `getPullRequest` (title, body, branch); `linkPullRequest`,
      `getIssuePullRequests` (live, batched GraphQL), `createBranch`,
      `createPullRequest`, `verifyRepositoryAccess`.
- [x] GraphQL detail query gains `body` for reference parsing.

### D. Webhooks and automation

- [x] `convex/http.ts` route, signature verification, delivery dedup, fan-out
      to every project linking the repository.
- [x] `registerWebhook` / `removeWebhook` actions (linker's token), manual
      setup fallback with URL and secret shown once.
- [x] Live version bump on every accepted delivery; `useGitHubData` refetches
      when the version changes.
- [x] Pull request events: upsert links and snapshots, timeline activity,
      status automation, notifications.
- [x] Push events: branch links for `KEY-123` branches, `branch_pushed` rule.
- [x] Review events: approved and changes requested notifications and rules.
- [x] Check suite and workflow run events: checks failed on your PR, workflow
      failed on default branch.
- [x] Automation writes use `applyIssueUpdate` with the mapped sender or the
      linking user as actor; blocked transitions record
      `github.automation_skipped` instead of failing.
- [x] `pr_closed` restores the status recorded by the last automation.

### E. Notifications

- [x] Generic GitHub notification content builder (`lib/notifications.ts`).
- [x] `createGitHubNotification` internal mutation and email delivery for the
      new types (subject, text, HTML from metadata).
- [x] Inbox rows link to the Tasker PR page or run page.

### F. Frontend

- [x] `IssueDevelopmentPanel` on the task page: branches, PRs (live when the
      viewer has a token, snapshot otherwise), create branch, create PR, link
      existing PR, unlink, copy checkout commands.
- [x] PR chips on list rows, Kanban cards, calendar events and Gantt rows.
- [x] `LinkedTasksCard` on the PR page: linked tasks with inline status, link
      and unlink, task intent (description and checklist).
- [x] GitHub tab: webhook card, automation rules editor, templates,
      automation identity opt-in.
- [x] Activity labels for the new `github.*` actions in the task timeline.
- [x] Inbox copy for GitHub notification types.

### G. Documentation and validation

- [x] `AGENT.md`: new modules, invariants, env (`CONVEX_SITE_URL` or
      `GITHUB_WEBHOOK_URL`), tests.
- [x] `ROADMAP.md`: mark linking and webhooks done, log the date.
- [x] `pnpm check`, `pnpm test`, MCP type check still pass.
