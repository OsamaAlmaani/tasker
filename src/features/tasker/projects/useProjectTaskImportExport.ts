import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { ISSUE_PRIORITIES } from "#/features/tasker/model";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";
import { getClientErrorMessage } from "#/lib/utils";
import type { Doc, Id } from "#convex/_generated/dataModel";

type ImportedTask = {
	title: string;
	description?: string;
	status?: string;
	priority?: (typeof ISSUE_PRIORITIES)[number];
	labels?: string[] | string;
	dueDate?: number | string;
	listName?: string;
	statusName?: string;
};

type ExportableIssue = Pick<
	Doc<"issues">,
	| "title"
	| "description"
	| "status"
	| "priority"
	| "labels"
	| "dueDate"
	| "listId"
>;

type IssueListSummary = Pick<Doc<"issueLists">, "_id" | "name">;
type ProjectSummary = Pick<Doc<"projects">, "_id" | "key" | "name">;

type TaskFilters = {
	search?: string;
	statuses?: (typeof ISSUE_STATUSES)[number][];
	priority?: string;
	assigneeId?: string;
	list?: string;
	sort?: string;
	groupBy?: string;
	layout?: string;
	view?: string;
};

type CreateImportedIssueArgs = {
	projectId: Id<"projects">;
	title: string;
	description?: string;
	status?: string;
	priority?: (typeof ISSUE_PRIORITIES)[number];
	dueDate?: number;
	labels?: string[];
	listId?: Id<"issueLists">;
};

type UseProjectTaskImportExportOptions = {
	canWrite: boolean;
	createIssue: (args: CreateImportedIssueArgs) => Promise<unknown>;
	filters: TaskFilters;
	issueListById: Map<string, IssueListSummary>;
	issueLists: IssueListSummary[] | undefined;
	issues: ExportableIssue[] | undefined;
	project: ProjectSummary | undefined;
	projectId: Id<"projects">;
	projectStatuses: ProjectStatusDefinition[];
};

function extractImportTasks(payload: unknown): ImportedTask[] {
	if (Array.isArray(payload)) {
		return payload as ImportedTask[];
	}
	if (payload && typeof payload === "object") {
		const objectPayload = payload as Record<string, unknown>;
		if (Array.isArray(objectPayload.tasks)) {
			return objectPayload.tasks as ImportedTask[];
		}
		if (Array.isArray(objectPayload.issues)) {
			return objectPayload.issues as ImportedTask[];
		}
	}

	return [];
}

function normalizeTaskLabels(labels?: string[] | string): string[] | undefined {
	if (!labels) {
		return undefined;
	}

	if (typeof labels === "string") {
		const parsed = labels
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		return parsed.length ? parsed : undefined;
	}

	const parsed = labels.map((item) => item.trim()).filter(Boolean);
	return parsed.length ? parsed : undefined;
}

function normalizeTaskDueDate(dueDate?: string | number): number | undefined {
	if (dueDate === undefined || dueDate === null) {
		return undefined;
	}
	if (typeof dueDate === "number" && Number.isFinite(dueDate)) {
		return dueDate;
	}
	if (typeof dueDate === "string" && dueDate.trim()) {
		const timestamp = Date.parse(dueDate);
		if (Number.isFinite(timestamp)) {
			return timestamp;
		}
	}

	return undefined;
}

