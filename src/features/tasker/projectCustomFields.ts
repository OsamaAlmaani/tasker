export const PROJECT_CUSTOM_FIELD_TYPES = [
	"text",
	"number",
	"date",
	"checkbox",
	"select",
] as const;

export type ProjectCustomFieldType =
	(typeof PROJECT_CUSTOM_FIELD_TYPES)[number];

export type ProjectCustomFieldDefinition = {
	key: string;
	name: string;
	type: ProjectCustomFieldType;
	position: number;
	options?: string[];
};

export type ProjectCustomFieldDraftValue = string | boolean;

function normalizeFieldName(name: string) {
	return name.trim() || "New Field";
}

function normalizeFieldType(type: string | undefined): ProjectCustomFieldType {
	switch (type) {
		case "number":
		case "date":
		case "checkbox":
		case "select":
			return type;
		default:
			return "text";
	}
}

function normalizeFieldOptions(options: string[] | undefined) {
	const seen = new Set<string>();
	return (options ?? [])
		.map((option) => option.trim())
		.filter(Boolean)
		.filter((option) => {
			const normalized = option.toLowerCase();
			if (seen.has(normalized)) {
				return false;
			}
			seen.add(normalized);
			return true;
		});
}

export function normalizeProjectCustomFields(
	customFields?: ProjectCustomFieldDefinition[] | null,
) {
	const seenKeys = new Set<string>();
	const seenNames = new Set<string>();

	return (customFields ?? [])
		.map((field) => ({
			key: field.key,
			name: normalizeFieldName(field.name),
			type: normalizeFieldType(field.type),
			position: Number.isFinite(field.position) ? field.position : 0,
			options:
				normalizeFieldType(field.type) === "select"
					? normalizeFieldOptions(field.options)
					: undefined,
		}))
		.filter((field) => {
			const normalizedName = field.name.trim().toLowerCase();
			if (!field.key) {
				return false;
			}
			if (seenKeys.has(field.key) || seenNames.has(normalizedName)) {
				return false;
			}
			seenKeys.add(field.key);
			seenNames.add(normalizedName);
			return true;
		})
		.sort((left, right) => left.position - right.position)
		.map((field, index) => ({
			...field,
			position: index,
		}));
}

export function getProjectCustomFieldDefinition(
	customFields: ProjectCustomFieldDefinition[] | null | undefined,
	fieldKey: string,
) {
	return normalizeProjectCustomFields(customFields).find(
		(field) => field.key === fieldKey,
	);
}

export function createProjectCustomFieldKey(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	const suffix = Math.random().toString(36).slice(2, 8);
	return slug ? `${slug}_${suffix}` : `field_${suffix}`;
}

export function appendProjectCustomField(
	customFields: ProjectCustomFieldDefinition[],
	type: ProjectCustomFieldType = "text",
	name = "",
) {
	return normalizeProjectCustomFields([
		...customFields,
		{
			key: createProjectCustomFieldKey(name),
			name: name.trim() || "New Field",
			type,
			position: customFields.length,
			options: type === "select" ? ["Option 1", "Option 2"] : undefined,
		},
	]);
}

export function removeProjectCustomField(
	customFields: ProjectCustomFieldDefinition[],
	key: string,
) {
	return normalizeProjectCustomFields(
		customFields.filter((field) => field.key !== key),
	);
}

export function moveProjectCustomField(
	customFields: ProjectCustomFieldDefinition[],
	key: string,
	direction: "up" | "down",
) {
	const normalized = normalizeProjectCustomFields(customFields);
	const index = normalized.findIndex((field) => field.key === key);
	if (index === -1) {
		return normalized;
	}

	const targetIndex = direction === "up" ? index - 1 : index + 1;
	if (targetIndex < 0 || targetIndex >= normalized.length) {
		return normalized;
	}

	const next = [...normalized];
	const [field] = next.splice(index, 1);
	next.splice(targetIndex, 0, field);
	return next.map((item, itemIndex) => ({
		...item,
		position: itemIndex,
	}));
}

export function normalizeIssueCustomFieldDraftValues(
	customFields: ProjectCustomFieldDefinition[] | null | undefined,
	values?: Record<string, string | number | boolean> | null,
) {
	const fieldByKey = new Map(
		normalizeProjectCustomFields(customFields).map((field) => [
			field.key,
			field,
		]),
	);
	const nextValues: Record<string, ProjectCustomFieldDraftValue> = {};

	for (const [fieldKey, rawValue] of Object.entries(values ?? {})) {
		const field = fieldByKey.get(fieldKey);
		if (!field) {
			continue;
		}

		if (field.type === "checkbox") {
			nextValues[fieldKey] = Boolean(rawValue);
			continue;
		}

		nextValues[fieldKey] = String(rawValue);
	}

	return nextValues;
}

export function buildIssueCustomFieldSubmission(
	customFields: ProjectCustomFieldDefinition[] | null | undefined,
	values: Record<string, ProjectCustomFieldDraftValue>,
) {
	const fieldByKey = new Map(
		normalizeProjectCustomFields(customFields).map((field) => [
			field.key,
			field,
		]),
	);
	const nextValues: Record<string, string | number | boolean> = {};

	for (const [fieldKey, rawValue] of Object.entries(values)) {
		const field = fieldByKey.get(fieldKey);
		if (!field) {
			continue;
		}

		switch (field.type) {
			case "checkbox":
				nextValues[fieldKey] = Boolean(rawValue);
				break;
			case "number": {
				const trimmed = String(rawValue).trim();
				if (!trimmed) {
					break;
				}
				const numeric = Number(trimmed);
				if (Number.isFinite(numeric)) {
					nextValues[fieldKey] = numeric;
				}
				break;
			}
			default: {
				const trimmed = String(rawValue).trim();
				if (trimmed) {
					nextValues[fieldKey] = trimmed;
				}
				break;
			}
		}
	}

	return nextValues;
}

export function formatProjectCustomFieldValue(
	field: ProjectCustomFieldDefinition,
	value: string | boolean | undefined,
) {
	if (value === undefined || value === "") {
		return "Not set";
	}

	if (field.type === "checkbox") {
		return value ? "Yes" : "No";
	}

	return String(value);
}
