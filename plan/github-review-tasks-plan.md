# GitHub Review Tasks

Turn pull request review conversations into Tasker tasks, keep both sides in
sync, and show the tasks where reviews happen. Covers the "Turn into follow-up
task" idea from [`github-integration-vision.md`](./github-integration-vision.md).
Started 2026-11-10. Check items off as they ship and keep `AGENT.md` and
`ROADMAP.md` in step.

## Decisions (made 2026-11-10)

- **Where comments are written:** on GitHub (github.com or Tasker's pull
  request page). Tasker pulls review threads in; it never keeps a second copy
  of the discussion. The thread is the conversation, the task tracks the work.
  Writing line comments from Tasker ("comment + track") waits for the diff
  viewer.
- **Granularity:** one task per review thread. Each thread needs its own
  status, assignee and link back.
- **Shape:** when the pull request is linked to a top-level task that is not
  done, review tasks become its sub-tasks so the feature task rolls up review
  progress. Otherwise they are standalone tasks. The person tracking can pick
  another parent or none.
- **Two kinds:**
  - `fix` ("Fix before merge"): task and thread stay in sync. Thread resolved
    -> task done; thread unresolved -> task back to the status it had; task
    done -> thread resolved on GitHub.
  - `follow_up` ("Follow up later"): a standalone piece of work. Tasker replies
    "Tracked in KEY-130" on the thread and resolves it, so the pull request is
    not blocked. The task's status is independent of the thread afterwards.
- **Assignee:** the pull request author when their GitHub login maps to a
  Tasker user who can be assigned in the project; otherwise unassigned. The
  dialog can turn this off.
- **Who acts:** creating tasks and resolving threads from Tasker use the
  signed-in user's own token. Status changes caused by GitHub (webhook or page
  load) act as the mapped GitHub user who resolved the thread, else the
  project's automation identity, else the person who linked the repository,
  the same rule status automation uses.
- **Text copied into tasks:** title and description come from the first
  comment of the thread. This is an explicit action by someone who can read
  the repository, so the text is visible to every project member like any
  other task text. Nothing is copied automatically.
- **Settings:** two per-project toggles on the GitHub tab, both on by default:
  "Complete review tasks when their conversation is resolved" and "Resolve the
  conversation when its review task is done".

## Architecture

- `convex/schema.ts`: `githubReviewThreadLinks` (projectId, repositoryId,
  pullNumber, issueId, threadId, rootCommentId?, kind, path, line?,
  authorLogin?, isResolved, isOutdated, statusBeforeResolve?, createdBy,
  createdAt, updatedAt). `githubRepositoryLinks` gains `reviewTaskSettings`
  and `webhook.events`.
- `convex/lib/githubReviewTasks.ts`: pure helpers: task title, description
  document, follow-up reply text, settings defaults, thread GraphQL query and
  normaliser.
- `convex/githubReviewTasks.ts`: queries (`listForPullRequest`, `listForIssue`),
  `unlink`, internal mutations for creating tasks and links, applying thread
  state (shared by the webhook and page-load reconcile), and recording
  GitHub write results.
