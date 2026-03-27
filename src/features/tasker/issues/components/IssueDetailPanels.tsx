import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
	IssueLabelBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { ProjectCustomFieldInput } from "#/features/tasker/components/ProjectCustomFieldInput";
import { ProjectLabelSelector } from "#/features/tasker/components/ProjectLabelSelector";
import { formatDate } from "#/features/tasker/format";
import {
	createIssueChecklistItem,
	formatChecklistProgress,
	type IssueChecklistItem,
	normalizeIssueChecklistItems,
	roundChecklistCompletionRate,
} from "#/features/tasker/issues/checklists";
import { ISSUE_PRIORITIES, issuePriorityLabel } from "#/features/tasker/model";
import {
	formatProjectCustomFieldValue,
	normalizeIssueCustomFieldDraftValues,
	type ProjectCustomFieldDefinition,
	type ProjectCustomFieldDraftValue,
} from "#/features/tasker/projectCustomFields";
import {
	getProjectLabelColor,
	getProjectLabelName,
	type ProjectLabelDefinition,
} from "#/features/tasker/projectLabels";
import {
	getProjectStatusColor,
	getProjectStatusLabel,
	type ProjectStatusDefinition,
} from "#/features/tasker/projectStatuses";

type IssueLike = {
	_id: string;
	assigneeId?: string | null;
	childCompletionRate: number;
	childIssueCount: number;
	completedChildIssueCount: number;
	description?: string | null;
	dueDate?: number | null;
	hasChildren: boolean;
	hasChecklist: boolean;
	issueNumber: number;
	checklistItems?: IssueChecklistItem[];
	checklistItemCount: number;
	checklistCompletionRate: number;
	completedChecklistItemCount: number;
	labels: string[];
	customFieldValues?: Record<string, string | number | boolean>;
	listId?: string | null;
	parentIssueId?: string | null;
	priority: (typeof ISSUE_PRIORITIES)[number];
	status: ProjectStatusDefinition["key"];
	title: string;
};

type ParentIssueSummary = {
	_id: string;
	issueNumber: number;
	status: ProjectStatusDefinition["key"];
	title: string;
};

type ChildIssueRow = {
	issue: IssueLike;
	assignee: { name: string } | null;
};

type AssignableUserOption = {
	_id: string;
	name: string;
};

type IssueListOption = {
	_id: string;
	name: string;
};

function formatChildProgress(issue: IssueLike) {
	if (!issue.hasChildren) {
		return null;
	}

	return `${issue.completedChildIssueCount}/${issue.childIssueCount} done`;
}

function roundCompletionRate(issue: IssueLike) {
	return Math.round(issue.childCompletionRate * 100);
}

type IssueOverviewPanelProps = {
	canWrite: boolean;
	childIssueRows: ChildIssueRow[];
	currentIssue: IssueLike;
	descriptionDraft: string;
	editingDescription: boolean;
	editingTitle: boolean;
	onChecklistItemsChange: (items: IssueChecklistItem[]) => void;
	onCancelDescriptionEdit: () => void;
	onCancelTitleEdit: () => void;
	onDescriptionDraftChange: (value: string) => void;
	onOpenSubIssueForm: () => void;
	onSaveDescription: () => void | Promise<void>;
	onStartDescriptionEdit: () => void;
	onStartTitleEdit: () => void;
	onSubmitTitle: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	projectStatuses: ProjectStatusDefinition[];
	onTitleDraftChange: (value: string) => void;
	parentIssue?: ParentIssueSummary | null;
	titleDraft: string;
};

