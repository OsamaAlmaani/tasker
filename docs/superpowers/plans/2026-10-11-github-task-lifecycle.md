# GitHub Task Lifecycle Implementation Plan

> **For agentic workers:** Implement natively in this authorized session using the test-driven development skill. Steps use checkbox syntax for tracking.

**Goal:** Create GitHub branches from tasks and follow their PR lifecycle safely.

**Architecture:** Convex stores project connections and issue links. Node actions authenticate as a GitHub App and call GitHub; mutations enforce authorization and apply existing task rules. An HTTP webhook queues reconciliations, with a cron backstop and fenced leases to prevent stale workers.

**Tech Stack:** React, TanStack Start, Convex, GitHub REST API, Node crypto, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-github-task-lifecycle.md`

## Global Constraints

- One repository per project, one branch/PR per issue; preserve existing themes and route shells.
- Only admins configure connections; project writers can create branches and manage task sync.
- Keep credentials in Convex environment variables; never expose JWTs, installation tokens, or private keys.
- Reuse `applyIssueUpdate`, preserve ancestor/subtask checks, never cascade from GitHub.
- Native execution is authorized by the user's request; no extra plan approval or worktree setup is needed.

## Review Focus

- Revoked project access or role changes during an external action must prevent status/link finalization.
- Forged webhooks, uninstalled apps, repo mismatches, and branch-name collisions must fail safely.
- Duplicate/out-of-order events and expired workers must not regress task state.
- Manual edits and unfinished subtasks must survive automatic updates.
- Configuration changes during branch creation or refresh must invalidate stale results.

### Task 1: GitHub boundary and lifecycle rules

**Files:** `convex/lib/github.ts`, `convex/lib/githubClient.ts`, `tests/githubRules.test.ts`, `tests/githubClient.test.ts`.

**Interfaces:** repository/branch validation, suggested names, desired status derivation, signed webhooks, App JWT/token requests, exact branch and PR snapshots.

- [x] Write and run failing tests for invalid refs, drafts, merges, wrong targets, deletions, signatures, scoped credentials, collisions, and GitHub errors.
- [x] Implement helpers and the GitHub client; run targeted tests.

### Task 2: Authorized persistence and synchronization

**Files:** `convex/schema.ts`, `convex/github.ts`, `convex/githubActions.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/issues.ts`, `convex/constants.ts`, generated API declarations, `tests/github.test.ts`.

**Interfaces:** project connection query/configuration, issue link query, branch action, refresh action, pause/resume mutation, internal fenced work reservation/result mutations, verified webhook enqueue, cron reconciliation.

- [x] Write and run failing handler tests for authorization, link uniqueness, leases, manual overrides, existing hierarchy guards, stale configuration, duplicates, and snapshot transitions.
- [x] Implement tables, handlers, webhook and scheduled recovery; regenerate API types locally and run targeted tests.

### Task 3: UI, documentation, and verification

**Files:** `src/features/tasker/github/*`, project settings composition, issue route composition, activity labels, `docs/github-integration.md`, `README.md`, `AGENT.md`, `ROADMAP.md`, foundation plan.

- [x] Write and run UI tests for unconfigured/connected setup, custom mappings, create failures, pending controls, paused automation and viewer restrictions.
- [x] Implement project connection section and issue GitHub panel using existing UI primitives/theme variables.
- [x] Document setup and lifecycle constraints; update roadmap and architecture notes.
- [x] Run `pnpm test`, `pnpm check`, type checks, build and independent code review; fix any new findings.

## Verification — 2026-10-12

- `pnpm test`: 30 files, 210 tests passed (47 added GitHub tests).
- `pnpm build`: client, SSR, and Nitro production build passed; existing chunk-size warning remains.
- `pnpm exec tsc --noEmit -p convex/tsconfig.json` and `pnpm mcp:check`: passed.
- Biome check of all eight changed/new frontend files: passed. Full `pnpm check` reports 102 existing formatting failures (baseline 110); comparison of diagnostic categories/paths shows no new failures.
- Full application `tsc --noEmit`: 21 existing errors. Compared against initial commit `7409e6e7f702240135caea341fc67b95665de7e8` with line numbers normalized: identical errors, no new errors.
- Independent review fixes verified: closed unmerged PR after branch deletion; pause/resume invalidates old workers; reused branch names cannot adopt historical merged PRs. Reviewer found no remaining Important/Critical findings after those fixes.
- API declarations regenerated with the installed Convex generator template offline, preserving existing component exports. Normal deployment-bound codegen could not run without `CONVEX_DEPLOYMENT`.
- Not deployed or tested against live GitHub: this checkout has no deployment/App credentials. Operator setup and live verification steps are in `docs/github-integration.md`.

## Branch review follow-up — 2026-10-12

- [x] Reproduce stale connection saves after a newer disconnect/configuration write, including simultaneous initial connection requests.
- [x] Capture a version precondition before external validation and reject outdated final saves.
- [x] Reproduce human status round trips that let old agent claims renew, submit, or restore obsolete status.
- [x] Invalidate claims on actual non-agent status transitions, including cascade completion and workflow transfers; retain safe release behavior and unchanged-status/non-status edit compatibility.
- `pnpm test`: 30 files, 217 tests passed. Convex and MCP type checks passed.
- Lint checks passed with the formatter disabled. Full application TypeScript still reports the same 21 baseline errors, verified by comparison with normalized line numbers.
- The same independent reviewer inspected both fixes and found no actionable issues. No live deployment or GitHub calls were made.
