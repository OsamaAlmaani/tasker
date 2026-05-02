# Notifications, Inbox, and Assignment Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-pass assignment notifications with an in-app inbox and async SMTP email delivery.

**Architecture:** Add a dedicated `notifications` backend domain rather than overloading `activities`. Assignment writes create durable inbox rows in Convex, then schedule an internal email action that sends best-effort SMTP mail and records delivery state back on the notification row. Frontend surfaces consume inbox queries through a bell dropdown and a dedicated `/inbox` page.

**Tech Stack:** TanStack Start, React 19, Convex, Clerk, Vitest, Nodemailer, Tailwind CSS

---

### Task 1: Spec and domain scaffolding

**Files:**
- Create: `convex/notifications.ts`
- Create: `convex/notificationsActions.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/constants.ts`
- Test: `src/features/tasker/notifications/notifications.test.ts`

- [ ] **Step 1: Write failing tests for notification helper behavior**

```ts
import { describe, expect, it } from "vitest";
import {
  buildAssignmentNotificationContent,
  shouldNotifyAssigneeChange,
} from "#/features/tasker/notifications/notifications";

describe("shouldNotifyAssigneeChange", () => {
  it("returns true for initial assignment", () => {
    expect(shouldNotifyAssigneeChange(undefined, "user_1")).toBe(true);
  });

  it("returns true for reassignment to a different user", () => {
    expect(shouldNotifyAssigneeChange("user_1", "user_2")).toBe(true);
  });

  it("returns false when assignee is unchanged", () => {
    expect(shouldNotifyAssigneeChange("user_1", "user_1")).toBe(false);
  });

  it("returns false when assignee is cleared", () => {
    expect(shouldNotifyAssigneeChange("user_1", null)).toBe(false);
  });
});

describe("buildAssignmentNotificationContent", () => {
  it("builds stable title, body, subject, and link", () => {
    expect(
      buildAssignmentNotificationContent({
        actorName: "Sara",
        appBaseUrl: "https://tasker.example.com",
        issueId: "issue_1",
        issueNumber: 123,
        issueTitle: "Finish report",
        projectKey: "OPS",
        projectName: "Operations",
      }),
    ).toMatchObject({
      title: "You were assigned OPS-123",
      link: "/issues/issue_1",
      emailSubject: "Assigned: OPS-123 Finish report",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: FAIL with module-not-found or missing export errors for notification helpers.

- [ ] **Step 3: Write minimal helper implementation and schema constants**

Add a focused pure helper module with:

```ts
export function shouldNotifyAssigneeChange(
  previousAssigneeId: string | null | undefined,
  nextAssigneeId: string | null | undefined,
) {
  return Boolean(nextAssigneeId && nextAssigneeId !== previousAssigneeId);
}
```

Also add notification table validators and types in Convex constants/schema.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/constants.ts convex/notifications.ts convex/notificationsActions.ts src/features/tasker/notifications/notifications.ts src/features/tasker/notifications/notifications.test.ts
git commit -m "feat: scaffold notifications domain"
```

### Task 2: Wire backend notification creation into issue assignment flows

**Files:**
- Modify: `convex/issues.ts`
- Modify: `convex/notifications.ts`
- Test: `src/features/tasker/notifications/notifications.test.ts`

- [ ] **Step 1: Write failing test for assignment-event rules**

Add tests proving these cases:

```ts
it("notifies when task is created with assignee", () => {
  expect(shouldNotifyAssigneeChange(undefined, "user_1")).toBe(true);
});

it("notifies when assignee changes to a different user", () => {
  expect(shouldNotifyAssigneeChange("user_1", "user_2")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails for missing integration helper if not present**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: FAIL until the new integration helper exists.

- [ ] **Step 3: Implement notification creation hook points**

In `convex/issues.ts`:

- after issue insert, call internal notification creator if `args.assigneeId` exists
- in `applyIssueUpdate`, after assignee patch logic, create notification only when `shouldNotifyAssigneeChange(issue.assigneeId, changes.assigneeId)` is true
- keep issue mutation success independent from email success

- [ ] **Step 4: Run targeted tests**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add convex/issues.ts convex/notifications.ts src/features/tasker/notifications/notifications.test.ts
git commit -m "feat: create notifications for issue assignment"
```

### Task 3: Implement async SMTP email delivery

**Files:**
- Modify: `convex/notifications.ts`
- Modify: `convex/notificationsActions.ts`
- Modify: `package.json`
- Test: `src/features/tasker/notifications/notifications.test.ts`

- [ ] **Step 1: Write failing tests for content formatting**

Add assertions for email body content:

```ts
it("includes actor, project, and task link in assignment content", () => {
  const content = buildAssignmentNotificationContent({
    actorName: "Sara",
    appBaseUrl: "https://tasker.example.com",
    issueId: "issue_1",
    issueNumber: 123,
    issueTitle: "Finish report",
    projectKey: "OPS",
    projectName: "Operations",
  });

  expect(content.emailText).toContain("Sara");
  expect(content.emailText).toContain("OPS-123");
  expect(content.emailText).toContain("https://tasker.example.com/issues/issue_1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: FAIL until email text/html builders exist.

- [ ] **Step 3: Implement SMTP delivery action**

- add `nodemailer`
- build transport from env
- `internalAction` loads notification + recipient
- send SMTP mail
- patch notification row with `sent` or `failed`
- no retry loop

- [ ] **Step 4: Run targeted tests**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml convex/notifications.ts convex/notificationsActions.ts src/features/tasker/notifications/notifications.ts src/features/tasker/notifications/notifications.test.ts
git commit -m "feat: send assignment notifications by email"
```

### Task 4: Add inbox route and app-shell surfaces

**Files:**
- Create: `src/routes/_app.inbox.tsx`
- Create: `src/features/tasker/notifications/components/NotificationInboxList.tsx`
- Modify: `src/features/tasker/layout/AppShell.tsx`
- Test: `src/features/tasker/notifications/notifications.test.ts`

- [ ] **Step 1: Write failing UI-focused helper test**

Add a pure test for unread badge formatting / ordering helper if needed so UI logic has coverage before implementation.

- [ ] **Step 2: Run targeted test**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: FAIL until helper exists.

- [ ] **Step 3: Implement inbox route and bell dropdown**

- query unread count + recent notifications in shell
- add bell button with badge
- add dropdown list with mark-read controls
- add `/inbox` route with list + mark all read

- [ ] **Step 4: Run targeted tests**

Run: `pnpm test src/features/tasker/notifications/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.inbox.tsx src/features/tasker/notifications/components/NotificationInboxList.tsx src/features/tasker/layout/AppShell.tsx src/features/tasker/notifications/notifications.test.ts
git commit -m "feat: add inbox and notification bell"
```

### Task 5: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `AGENT.md`

- [ ] **Step 1: Update docs**

Document SMTP env setup, inbox architecture, and roadmap progress.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: Run static checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Run production build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md ROADMAP.md AGENT.md
git commit -m "docs: document notifications rollout"
```

## Self-Review

- Spec coverage: backend notifications domain, assignment triggers, inbox UI, async email delivery, and docs all map to explicit tasks above.
- Placeholder scan: no `TBD` or deferred implementation markers remain in task steps.
- Type consistency: `issue_assigned`, `emailStatus`, and assignment helper naming are consistent across backend/frontend tasks.