export function IssueOverviewPanel({
	canWrite,
	childIssueRows,
	currentIssue,
	descriptionDraft,
	editingDescription,
	editingTitle,
	onChecklistItemsChange,
	onCancelDescriptionEdit,
	onCancelTitleEdit,
	onDescriptionDraftChange,
	onOpenSubIssueForm,
	onSaveDescription,
	onStartDescriptionEdit,
	onStartTitleEdit,
	onSubmitTitle,
	projectStatuses,
	onTitleDraftChange,
	parentIssue,
	titleDraft,
}: IssueOverviewPanelProps) {
	return (
		<div className="issue-detail-main">
			{parentIssue ? (
				<section className="issue-overview-block">
					<div className="issue-overview-toolbar">
						<span className="issue-overview-kicker">Parent Task</span>
					</div>
					<Link
						to="/issues/$issueId"
						params={{ issueId: parentIssue._id }}
						className="issue-related-link no-underline"
					>
						<div className="flex items-center gap-2">
							<Badge className="issue-row-id-badge">
								#{parentIssue.issueNumber}
							</Badge>
							<p className="m-0 text-sm font-medium text-[var(--text)]">
								{parentIssue.title}
							</p>
						</div>
						<div className="mt-2 flex items-center gap-2">
							<Badge className="issue-hierarchy-badge">Parent</Badge>
							<IssueStatusBadge
								color={getProjectStatusColor(
									projectStatuses,
									parentIssue.status,
								)}
								label={getProjectStatusLabel(
									projectStatuses,
									parentIssue.status,
								)}
								status={parentIssue.status}
							/>
						</div>
					</Link>
				</section>
			) : null}

			<section className="issue-overview-block">
				<div className="issue-overview-toolbar">
					<span className="issue-overview-kicker">Title</span>
					{canWrite && !editingTitle ? (
						<Button
							size="sm"
							variant="ghost"
							className="h-7 w-7 p-0"
							aria-label="Edit title"
							title="Edit title"
							onClick={onStartTitleEdit}
						>
							<Pencil className="h-3.5 w-3.5" />
						</Button>
					) : null}
				</div>
				{editingTitle ? (
					<form className="space-y-2" onSubmit={onSubmitTitle}>
						<Input
							value={titleDraft}
							onChange={(event) => onTitleDraftChange(event.target.value)}
							autoFocus
						/>
						<div className="flex items-center gap-2">
							<Button type="submit" size="sm">
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								type="button"
								onClick={onCancelTitleEdit}
							>
								Cancel
							</Button>
						</div>
					</form>
				) : (
					<div className="space-y-3">
						<h1 className="m-0 text-4xl font-bold leading-tight tracking-[-0.02em] text-[var(--text)]">
							{currentIssue.title}
						</h1>
						{currentIssue.parentIssueId ? (
							<div>
								<Badge className="issue-hierarchy-badge">Sub-task</Badge>
							</div>
						) : null}
						{currentIssue.hasChildren ? (
							<div className="issue-progress-panel">
								<div className="flex items-center justify-between gap-3">
									<span className="issue-progress-text">Sub-task progress</span>
									<span className="issue-progress-text">
										{formatChildProgress(currentIssue)} (
										{roundCompletionRate(currentIssue)}%)
									</span>
								</div>
								<div className="issue-progress-bar" aria-hidden="true">
									<div
										className="issue-progress-bar-fill"
										style={{
											width: `${roundCompletionRate(currentIssue)}%`,
										}}
									/>
								</div>
							</div>
						) : null}
					</div>
				)}
			</section>

			<section className="issue-overview-block issue-overview-block-description">
				<div className="issue-overview-toolbar">
					<span className="issue-overview-kicker">Description</span>
					{canWrite && !editingDescription ? (
						<Button
							size="sm"
							variant="ghost"
							className="h-7 w-7 p-0"
							aria-label="Edit description"
							title="Edit description"
							onClick={onStartDescriptionEdit}
						>
							<Pencil className="h-3.5 w-3.5" />
						</Button>
					) : null}
				</div>
				{editingDescription ? (
					<div className="space-y-2">
						<Textarea
							value={descriptionDraft}
							onChange={(event) => onDescriptionDraftChange(event.target.value)}
						/>
						<div className="flex items-center gap-2">
							<Button size="sm" onClick={() => void onSaveDescription()}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={onCancelDescriptionEdit}
							>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<p className="m-0 whitespace-pre-wrap text-[1.05rem] leading-relaxed text-[var(--text)]">
						{currentIssue.description || "No description provided."}
					</p>
				)}
			</section>

			<IssueChecklistSection
				canWrite={canWrite}
				currentIssue={currentIssue}
				onChecklistItemsChange={onChecklistItemsChange}
			/>

			{!currentIssue.parentIssueId ? (
				<Card className="issue-subissues-card">
					<CardHeader className="pb-2">
						<div className="flex items-center justify-between gap-3">
							<CardTitle className="text-base">
								Sub-tasks ({childIssueRows.length})
							</CardTitle>
							{canWrite ? (
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={onOpenSubIssueForm}
								>
									<Plus className="mr-1.5 h-3.5 w-3.5" />
									Add sub-task
								</Button>
							) : null}
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{childIssueRows.length ? (
							<div className="issue-tree-children issue-tree-list">
								{childIssueRows.map((row) => (
									<div
										key={row.issue._id}
										className="issue-tree-node issue-tree-node-child"
									>
										<Link
											to="/issues/$issueId"
											params={{ issueId: row.issue._id }}
											className="issue-related-link no-underline"
										>
											<div className="flex items-center gap-2">
												<Badge className="issue-row-id-badge">
													#{row.issue.issueNumber}
												</Badge>
												<p className="m-0 text-sm font-medium text-[var(--text)]">
													{row.issue.title}
												</p>
											</div>
											<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
												{row.issue.description?.trim() || "No description"}
											</p>
											<div className="mt-2 flex flex-wrap items-center gap-2">
												<IssueStatusBadge
													color={getProjectStatusColor(
														projectStatuses,
														row.issue.status,
													)}
													label={getProjectStatusLabel(
														projectStatuses,
														row.issue.status,
													)}
													status={row.issue.status}
												/>
												<Badge>{issuePriorityLabel[row.issue.priority]}</Badge>
												{row.assignee ? (
													<Badge>{row.assignee.name}</Badge>
												) : null}
												{row.issue.hasChildren ? (
													<Badge className="issue-progress-badge">
														{formatChildProgress(row.issue)} (
														{roundCompletionRate(row.issue)}%)
													</Badge>
												) : null}
											</div>
										</Link>
									</div>
								))}
							</div>
						) : (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No sub-tasks yet.
							</p>
						)}
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}

function IssueChecklistSection({
	canWrite,
	currentIssue,
	onChecklistItemsChange,
}: {
	canWrite: boolean;
	currentIssue: IssueLike;
	onChecklistItemsChange: (items: IssueChecklistItem[]) => void;
}) {
	const normalizedChecklistItems = useMemo(
		() => normalizeIssueChecklistItems(currentIssue.checklistItems),
		[currentIssue.checklistItems],
	);
	const [editingChecklistItems, setEditingChecklistItems] = useState(
		normalizedChecklistItems,
	);
	const [autofocusChecklistItemId, setAutofocusChecklistItemId] = useState<
		string | null
	>(null);
	const checklistProgressLabel = formatChecklistProgress({
		checklistItems: editingChecklistItems,
	});
	const checklistCompletionRate = roundChecklistCompletionRate({
		checklistItems: editingChecklistItems,
	});

	useEffect(() => {
		setEditingChecklistItems(normalizedChecklistItems);
	}, [normalizedChecklistItems]);

	function persistChecklistItems(nextItems: IssueChecklistItem[]) {
		const normalizedItems = normalizeIssueChecklistItems(nextItems);
		setEditingChecklistItems(normalizedItems);
		void onChecklistItemsChange(normalizedItems);
	}

	function addChecklistItem() {
		const nextItem = createIssueChecklistItem(editingChecklistItems.length);
		setEditingChecklistItems([...editingChecklistItems, nextItem]);
		setAutofocusChecklistItemId(nextItem.id);
	}

	function updateChecklistItemText(itemId: string, text: string) {
		setEditingChecklistItems((current) =>
			current.map((item) => (item.id === itemId ? { ...item, text } : item)),
		);
	}

	function toggleChecklistItem(itemId: string) {
		const nextItems = editingChecklistItems.map((item) =>
			item.id === itemId ? { ...item, completed: !item.completed } : item,
		);
		persistChecklistItems(nextItems);
	}

	function moveChecklistItem(itemId: string, direction: "up" | "down") {
		const currentIndex = editingChecklistItems.findIndex(
			(item) => item.id === itemId,
		);
		if (currentIndex === -1) {
			return;
		}

		const targetIndex =
			direction === "up" ? currentIndex - 1 : currentIndex + 1;
		if (targetIndex < 0 || targetIndex >= editingChecklistItems.length) {
			return;
		}

		const nextItems = [...editingChecklistItems];
		const [movedItem] = nextItems.splice(currentIndex, 1);
		nextItems.splice(targetIndex, 0, movedItem);
		persistChecklistItems(nextItems);
	}

	function deleteChecklistItem(itemId: string) {
		persistChecklistItems(
			editingChecklistItems.filter((item) => item.id !== itemId),
		);
	}

	if (!canWrite && !normalizedChecklistItems.length) {
		return null;
	}

	return (
		<section className="issue-overview-block">
			<div className="issue-overview-toolbar">
				<div className="flex items-center gap-3">
					<span className="issue-overview-kicker">Checklist</span>
					{checklistProgressLabel ? (
						<Badge className="issue-progress-badge">
							{checklistProgressLabel} ({checklistCompletionRate}%)
						</Badge>
					) : null}
				</div>
				{canWrite ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 px-2"
						onClick={addChecklistItem}
					>
						<Plus className="mr-1.5 h-3.5 w-3.5" />
						Add item
					</Button>
				) : null}
			</div>

			{checklistProgressLabel ? (
				<div className="issue-progress-panel mb-3">
					<div className="flex items-center justify-between gap-3">
						<span className="issue-progress-text">Checklist progress</span>
						<span className="issue-progress-text">
							{checklistProgressLabel} ({checklistCompletionRate}%)
						</span>
					</div>
					<div className="issue-progress-bar" aria-hidden="true">
						<div
							className="issue-progress-bar-fill"
							style={{ width: `${checklistCompletionRate}%` }}
						/>
					</div>
				</div>
			) : null}

			{editingChecklistItems.length ? (
				<div className="issue-checklist-list">
					{editingChecklistItems.map((item, index) => (
						<div key={item.id} className="issue-checklist-item">
							<label className="issue-checklist-toggle">
								<input
									type="checkbox"
									checked={item.completed}
									disabled={!canWrite}
									onChange={() => toggleChecklistItem(item.id)}
								/>
							</label>
							{canWrite ? (
								<Input
									autoFocus={autofocusChecklistItemId === item.id}
									className={`issue-checklist-input${item.completed ? " issue-checklist-input-completed" : ""}`}
									value={item.text}
									placeholder="Checklist item"
									onBlur={() => {
										setAutofocusChecklistItemId(null);
										persistChecklistItems(editingChecklistItems);
									}}
									onChange={(event) =>
										updateChecklistItemText(item.id, event.target.value)
									}
								/>
							) : (
								<span
									className={`issue-checklist-static${item.completed ? " issue-checklist-input-completed" : ""}`}
								>
									{item.text}
								</span>
							)}
							{canWrite ? (
								<div className="issue-checklist-actions">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="h-8 w-8 p-0"
										disabled={index === 0}
										aria-label="Move checklist item up"
										onClick={() => moveChecklistItem(item.id, "up")}
									>
										<ArrowUp className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="h-8 w-8 p-0"
										disabled={index === editingChecklistItems.length - 1}
										aria-label="Move checklist item down"
										onClick={() => moveChecklistItem(item.id, "down")}
									>
										<ArrowDown className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="h-8 w-8 p-0 text-[var(--danger)] hover:text-[var(--danger)]"
										aria-label="Delete checklist item"
										onClick={() => deleteChecklistItem(item.id)}
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							) : null}
						</div>
					))}
				</div>
			) : (
				<p className="m-0 text-sm text-[var(--muted-text)]">
					No checklist items yet.
				</p>
			)}
		</section>
	);
}

type IssueMetadataPanelProps = {
	assignableUsers?: AssignableUserOption[];
	assigneeName?: string;
	canWrite: boolean;
	currentIssue: IssueLike;
	issueLists?: IssueListOption[];
	onAssigneeChange: (value: string) => void;
	onCustomFieldValuesChange: (
		values: Record<string, ProjectCustomFieldDraftValue>,
	) => void;
	onDueDateChange: (value: string) => void;
	onLabelsChange: (labels: string[]) => void;
	onListChange: (value: string) => void;
	onPriorityChange: (value: (typeof ISSUE_PRIORITIES)[number]) => void;
	onStatusChange: (value: ProjectStatusDefinition["key"]) => void;
	projectCustomFields: ProjectCustomFieldDefinition[];
	projectLabels: ProjectLabelDefinition[];
	projectStatuses: ProjectStatusDefinition[];
};

export function IssueMetadataPanel({
	assignableUsers,
	assigneeName,
	canWrite,
	currentIssue,
	issueLists,
	onAssigneeChange,
	onCustomFieldValuesChange,
	onDueDateChange,
	onLabelsChange,
	onListChange,
	onPriorityChange,
	onStatusChange,
	projectCustomFields,
	projectLabels,
	projectStatuses,
}: IssueMetadataPanelProps) {
	const customFieldDraftValues = useMemo(
		() =>
			normalizeIssueCustomFieldDraftValues(
				projectCustomFields,
				currentIssue.customFieldValues,
			),
		[projectCustomFields, currentIssue.customFieldValues],
	);
	const currentDueDateValue = useMemo(
		() =>
			currentIssue.dueDate
				? new Date(currentIssue.dueDate).toISOString().slice(0, 10)
				: "",
		[currentIssue.dueDate],
	);
	const [dueDateDraft, setDueDateDraft] = useState(currentDueDateValue);
	const [editingCustomFieldValues, setEditingCustomFieldValues] = useState(
		customFieldDraftValues,
	);
	const [editingTextCustomFieldKey, setEditingTextCustomFieldKey] = useState<
		string | null
	>(null);

	useEffect(() => {
		setEditingCustomFieldValues(customFieldDraftValues);
	}, [customFieldDraftValues]);

	useEffect(() => {
		setDueDateDraft(currentDueDateValue);
	}, [currentDueDateValue]);

	function updateCustomFieldValue(
		field: ProjectCustomFieldDefinition,
		value: ProjectCustomFieldDraftValue,
	) {
		const nextValues = {
			...editingCustomFieldValues,
			[field.key]: value,
		};
		setEditingCustomFieldValues(nextValues);
		if (field.type === "checkbox" || field.type === "select") {
			void onCustomFieldValuesChange(nextValues);
		}
	}

	function saveCustomFieldValues() {
		void onCustomFieldValuesChange(editingCustomFieldValues);
	}

	function saveAndCloseTextCustomField() {
		void onCustomFieldValuesChange(editingCustomFieldValues);
		setEditingTextCustomFieldKey(null);
	}

	return (
		<aside className="issue-detail-settings issue-meta-panel">
			<div className="issue-meta-row">
				<span className="issue-meta-label">List</span>
				<div className="issue-meta-value">
					{canWrite && !currentIssue.parentIssueId ? (
						<Select
							className="issue-meta-control"
							value={currentIssue.listId ?? ""}
							onChange={(event) => onListChange(event.target.value)}
						>
							<option value="">No list</option>
							{(issueLists ?? []).map((list) => (
								<option key={list._id} value={list._id}>
									{list.name}
								</option>
							))}
						</Select>
					) : (
						<span className="issue-meta-static">
							{issueLists?.find((list) => list._id === currentIssue.listId)
								?.name ?? "No list"}
						</span>
					)}
				</div>
			</div>

			<div className="issue-meta-row">
				<span className="issue-meta-label">Status</span>
				<div className="issue-meta-value">
					{canWrite ? (
						<Select
							className="issue-meta-control"
							value={currentIssue.status}
							onChange={(event) =>
								onStatusChange(
									event.target.value as ProjectStatusDefinition["key"],
								)
							}
						>
							{projectStatuses.map((status) => (
								<option key={status.key} value={status.key}>
									{status.name}
								</option>
							))}
						</Select>
					) : (
						<IssueStatusBadge
							color={getProjectStatusColor(
								projectStatuses,
								currentIssue.status,
							)}
							label={getProjectStatusLabel(
								projectStatuses,
								currentIssue.status,
							)}
							status={currentIssue.status}
						/>
					)}
				</div>
			</div>

			<div className="issue-meta-row">
				<span className="issue-meta-label">Priority</span>
				<div className="issue-meta-value">
					{canWrite ? (
						<Select
							className="issue-meta-control"
							value={currentIssue.priority}
							onChange={(event) =>
								onPriorityChange(
									event.target.value as (typeof ISSUE_PRIORITIES)[number],
								)
							}
						>
							{ISSUE_PRIORITIES.map((value) => (
								<option key={value} value={value}>
									{issuePriorityLabel[value]}
								</option>
							))}
						</Select>
					) : (
						<span className="issue-meta-static">
							{issuePriorityLabel[currentIssue.priority]}
						</span>
					)}
				</div>
			</div>

			<div className="issue-meta-row">
				<span className="issue-meta-label">Assignee</span>
				<div className="issue-meta-value">
					{canWrite ? (
						<Select
							className="issue-meta-control"
							value={currentIssue.assigneeId ?? ""}
							onChange={(event) => onAssigneeChange(event.target.value)}
						>
							<option value="">Unassigned</option>
							{(assignableUsers ?? []).map((user) => (
								<option key={user._id} value={user._id}>
									{user.name}
								</option>
							))}
						</Select>
					) : (
						<span className="issue-meta-static">
							{assigneeName ?? "Unassigned"}
						</span>
					)}
				</div>
			</div>

			<div className="issue-meta-row">
				<span className="issue-meta-label">Due Date</span>
				<div className="issue-meta-value">
					{canWrite ? (
						<Input
							className="issue-meta-control"
							type="date"
							value={dueDateDraft}
							onBlur={() => onDueDateChange(dueDateDraft)}
							onChange={(event) => setDueDateDraft(event.target.value)}
						/>
					) : (
						<span className="issue-meta-static">
							{currentIssue.dueDate
								? formatDate(currentIssue.dueDate)
								: "No due date"}
						</span>
					)}
				</div>
			</div>

			<div
				className={`issue-meta-row${projectCustomFields.length ? "" : " issue-meta-row-last"}`}
			>
				<span className="issue-meta-label">Labels</span>
				<div className="issue-meta-value">
					{canWrite ? (
						<ProjectLabelSelector
							labelOptions={projectLabels}
							selectedLabelKeys={currentIssue.labels}
							onChange={onLabelsChange}
						/>
					) : currentIssue.labels.length ? (
						<div className="flex flex-wrap justify-end gap-1.5">
							{currentIssue.labels.map((label) => (
								<IssueLabelBadge
									key={label}
									color={getProjectLabelColor(projectLabels, label)}
									label={getProjectLabelName(projectLabels, label)}
								/>
							))}
						</div>
					) : (
						<span className="issue-meta-static">None</span>
					)}
				</div>
			</div>

			{projectCustomFields.map((field, index) => (
				<div
					key={field.key}
					className={`issue-meta-row${index === projectCustomFields.length - 1 ? " issue-meta-row-last" : ""}`}
				>
					<span className="issue-meta-label">{field.name}</span>
					<div className="issue-meta-value">
						{canWrite && field.type === "text" ? (
							editingTextCustomFieldKey === field.key ||
							!editingCustomFieldValues[field.key] ? (
								<Textarea
									autoFocus={editingTextCustomFieldKey === field.key}
									className="max-w-[260px] text-left"
									rows={4}
									value={
										typeof editingCustomFieldValues[field.key] === "string"
											? editingCustomFieldValues[field.key]
											: ""
									}
									placeholder={`Add ${field.name.toLowerCase()}`}
									onBlur={saveAndCloseTextCustomField}
									onChange={(event) =>
										updateCustomFieldValue(field, event.target.value)
									}
								/>
							) : (
								<button
									type="button"
									className="max-w-[260px] cursor-text border-0 bg-transparent p-0 whitespace-pre-wrap text-left text-[0.96rem] text-[var(--text)]"
									onClick={() => setEditingTextCustomFieldKey(field.key)}
								>
									{editingCustomFieldValues[field.key]}
								</button>
							)
						) : canWrite ? (
							<ProjectCustomFieldInput
								className="issue-meta-control"
								field={field}
								value={
									editingCustomFieldValues[field.key] as
										| ProjectCustomFieldDraftValue
										| undefined
								}
								onBlur={saveCustomFieldValues}
								onChange={(value) => updateCustomFieldValue(field, value)}
							/>
						) : (
							<span className="issue-meta-static">
								{formatProjectCustomFieldValue(
									field,
									currentIssue.customFieldValues?.[field.key] as
										| string
										| boolean
										| undefined,
								)}
							</span>
						)}
					</div>
				</div>
			))}
		</aside>
	);
}
