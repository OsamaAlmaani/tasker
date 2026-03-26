import { describe, expect, it } from "vitest";
import {
	normalizeProjectSearch,
	parseStatusFilters,
	projectSearchSchema,
	serializeStatusFilters,
} from "#/features/tasker/projects/projectSearch";

describe("projectSearchSchema", () => {
	it("accepts valid project search params", () => {
		const parsed = projectSearchSchema.parse({
			archive: "archived",
			groupBy: "status",
			layout: "kanban",
			priority: "high",
			sort: "due_asc",
			statuses: "todo,done",
			view: "activity",
		});

		expect(parsed).toEqual({
			archive: "archived",
			groupBy: "status",
			layout: "kanban",
			priority: "high",
			sort: "due_asc",
			statuses: "todo,done",
			view: "activity",
		});
	});
});

describe("parseStatusFilters", () => {
	it("keeps arbitrary non-empty status keys", () => {
		expect(parseStatusFilters("todo, invalid ,done, todo,blocked")).toEqual([
			"todo",
			"invalid",
			"done",
			"todo",
			"blocked",
		]);
	});

	it("returns an empty array for missing input", () => {
		expect(parseStatusFilters()).toEqual([]);
	});
});

describe("serializeStatusFilters", () => {
	it("deduplicates values while preserving first-seen order", () => {
		expect(serializeStatusFilters(["done", "todo", "done"])).toBe("done,todo");
	});

	it("returns undefined for an empty list", () => {
		expect(serializeStatusFilters([])).toBeUndefined();
	});
});

describe("normalizeProjectSearch", () => {
	it("trims query text, removes defaults, and normalizes statuses", () => {
		expect(
			normalizeProjectSearch({
				archive: "active",
				assignee: "",
				groupBy: "list",
				layout: "list",
				list: "all",
				q: "  sprint planning  ",
				sort: "updated_desc",
				statuses: "todo, done, invalid, todo",
				view: "issues",
			}),
		).toEqual({
			q: "sprint planning",
			statuses: "todo,done,invalid",
		});
	});

	it("keeps explicit non-default filters and view options", () => {
		expect(
			normalizeProjectSearch({
				archive: "archived",
				assignee: "user_123",
				groupBy: "status",
				layout: "kanban",
				list: "list_123",
				priority: "urgent",
				sort: "priority_desc",
				statuses: "in_progress,done",
				view: "activity",
			}),
		).toEqual({
			archive: "archived",
			assignee: "user_123",
			groupBy: "status",
			layout: "kanban",
			list: "list_123",
			priority: "urgent",
			sort: "priority_desc",
			statuses: "in_progress,done",
			view: "activity",
		});
	});
});
