import { describe, expect, it } from "vitest";
import {
	appendProjectLabel,
	getProjectLabelColor,
	getProjectLabelName,
	normalizeProjectLabels,
} from "#/features/tasker/projectLabels";

describe("normalizeProjectLabels", () => {
	it("deduplicates labels and normalizes colors", () => {
		expect(
			normalizeProjectLabels([
				{ key: "frontend", name: "Frontend", color: "#abc", position: 0 },
				{ key: "frontend", name: "Duplicate", color: "#000000", position: 1 },
				{ key: "backend", name: "Backend", color: "bad-color", position: 2 },
			]),
		).toEqual([
			{ key: "frontend", name: "Frontend", color: "#aabbcc", position: 0 },
			{ key: "backend", name: "Backend", color: "#f97316", position: 1 },
		]);
	});

	it("resolves label names and colors by key", () => {
		const labels = normalizeProjectLabels([
			{ key: "qa", name: "QA", color: "#8b5cf6", position: 0 },
		]);

		expect(getProjectLabelName(labels, "qa")).toBe("QA");
		expect(getProjectLabelColor(labels, "qa")).toBe("#8b5cf6");
	});
});

describe("appendProjectLabel", () => {
	it("creates a new project label with a generated key", () => {
		const labels = appendProjectLabel([], "Blocked");
		expect(labels[0]?.name).toBe("Blocked");
		expect(labels[0]?.key).toMatch(/^blocked_/);
		expect(labels[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
	});
});
