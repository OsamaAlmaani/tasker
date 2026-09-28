import { describe, expect, it } from "vitest";
import {
	getTaskCalendarDateChanges,
	getTaskCalendarRange,
} from "./taskCalendarDates";

const startDate = Date.UTC(2026, 8, 28);
const dueDate = Date.UTC(2026, 9, 2);

describe("calendar date boundaries", () => {
	it.each([
		[{ startDate }, { start: "2026-09-28", end: "2026-09-29" }],
		[{ dueDate }, { start: "2026-10-02", end: "2026-10-03" }],
		[
			{ startDate, dueDate },
			{ start: "2026-09-28", end: "2026-10-03" },
		],
		[
			{ startDate, dueDate: startDate },
			{ start: "2026-09-28", end: "2026-09-29" },
		],
		[{}, null],
	])("maps %j to inclusive task dates with an exclusive calendar end", (task, expected) => {
		expect(getTaskCalendarRange(task)).toEqual(expected);
	});

	it("keeps UTC dates, including epoch zero and leap days", () => {
		expect(getTaskCalendarRange({ startDate: 0 })).toEqual({
			start: "1970-01-01",
			end: "1970-01-02",
		});
		expect(
			getTaskCalendarRange({
				startDate: Date.UTC(2028, 1, 28, 23),
				dueDate: Date.UTC(2028, 1, 29, 23),
			}),
		).toEqual({ start: "2028-02-28", end: "2028-03-01" });
	});

	it.each([
		[
			{ startDate },
			"2026-10-01",
			"2026-10-02",
			{ startDate: Date.UTC(2026, 9, 1) },
		],
		[
			{ dueDate },
			"2026-10-05",
			"2026-10-06",
			{ dueDate: Date.UTC(2026, 9, 5) },
		],
		[
			{ startDate, dueDate },
			"2026-10-01",
			"2026-10-06",
			{ startDate: Date.UTC(2026, 9, 1), dueDate: Date.UTC(2026, 9, 5) },
		],
	])("moving %j preserves its configured boundaries", (task, start, end, expected) => {
		expect(getTaskCalendarDateChanges(task, start, end)).toEqual(expected);
	});

	it.each([
		[
			{ startDate },
			"2026-09-26",
			"2026-09-29",
			{ startDate: Date.UTC(2026, 8, 26), dueDate: startDate },
		],
		[
			{ startDate },
			"2026-09-28",
			"2026-10-01",
			{ startDate, dueDate: Date.UTC(2026, 8, 30) },
		],
		[
			{ dueDate },
			"2026-09-30",
			"2026-10-03",
			{ startDate: Date.UTC(2026, 8, 30), dueDate },
		],
		[
			{ dueDate },
			"2026-10-02",
			"2026-10-05",
			{ startDate: dueDate, dueDate: Date.UTC(2026, 9, 4) },
		],
		[
			{ startDate, dueDate },
			"2026-09-26",
			"2026-10-03",
			{ startDate: Date.UTC(2026, 8, 26), dueDate },
		],
		[
			{ startDate, dueDate },
			"2026-09-28",
			"2026-10-05",
			{ startDate, dueDate: Date.UTC(2026, 9, 4) },
		],
	])("resizing %j updates its dragged edge and fills any missing boundary", (task, start, end, expected) => {
		expect(getTaskCalendarDateChanges(task, start, end, true)).toEqual(
			expected,
		);
	});
});
