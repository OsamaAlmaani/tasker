import { describe, expect, it } from "vitest";
import {
	appendProjectCustomField,
	buildIssueCustomFieldSubmission,
	normalizeIssueCustomFieldDraftValues,
	normalizeProjectCustomFields,
} from "#/features/tasker/projectCustomFields";

describe("normalizeProjectCustomFields", () => {
	it("deduplicates by key/name and normalizes select options", () => {
		expect(
			normalizeProjectCustomFields([
				{
					key: "severity",
					name: "Severity",
					type: "select",
					position: 2,
					options: ["High", "Low", "High", "  "],
				},
				{
					key: "severity",
					name: "Duplicate",
					type: "text",
					position: 0,
				},
			]),
		).toEqual([
			{
				key: "severity",
				name: "Severity",
				type: "select",
				position: 0,
				options: ["High", "Low"],
			},
		]);
	});
});

describe("appendProjectCustomField", () => {
	it("creates a usable select field with starter options", () => {
		const fields = appendProjectCustomField([], "select", "Severity");
		expect(fields[0]).toMatchObject({
			name: "Severity",
			type: "select",
			options: ["Option 1", "Option 2"],
		});
		expect(fields[0]?.key).toMatch(/^severity_/);
	});
});

describe("custom field value helpers", () => {
	it("normalizes draft values and converts numeric submissions", () => {
		const fields = normalizeProjectCustomFields([
			{
				key: "estimate",
				name: "Estimate",
				type: "number",
				position: 0,
			},
			{
				key: "blocked",
				name: "Blocked",
				type: "checkbox",
				position: 1,
			},
		]);

		expect(
			normalizeIssueCustomFieldDraftValues(fields, {
				estimate: 5,
				blocked: true,
			}),
		).toEqual({
			estimate: "5",
			blocked: true,
		});

		expect(
			buildIssueCustomFieldSubmission(fields, {
				estimate: "8",
				blocked: false,
			}),
		).toEqual({
			estimate: 8,
			blocked: false,
		});
	});
});
