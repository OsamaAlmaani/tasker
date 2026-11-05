# GitHub Integration Plan

Goal: give every project a GitHub section that links one repository, and let
each member work with that repository's pull requests from Tasker using their
own GitHub personal access token.

## Scope

Phase 1 (this change):

- [x] Personal GitHub connection per Tasker account: each user saves their own
      personal access token (Settings or any project's GitHub tab) and it is
      used only for that user's requests, in every project.
- [x] Link or unlink one repository per project.
- [x] Pull requests page: list open, closed, merged or all PRs with draft state,
      CI checks, review decision, merge conflicts, labels, reviewers and size.
- [x] Pull request detail: description, checks, changed files, conversation
      (comments and reviews), add comment, review (approve, request changes,
      comment), merge (merge, squash, rebase, optional branch deletion),
      update branch, mark ready for review, close and reopen.
- [x] Project activity entries for repository changes, merges, closes and
      reopens.

Later phases:

- [x] Link PRs to Tasker tasks (branch/title key detection, e.g. `ABC-12`) and
      show PR status on task details. See `github-phase2-links-and-signals-plan.md`.
- [x] Webhooks for live PR updates and automation (move task to `in_review`
      when a PR opens, to `done` when it merges).
- [ ] Inline diff viewer and review comments on lines.
- [ ] Optional "Sign in with GitHub" (OAuth) as another way to get a personal
      token.
- [ ] Expose PR reads and actions through the Tasker MCP workspace.

## Design

- No shared credentials: `githubConnections` holds one encrypted token per
  Tasker user. Actions load only the caller's own row, so every read and write
  runs as the caller's GitHub account and shows only what their token can
  access. Removing a token affects only that user.
- `githubRepositoryLinks` stores which repository a project tracks. It holds no
  credentials and no GitHub data.
- Live data: PR lists and details are fetched from GitHub on demand through
  Convex actions with the caller's token. Nothing about PRs is stored or cached
  in Convex, so users never see data fetched with someone else's token.
- Tokens are encrypted with AES-GCM using `GITHUB_TOKEN_ENCRYPTION_KEY` and are
  never returned to the client.
- Permissions: Tasker project viewers can read; project writers (admin or
  member) can link repositories and act on PRs. GitHub enforces each user's own
  repository permissions on top of that.
- Merges send the head SHA the user saw, so GitHub rejects a merge if new
  commits were pushed in the meantime.
