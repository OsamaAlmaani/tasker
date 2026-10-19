import { useEffect, useMemo, useRef, useState } from "react";
import {
	type Column,
	DataGrid,
	type RenderEditCellProps,
	SelectColumn,
	type SortColumn,
} from "react-data-grid";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { ProjectCustomFieldInput } from "#/features/tasker/components/ProjectCustomFieldInput";
import { ProjectLabelSelector } from "#/features/tasker/components/ProjectLabelSelector";
import {
	canEditSheetField,
	getSheetFields,
	getSheetUpdate,
	getSheetValue,
	parseSheetValue,
	type SheetField,
	type SheetOptions,
	type SheetUpdate,
	type SheetValue,
	sheetValueLabel,
} from "#/features/tasker/projects/taskSheet";
import type { ProjectIssueRow } from "#/features/tasker/projects/useProjectDetailPage";
import { getClientErrorMessage } from "#/lib/utils";
import "react-data-grid/lib/styles.css";
import "./projectTaskSheet.css";

type SheetRow = { issue: ProjectIssueRow; cells: Record<string, SheetValue> };
type Props = SheetOptions & {
	issues: ProjectIssueRow[];
	projectKey: string;
	canWrite: boolean;
	disabled: boolean;
	isLoading?: boolean;
	selectedIssueIds: ReadonlySet<string>;
	onSelectionChange: (ids: Set<string>) => void;
	onUpdate: (update: SheetUpdate) => Promise<unknown>;
	onStatusChange: (issue: ProjectIssueRow, status: string) => Promise<unknown>;
	onOpenIssue: (id: string) => void;
};

