import { ISSUE_STATUSES, issueStatusLabel } from "#/features/tasker/model";

export type ProjectStatusKey = string;

export type ProjectStatusDefinition = {
	key: ProjectStatusKey;
	name: string;
	color: string;
	position: number;
};

const LOCKED_PROJECT_STATUS_KEYS = ["todo", "done"] as const;

export const DEFAULT_PROJECT_STATUSES: ProjectStatusDefinition[] = [
	{ key: "todo", name: "Todo", color: "#3b82f6", position: 0 },
	{ key: "backlog", name: "Backlog", color: "#64748b", position: 1 },
	{ key: "in_progress", name: "In Progress", color: "#f59e0b", position: 2 },
	{ key: "in_review", name: "In Review", color: "#8b5cf6", position: 3 },
	{ key: "done", name: "Done", color: "#10b981", position: 4 },
];

const CUSTOM_STATUS_COLORS = [
	"#64748b",
	"#f59e0b",
	"#8b5cf6",
	"#06b6d4",
	"#ec4899",
	"#14b8a6",
	"#f97316",
] as const;

function getDefaultProjectStatus(key: string, position: number) {
	return (
		DEFAULT_PROJECT_STATUSES.find((status) => status.key === key) ?? {
			key,
			name: issueStatusLabel[key] ?? key,
			color:
				CUSTOM_STATUS_COLORS[position % CUSTOM_STATUS_COLORS.length] ??
				"#64748b",
			position,
		}
	);
}

function normalizeStatusColor(
	key: string,
	color: string | undefined,
	position: number,
) {
	if (key === "todo" || key === "done") {
		return getDefaultProjectStatus(key, position).color;
	}

	const normalized = color?.trim().toLowerCase();
	if (normalized && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) {
		if (normalized.length === 4) {
			const [hash, red, green, blue] = normalized;
			return `${hash}${red}${red}${green}${green}${blue}${blue}`;
		}
		return normalized;
	}

	return getDefaultProjectStatus(key, position).color;
}

function normalizeStatusName(key: string, name: string) {
	if (key === "todo") {
		return "Todo";
	}
	if (key === "done") {
		return "Done";
	}

	return name.trim() || issueStatusLabel[key] || "New Status";
}

function dedupeCustomStatuses(statuses: ProjectStatusDefinition[]) {
	const seenKeys = new Set<string>();
	const seenNames = new Set<string>();

	return statuses.filter((status) => {
		const normalizedName = status.name.trim().toLowerCase();
		if (
			!status.key ||
			LOCKED_PROJECT_STATUS_KEYS.includes(
				status.key as (typeof LOCKED_PROJECT_STATUS_KEYS)[number],
			)
		) {
			return false;
		}
		if (seenKeys.has(status.key) || seenNames.has(normalizedName)) {
			return false;
		}

		seenKeys.add(status.key);
		seenNames.add(normalizedName);
		return true;
	});
}

export function normalizeProjectStatuses(
	statuses?: ProjectStatusDefinition[] | null,
) {
	const incoming = statuses ?? [];
	const customStatuses = dedupeCustomStatuses(
		incoming
			.filter(
				(status) => !LOCKED_PROJECT_STATUS_KEYS.includes(status.key as never),
			)
			.map((status) => ({
				key: status.key,
				name: normalizeStatusName(status.key, status.name),
				color: normalizeStatusColor(status.key, status.color, status.position),
				position: Number.isFinite(status.position) ? status.position : 0,
			})),
	).sort((left, right) => left.position - right.position);

	return [
		getDefaultProjectStatus("todo", 0),
		...customStatuses.map((status, index) => ({
			...status,
			position: index + 1,
		})),
		{
			...getDefaultProjectStatus("done", customStatuses.length + 1),
			position: customStatuses.length + 1,
		},
	];
}

export function isLockedProjectStatusKey(key: string) {
	return LOCKED_PROJECT_STATUS_KEYS.includes(
		key as (typeof LOCKED_PROJECT_STATUS_KEYS)[number],
	);
}

export function getProjectStatusLabel(
	statuses: ProjectStatusDefinition[] | null | undefined,
	status: string,
) {
	return (
		getProjectStatusDefinition(statuses, status)?.name ??
		issueStatusLabel[status] ??
		status
	);
}

export function getProjectStatusColor(
	statuses: ProjectStatusDefinition[] | null | undefined,
	status: string,
) {
	return getProjectStatusDefinition(statuses, status)?.color;
}

export function getProjectStatusDefinition(
	statuses: ProjectStatusDefinition[] | null | undefined,
	status: string,
) {
	return normalizeProjectStatuses(statuses).find((item) => item.key === status);
}

export function moveProjectStatus(
	statuses: ProjectStatusDefinition[],
	key: string,
	direction: "up" | "down",
) {
	if (isLockedProjectStatusKey(key)) {
		return normalizeProjectStatuses(statuses);
	}

	const normalized = normalizeProjectStatuses(statuses);
	const customStatuses = normalized.filter(
		(status) => !isLockedProjectStatusKey(status.key),
	);
	const index = customStatuses.findIndex((status) => status.key === key);
	if (index === -1) {
		return normalized;
	}

	const targetIndex = direction === "up" ? index - 1 : index + 1;
	if (targetIndex < 0 || targetIndex >= customStatuses.length) {
		return normalized;
	}

	const next = [...customStatuses];
	const [status] = next.splice(index, 1);
	next.splice(targetIndex, 0, status);

	return normalizeProjectStatuses(next);
}

export function removeProjectStatus(
	statuses: ProjectStatusDefinition[],
	key: string,
) {
	return normalizeProjectStatuses(
		statuses.filter(
			(status) => status.key !== key || isLockedProjectStatusKey(key),
		),
	);
}

export function appendProjectStatus(
	statuses: ProjectStatusDefinition[],
	name = "",
) {
	const customStatusCount = statuses.filter(
		(status) => !isLockedProjectStatusKey(status.key),
	).length;

	return normalizeProjectStatuses([
		...statuses,
		{
			key: createProjectStatusKey(name),
			name: name.trim() || "New Status",
			color: getDefaultProjectStatus(
				`custom_${customStatusCount + 1}`,
				customStatusCount + 1,
			).color,
			position: statuses.length,
		},
	]);
}

export function createProjectStatusKey(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	const suffix = Math.random().toString(36).slice(2, 8);
	return slug ? `${slug}_${suffix}` : `status_${suffix}`;
}

export function isDoneStatusKey(key: string) {
	return key === "done";
}

export function isTodoLikeStatusKey(key: string) {
	return key === "todo" || key === "backlog";
}

export function isActiveStatusKey(key: string) {
	return !isDoneStatusKey(key) && !isTodoLikeStatusKey(key);
}

export function getCustomProjectStatuses(
	statuses?: ProjectStatusDefinition[] | null,
) {
	return normalizeProjectStatuses(statuses).filter(
		(status) => !isLockedProjectStatusKey(status.key),
	);
}

export function getAllowedStatusFilterValues(
	statuses?: ProjectStatusDefinition[] | null,
) {
	const allowed = new Set(ISSUE_STATUSES);
	for (const status of statuses ?? []) {
		allowed.add(status.key);
	}
	return allowed;
}
