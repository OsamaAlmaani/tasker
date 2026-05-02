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
	it("builds stable title, body, subject, and links", () => {
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
			absoluteLink: "https://tasker.example.com/issues/issue_1",
			emailSubject: "Assigned: OPS-123 Finish report",
		});
	});

	it("includes actor, project, and task link in email text", () => {
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
		expect(content.emailText).toContain(
			"https://tasker.example.com/issues/issue_1",
		);
	});
});
