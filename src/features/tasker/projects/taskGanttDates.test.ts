import { describe, expect, it } from "vitest";
import {
	ganttDate,
	ganttDateString,
	getTaskGanttDateChanges,
	getTaskGanttRange,
} from "./taskGanttDates";

describe("Gantt date bridge", () => {
	it.each([
		"1970-01-01",
		"2026-03-08",
		"2026-11-01",
		"2028-02-29",
	])("preserves %s as a local wall date", (date) => {
		const local = ganttDate(date);
		expect(ganttDateString(local)).toBe(date);
		expect(local.getHours()).toBe(0);
		const range = getTaskGanttRange({
			startDate: Date.parse(`${date}T00:00:00Z`),
		});
		if (!range) throw new Error("Expected scheduled range");
		expect(ganttDateString(range.start)).toBe(date);
		const next = new Date(local);
		next.setDate(next.getDate() + 1);
		expect(ganttDateString(range.end)).toBe(ganttDateString(next));
	});
	it("maps ranges to an exclusive end without losing inclusive due dates", () => {
		const task = {
			startDate: Date.UTC(2026, 9, 31),
			dueDate: Date.UTC(2026, 10, 2),
		};
		const range = getTaskGanttRange(task);
		if (!range) throw new Error("Expected scheduled range");
		expect(ganttDateString(range.end)).toBe("2026-11-03");
		expect(
			getTaskGanttDateChanges(task, range.start, range.end, false),
		).toEqual(task);
	});
	it.each([
		[
			{ startDate: Date.UTC(2026, 8, 20) },
			false,
			{ startDate: Date.UTC(2026, 8, 21) },
		],
		[
			{ dueDate: Date.UTC(2026, 8, 20) },
			false,
			{ dueDate: Date.UTC(2026, 8, 21) },
		],
		[
			{ startDate: Date.UTC(2026, 8, 20) },
			true,
			{ startDate: Date.UTC(2026, 8, 21), dueDate: Date.UTC(2026, 8, 23) },
		],
		[
			{ dueDate: Date.UTC(2026, 8, 20) },
			true,
			{ startDate: Date.UTC(2026, 8, 21), dueDate: Date.UTC(2026, 8, 23) },
		],
	])("preserves configured boundaries on moves and creates both on resizing", (task, resize, expected) => {
		const end = ganttDate(resize ? "2026-09-24" : "2026-09-22");
		expect(
			getTaskGanttDateChanges(task, ganttDate("2026-09-21"), end, resize),
		).toEqual(expected);
	});
});