function SheetEditor({
	field,
	labels,
	row,
	onRowChange,
	onClose,
	onEditingChange,
}: RenderEditCellProps<SheetRow> & {
	field: SheetField;
	labels: SheetOptions["labels"];
	onEditingChange: (editing: boolean) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const value = row.cells[field.key];
	useEffect(() => {
		onEditingChange(true);
		dialogRef.current?.showModal();
		const control = ref.current?.querySelector<HTMLElement>(
			"input, select, button",
		);
		if (field.type !== "labels")
			control?.setAttribute("aria-label", field.name);
		control?.focus();
		return () => onEditingChange(false);
	}, [field.name, field.type, onEditingChange]);
	function change(next: SheetValue) {
		onRowChange({ ...row, cells: { ...row.cells, [field.key]: next } });
	}
	return (
		<div ref={ref} className="task-sheet-editor">
			{field.type === "labels" ? (
				<dialog
					ref={dialogRef}
					aria-label="Edit labels"
					className="task-sheet-label-editor"
					onKeyDown={(event) => event.stopPropagation()}
					onCancel={(event) => {
						event.preventDefault();
						onClose(false);
					}}
				>
					<ProjectLabelSelector
						labelOptions={labels}
						selectedLabelKeys={value as string[]}
						onChange={change}
					/>
					<Button size="sm" onClick={() => onClose(true)}>
						Apply labels
					</Button>
					<Button size="sm" variant="ghost" onClick={() => onClose(false)}>
						Cancel
					</Button>
				</dialog>
			) : field.type === "select" ? (
				<Select
					aria-label={field.name}
					value={String(value)}
					onChange={(event) => change(event.target.value)}
				>
					{!field.required && <option value="">Not set</option>}
					{field.options
						?.filter(
							(option) =>
								field.key !== "parentIssueId" || option.value !== row.issue._id,
						)
						.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
				</Select>
			) : field.key.startsWith("custom:") ? (
				<ProjectCustomFieldInput
					field={{
						key: field.key,
						name: field.name,
						type: field.type,
						position: 0,
					}}
					value={typeof value === "boolean" ? value : String(value)}
					onChange={change}
				/>
			) : (
				<Input
					aria-label={field.name}
					type={field.type === "date" ? "date" : "text"}
					value={String(value)}
					onChange={(event) => change(event.target.value)}
				/>
			)}
		</div>
	);
}

export default function ProjectTaskSheet(props: Props) {
	const {
		issues,
		projectKey,
		canWrite,
		disabled,
		isLoading,
		selectedIssueIds,
		onSelectionChange,
		onUpdate,
		onStatusChange,
		onOpenIssue,
		statuses,
		customFields,
		labels,
		users,
		lists,
		parents,
	} = props;
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const savingRef = useRef(false);
	const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
	const fields = useMemo(
		() =>
			getSheetFields({ statuses, customFields, labels, users, lists, parents }),
		[statuses, customFields, labels, users, lists, parents],
	);
	const fieldByKey = useMemo(
		() => new Map(fields.map((field) => [field.key, field])),
		[fields],
	);
	const editable = canWrite && !disabled && !saving;
	const rows = useMemo(() => {
		const result = issues.map((issue) => ({
			issue,
			cells: Object.fromEntries(
				fields.map((field) => [field.key, getSheetValue(issue, field.key)]),
			),
		}));
		return result.sort((a, b) => {
			for (const sort of sortColumns) {
				const field = fieldByKey.get(sort.columnKey);
				const left = field ? a.cells[field.key] : a.issue.issueNumber;
				const right = field ? b.cells[field.key] : b.issue.issueNumber;
				const order =
					field?.type === "number" || sort.columnKey === "id"
						? (left === "" ? -Infinity : Number(left)) -
							(right === "" ? -Infinity : Number(right))
						: (field
								? sheetValueLabel(field, left)
								: String(left)
							).localeCompare(
								field ? sheetValueLabel(field, right) : String(right),
								undefined,
								{ numeric: true },
							);
				if (order) return sort.direction === "ASC" ? order : -order;
			}
			return 0;
		});
	}, [issues, fields, fieldByKey, sortColumns]);
	const [displayRows, setDisplayRows] = useState(rows);
	// The grid cancels drafts on row replacement, so defer refreshes until editing ends.
	if (!isEditing && displayRows !== rows) setDisplayRows(rows);
	const columns = useMemo(
		(): Column<SheetRow>[] => [
			...(canWrite ? [SelectColumn as Column<SheetRow>] : []),
			{
				key: "id",
				name: "Task",
				width: 125,
				frozen: true,
				renderCell: ({ row, tabIndex }) => (
					<button
						type="button"
						tabIndex={tabIndex}
						className="text-[var(--accent)] underline"
						onClick={() => onOpenIssue(row.issue._id)}
					>
						{projectKey}-{row.issue.issueNumber}
					</button>
				),
			},
			...fields.map(
				(field): Column<SheetRow> => ({
					key: field.key,
					name: field.name,
					width: field.key === "title" ? 300 : 170,
					editable: (row) =>
						editable && canEditSheetField(row.issue, field.key),
					renderCell: ({ row }) => (
						<span title={sheetValueLabel(field, row.cells[field.key])}>
							{sheetValueLabel(field, row.cells[field.key]) || "—"}
						</span>
					),
					renderEditCell: (editor) => (
						<SheetEditor
							{...editor}
							field={field}
							labels={labels}
							onEditingChange={setIsEditing}
						/>
					),
					editorOptions: { commitOnOutsideClick: field.type !== "labels" },
				}),
			),
			{
				key: "subtasks",
				name: "Sub-tasks",
				width: 115,
				sortable: false,
				renderCell: ({ row }) =>
					`${row.issue.completedChildIssueCount}/${row.issue.childIssueCount}`,
			},
			{
				key: "checklist",
				name: "Checklist",
				width: 115,
				sortable: false,
				renderCell: ({ row }) =>
					`${row.issue.completedChecklistItemCount}/${row.issue.checklistItemCount}`,
			},
		],
		[canWrite, editable, fields, labels, onOpenIssue, projectKey],
	);

	async function saveRows(
		nextRows: SheetRow[],
		indexes: number[],
		key: string,
	) {
		if (!editable || savingRef.current) return;
		const field = fieldByKey.get(key);
		if (!field) return;
		let saved = 0;
		try {
			const issueById = new Map(issues.map((issue) => [issue._id, issue]));
			const changes = indexes
				.filter(
					(index) =>
						JSON.stringify(nextRows[index].cells[key]) !==
						JSON.stringify(displayRows[index].cells[key]),
				)
				.map((index) => {
					const row = nextRows[index];
					const issue = issueById.get(row.issue._id);
					if (!issue) throw new Error("This task is no longer available.");
					return {
						issue,
						update: getSheetUpdate(issue, field, row.cells[key]),
					};
				});
			if (!changes.length) return;
			setError(null);
			if (key === "status" && changes.length > 1)
				throw new Error(
					"Use the bulk Status action to change multiple task statuses.",
				);
			savingRef.current = true;
			setSaving(true);
			for (const { issue, update } of changes) {
				if (update.status !== undefined)
					await onStatusChange(issue, update.status);
				else await onUpdate(update);
				saved++;
			}
		} catch (cause) {
			setError(
				`${saved ? `${saved} task(s) saved before the error. ` : ""}${getClientErrorMessage(cause, "Could not save the cell. Please try again.")}`,
			);
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}

	return (
		<div className="min-w-0 space-y-2">
			{error && (
				<p role="alert" className="text-sm text-[var(--danger)]">
					{error}
				</p>
			)}
			<div role="status" className="text-xs text-[var(--muted-text)]">
				{isLoading
					? "Loading tasks…"
					: saving
						? "Saving…"
						: `${displayRows.length} tasks`}
			</div>
			<DataGrid<SheetRow, unknown, string>
				aria-label="Task sheet"
				className="task-sheet"
				columns={columns}
				rows={displayRows}
				rowKeyGetter={(row) => row.issue._id}
				rowHeight={40}
				defaultColumnOptions={{ resizable: true, sortable: true, minWidth: 90 }}
				sortColumns={sortColumns}
				onSortColumnsChange={setSortColumns}
				selectedRows={selectedIssueIds}
				isRowSelectionDisabled={() => !editable}
				onSelectedRowsChange={editable ? onSelectionChange : undefined}
				onRowsChange={(next, { indexes, column }) =>
					void saveRows(next, indexes, column.key)
				}
				onCellCopy={({ row, column }, event) => {
					const field = fieldByKey.get(column.key);
					if (!field) return;
					event.preventDefault();
					event.clipboardData.setData(
						"text/plain",
						field.type === "labels"
							? JSON.stringify(row.cells[field.key])
							: field.type === "select"
								? String(row.cells[field.key])
								: sheetValueLabel(field, row.cells[field.key]),
					);
				}}
				onCellPaste={({ row, column }, event) => {
					event.preventDefault();
					const field = fieldByKey.get(column.key);
					if (!editable || !field) return row;
					try {
						const text = event.clipboardData
							.getData("text/plain")
							.replace(/\r?\n$/, "");
						// shortcut: single-cell paste; add range paste when multi-cell imports are needed.
						if (/[\t\r\n]/.test(text))
							throw new Error(
								"Paste one cell at a time; use fill or bulk actions for multiple tasks.",
							);
						const raw =
							field.type === "labels" && text.startsWith("[")
								? JSON.parse(text)
								: text;
						const value = parseSheetValue(field, raw);
						getSheetUpdate(row.issue, field, value);
						return { ...row, cells: { ...row.cells, [field.key]: value } };
					} catch (cause) {
						setError(getClientErrorMessage(cause, "Invalid cell value."));
						return row;
					}
				}}
				onFill={
					editable
						? ({ columnKey, sourceRow, targetRow }) => {
								if (columnKey === "status") {
									setError(
										"Use the bulk Status action to change multiple task statuses.",
									);
									return targetRow;
								}
								if (!canEditSheetField(targetRow.issue, columnKey))
									return targetRow;
								return {
									...targetRow,
									cells: {
										...targetRow.cells,
										[columnKey]: sourceRow.cells[columnKey],
									},
								};
							}
						: undefined
				}
			/>
		</div>
	);
}
