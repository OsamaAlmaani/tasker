import { describe, expect, it } from "vitest";
import {
	canEditSheetField,
	getSheetFields,
	getSheetUpdate,
	getSheetValue,
	parseSheetValue,
	type SheetOptions,
} from "./taskSheet";
import type { ProjectIssueRow } from "./useProjectDetailPage";

const issue = {
	_id: "task",
	title: "Original",
	labels: [],
	customFieldValues: { points: 2, text: "Keep me" },
	dueDate: Date.UTC(2026, 9, 21),
} as unknown as ProjectIssueRow;
const options: SheetOptions = {
	statuses: [{ key: "todo", name: "To do", color: "#000000", position: 0 }],
	users: [{ _id: "user", name: "Person" }],
	lists: [],
	parents: [],
	labels: [{ key: "bug", name: "Bug, urgent", color: "#000000", position: 0 }],
	customFields: [
		{ key: "points", name: "Points", type: "number", position: 0 },
		{ key: "text", name: "Text", type: "text", position: 1 },
		{ key: "date", name: "Date", type: "date", position: 2 },
		{ key: "check", name: "Check", type: "checkbox", position: 3 },
		{
			key: "select",
			name: "Select",
			type: "select",
			position: 4,
			options: ["A", "B"],
		},
	],
};
const fields = getSheetFields(options);
const field = (key: string) => {
	const result = fields.find((f) => f.key === key);
	if (!result) throw new Error(key);
	return result;
};

describe("sheet edits", () => {
	it("uses typed values and preserves other custom fields when changing or clearing one", () => {
		expect(
			getSheetUpdate(issue, field("custom:points"), "2.5").customFieldValues,
		).toEqual({ points: 2.5, text: "Keep me" });
		expect(
			getSheetUpdate(issue, field("custom:points"), "").customFieldValues,
		).toEqual({ text: "Keep me" });
		expect(parseSheetValue(field("custom:check"), "No")).toBe(false);
		expect(parseSheetValue(field("custom:check"), "yes")).toBe(true);
		expect(parseSheetValue(field("custom:select"), "B")).toBe("B");
		expect(parseSheetValue(field("custom:text"), "=SUM(A1)")).toBe("=SUM(A1)");
	});
	it("rejects invalid numbers, dates, required titles, booleans and select options", () => {
		for (const [key, value] of [
			["custom:points", "Infinity"],
			["custom:points", "abc"],
			["custom:date", "2026-02-30"],
			["title", " "],
			["custom:check", "maybe"],
			["custom:select", "unknown"],
			["assigneeId", "stranger"],
		]) {
			expect(() => getSheetUpdate(issue, field(key), value)).toThrow();
		}
	});
	it("maps labels and assignees to IDs, including clearing values", () => {
		expect(() =>
			parseSheetValue(
				{
					...field("assigneeId"),
					options: [
						{ value: "one", label: "Alex" },
						{ value: "two", label: "Alex" },
					],
				},
				"Alex",
			),
		).toThrow("dropdown");
		expect(
			getSheetUpdate(issue, field("assigneeId"), "Person").assigneeId,
		).toBe("user");
		expect(
			getSheetUpdate(issue, field("assigneeId"), "").assigneeId,
		).toBeNull();
		expect(getSheetUpdate(issue, field("labels"), ["bug"]).labels).toEqual([
			"bug",
		]);
		expect(getSheetUpdate(issue, field("labels"), []).labels).toEqual([]);
	});
	it("preserves UTC dates and refuses reversed ranges", () => {
		expect(getSheetValue(issue, "dueDate")).toBe("2026-10-21");
		expect(
			getSheetUpdate(issue, field("startDate"), "2026-10-19").startDate,
		).toBe(Date.UTC(2026, 9, 19));
		expect(getSheetUpdate(issue, field("dueDate"), "").dueDate).toBeNull();
		expect(() =>
			getSheetUpdate(issue, field("startDate"), "2026-10-22"),
		).toThrow("Start date");
	});
	it("protects inherited lists, parent hierarchies and read-only columns", () => {
		expect(
			canEditSheetField({ ...issue, hasChildren: true }, "parentIssueId"),
		).toBe(false);
		expect(() =>
			getSheetUpdate(
				{ ...issue, parentIssueId: issue._id },
				field("listId"),
				"",
			),
		).toThrow("inherit");
		expect(() =>
			getSheetUpdate(issue, { key: "id", name: "ID", type: "text" }, "new"),
		).toThrow("read-only");
	});
});
