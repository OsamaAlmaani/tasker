import { describe, expect, it } from "vitest";
import {
	buildDescendantStats,
	findDoneAncestorIssue,
} from "#/features/tasker/issues/hierarchy";
import type { Doc, Id } from "#convex/_generated/dataModel";

type TestIssue = Pick<Doc<"issues">, "_id" | "parentIssueId" | "status">;

describe("buildDescendantStats", () => {
	it("counts unfinished descendants recursively", () => {
		const issues: TestIssue[] = [
			{ _id: "root" as Id<"issues">, status: "todo" },
			{
				_id: "child-a" as Id<"issues">,
				parentIssueId: "root" as Id<"issues">,
				status: "done",
			},
			{
				_id: "child-b" as Id<"issues">,
				parentIssueId: "root" as Id<"issues">,
				status: "in_progress",
			},
			{
				_id: "grandchild-a" as Id<"issues">,
				parentIssueId: "child-a" as Id<"issues">,
				status: "todo",
			},
			{
				_id: "grandchild-b" as Id<"issues">,
				parentIssueId: "child-b" as Id<"issues">,
				status: "done",
			},
		];

		const stats = buildDescendantStats(issues);

		expect(stats.get("root")).toEqual({ unfinishedDescendantCount: 2 });
		expect(stats.get("child-a")).toEqual({ unfinishedDescendantCount: 1 });
		expect(stats.get("child-b")).toEqual({ unfinishedDescendantCount: 0 });
		expect(stats.get("grandchild-a")).toEqual({ unfinishedDescendantCount: 0 });
	});

	it("returns zero unfinished descendants for leaf issues", () => {
		const stats = buildDescendantStats([
			{ _id: "solo" as Id<"issues">, status: "done" },
		]);

		expect(stats.get("solo")).toEqual({ unfinishedDescendantCount: 0 });
	});
});

describe("findDoneAncestorIssue", () => {
	it("returns the nearest done ancestor", () => {
		const root = { _id: "root" as Id<"issues">, status: "done" } as const;
		const child = {
			_id: "child" as Id<"issues">,
			parentIssueId: "root" as Id<"issues">,
			status: "todo",
		} as const;
		const grandchild = {
			_id: "grandchild" as Id<"issues">,
			parentIssueId: "child" as Id<"issues">,
			status: "in_progress",
		} as const;

		const issueById = new Map(
			[root, child, grandchild].map((issue) => [issue._id, issue]),
		);

		expect(findDoneAncestorIssue(grandchild, issueById)).toEqual(root);
	});

	it("returns null when no ancestor is done or a parent is missing", () => {
		const root = { _id: "root" as Id<"issues">, status: "todo" } as const;
		const child = {
			_id: "child" as Id<"issues">,
			parentIssueId: "root" as Id<"issues">,
			status: "in_progress",
		} as const;
		const orphan = {
			_id: "orphan" as Id<"issues">,
			parentIssueId: "missing" as Id<"issues">,
			status: "todo",
		} as const;

		const issueById = new Map([root, child].map((issue) => [issue._id, issue]));

		expect(findDoneAncestorIssue(child, issueById)).toBeNull();
		expect(findDoneAncestorIssue(orphan, issueById)).toBeNull();
	});
});
