import { describe, expect, it } from "vitest";
import { read, utils, write } from "xlsx";
import type { Id } from "#convex/_generated/dataModel";
import { buildTaskWorkbook } from "./taskExcel";
import type { SheetOptions } from "./taskSheet";

const options: SheetOptions = {
	statuses: [{ key: "todo", name: "To do", color: "#000000", position: 0 }],
	customFields: [
		{ key: "cost", name: "Cost", type: "number", position: 0 },
		{ key: "approved", name: "Approved", type: "checkbox", position: 1 },
	],
	labels: [{ key: "bug", name: "Bug fix", color: "#000000", position: 0 }],
	users: [{ _id: "user", name: "Alex" }],
	lists: [{ _id: "list", name: "Sprint" }],
	parents: [{ value: "parent", label: "DEMO-1 Parent" }],
};

describe("project task Excel export", () => {
	it("round-trips only the supplied rows, with readable labels, safe text and typed values", () => {
		const workbook = buildTaskWorkbook(
			[
				{
					issueNumber: 2,
					title: '=HYPERLINK("https://example.com")',
					description: "Arabic العربية\nSecond line",
					status: "todo",
					priority: "high",
					assigneeId: "user" as Id<"users">,
					listId: "list" as Id<"issueLists">,
					parentIssueId: "parent" as Id<"issues">,
					startDate: 0,
					dueDate: Date.UTC(2026, 9, 19),
					labels: ["bug"],
					customFieldValues: { cost: 0, approved: false },
				},
				{
					issueNumber: 3,
					title: "Unassigned",
					status: "todo",
					priority: "none",
					labels: [],
				},
			],
			{ key: "DEMO", name: "Demo project" },
			options,
		);
		const restored = read(write(workbook, { type: "array", bookType: "xlsx" }));
		const sheet = restored.Sheets.Tasks;
		const rows = utils.sheet_to_json(sheet);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			Task: "DEMO-2",
			Project: "Demo project",
			Status: "To do",
			Assignee: "Alex",
			List: "Sprint",
			"Parent task": "DEMO-1 Parent",
			Labels: "Bug fix",
			"Start date": "1970-01-01",
			"Due date": "2026-10-19",
			Cost: 0,
			Approved: false,
			Description: "Arabic العربية\nSecond line",
		});
		expect(rows[1]).toMatchObject({ Assignee: "", List: "", "Due date": "" });
		expect(sheet.C2.t).toBe("s");
		expect(sheet.C2.f).toBeUndefined();
		expect(sheet["!autofilter"]?.ref).toBe(sheet["!ref"]);
	});
	it("exports headers for an empty result", () => {
		const sheet = buildTaskWorkbook([], { key: "DEMO", name: "Demo" }, options)
			.Sheets.Tasks;
		expect(utils.sheet_to_json(sheet)).toEqual([]);
		expect(sheet.A1.v).toBe("Task");
	});
	it.each(
		[
			"a".repeat(32767),
			"a".repeat(32768),
			`${"a".repeat(32766)}😀${"b".repeat(65534)}`,
		].map((description) => ({ description, length: description.length })),
	)("preserves a $length-character description in writable continuation cells", ({
		description,
	}) => {
		const workbook = buildTaskWorkbook(
			[
				{
					title: "Long task",
					status: "todo",
					priority: "none",
					labels: [],
					description,
				},
				{
					title: "Short task",
					status: "todo",
					priority: "none",
					labels: [],
					description: "Short",
				},
			],
			{ key: "DEMO", name: "Demo" },
			options,
		);
		const restored = read(write(workbook, { type: "array", bookType: "xlsx" }));
		const rows = utils.sheet_to_json<Record<string, string>>(
			restored.Sheets.Tasks,
		);
		const parts = Object.entries(rows[0])
			.filter(([header]) => header.startsWith("Description"))
			.map(([, value]) => value);
		expect(parts.join("")).toBe(description);
		expect(
			parts.every(
				(part) => part.length <= 32767 && !/[\uD800-\uDBFF]$/.test(part),
			),
		).toBe(true);
		expect(rows[1].Description).toBe("Short");
	});
});
