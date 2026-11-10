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
