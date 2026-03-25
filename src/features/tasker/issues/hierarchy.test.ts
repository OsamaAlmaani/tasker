import { describe, expect, it } from "vitest";
import {
	buildDescendantStats,
	findDoneAncestorIssue,
} from "#/features/tasker/issues/hierarchy";

type TestIssue = {
	_id: string;
	parentIssueId?: string | null;
	status: "todo" | "in_progress" | "done";
};

describe("buildDescendantStats", () => {
	it("counts unfinished descendants recursively", () => {
		const issues: TestIssue[] = [
			{ _id: "root", parentIssueId: null, status: "todo" },
			{ _id: "child-a", parentIssueId: "root", status: "done" },
			{ _id: "child-b", parentIssueId: "root", status: "in_progress" },
			{ _id: "grandchild-a", parentIssueId: "child-a", status: "todo" },
			{ _id: "grandchild-b", parentIssueId: "child-b", status: "done" },
		];

		const stats = buildDescendantStats(issues);

		expect(stats.get("root")).toEqual({ unfinishedDescendantCount: 2 });
		expect(stats.get("child-a")).toEqual({ unfinishedDescendantCount: 1 });
		expect(stats.get("child-b")).toEqual({ unfinishedDescendantCount: 0 });
		expect(stats.get("grandchild-a")).toEqual({ unfinishedDescendantCount: 0 });
	});

	it("returns zero unfinished descendants for leaf issues", () => {
		const stats = buildDescendantStats([
			{ _id: "solo", parentIssueId: null, status: "done" },
		]);

		expect(stats.get("solo")).toEqual({ unfinishedDescendantCount: 0 });
	});
});

describe("findDoneAncestorIssue", () => {
	it("returns the nearest done ancestor", () => {
		const root = { _id: "root", parentIssueId: null, status: "done" } as const;
		const child = {
			_id: "child",
			parentIssueId: "root",
			status: "todo",
		} as const;
		const grandchild = {
			_id: "grandchild",
			parentIssueId: "child",
			status: "in_progress",
		} as const;

		const issueById = new Map(
			[root, child, grandchild].map((issue) => [issue._id, issue]),
		);

		expect(findDoneAncestorIssue(grandchild, issueById)).toEqual(root);
	});

	it("returns null when no ancestor is done or a parent is missing", () => {
		const root = { _id: "root", parentIssueId: null, status: "todo" } as const;
		const child = {
			_id: "child",
			parentIssueId: "root",
			status: "in_progress",
		} as const;
		const orphan = {
			_id: "orphan",
			parentIssueId: "missing",
			status: "todo",
		} as const;

		const issueById = new Map([root, child].map((issue) => [issue._id, issue]));

		expect(findDoneAncestorIssue(child, issueById)).toBeNull();
		expect(findDoneAncestorIssue(orphan, issueById)).toBeNull();
	});
});
