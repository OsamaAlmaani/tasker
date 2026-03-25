import { Link } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { formatDate } from "#/features/tasker/format";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";

type IssueLike = {
	_id: string;
	assigneeId?: string | null;
	childCompletionRate: number;
	childIssueCount: number;
	completedChildIssueCount: number;
	description?: string | null;
	dueDate?: number | null;
	hasChildren: boolean;
	issueNumber: number;
	labels: string[];
	listId?: string | null;
	parentIssueId?: string | null;
	priority: (typeof ISSUE_PRIORITIES)[number];
	status: (typeof ISSUE_STATUSES)[number];
	title: string;
};

type ParentIssueSummary = {
	_id: string;
	issueNumber: number;
	status: (typeof ISSUE_STATUSES)[number];
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
	onCancelDescriptionEdit: () => void;
	onCancelTitleEdit: () => void;
	onDescriptionDraftChange: (value: string) => void;
	onOpenSubIssueForm: () => void;
	onSaveDescription: () => void | Promise<void>;
	onStartDescriptionEdit: () => void;
	onStartTitleEdit: () => void;
	onSubmitTitle: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
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
	onCancelDescriptionEdit,
	onCancelTitleEdit,
	onDescriptionDraftChange,
	onOpenSubIssueForm,
	onSaveDescription,
	onStartDescriptionEdit,
	onStartTitleEdit,
	onSubmitTitle,
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
							<Badge>{issueStatusLabel[parentIssue.status]}</Badge>
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
												<Badge className="issue-hierarchy-badge">
													Sub-task
												</Badge>
											</div>
											<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
												{row.issue.description?.trim() || "No description"}
											</p>
											<div className="mt-2 flex flex-wrap items-center gap-2">
												<Badge>{issueStatusLabel[row.issue.status]}</Badge>
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

type IssueMetadataPanelProps = {
	assignableUsers?: AssignableUserOption[];
	assigneeName?: string;
	canWrite: boolean;
	currentIssue: IssueLike;
	issueLists?: IssueListOption[];
	onAssigneeChange: (value: string) => void;
	onDueDateChange: (value: string) => void;
	onListChange: (value: string) => void;
	onPriorityChange: (value: (typeof ISSUE_PRIORITIES)[number]) => void;
	onStatusChange: (value: (typeof ISSUE_STATUSES)[number]) => void;
};

export function IssueMetadataPanel({
	assignableUsers,
	assigneeName,
	canWrite,
	currentIssue,
	issueLists,
	onAssigneeChange,
	onDueDateChange,
	onListChange,
	onPriorityChange,
	onStatusChange,
}: IssueMetadataPanelProps) {
	return (
		<aside className="issue-detail-settings issue-meta-panel">
			<div className="issue-meta-row">
				<span className="issue-meta-label">List</span>
				<div className="issue-meta-value">
					{canWrite ? (
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
									event.target.value as (typeof ISSUE_STATUSES)[number],
								)
							}
						>
							{ISSUE_STATUSES.map((value) => (
								<option key={value} value={value}>
									{issueStatusLabel[value]}
								</option>
							))}
						</Select>
					) : (
						<span className="issue-meta-static">
							{issueStatusLabel[currentIssue.status]}
						</span>
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
							value={
								currentIssue.dueDate
									? new Date(currentIssue.dueDate).toISOString().slice(0, 10)
									: ""
							}
							onChange={(event) => onDueDateChange(event.target.value)}
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

			<div className="issue-meta-row issue-meta-row-last">
				<span className="issue-meta-label">Labels</span>
				<div className="issue-meta-value">
					{currentIssue.labels.length ? (
						<div className="flex flex-wrap justify-end gap-1.5">
							{currentIssue.labels.map((label) => (
								<Badge key={label} className="issue-meta-tag">
									{label}
								</Badge>
							))}
						</div>
					) : (
						<span className="issue-meta-static">None</span>
					)}
				</div>
			</div>
		</aside>
	);
}
