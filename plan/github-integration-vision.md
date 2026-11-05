# GitHub Integration Vision: "Never open github.com"

Status: brainstorm / direction document, written 2026-11-05. Nothing here is
implemented. Phase 1 of the integration (per-user PAT, linked repository, pull
request workspace, Workflows workspace) is described in
[`github-integration-plan.md`](./github-integration-plan.md).

Goal: a developer who works in Tasker should be able to go from "task assigned"
to "change released" without ever opening GitHub in a browser, and Tasker should
know more about the work than GitHub does, because it holds the task context
that GitHub lacks.

## What we have to build on

- One personal access token per Tasker user, AES-GCM encrypted, decrypted only
  inside actions, never shared. Every GitHub call runs as the caller.
- `githubConnections.githubLogin` already maps a GitHub login to a Tasker user.
  This is the key that makes review requests, mentions, commit authors and
  CODEOWNERS entries addressable as Tasker people.
- Live, uncached PR reads, a sanitised render of GitHub HTML that already
  rewrites PR links to stay inside Tasker, a timeline with review threads, and
  write actions (comment, review, merge, close, reopen, draft, update branch).
- Workflows: overview, runs, job logs with line deep links, failure signatures,
  branch resolution, change-aware releases that skip unchanged workflows,
  re-run/cancel/enable/disable, workflow groups.
- Project activity entries for GitHub actions taken from Tasker.
- An MCP workspace with idempotent writes, revisions and scoped agent tokens.
- Project-owned statuses, labels, custom fields and checklists, plus an inbox
  with SMTP delivery.

## Principles that must survive

1. No shared credentials. Reads and writes to GitHub run as the person asking.
2. GitHub content is never stored where someone whose own token could not read
   it might see it. Metadata needed for linking (numbers, SHAs, ids) is fine.
3. Tasker is the system of record for intent (tasks, status, acceptance);
   GitHub is the system of record for code. Each side mirrors, never forks, the
   other's truth.
4. Every automation is visible as project activity and reversible by a human.

Two things in this document bend principle 1 and need an explicit decision:
webhooks (GitHub pushes data to Tasker with no caller) and automations that
write to GitHub when no user is present. See "Identity decisions" at the end.

---

## 1. Task <-> pull request linking (the foundation)

Everything else stands on this. Today a PR and a task know nothing about each
other.

### Project key and task references

- Give each project a short key (`TSK`, `SHOP`, `API`), editable in project
  settings, unique per workspace. Tasks become `SHOP-142`. Task numbers already
  exist per project (`projectCounters`), so this is a display and parsing layer.
