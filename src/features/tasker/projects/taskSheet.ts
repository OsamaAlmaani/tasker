import type { FunctionArgs } from "convex/server";
import { ISSUE_PRIORITIES } from "#/features/tasker/model";
import type { ProjectCustomFieldDefinition } from "#/features/tasker/projectCustomFields";
import type { ProjectLabelDefinition } from "#/features/tasker/projectLabels";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";
import type { ProjectIssueRow } from "#/features/tasker/projects/useProjectDetailPage";
import type { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";
import { isCalendarDate } from "#convex/lib/issueFilters";
import { calendarDate, calendarTimestamp } from "./taskCalendarDates";

export type SheetValue = string | number | boolean | string[];
export type SheetField = {
	key: string;
	name: string;
	type: ProjectCustomFieldDefinition["type"] | "labels";
	options?: { value: string; label: string }[];
	required?: boolean;
};
export type SheetOptions = {
	statuses: ProjectStatusDefinition[];
	customFields: ProjectCustomFieldDefinition[];
	labels: ProjectLabelDefinition[];
	users: { _id: string; name: string }[];
	lists: { _id: string; name: string }[];
	parents: { value: string; label: string }[];
};
export type SheetUpdate = FunctionArgs<typeof api.issues.update>;

export function getSheetFields(options: SheetOptions): SheetField[] {
	return [
		{ key: "title", name: "Title", type: "text", required: true },
		{
			key: "status",
			name: "Status",
			type: "select",
			required: true,
			options: options.statuses.map((s) => ({ value: s.key, label: s.name })),
		},
		{
			key: "priority",
			name: "Priority",
			type: "select",
			required: true,
			options: ISSUE_PRIORITIES.map((p) => ({ value: p, label: p })),
		},
		{
			key: "assigneeId",
			name: "Assignee",
			type: "select",
			options: options.users.map((u) => ({ value: u._id, label: u.name })),
		},
		{
			key: "listId",
			name: "List",
			type: "select",
			options: options.lists.map((l) => ({ value: l._id, label: l.name })),
		},
		{
			key: "parentIssueId",
			name: "Parent task",
			type: "select",
			options: options.parents,
		},
		{ key: "startDate", name: "Start date", type: "date" },
		{ key: "dueDate", name: "Due date", type: "date" },
		{
			key: "labels",
			name: "Labels",
			type: "labels",
			options: options.labels.map((l) => ({ value: l.key, label: l.name })),
		},
		...options.customFields.map(
			(field): SheetField => ({
				...field,
				key: `custom:${field.key}`,
				options: field.options?.map((value) => ({ value, label: value })),
			}),
		),
	];
}

export function getSheetValue(
	issue: Pick<
		Doc<"issues">,
		| "title"
		| "status"
		| "priority"
		| "assigneeId"
		| "listId"
		| "parentIssueId"
		| "startDate"
		| "dueDate"
		| "labels"
		| "customFieldValues"
	>,
	key: string,
): SheetValue {
	if (key.startsWith("custom:"))
		return issue.customFieldValues?.[key.slice(7)] ?? "";
	switch (key) {
		case "startDate":
		case "dueDate":
			return issue[key] == null ? "" : calendarDate(issue[key]);
		case "title":
		case "status":
		case "priority":
			return issue[key];
		case "assigneeId":
		case "listId":
		case "parentIssueId":
			return issue[key] ?? "";
		case "labels":
			return issue.labels;
		default:
			return "";
	}
}

export function sheetValueLabel(field: SheetField, value: SheetValue) {
	if (field.type === "checkbox") return value ? "Yes" : "No";
	if (Array.isArray(value))
		return value
			.map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
			.join(", ");
	return (
		field.options?.find((o) => o.value === String(value))?.label ??
		String(value)
	);
}

export function canEditSheetField(issue: ProjectIssueRow, key: string) {
	return (
		!(key === "listId" && issue.parentIssueId) &&
		!(key === "parentIssueId" && issue.hasChildren)
	);
}

export function parseSheetValue(
	field: SheetField,
	raw: SheetValue,
): SheetValue {
	const value = String(raw).trim();
	if (field.type === "checkbox") {
		if (typeof raw === "boolean") return raw;
		if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
		if (["false", "no", "0", ""].includes(value.toLowerCase())) return false;
		throw new Error(`${field.name}: use Yes or No.`);
	}
	if (field.required && !value) throw new Error(`${field.name} is required.`);
	if (field.key === "title" && value.length < 2)
		throw new Error("Task title must have at least 2 characters.");
	if (field.type === "labels") {
		const values = Array.isArray(raw)
			? raw
			: value
				? value.split(",").map((v) => v.trim())
				: [];
		return [
			...new Set(
				values.map((v) => {
					const option = field.options?.find(
						(o) => o.value === v || o.label === v,
					);
					if (!option) throw new Error(`Unknown label: ${v}.`);
					return option.value;
				}),
			),
		];
	}
	if (field.type === "select" && value) {
		const matches = field.options?.filter((o) => o.label === value) ?? [];
		const option =
			field.options?.find((o) => o.value === value) ??
			(matches.length === 1 ? matches[0] : undefined);
		if (!option)
			throw new Error(
				`${field.name}: choose a configured option from the dropdown.`,
			);
		return option.value;
	}
	if (field.type === "number" && value) {
		if (!Number.isFinite(Number(value)))
			throw new Error(`${field.name}: enter a finite number.`);
		return Number(value);
	}
	if (field.type === "date" && value && !isCalendarDate(value))
		throw new Error(`${field.name}: use a valid YYYY-MM-DD date.`);
	return value;
}

export function getSheetUpdate(
	issue: ProjectIssueRow,
	field: SheetField,
	raw: SheetValue,
): SheetUpdate {
	if (!canEditSheetField(issue, field.key))
		throw new Error(
			"Sub-tasks inherit their list; tasks with sub-tasks cannot become sub-tasks.",
		);
	const value = parseSheetValue(field, raw);
	const update: SheetUpdate = { issueId: issue._id };
	if (field.key.startsWith("custom:")) {
		const key = field.key.slice(7);
		const customFieldValues = { ...issue.customFieldValues };
		if (value === "") delete customFieldValues[key];
		else customFieldValues[key] = value as string | number | boolean;
		return { ...update, customFieldValues };
	}
	switch (field.key) {
		case "title":
			return { ...update, title: String(value) };
		case "status":
			return { ...update, status: String(value) };
		case "priority":
			return { ...update, priority: value as ProjectIssueRow["priority"] };
		case "assigneeId":
			return { ...update, assigneeId: (value || null) as Id<"users"> | null };
		case "listId":
			return { ...update, listId: (value || null) as Id<"issueLists"> | null };
		case "parentIssueId":
			if (value === issue._id)
				throw new Error("A task cannot be its own parent.");
			return {
				...update,
				parentIssueId: (value || null) as Id<"issues"> | null,
			};
		case "labels":
			return { ...update, labels: value as string[] };
		case "startDate":
		case "dueDate": {
			const date = value ? calendarTimestamp(String(value)) : null;
			const start = field.key === "startDate" ? date : issue.startDate;
			const end = field.key === "dueDate" ? date : issue.dueDate;
			if (start != null && end != null && start > end)
				throw new Error("Start date cannot be after due date.");
			return { ...update, [field.key]: date };
		}
		default:
			throw new Error("This column is read-only.");
	}
}