export function useProjectTaskImportExport({
	canWrite,
	createIssue,
	filters,
	issueListById,
	issueLists,
	issues,
	project,
	projectId,
	projectStatuses,
}: UseProjectTaskImportExportOptions) {
	const [isImportExportMenuOpen, setIsImportExportMenuOpen] = useState(false);
	const [isImportingTasks, setIsImportingTasks] = useState(false);
	const [importExportMessage, setImportExportMessage] = useState<string | null>(
		null,
	);
	const [importExportError, setImportExportError] = useState<string | null>(
		null,
	);
	const importFileInputRef = useRef<HTMLInputElement | null>(null);
	const importExportMenuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isImportExportMenuOpen) {
			return;
		}

		const onDocumentClick = (event: MouseEvent) => {
			if (
				importExportMenuRef.current &&
				!importExportMenuRef.current.contains(event.target as Node)
			) {
				setIsImportExportMenuOpen(false);
			}
		};

		const onDocumentKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsImportExportMenuOpen(false);
			}
		};

		document.addEventListener("mousedown", onDocumentClick);
		document.addEventListener("keydown", onDocumentKeydown);
		return () => {
			document.removeEventListener("mousedown", onDocumentClick);
			document.removeEventListener("keydown", onDocumentKeydown);
		};
	}, [isImportExportMenuOpen]);

	function toggleImportExportMenu() {
		setIsImportExportMenuOpen((current) => !current);
	}

	function openImportPicker() {
		if (!canWrite || isImportingTasks) {
			return;
		}

		setIsImportExportMenuOpen(false);
		importFileInputRef.current?.click();
	}

	function exportTasks() {
		if (!project) {
			return;
		}

		const taskRows = issues ?? [];
		const payload = {
			version: 1,
			exportedAt: new Date().toISOString(),
			project: {
				id: project._id,
				key: project.key,
				name: project.name,
			},
			filters: {
				search: filters.search || undefined,
				statuses: filters.statuses?.length ? filters.statuses : undefined,
				priority: filters.priority || undefined,
				assigneeId: filters.assigneeId || undefined,
				list:
					filters.list === "all"
						? undefined
						: filters.list === "none"
							? "none"
							: filters.list,
				sort: filters.sort,
				groupBy: filters.groupBy,
				layout: filters.layout,
				view: filters.view,
			},
			tasks: taskRows.map((issue) => ({
				title: issue.title,
				description: issue.description,
				status: issue.status,
				statusName:
					projectStatuses.find((status) => status.key === issue.status)?.name ??
					issue.status,
				priority: issue.priority,
				labels: issue.labels,
				dueDate: issue.dueDate,
				listName: issue.listId
					? issueListById.get(issue.listId)?.name
					: undefined,
			})),
		};

		const fileContent = JSON.stringify(payload, null, 2);
		const fileBlob = new Blob([fileContent], { type: "application/json" });
		const downloadUrl = URL.createObjectURL(fileBlob);
		const anchor = document.createElement("a");
		anchor.href = downloadUrl;
		anchor.download = `${project.key.toLowerCase()}-tasks-${new Date().toISOString().slice(0, 10)}.json`;
		anchor.click();
		URL.revokeObjectURL(downloadUrl);
		setImportExportError(null);
		setImportExportMessage(
			`Exported ${payload.tasks.length} task${payload.tasks.length === 1 ? "" : "s"}.`,
		);
	}

	async function handleImportTasksFile(event: ChangeEvent<HTMLInputElement>) {
		if (!canWrite) {
			return;
		}

		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) {
			return;
		}

		setImportExportError(null);
		setImportExportMessage(null);
		setIsImportingTasks(true);
		setIsImportExportMenuOpen(false);

		try {
			const fileText = await file.text();
			const jsonPayload = JSON.parse(fileText) as unknown;
			const importedTasks = extractImportTasks(jsonPayload);
			if (!importedTasks.length) {
				throw new Error("No tasks found in the import file.");
			}

			const listIdByName = new Map(
				(issueLists ?? []).map((list) => [
					list.name.trim().toLowerCase(),
					list._id,
				]),
			);
			const statusKeyByName = new Map(
				projectStatuses.map((status) => [
					status.name.trim().toLowerCase(),
					status.key,
				]),
			);
			const allowedStatuses = new Set(
				projectStatuses.map((status) => status.key),
			);
			const allowedPriorities = new Set<string>(ISSUE_PRIORITIES);

			let importedCount = 0;
			let skippedCount = 0;

			for (const task of importedTasks) {
				const title = task.title?.trim();
				if (!title) {
					skippedCount += 1;
					continue;
				}

				const status =
					task.status && allowedStatuses.has(task.status)
						? task.status
						: task.statusName
							? statusKeyByName.get(task.statusName.trim().toLowerCase())
							: undefined;
				const priority =
					task.priority && allowedPriorities.has(task.priority)
						? task.priority
						: undefined;
				const normalizedListName = task.listName?.trim().toLowerCase();
				const listId = normalizedListName
					? listIdByName.get(normalizedListName)
					: undefined;

				try {
					await createIssue({
						projectId,
						title,
						description: task.description?.trim() || undefined,
						status,
						priority,
						dueDate: normalizeTaskDueDate(task.dueDate),
						labels: normalizeTaskLabels(task.labels),
						listId,
					});
					importedCount += 1;
				} catch {
					skippedCount += 1;
				}
			}

			if (!importedCount) {
				throw new Error(
					"No tasks were imported. Check the file format and permissions.",
				);
			}

			setImportExportMessage(
				skippedCount
					? `Imported ${importedCount} task${importedCount === 1 ? "" : "s"} (${skippedCount} skipped).`
					: `Imported ${importedCount} task${importedCount === 1 ? "" : "s"}.`,
			);
		} catch (error) {
			setImportExportError(
				getClientErrorMessage(error, "Failed to import tasks."),
			);
		} finally {
			setIsImportingTasks(false);
		}
	}

	return {
		exportTasks,
		handleImportTasksFile,
		importExportError,
		importExportMenuRef,
		importExportMessage,
		importFileInputRef,
		isImportExportMenuOpen,
		isImportingTasks,
		openImportPicker,
		toggleImportExportMenu,
	};
}