- Accept `SHOP-142`, `#142` (within the linked repo's project) and full Tasker
  task URLs anywhere we parse: branch names, PR titles, PR bodies, commit
  messages, review comments.
- Copy-key button on every task row, card and detail header.

### Link storage

- New table `githubPullRequestLinks`: `projectId`, `issueId`, `repositoryId`,
  `pullNumber`, `source` (`branch`, `title`, `body`, `commit`, `manual`,
  `created_from_task`), `linkedBy`, `linkedAt`, `unlinkedAt`. Numbers and ids
  only; no GitHub content.
- A PR can link to many tasks; a task to many PRs (fix, follow-up, revert).
- Also `githubBranchLinks` (`issueId`, `branchName`) so a branch is linked
  before any PR exists.

### Where links come from

- Automatic: when a PR list or detail is loaded, parse references with the
  viewer's data and upsert links. Later, webhooks do this the moment a PR opens
  or a branch is pushed, without anyone loading the page.
- Manual: "Link pull request" picker on the task (search open PRs by number or
  title), "Link task" picker on the PR page, drag a task key into a PR comment.
- Create from task: "Create branch" (Git Data API: create ref from default
  branch, name from a project template like `feat/{key}-{slug}`), then
  "Open pull request" from the task once the branch has commits (title
  `{key}: {title}`, body pre-filled with task link, description and a
  checklist mirror). Both record `created_from_task` links.
- Create from PR: "Create task from this pull request" for work that arrived
  without a ticket; title, body, author and labels pre-filled.

### Development panel on the task page

A panel like Linear's or Jira's "Development" block:

- Linked branches with copy buttons for `git fetch origin && git checkout
  <branch>` and `gh pr checkout <n>`.
- Each linked PR: state, draft, review decision, checks summary, mergeable,
  behind-base, files changed, reviewers (as Tasker avatars when mapped).
- Actions right there: request review, mark ready, update branch, merge with
  the project's default method, open the Tasker PR page.
- Commits that reference the task key (search commits on the linked repo).
- Deployments and environments the PR reached (see section 7).
- Everything live with the viewer's token; empty-with-reason for people
  without a token or repo access ("Connect GitHub to see linked pull
  requests").

### PR chips on rows and cards

List rows, Kanban cards, calendar and Gantt bars get a small chip: `PR #142
review` / `merged` / `CI failing` / `conflicts`. For list views this needs one
batched GraphQL query per visible page of PRs, not one per task.

### Linked tasks on the PR page

- Sidebar: linked tasks with status, assignee, priority; change status inline.
- "What this change is supposed to do": task description and checklist beside
  the PR body, so reviewers review against intent.
- Unlinked PR warning with one-click link or create.

---

## 2. Webhooks: live data and automation

### Ingestion

- A Convex HTTP action at `/github/webhook` on the `.convex.site` URL verifies
  the `X-Hub-Signature-256` HMAC with a per-link secret stored encrypted.
- Registration from Tasker with the linking user's token (fine-grained PATs can
  carry "Webhooks" repository permission). Fallback: show the URL and secret
  for manual setup and detect the first ping.
- Store only an `githubWebhookEvents` log of `deliveryId`, event type, action,
  repository id, PR number, SHA, sender login and timestamp for debugging and
  replay. Never store bodies, comments or diffs.

### Live pages without polling

- Each webhook bumps `githubRepositoryLinks.liveVersion`. Clients subscribe to
  that cheap Convex query and re-fetch with their own token when it changes.
  PR lists, PR detail, workflow runs and job progress become live without
  storing GitHub data. This replaces refresh-on-focus and reduces rate-limit
  pressure.

### Status automation rules

Per project, with sensible defaults seeded, each rule on/off and mapped to the
project's own statuses (`projects.statuses`):

| GitHub event | Default Tasker effect |
| --- | --- |
| Branch with task key pushed | task `todo`/`backlog` -> `in_progress` |
| PR opened (not draft) referencing task | -> `in_review`, PR link recorded |
| PR converted to draft | -> `in_progress` |
| Review approved | optional label `approved` or custom status |
| Changes requested | notify assignee, optional `in_progress` |
| PR merged | -> `done` (or a configurable `ready_to_release`) |
| PR closed without merge | -> previous status, activity note |
| Checks failed on linked PR | inbox + email to PR author |
| Deployment to production succeeded | set custom field `Released in` |

- Rule editor: trigger, condition (branch pattern, label, draft, base branch),
  action (set status, set label, set custom field, assign, comment on task,
  comment on PR, notify). Reuse existing status cascade rules so a parent is
  never auto-completed while children are open; stop with a notification
  instead.
- Every automated change writes activity with `source: github_webhook` and the
  delivery id, and the task page shows "moved by GitHub automation (PR #142
  merged)".
- Undo from the activity entry for the last automated transition.

### PR events in the task timeline

Opened, review requested, approved, changes requested, merged, closed, checks
failed, deployed. The task tells the whole story of the work, not only the
discussion that happened in Tasker.

---

## 3. One inbox: GitHub notifications inside Tasker

Developers go to github.com mostly because of notifications. Route them to the
Tasker inbox using webhooks plus the login mapping:

- Review requested from you (direct or via team if we resolve team members).
- Someone replied to your review thread or mentioned you.
- Your PR: approved, changes requested, checks failed, merge conflict appeared,
  became mergeable (all green and approved), merged by someone else.
- Workflow failed on the default branch, with the failure signature and a deep
  link to the log line in the Tasker run page.
