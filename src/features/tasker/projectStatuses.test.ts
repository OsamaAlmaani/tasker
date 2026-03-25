import { describe, expect, it } from "vitest";
import {
	appendProjectStatus,
	getProjectStatusColor,
	normalizeProjectStatuses,
} from "#/features/tasker/projectStatuses";

describe("normalizeProjectStatuses", () => {
	it("keeps fixed todo and done names and colors", () => {
		expect(
			normalizeProjectStatuses([
				{ key: "todo", name: "Queued", color: "#111111", position: 0 },
				{ key: "backlog", name: "Inbox", color: "#222222", position: 1 },
				{ key: "done", name: "Shipped", color: "#333333", position: 2 },
			]),
		).toEqual([
			{ key: "todo", name: "Todo", color: "#3b82f6", position: 0 },
			{ key: "backlog", name: "Inbox", color: "#222222", position: 1 },
			{ key: "done", name: "Done", color: "#10b981", position: 2 },
		]);
	});

	it("normalizes custom colors and falls back when they are invalid", () => {
		const statuses = normalizeProjectStatuses([
			{ key: "todo", name: "Todo", color: "#3b82f6", position: 0 },
			{ key: "blocked", name: "Blocked", color: "#abc", position: 1 },
			{ key: "waiting", name: "Waiting", color: "bad-color", position: 2 },
			{ key: "done", name: "Done", color: "#10b981", position: 3 },
		]);

		expect(getProjectStatusColor(statuses, "blocked")).toBe("#aabbcc");
		expect(getProjectStatusColor(statuses, "waiting")).toBe("#8b5cf6");
	});
});

describe("appendProjectStatus", () => {
	it("gives newly added statuses a default color", () => {
		const statuses = appendProjectStatus(
			normalizeProjectStatuses([
				{ key: "todo", name: "Todo", color: "#3b82f6", position: 0 },
				{ key: "done", name: "Done", color: "#10b981", position: 1 },
			]),
			"Blocked",
		);

		const blocked = statuses.find((status) => status.name === "Blocked");
		expect(blocked?.color).toBeTruthy();
		expect(blocked?.color).toMatch(/^#[0-9a-f]{6}$/);
	});
});
