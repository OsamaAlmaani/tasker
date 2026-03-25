import { describe, expect, it } from "vitest";
import {
	buildGroupedIssues,
	buildIssueTree,
	buildKanbanColumns,
	formatIssueInputDate,
} from "#/features/tasker/projects/issueGrouping";

type TestIssue = {
	_id: string;
	listId?: string | null;
	parentIssueId?: string | null;
	status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
	title: string;
};

const issues: TestIssue[] = [
	{
		_id: "parent-todo",
		listId: "list-b",
		parentIssueId: null,
		status: "todo",
		title: "Plan sprint",
	},
	{
		_id: "child-done",
		listId: "list-b",
		parentIssueId: "parent-todo",
		status: "done",
		title: "Write checklist",
	},
	{
		_id: "backlog-root",
		listId: null,
		parentIssueId: null,
		status: "backlog",
		title: "Inbox item",
	},
	{
		_id: "review-root",
		listId: "list-a",
		parentIssueId: null,
		status: "in_review",
		title: "Review copy",
	},
];

describe("formatIssueInputDate", () => {
	it("returns a yyyy-mm-dd date string for timestamps", () => {
		expect(formatIssueInputDate(Date.UTC(2026, 2, 25, 12, 0, 0))).toBe(
			"2026-03-25",
		);
	});

	it("returns an empty string for missing timestamps", () => {
		expect(formatIssueInputDate()).toBe("");
	});
});

describe("buildIssueTree", () => {
	it("nests children under their parent and keeps roots at the top level", () => {
		const tree = buildIssueTree(issues);

		expect(tree.map((node) => node.issue._id)).toEqual([
			"parent-todo",
			"backlog-root",
			"review-root",
		]);
		expect(tree[0]?.children.map((node) => node.issue._id)).toEqual([
			"child-done",
		]);
	});
});

describe("buildGroupedIssues", () => {
	it("groups by status using workflow order", () => {
		const groups = buildGroupedIssues(issues, "status", new Map(), [
			{ key: "todo", name: "Ready", color: "#000000", position: 0 },
			{ key: "in_review", name: "Review", color: "#8b5cf6", position: 1 },
			{ key: "backlog", name: "Inbox", color: "#64748b", position: 2 },
			{ key: "in_progress", name: "Doing", color: "#f59e0b", position: 3 },
			{ key: "done", name: "Shipped", color: "#ffffff", position: 4 },
		]);

		expect(groups.map((group) => group.key)).toEqual([
			"todo",
			"in_review",
			"backlog",
			"done",
		]);
		expect(groups.map((group) => group.title)).toEqual([
			"Todo",
			"Review",
			"Inbox",
			"Done",
		]);
		expect(groups[1]?.tree.map((node) => node.issue._id)).toEqual([
			"review-root",
		]);
		expect(groups[3]?.tree.map((node) => node.issue._id)).toEqual([
			"child-done",
		]);
	});

	it("groups by list position and uses 'No List' fallback", () => {
		const groups = buildGroupedIssues(
			issues,
			"list",
			new Map([
				["list-a", { _id: "list-a", name: "Alpha", position: 0 }],
				["list-b", { _id: "list-b", name: "Beta", position: 1 }],
			]),
		);

		expect(
			groups.map((group) => ({ key: group.key, title: group.title })),
		).toEqual([
			{ key: "list-a", title: "Alpha" },
			{ key: "list-b", title: "Beta" },
			{ key: "none", title: "No List" },
		]);
	});
});

describe("buildKanbanColumns", () => {
	it("returns every workflow column with filtered items and trees", () => {
		const columns = buildKanbanColumns(issues, [
			{ key: "in_progress", name: "Building", color: "#f59e0b", position: 0 },
			{ key: "todo", name: "Planned", color: "#000000", position: 1 },
			{ key: "backlog", name: "Inbox", color: "#64748b", position: 2 },
			{ key: "in_review", name: "QA", color: "#8b5cf6", position: 3 },
			{ key: "done", name: "Released", color: "#ffffff", position: 4 },
		]);

		expect(columns.map((column) => column.status)).toEqual([
			"todo",
			"in_progress",
			"backlog",
			"in_review",
			"done",
		]);
		expect(columns.map((column) => column.title)).toEqual([
			"Todo",
			"Building",
			"Inbox",
			"QA",
			"Done",
		]);
		expect(columns.find((column) => column.status === "todo")?.items).toEqual([
			issues[0],
		]);
		expect(
			columns.find((column) => column.status === "done")?.tree[0]?.issue._id,
		).toBe("child-done");
	});
});
