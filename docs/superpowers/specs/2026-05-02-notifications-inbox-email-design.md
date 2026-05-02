# Notifications, Inbox, and Assignment Email Design

**Date:** 2026-05-02

## Goal

Add first-pass user notifications with two delivery surfaces:

- in-app inbox
- assignment email via SendGrid SMTP

Phase 1 scope is intentionally small:

- create notifications when a task is assigned during task creation
- create notifications when a task assignee changes to a different non-null user
- show notifications in an inbox route and shell bell dropdown
- send assignment email asynchronously

Out of scope for this phase:

- replacing Clerk invite delivery
- `@mentions`
- due date reminders
- retries, digests, batching, quiet hours, watcher rules

## Product Rules

1. The recipient is the current assignee after the mutation completes.
2. No notification is created when the assignee remains unchanged.
3. No notification is created when the assignee is cleared.
4. Task creation with an initial assignee does create a notification.
5. Inbox notification creation is durable and must not depend on email success.
6. Email delivery is best-effort in phase 1 and must never fail the task mutation.
7. Invite emails remain managed by Clerk.

## Architecture

Notifications are a dedicated backend domain and do not reuse `activities`.

- `activities` remain project/audit timeline records
- `notifications` become per-user delivery records with unread state and email delivery state

Assignment writes in `convex/issues.ts` create a notification row and schedule an internal email action. The internal action sends SMTP mail using server-side environment variables and patches delivery status back onto the notification row.

## Data Model

Add `notifications` table with these fields:

- `recipientUserId`
- `actorUserId?`
- `projectId?`
- `issueId?`
- `type`
- `title`
- `body`
- `link`
- `metadata?`
- `readAt?`
- `emailStatus`
- `emailAttempts`
- `lastEmailAttemptAt?`
- `emailSentAt?`
- `lastEmailError?`
- `createdAt`
- `updatedAt`

Initial enum values:

- `type`: `issue_assigned`
- `emailStatus`: `pending`, `sent`, `failed`, `skipped`

Indexes:

- `by_recipientUserId_createdAt`
- `by_recipientUserId_readAt`
- `by_recipientUserId_emailStatus`
- `by_issueId`
- `by_projectId`

## Backend Responsibilities

### `convex/notifications.ts`

- user-facing queries for inbox list and unread count
- user-facing mutations for mark-read actions
- internal helper mutations for creating notifications and patching email status

### `convex/notificationsActions.ts`

- SMTP env validation
- internal action for delivering assignment email
- message formatting for text and HTML bodies

### `convex/issues.ts`

- task create path triggers notification when `assigneeId` is provided
- task update path triggers notification when assignee changes to a different non-null user
- bulk assign continues to work because it already routes through `applyIssueUpdate`

## Frontend Responsibilities

### App shell

- add bell button with unread badge
- add lightweight dropdown with recent notifications
- add nav link to `/inbox`

### Inbox route

- show recent notifications
- show unread/read state
- support mark read and mark all read
- link rows to task detail

## Email Delivery

Environment variables live only in Convex/server runtime:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME`

Transport choice:

- `nodemailer`
- SendGrid SMTP on `587` with STARTTLS (`SMTP_SECURE=false`)

Email subject shape:

- `Assigned: PROJ-123 Task title`

Email body includes:

- actor name
- project key/name
- task number/title
- direct task link

## Error Handling

- if SMTP env is missing, mark notification email status as `failed`
- if SMTP send throws, mark notification email status as `failed`
- notification row still remains visible in inbox
- no retries in phase 1

## Testing

Add unit coverage for pure notification helpers:

- assignment notification creation rules
- notification content builder
- SMTP env parsing fallback behavior where practical

Verification for implementation:

- `pnpm test`
- `pnpm check`
- `pnpm build`

## Docs / Roadmap

Update:

- `README.md` with SMTP env setup
- `ROADMAP.md` with notifications progress
- `AGENT.md` with new notifications architecture and env expectations
