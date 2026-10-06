import { describe, expect, it } from "vitest";
import {
	isCalendarDate,
	matchesDateRange,
	matchesIssueFilters,
	validateDateFilters,
} from "#convex/lib/issueFilters";

describe("task filters", () => {
	it("distinguishes all assignees, unassigned, and a specific user", () => {
		expect(matchesIssueFilters({}, {})).toBe(true);
		expect(matchesIssueFilters({ assigneeId: "a" }, {})).toBe(true);
		expect(matchesIssueFilters({}, { assigneeId: null })).toBe(true);
		expect(matchesIssueFilters({ assigneeId: "a" }, { assigneeId: null })).toBe(
			false,
		);
		expect(matchesIssueFilters({}, { assigneeId: "a" })).toBe(false);
		expect(matchesIssueFilters({ assigneeId: "a" }, { assigneeId: "a" })).toBe(
			true,
		);
	});
	it("includes the entire UTC boundary day", () => {
		const from = "2026-10-01",
			to = "2026-10-06";
		expect(matchesDateRange(Date.parse(`${from}T00:00:00Z`), from, to)).toBe(
			true,
		);
		expect(matchesDateRange(Date.parse(`${to}T23:59:59.999Z`), from, to)).toBe(
			true,
		);
		expect(
			matchesDateRange(Date.parse("2026-09-30T23:59:59.999Z"), from, to),
		).toBe(false);
		expect(matchesDateRange(Date.parse("2026-10-07T00:00:00Z"), from, to)).toBe(
			false,
		);
	});
	it("supports open bounds and excludes missing dates only for active ranges", () => {
		expect(matchesDateRange(undefined)).toBe(true);
		expect(matchesDateRange(undefined, "2026-10-01")).toBe(false);
		expect(matchesDateRange(Date.parse("2026-10-06"), "2026-10-01")).toBe(true);
		expect(
			matchesDateRange(Date.parse("2026-10-06"), undefined, "2026-10-06"),
		).toBe(true);
		expect(matchesDateRange(0, "1970-01-01", "1970-01-01")).toBe(true);
	});
	it("requires both date ranges and assignee to match when combined", () => {
		const issue = {
			startDate: Date.parse("2026-10-01"),
			dueDate: Date.parse("2026-10-06"),
		};
		expect(
			matchesIssueFilters(issue, {
				assigneeId: null,
				startFrom: "2026-10-01",
				dueTo: "2026-10-06",
			}),
		).toBe(true);
		expect(
			matchesIssueFilters(issue, {
				startFrom: "2026-10-01",
				dueTo: "2026-10-05",
			}),
		).toBe(false);
		expect(
			matchesIssueFilters(issue, {
				startFrom: "2026-10-02",
				dueTo: "2026-10-06",
			}),
		).toBe(false);
	});
	it("rejects invalid calendar dates and reversed ranges", () => {
		expect(isCalendarDate("2026-02-30")).toBe(false);
		expect(isCalendarDate("2028-02-29")).toBe(true);
		expect(() => validateDateFilters({ dueFrom: "invalid" })).toThrow(
			"valid calendar dates",
		);
		expect(() =>
			validateDateFilters({ dueFrom: "2026-10-06", dueTo: "2026-10-01" }),
		).toThrow("cannot be after");
	});
});
