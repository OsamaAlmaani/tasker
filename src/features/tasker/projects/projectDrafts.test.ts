import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_STATUSES } from "#/features/tasker/projectStatuses";
import {
	applyParentIssueDraftDefaults,
	createIssueDraft,
	createIssueDraftWithOverrides,
	createProjectSettingsForm,
	getProjectInviteResultMessage,
} from "#/features/tasker/projects/projectDrafts";

describe("createIssueDraft", () => {
	it("returns the default blank task draft", () => {
		expect(createIssueDraft()).toEqual({
			title: "",
			description: "",
			listId: "",
			parentIssueId: "",
			status: "todo",
			priority: "none",
			assigneeId: "",
			dueDate: "",
			customFieldValues: {},
			labels: [],
		});
	});

	it("allows selected defaults to prefill the task draft", () => {
		expect(
			createIssueDraftWithOverrides({
				listId: "list-123",
			}),
		).toEqual({
			title: "",
			description: "",
			listId: "list-123",
			parentIssueId: "",
			status: "todo",
			priority: "none",
			assigneeId: "",
			dueDate: "",
			customFieldValues: {},
			labels: [],
		});
	});
});

describe("createProjectSettingsForm", () => {
	it("fills missing project values with defaults", () => {
		expect(createProjectSettingsForm()).toEqual({
			name: "",
			description: "",
			color: "#4f46e5",
			icon: "FolderKanban",
			customFields: [],
			labels: [],
			statuses: DEFAULT_PROJECT_STATUSES,
			allowMemberInvites: true,
			allowIssueDelete: true,
		});
	});

	it("maps existing project values into the settings form", () => {
		expect(
			createProjectSettingsForm({
				name: "Alpha",
				description: "Roadmap",
				color: "#123456",
				icon: "Rocket",
				labels: [
					{
						key: "frontend",
						name: "Frontend",
						color: "#06b6d4",
						position: 0,
					},
				],
				statuses: [
					{ key: "todo", name: "Queued", color: "#000000", position: 0 },
					{ key: "backlog", name: "Inbox", color: "#334155", position: 1 },
					{ key: "in_progress", name: "Doing", color: "#f97316", position: 2 },
					{ key: "in_review", name: "QA", color: "#c084fc", position: 3 },
					{ key: "done", name: "Shipped", color: "#ffffff", position: 4 },
				],
				allowMemberInvites: false,
				allowIssueDelete: false,
			}),
		).toEqual({
			name: "Alpha",
			description: "Roadmap",
			color: "#123456",
			icon: "Rocket",
			customFields: [],
			labels: [
				{
					key: "frontend",
					name: "Frontend",
					color: "#06b6d4",
					position: 0,
				},
			],
			statuses: [
				{ key: "todo", name: "Todo", color: "#3b82f6", position: 0 },
				{ key: "backlog", name: "Inbox", color: "#334155", position: 1 },
				{ key: "in_progress", name: "Doing", color: "#f97316", position: 2 },
				{ key: "in_review", name: "QA", color: "#c084fc", position: 3 },
				{ key: "done", name: "Done", color: "#10b981", position: 4 },
			],
			allowMemberInvites: false,
			allowIssueDelete: false,
		});
	});
});

describe("getProjectInviteResultMessage", () => {
	it("maps known invite outcomes to user-facing messages", () => {
		expect(getProjectInviteResultMessage("added_existing_user")).toBe(
			"User already exists and was added to the project.",
		);
		expect(getProjectInviteResultMessage("already_member")).toBe(
			"This user is already a project member.",
		);
		expect(getProjectInviteResultMessage("already_invited")).toBe(
			"A pending invite already exists for this email.",
		);
		expect(getProjectInviteResultMessage("sent")).toBe("Invitation sent.");
	});

	it("falls back for unrecognized outcomes", () => {
		expect(getProjectInviteResultMessage("something_else")).toBe(
			"Invite processed.",
		);
	});
});

describe("applyParentIssueDraftDefaults", () => {
	it("inherits the parent list and other blank/default values", () => {
		const next = applyParentIssueDraftDefaults(createIssueDraft(), "parent-1", {
			listId: "list-1",
			status: "in_progress",
			priority: "high",
			assigneeId: "user-1",
			dueDate: Date.UTC(2026, 2, 25, 9, 0, 0),
		});

		expect(next).toEqual({
			title: "",
			description: "",
			listId: "list-1",
			parentIssueId: "parent-1",
			status: "in_progress",
			priority: "high",
			assigneeId: "user-1",
			dueDate: "2026-03-25",
			customFieldValues: {},
			labels: [],
		});
	});

	it("overrides an explicit draft list when a parent is selected", () => {
		const next = applyParentIssueDraftDefaults(
			{
				...createIssueDraft(),
				listId: "list-custom",
			},
			"parent-1",
			{
				listId: "list-parent",
				status: "todo",
				priority: "none",
				assigneeId: null,
				dueDate: null,
			},
		);

		expect(next.listId).toBe("list-parent");
		expect(next.parentIssueId).toBe("parent-1");
	});

	it("preserves explicit draft values and handles removed parent selection", () => {
		const next = applyParentIssueDraftDefaults(
			{
				...createIssueDraft(),
				listId: "list-custom",
				status: "done",
				priority: "urgent",
				assigneeId: "user-custom",
				dueDate: "2026-04-01",
			},
			"",
			null,
		);

		expect(next).toEqual({
			title: "",
			description: "",
			listId: "list-custom",
			parentIssueId: "",
			status: "done",
			priority: "urgent",
			assigneeId: "user-custom",
			dueDate: "2026-04-01",
			customFieldValues: {},
			labels: [],
		});
	});
});