- Token expiring soon (GitHub returns the expiry header on every response).
- Dependabot and code scanning alerts opened (section 8).

Each inbox row carries the one action that usually follows: Approve, Merge,
Re-run failed jobs, Open review. Reuse the existing SMTP delivery and the
planned per-user notification preferences for digests and quiet hours.

Mapping rule: a notification goes only to the Tasker user whose connected
GitHub login matches; unmapped logins produce nothing.

---

## 4. Code review inside Tasker

This is the single biggest reason to leave Tasker today.

- Diff viewer: files tab with tree, per-file collapse, viewed checkboxes
  (GitHub tracks `viewerViewedState`, we can read and write it), unified and
  split modes, syntax highlighting (Shiki in a worker), whitespace toggle,
  large-file and binary handling, image diffs.
- Line comments and multi-line comments, suggestions (` ```suggestion ` blocks)
  with one-click "commit suggestion", pending review batching with a floating
  "Finish review" panel, resolve/unresolve threads (already exists), reply.
- Review against intent: task description and checklist pinned in a side rail;
  tick acceptance items as you verify them; tick state saved on the task.
- Review checklist templates per project ("tests added", "migration
  reversible"), inserted into the review body.
- Reviewer suggestions: CODEOWNERS parsed from the repo plus current review
  load from Tasker (open requests per person), mapped to Tasker members.
- Keyboard: `j/k` files, `n/p` hunks, `c` comment, `r` review, `m` merge.
- Compare any two refs (branch to branch, tag to tag) as the same viewer.

---

## 5. My Work and Dashboard become code-aware

My Work gains sections, each backed by the viewer's own token:

- Reviews waiting for you (sorted by age and PR size).
- Your PRs: blocked (conflicts, failing checks, changes requested), waiting for
  review, ready to merge.
- Tasks you own with no branch or PR yet (stale work).
- Failing workflows on branches you touched.

Dashboard and reporting:

- Cycle time per task: created -> first commit -> PR opened -> first review ->
  approved -> merged -> deployed. Shown per project, per assignee and as a
  trend. The link table plus webhook timestamps give this for free.
- Review latency and review load per person; PR size distribution.
- Deployment frequency, change failure rate (deployments followed by a revert
  or a hotfix PR), mean time to restore (failure -> green on default branch).
- Workflow reliability: failure rate per workflow, flaky jobs (fail then pass
  on re-run), duration trends, Actions minutes used.
- Release burndown: tasks merged but not yet deployed to production.

---

## 6. Repository operations without leaving

- Branches: list, stale detection (merged or no commits in N days), delete,
  compare with default branch, create from a task.
- Commits: history on default branch and per branch, commit detail with diff,
  linked task keys resolved to task chips, revert PR creation.
- Files: browse the tree, view files with highlighting, README and
  CONTRIBUTING rendered via GitHub's markdown API, "edit and open PR" for
  docs-only changes, permalink copying, blame view for a file.
- Code search within the linked repo (REST code search; needs a classic token
  or GitHub-side limits, so degrade gracefully).
- Tags and releases: list, create tag from a SHA, draft release.
- Repository health: branch protection and rulesets summary, required checks,
  CODEOWNERS coverage, who on the Tasker project lacks repository access
  (compare project members' logins to collaborators) with an "invite to
  repository" action for admins.
- Actions secrets and variables: list names, set values (never read back),
  with activity entries. Environment protection rules and required reviewers.
- Pending deployment approvals: environments with `wait` or reviewer rules
  show as "Approve deployment" cards on the Workflows page and in the inbox.
- Artifacts: list and download links from run pages; cache usage and purge.

---

## 7. Releases, deployments and changelog

- "What's in this release": pick a range (last tag -> HEAD, or a Tasker
  workflow release) and see tasks and PRs merged in it, grouped by label and
  list, with assignees. Export as release notes.
- Release notes generator: from linked tasks (title, key, labels) and PR
  titles for unlinked PRs; template per project; create the GitHub Release
  with the notes and a tag from Tasker.
- Deployments: read the Deployments API and `deployment_status` webhooks to
  show per PR and per task which environments the change reached, with the
  environment URL ("Visit preview", "Open staging").
- Auto-fill a project custom field `Released in` with the tag or release name
  when a task's PR lands in a production deployment.
- Milestones as a mirror of Tasker lists or a `Release` custom field: create
  the GitHub milestone, keep PR milestones in sync.
- Hotfix flow: "Create hotfix task" from a failed production deployment with
  the failing run, commit range and suspected PRs pre-linked.

---

## 8. GitHub Issues, alerts and bots as sources of tasks

- Import GitHub Issues into a project as tasks (one-time or continuous), with
  a `githubIssueLinks` table. Two-way sync is optional per project: title,
  state (open/closed <-> not done/done), labels (mapped to project labels),
  comments mirrored read-only. Useful for repos with public issue trackers.
- Dependabot PRs: a "Dependencies" list where each Dependabot PR becomes a
  task automatically, grouped by ecosystem, with bulk approve-and-merge for
  green patch updates.
- Dependabot, code scanning and secret scanning alerts become tasks in a
  "Security" list with severity as priority, assigned by CODEOWNERS, closed
  when the alert is dismissed or fixed.
- Failed workflow on the default branch creates a task assigned to the
  commit author (mapped login) with the failure signature, deduplicated by
  signature so the same break does not open ten tasks.
- "Turn into follow-up task" on any PR review comment or log line, keeping a
  link back to the thread.

---

## 9. Tasker as a GitHub status check

PATs can create commit statuses and comments, so Tasker can act as a gate
without a GitHub App:

- Status `tasker/linked`: the PR references at least one Tasker task.
- Status `tasker/checklist`: all linked tasks' checklist items are complete.
- Status `tasker/acceptance`: a non-author project member marked the task as
  accepted in Tasker (product sign-off before merge).
- Teams can require these in branch protection. The status is posted by the
  automation identity (see "Identity decisions") and refreshed on task edits
  and PR synchronize events.
- PR comment from Tasker on open: "Linked to SHOP-142 (Checkout: fix tax
  rounding) - assigned to @login" so GitHub-side readers get the context too.

---

## 10. Repository setup in one click

When a repository is linked, offer "Set up this repository for Tasker". Tasker
opens a pull request (never writes to the default branch directly) that adds:

- `.github/pull_request_template.md` with a task key prompt and checklist.
- Labels used by the project (created via API, not in the PR).
- Optional workflow that posts job summaries in a format Tasker parses.
- CODEOWNERS skeleton from project members' logins if none exists.
- The webhook registration happens via API with the linker's token.

A settings panel shows setup health: webhook delivering, template present,
labels in sync, required statuses configured.

---

## 11. Agents and MCP

- Expose all PR and workflow reads and actions as MCP tools with the same
  scope model (`github:read`, `github:write`). The agent token's owner's GitHub
  token is used, so an agent never does anything its human could not.
- Agent loop made whole: `claim_task` -> `create_branch` -> push ->
  `open_pull_request` (auto-linked) -> `submit_task_for_review`; the human
  reviews the diff in Tasker and merges; webhooks close the task.
- "Ask an agent to review" on a PR page creates a review task with the PR
  linked; the agent's findings come back as a pending GitHub review the human
  submits or discards from Tasker.
- "Fix failing check" on a run creates an agent task with the failure
  signature, log excerpt and PR link.
- Webhook-driven agent triggers: label `agent` on a PR or task, or a review
  comment starting with `/agent`, enqueues work for a claimed agent.
- MCP tools for release notes, deployment approvals and workflow dispatch so
  release management can be delegated too.

---

## 12. Everything GitHub, rendered in Tasker

- Unfurl any github.com URL pasted into a task description, comment or note
  into a live card: PR, issue, commit, run, file permalink (with the code
  snippet), release, user. Rendered with the viewer's token, and linked to the
  Tasker page when one exists.
- Route `/gh/:owner/:repo/pull/:n` and friends resolve to the Tasker page for
  any linked repository, so a github.com URL can be rewritten by replacing the
  host. A bookmarklet or tiny browser extension can do that automatically.
- Global search includes PRs, branches and commits of linked repositories.
- Command palette: `merge`, `approve`, `re-run failed`, `copy branch`, `open
  PR for task`, `create branch`.
- @mentions in Tasker comments can target GitHub logins and post to the PR
  when the comment is on a linked PR thread.

---

## 13. Multiple repositories per project

Many teams run a frontend, an API and infrastructure as separate repos under
one product. Turn `githubRepositoryLinks` into one-to-many, prefix PR numbers
with the repo name where ambiguous (`api#142`), make releases span repos
(workflow groups already can), and let a task link PRs across repos. Cross-repo
cycle time then shows the true lead time of a feature.

---

## 14. Token and connection experience

- Setup wizard: explains fine-grained vs classic, lists the exact permissions
  Tasker needs for each feature (contents, pull requests, actions, workflows,
  webhooks, deployments, statuses, metadata; `notifications` only on classic),
  deep-links to the GitHub token pages, and verifies the token by probing each
  capability and showing a green/amber checklist.
- Capability-aware UI: features the token cannot do are shown disabled with
  the missing permission named, not hidden and not failing.
- Expiry: read the `github-authentication-token-expiration` header, store the
  date, warn in Settings and inbox 14 and 3 days before, one-click rotate.
- Rate limits: show remaining budget in Settings, use conditional requests and
  GraphQL batching, prefer webhooks over polling.
- Per-repo access check cached per user per session so chips and panels can
  decide quickly whether to render.
- Later: "Sign in with GitHub" OAuth as a second way to obtain a token with the
  same per-user storage.

---

## Identity decisions to make before phase 2

1. **Webhook data visibility.** Webhook payloads arrive with no caller. Proposal:
   store only ids, numbers, SHAs, logins, event types and timestamps. Show
   PR chips and timeline entries derived from webhook metadata only to users
   whose own token can access the repository (checked once per session); for
   everyone else show "linked pull request" with no details. This keeps
   principle 2 with a small, auditable exception for metadata.
2. **Writes to GitHub with no user present.** Status checks, bot comments and
   scheduled jobs need an acting identity. Proposal: a project writer opts in
   as the project's "automation identity"; their token is used only for the
   enumerated automation actions, every such action is labelled with their
   login and `via Tasker automation` in activity, and revoking the token or
   leaving the project disables the automations with an inbox warning to the
   project. The clean long-term answer is a GitHub App installation with a bot
   identity; design the automation layer so the identity provider can be
   swapped.
3. **Project key.** Required for branch and commit parsing. Decide the format
   (2 to 6 uppercase letters), uniqueness scope (workspace) and whether old
   `#123` references stay valid (yes, within the linked repo).
4. **Multi-repo.** Decide now whether `githubRepositoryLinks` goes one-to-many,
   because link tables, chips and releases all key on `repositoryId`.

---

## Suggested phasing

**Phase 2: Links and signals** (unlocks everything)
Project key; link tables; automatic and manual linking; Development panel; PR
chips on rows and cards; linked tasks on the PR page; create branch and PR from
task; webhook ingestion with live-version invalidation; default status
automation; PR events in task timeline; GitHub notifications in the inbox for
review requests, CI failures and merges.

**Phase 3: Review and daily flow**
Diff viewer and inline review; review-against-intent rail; My Work code
sections; command palette actions; URL unfurling; token wizard and expiry
warnings; MCP exposure of PR and workflow tools.

**Phase 4: Release and reliability**
What's-in-this-release and release notes; deployments and environments on
tasks and PRs; deployment approvals; failed-run and alert tasks; Dependabot
list; Tasker status checks; repository setup PR; cycle time and DORA-style
reporting.

**Phase 5: Breadth**
Multiple repositories; GitHub Issues sync; file browser, commits and blame;
secrets and variables; CODEOWNERS-aware reviewer suggestions; OAuth sign-in;
GitHub App identity for automations.

Each phase keeps the existing structure: network calls in `convex/github*.ts`
actions, pure display logic in `src/features/tasker/github/*` with tests,
schema additions limited to ids and metadata, and activity entries for every
write.
