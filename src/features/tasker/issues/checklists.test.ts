import { describe, expect, it } from "vitest";
import {
	formatChecklistProgress,
	getIssueChecklistProgress,
	normalizeIssueChecklistItems,
	roundChecklistCompletionRate,
} from "#/features/tasker/issues/checklists";

describe("normalizeIssueChecklistItems", () => {
	it("sorts, trims, deduplicates, and reindexes checklist items", () => {
		expect(
			normalizeIssueChecklistItems([
				{ id: "b", text: " Second ", completed: true, position: 2 },
				{ id: "a", text: " First ", completed: false, position: 0 },
				{ id: "a", text: "Duplicate", completed: false, position: 1 },
				{ id: "c", text: "   ", completed: false, position: 3 },
			]),
		).toEqual([
			{ id: "a", text: "First", completed: false, position: 0 },
			{ id: "b", text: "Second", completed: true, position: 1 },
		]);
	});
});

describe("getIssueChecklistProgress", () => {
	it("derives checklist progress from items when counts are not present", () => {
		const progress = getIssueChecklistProgress({
			checklistItems: [
				{ id: "a", text: "One", completed: true, position: 0 },
				{ id: "b", text: "Two", completed: false, position: 1 },
				{ id: "c", text: "Three", completed: true, position: 2 },
			],
		});

		expect(progress).toEqual({
			checklistItemCount: 3,
			completedChecklistItemCount: 2,
			checklistCompletionRate: 2 / 3,
			hasChecklist: true,
		});
	});

	it("formats checklist progress labels and percentages", () => {
		const issue = {
			checklistItems: [
				{ id: "a", text: "One", completed: true, position: 0 },
				{ id: "b", text: "Two", completed: false, position: 1 },
			],
		};

		expect(formatChecklistProgress(issue)).toBe("1/2 checked");
		expect(roundChecklistCompletionRate(issue)).toBe(50);
	});
});
