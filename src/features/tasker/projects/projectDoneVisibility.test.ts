import { describe, expect, it } from "vitest";
import {
	filterDoneTasks,
	parseHideDoneTasksPreference,
} from "#/features/tasker/projects/projectDoneVisibility";

describe("parseHideDoneTasksPreference", () => {
	it("defaults to hiding done tasks when preference missing", () => {
		expect(parseHideDoneTasksPreference()).toBe(true);
		expect(parseHideDoneTasksPreference(null)).toBe(true);
	});

	it("reads explicit browser preference values", () => {
		expect(parseHideDoneTasksPreference("1")).toBe(true);
		expect(parseHideDoneTasksPreference("0")).toBe(false);
	});

	it("falls back to default hide behavior for invalid values", () => {
		expect(parseHideDoneTasksPreference("wat")).toBe(true);
	});
});

describe("filterDoneTasks", () => {
	it("hides done tasks in active view when toggle enabled", () => {
		expect(
			filterDoneTasks(
				[
					{ _id: "1", status: "todo" },
					{ _id: "2", status: "done" },
					{ _id: "3", status: "in_progress" },
				],
				{ archiveState: "active", hideDoneTasks: true },
			),
		).toEqual([
			{ _id: "1", status: "todo" },
			{ _id: "3", status: "in_progress" },
		]);
	});

	it("keeps done tasks visible when toggle disabled", () => {
		expect(
			filterDoneTasks(
				[
					{ _id: "1", status: "todo" },
					{ _id: "2", status: "done" },
				],
				{ archiveState: "active", hideDoneTasks: false },
			),
		).toEqual([
			{ _id: "1", status: "todo" },
			{ _id: "2", status: "done" },
		]);
	});

	it("does not hide done tasks in archived view", () => {
		expect(
			filterDoneTasks(
				[
					{ _id: "1", status: "done" },
					{ _id: "2", status: "todo" },
				],
				{ archiveState: "archived", hideDoneTasks: true },
			),
		).toEqual([
			{ _id: "1", status: "done" },
			{ _id: "2", status: "todo" },
		]);
	});
});