- `convex/githubReviewTaskActions.ts`: `trackThreads` (load threads with the
  caller's token, create tasks, reply/resolve for follow-ups) and the internal
  `syncThreadResolution` action scheduled when a task's done state changes.
- `convex/issues.ts`: `applyIssueUpdate` schedules thread resolution for `fix`
  links when a task (or its cascaded sub-tasks) enters or leaves done.
- Webhook: `pull_request_review_thread` events (`resolved`, `unresolved`)
  normalised in `lib/githubAutomation.ts` and handled in `githubWebhooks.ts`.
  Existing hooks get an "Update events" button on the GitHub tab.
- `githubActions.getPullRequest` reconciles stored thread state after every
  load, so tasks follow GitHub even if a webhook delivery was missed or no
  webhook is set up.
- Frontend: thread chips and "Track as task" in `PullRequestConversation`,
  review task progress and bulk tracking in the Conversations card,
  `TrackThreadsDialog`, merge box warning, a "Review feedback" block in the
  task's Development panel, `?thread=` deep links to a conversation.

## Phase 1 (this change)

- [x] Schema, settings defaults and validators.
- [x] Pure helpers with tests (title, description, reply text, settings).
- [x] `trackThreads` action: one or many threads, kind, parent, assign to
      author; idempotent per thread; follow-ups reply and resolve on GitHub.
- [x] Queries for the PR page and the task page; unlink.
- [x] Thread resolved/unresolved -> task status (webhook and page-load
      reconcile), with activity entries and skipped transitions recorded.
- [x] Task done/undone -> thread resolved/unresolved on GitHub with the acting
      user's token; failures recorded in the activity.
- [x] Webhook subscribes to `pull_request_review_thread`; update button for
      existing hooks.
- [x] PR page: chips and "Track as task" on threads, progress and "Track
      untracked" in the Conversations card, merge warning for open review
      tasks, `?thread=` deep link.
- [x] Task page: "Review feedback" in the Development panel.
- [x] Settings toggles on the GitHub tab.
- [x] Docs: `AGENT.md`, `ROADMAP.md`.

## Phase 2 (implemented 2026-11-10)

Decisions:

- **Replies are not copied.** The `pull_request_review_comment` webhook only
  records that someone replied (count, last login, time) and writes a
  `replied` activity. The text is read live with the viewer's own token, in
  line with the rule that webhook-sourced GitHub content is never shown to
  people whose token cannot read the repository.
- **Who hears about replies:** the task's assignee, for open `fix`
  conversations, unless they wrote the reply. Follow-ups only log activity.
- **Reviews is its own tab** next to Pull requests rather than a card on the
  GitHub settings tab, because it is a working list.
- The "untracked only" filter became **Hide tracked**, next to Hide resolved
  and Hide bots.

- [x] `pull_request_review_comment` webhook: reply count, `replied` activity,
      `github_review_reply` inbox and email for the assignee, live page refresh.
      Hooks get the new event through "Update webhook events".
- [x] Task page: the Review feedback block loads each conversation live
      (`getIssueReviewThreads`), shows replies, and can reply or resolve.
- [x] "Also reply on GitHub" in the task comment form, with a picker when the
      task has several conversations.
- [x] Reviews tab (`/projects/$projectId/reviews`): unresolved conversations on
      the 25 most recently updated open pull requests, "Started by me" or
      "Everyone", per-PR selection and tracking.
- [x] "Hide tracked" conversation filter on pull request pages.
- [x] `get_task` returns `reviewFeedback` for MCP agents; tool description and
      `docs/agent-workspace.md` explain the flow.

## Reviews inbox (started 2026-11-10)

The first Reviews tab was a read-only list. It becomes a triage inbox: pick a
conversation, read it with its code and replies, and act without leaving the
page.

Decisions:

- **Views (who):** Feedback I gave (conversations I started), Feedback I
  received (conversations on my pull requests started by others), Everyone,
  and Review requests (open pull requests waiting on my review).
- **States (what next), computed per conversation from who spoke last:**
  - Needs attention: my turn. As the reviewer: someone replied after me, or
    the code changed under the comment (outdated, probably fixed). As the PR
    author: the last word is not mine.
  - Waiting: their turn, or a conversation I am not part of.
  - Resolved: resolved conversations on the open pull requests checked.
  "Quiet" (no activity for 3 days) is a badge, not a state.
- **Loading:** the light pull request listing (now with review requests and
  review decision), then first and last comment of every conversation in
  parallel batches of 15 (measured 2026-11-10 on a 25-PR, 185-conversation
  repository: about 1.5 s plus 1 s, every request under 1.1 s). The selected
  conversation loads in full (rendered HTML, code, replies) on demand.
- **Unseen replies:** per user and project, a baseline time (first visit or
  "Mark all seen") plus per-conversation seen times. A conversation is new
  when its last comment is someone else's and newer than both.
- **Tab count:** the attention count plus review requests is computed by the
  page and stored per user, so the Reviews tab and the project page can show
  it without calling GitHub. It refreshes whenever Reviews loads.
- **Bulk actions across pull requests:** track as fix or follow-up (parent is
  each pull request's own open task, assignee its author), resolve, reply.
- **Severity:** bot labels like Critical, Major, Minor and Nitpick (and a
  leading "nit:") set task priority (urgent, high, medium, low) when tracking,
  on by default and switchable in the dialog.
- **Reply snippets:** saved per user, with sensible defaults until edited.
- **Keyboard:** `j`/`k` move, `x` select, `t` track as fix, `f` follow-up,
  `r` reply, `e` resolve or reopen, `o` open in the pull request, `?` help.
- **Mobile:** the list only; the selected conversation opens under its row.

- [x] Inbox listing action with first and last comment per conversation.
- [x] Classification, filters, grouping and unseen logic (pure, tested).
- [x] Detail pane: full conversation, code, reply with snippets, resolve,
      track, open in pull request; marks the conversation seen.
- [x] Views, state tabs with counts, filters (search, reviewer, PR author,
      hide bots, untracked, outdated, new replies).
- [x] Review requests view.
- [x] Bulk bar: track as fix or follow-up, resolve, reply.
- [x] Keyboard shortcuts and help.
- [x] Reply snippets, unseen markers, "Mark all seen", tab counts.
- [x] Severity to priority when tracking.
- [x] Per pull request header: author, review decision, oldest open
      conversation, review task progress.

## Phase 3 (later)

- [ ] Optional auto-tracking rule (for example every thread of a "changes
      requested" review by a project member, bots excluded).
- [ ] "Comment + track" from Tasker's own diff viewer once it exists.
- [ ] Tasker status check on GitHub: "N review tasks open".

## Known limits

- Threads are loaded through GitHub's `nodes(ids:)` lookup, up to 50 per
  request.
- A sub-task cannot reopen while its parent is done; an unresolve on GitHub
  then records a skipped transition instead of moving the task.
- Manual webhooks must have "Pull request review threads" ticked by hand.
- Manual webhooks also need "Pull request review comments" ticked by hand for
  reply notifications.
- The Reviews tab checks the 25 most recently updated open pull requests and
  the first 100 conversations of each.
- Replies are counted from webhook deliveries only; edited and deleted replies
  do not change the count.
