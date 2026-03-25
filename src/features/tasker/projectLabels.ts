export type ProjectLabelDefinition = {
	key: string;
	name: string;
	color: string;
	position: number;
};

const DEFAULT_PROJECT_LABEL_COLORS = [
	"#06b6d4",
	"#84cc16",
	"#f97316",
	"#ec4899",
	"#8b5cf6",
	"#14b8a6",
	"#f59e0b",
] as const;

function normalizeLabelName(name: string) {
	return name.trim() || "New Label";
}

function normalizeLabelColor(color: string, position: number) {
	const normalized = color.trim().toLowerCase();
	if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) {
		if (normalized.length === 4) {
			const [hash, red, green, blue] = normalized;
			return `${hash}${red}${red}${green}${green}${blue}${blue}`;
		}
		return normalized;
	}

	return (
		DEFAULT_PROJECT_LABEL_COLORS[
			position % DEFAULT_PROJECT_LABEL_COLORS.length
		] ?? "#06b6d4"
	);
}

function dedupeProjectLabels(labels: ProjectLabelDefinition[]) {
	const seenKeys = new Set<string>();
	const seenNames = new Set<string>();

	return labels.filter((label) => {
		const normalizedName = label.name.trim().toLowerCase();
		if (!label.key) {
			return false;
		}
		if (seenKeys.has(label.key) || seenNames.has(normalizedName)) {
			return false;
		}

		seenKeys.add(label.key);
		seenNames.add(normalizedName);
		return true;
	});
}

export function normalizeProjectLabels(
	labels?: ProjectLabelDefinition[] | null,
) {
	return dedupeProjectLabels(
		(labels ?? []).map((label) => ({
			key: label.key,
			name: normalizeLabelName(label.name),
			color: normalizeLabelColor(label.color, label.position),
			position: Number.isFinite(label.position) ? label.position : 0,
		})),
	)
		.sort((left, right) => left.position - right.position)
		.map((label, index) => ({
			...label,
			position: index,
		}));
}

export function getProjectLabelDefinition(
	labels: ProjectLabelDefinition[] | null | undefined,
	labelKey: string,
) {
	return normalizeProjectLabels(labels).find((label) => label.key === labelKey);
}

export function getProjectLabelName(
	labels: ProjectLabelDefinition[] | null | undefined,
	labelKey: string,
) {
	return getProjectLabelDefinition(labels, labelKey)?.name ?? labelKey;
}

export function getProjectLabelColor(
	labels: ProjectLabelDefinition[] | null | undefined,
	labelKey: string,
) {
	return getProjectLabelDefinition(labels, labelKey)?.color;
}

export function createProjectLabelKey(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	const suffix = Math.random().toString(36).slice(2, 8);
	return slug ? `${slug}_${suffix}` : `label_${suffix}`;
}

export function appendProjectLabel(
	labels: ProjectLabelDefinition[],
	name = "",
) {
	return normalizeProjectLabels([
		...labels,
		{
			key: createProjectLabelKey(name),
			name: name.trim() || "New Label",
			color: normalizeLabelColor("", labels.length),
			position: labels.length,
		},
	]);
}

export function removeProjectLabel(
	labels: ProjectLabelDefinition[],
	key: string,
) {
	return normalizeProjectLabels(labels.filter((label) => label.key !== key));
}
