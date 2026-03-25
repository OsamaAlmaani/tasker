import { z } from "zod";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "#/features/tasker/model";

const ISSUE_SORT_OPTIONS = [
	"updated_desc",
	"created_desc",
	"priority_desc",
	"due_asc",
] as const;
const ISSUE_GROUP_OPTIONS = ["list", "status"] as const;
const PROJECT_VIEW_OPTIONS = ["issues", "activity"] as const;
const ISSUE_LAYOUT_OPTIONS = ["list", "kanban"] as const;

export const projectSearchSchema = z.object({
	list: z.string().optional(),
	q: z.string().optional(),
	statuses: z.string().optional(),
	priority: z.enum(ISSUE_PRIORITIES).optional(),
	assignee: z.string().optional(),
	groupBy: z.enum(ISSUE_GROUP_OPTIONS).optional(),
	view: z.enum(PROJECT_VIEW_OPTIONS).optional(),
	sort: z.enum(ISSUE_SORT_OPTIONS).optional(),
	layout: z.enum(ISSUE_LAYOUT_OPTIONS).optional(),
});

export type ProjectSearch = z.infer<typeof projectSearchSchema>;

export function parseStatusFilters(
	raw?: string,
): (typeof ISSUE_STATUSES)[number][] {
	if (!raw) {
		return [];
	}

	const allowed = new Set<string>(ISSUE_STATUSES);
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter((value): value is (typeof ISSUE_STATUSES)[number] =>
			allowed.has(value),
		);
}

export function serializeStatusFilters(
	values: (typeof ISSUE_STATUSES)[number][],
): string | undefined {
	if (!values.length) {
		return undefined;
	}

	return [...new Set(values)].join(",");
}

export function normalizeProjectSearch(search: ProjectSearch): ProjectSearch {
	const next = { ...search };
	next.statuses = serializeStatusFilters(parseStatusFilters(next.statuses));

	next.q = next.q?.trim();
	if (!next.q) {
		delete next.q;
	}
	if (!next.statuses) {
		delete next.statuses;
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
