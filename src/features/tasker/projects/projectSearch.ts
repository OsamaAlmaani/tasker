import { z } from "zod";
import { ISSUE_PRIORITIES } from "#/features/tasker/model";
import { DATE_FILTER_KEYS, isCalendarDate } from "#convex/lib/issueFilters";

const ISSUE_SORT_OPTIONS = [
	"updated_desc",
	"created_desc",
	"priority_desc",
	"due_asc",
] as const;
const ISSUE_GROUP_OPTIONS = ["list", "status"] as const;
const PROJECT_VIEW_OPTIONS = ["issues", "activity"] as const;
const ISSUE_LAYOUT_OPTIONS = ["list", "kanban", "calendar", "gantt"] as const;
const ISSUE_ARCHIVE_OPTIONS = ["active", "archived"] as const;

const calendarDate = z
	.string()
	.refine(isCalendarDate, "Choose a valid date.")
	.optional();

export const projectSearchSchema = z
	.object({
		archive: z.enum(ISSUE_ARCHIVE_OPTIONS).optional(),
		list: z.string().optional(),
		q: z.string().optional(),
		statuses: z.string().optional(),
		priority: z.enum(ISSUE_PRIORITIES).optional(),
		assignee: z.string().optional(),
		startFrom: calendarDate,
		startTo: calendarDate,
		dueFrom: calendarDate,
		dueTo: calendarDate,
		groupBy: z.enum(ISSUE_GROUP_OPTIONS).optional(),
		view: z.enum(PROJECT_VIEW_OPTIONS).optional(),
		sort: z.enum(ISSUE_SORT_OPTIONS).optional(),
		layout: z.enum(ISSUE_LAYOUT_OPTIONS).optional(),
	})
	.refine(
		(filters) =>
			!filters.startFrom ||
			!filters.startTo ||
			filters.startFrom <= filters.startTo,
		{
			message: "Start-date From cannot be after To.",
			path: ["startTo"],
		},
	)
	.refine(
		(filters) =>
			!filters.dueFrom || !filters.dueTo || filters.dueFrom <= filters.dueTo,
		{
			message: "Due-date From cannot be after To.",
			path: ["dueTo"],
		},
	);

export type ProjectSearch = z.infer<typeof projectSearchSchema>;

export function parseStatusFilters(raw?: string): string[] {
	if (!raw) {
		return [];
	}

	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

export function serializeStatusFilters(values: string[]): string | undefined {
	if (!values.length) {
		return undefined;
	}

	return [...new Set(values)].join(",");
}

export function normalizeProjectSearch(search: ProjectSearch): ProjectSearch {
	const next = { ...search };
	next.statuses = serializeStatusFilters(parseStatusFilters(next.statuses));

	if (next.archive === "active" || !next.archive) {
		delete next.archive;
	}
	next.q = next.q?.trim();
	if (!next.q) {
		delete next.q;
	}
	if (!next.statuses) {
		delete next.statuses;
	}
	for (const key of DATE_FILTER_KEYS) {
		if (!next[key]) delete next[key];
	}
	if (!next.assignee) {
		delete next.assignee;
	}
	if (next.list === "all" || !next.list) {
		delete next.list;
	}
	if (next.groupBy === "list" || !next.groupBy) {
		delete next.groupBy;
	}
	if (next.view === "issues" || !next.view) {
		delete next.view;
	}
	if (next.sort === "updated_desc" || !next.sort) {
		delete next.sort;
	}
	if (next.layout === "list" || !next.layout) {
		delete next.layout;
	}

	return next;
}
