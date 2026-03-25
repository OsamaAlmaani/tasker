import { Link } from "@tanstack/react-router";
import type { DragEvent, ReactNode } from "react";
import { Badge } from "#/components/ui/badge";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { formatDate } from "#/features/tasker/format";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";
import { cn } from "#/lib/utils";

type ProjectAssignableUser = {
	_id: string;
	imageUrl?: string | null;
	name: string;
};

type ProjectIssue = {
	_id: string;
	assigneeId?: string | null;
	childCompletionRate: number;
	childIssueCount: number;
	completedChildIssueCount: number;
	description?: string | null;
	dueDate?: number | null;
	hasChildren: boolean;
	issueNumber: number;
	parentIssueId?: string | null;
	priority: (typeof ISSUE_PRIORITIES)[number];
	status: (typeof ISSUE_STATUSES)[number];
	title: string;
};

export type ProjectIssueTreeNode = {
	issue: ProjectIssue;
	children: ProjectIssueTreeNode[];
};

function formatChildProgress(issue: ProjectIssue) {
	if (!issue.hasChildren) {
		return null;
	}

	return `${issue.completedChildIssueCount}/${issue.childIssueCount} done`;
}

function roundCompletionRate(issue: ProjectIssue) {
	return Math.round(issue.childCompletionRate * 100);
}

function InlineSelectTrigger({
	ariaLabel,
	value,
	options,
	onChange,
	children,
	className,
}: {
	ariaLabel: string;
	value: string;
	options: Array<{ value: string; label: string; disabled?: boolean }>;
	onChange: (value: string) => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<label className={cn("issue-inline-select", className)}>
			<span className="issue-inline-select-display">{children}</span>
			<select
				aria-label={ariaLabel}
				className="issue-inline-select-native"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function AssigneeAvatar({
	name,
	imageUrl,
	unassigned = false,
}: {
	name?: string;
	imageUrl?: string | null;
	unassigned?: boolean;
}) {
	const initials =
		name
			?.split(" ")
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() ?? "?";

	return (
		<span
			className={cn(
				"issue-assignee-avatar",
				unassigned ? "issue-assignee-avatar-unassigned" : "",
			)}
			title={name ?? "Unassigned"}
		>
			{imageUrl && !unassigned ? (
				<img
					src={imageUrl}
					alt={name ?? "Assignee"}
					className="h-full w-full object-cover"
				/>
			) : unassigned ? null : (
				initials
			)}
		</span>
	);
}

type ProjectIssueListTreeProps = {
	assignableUserById: Map<string, ProjectAssignableUser>;
	assignableUsers?: ProjectAssignableUser[];
	canWrite: boolean;
	nodes: ProjectIssueTreeNode[];
	onAssigneeChange: (issueId: string, nextAssigneeId: string) => void;
	onPriorityChange: (
		issueId: string,
		nextPriority: (typeof ISSUE_PRIORITIES)[number],
	) => void;
	onStatusChange: (
		issue: ProjectIssue,
		nextStatus: (typeof ISSUE_STATUSES)[number],
	) => void;
};

export function ProjectIssueListTree({
	assignableUserById,
	assignableUsers,
	canWrite,
	nodes,
	onAssigneeChange,
	onPriorityChange,
	onStatusChange,
}: ProjectIssueListTreeProps) {
	return (
		<>
			{nodes.map((node) => {
				const { issue, children } = node;
				const assignee = issue.assigneeId
					? assignableUserById.get(issue.assigneeId)
					: null;
				const progressLabel = formatChildProgress(issue);
				const completionRate = roundCompletionRate(issue);

				return (
					<div
						key={issue._id}
						className={cn(
							"issue-tree-node",
							issue.parentIssueId ? "issue-tree-node-child" : "",
						)}
					>
						<div
							className={cn(
								"issue-row issue-row-compact",
								issue.parentIssueId ? "issue-row-subissue" : "",
							)}
						>
							<Link
								to="/issues/$issueId"
								params={{ issueId: issue._id }}
								className="issue-row-main no-underline"
							>
								<div className="min-w-0">
									<div className="flex min-w-0 items-center gap-2">
										<Badge className="issue-row-id-badge">
											#{issue.issueNumber}
										</Badge>
										<p className="m-0 truncate whitespace-nowrap text-sm font-medium text-[var(--text)]">
											{issue.title}
										</p>
									</div>
									<p className="m-0 truncate whitespace-nowrap text-xs text-[var(--muted-text)]">
										{issue.description?.trim() || "No description"}
									</p>
									{progressLabel ? (
										<div className="issue-progress-inline">
											<div className="issue-progress-bar" aria-hidden="true">
												<div
													className="issue-progress-bar-fill"
													style={{ width: `${completionRate}%` }}
												/>
											</div>
											<span className="issue-progress-text">
												{progressLabel} ({completionRate}%)
											</span>
										</div>
									) : null}
								</div>
							</Link>

							<div className="issue-row-col issue-row-col-assignee">
								{canWrite ? (
									<InlineSelectTrigger
										ariaLabel="Assign task"
										value={issue.assigneeId ?? ""}
										onChange={(nextAssigneeId) =>
											onAssigneeChange(issue._id, nextAssigneeId)
										}
										options={[
											{ value: "", label: "Unassigned" },
											...(assignableUsers ?? []).map((user) => ({
												value: user._id,
												label: user.name,
											})),
										]}
										className="issue-inline-select-assignee"
									>
										<AssigneeAvatar
											name={assignee?.name}
											imageUrl={assignee?.imageUrl}
											unassigned={!assignee}
										/>
									</InlineSelectTrigger>
								) : (
									<AssigneeAvatar
										name={assignee?.name}
										imageUrl={assignee?.imageUrl}
										unassigned={!assignee}
									/>
								)}
							</div>

							<div className="issue-row-col issue-row-col-due">
								<Badge className="issue-row-badge">
									{issue.dueDate ? formatDate(issue.dueDate) : "No due"}
								</Badge>
							</div>

							<div className="issue-row-col issue-row-col-status">
								{canWrite ? (
									<InlineSelectTrigger
										ariaLabel="Update status"
										value={issue.status}
										onChange={(nextStatus) =>
											onStatusChange(
												issue,
												nextStatus as (typeof ISSUE_STATUSES)[number],
											)
										}
										options={ISSUE_STATUSES.map((value) => ({
											value,
											label: issueStatusLabel[value],
										}))}
										className="issue-inline-select-full"
									>
										<span className="issue-row-badge-slot">
											<IssueStatusBadge status={issue.status} />
										</span>
									</InlineSelectTrigger>
								) : (
									<span className="issue-row-badge-slot">
										<IssueStatusBadge status={issue.status} />
									</span>
								)}
							</div>

							<div className="issue-row-col issue-row-col-priority">
								{canWrite ? (
									<InlineSelectTrigger
										ariaLabel="Update priority"
										value={issue.priority}
										onChange={(nextPriority) =>
											onPriorityChange(
												issue._id,
												nextPriority as (typeof ISSUE_PRIORITIES)[number],
											)
										}
										options={ISSUE_PRIORITIES.map((value) => ({
											value,
											label: issuePriorityLabel[value],
										}))}
										className="issue-inline-select-full"
									>
										<span className="issue-row-badge-slot">
											<IssuePriorityBadge priority={issue.priority} />
										</span>
									</InlineSelectTrigger>
								) : (
									<span className="issue-row-badge-slot">
										<IssuePriorityBadge priority={issue.priority} />
									</span>
								)}
							</div>
						</div>

						{children.length ? (
							<div className="issue-tree-children">
								<ProjectIssueListTree
									assignableUserById={assignableUserById}
									assignableUsers={assignableUsers}
									canWrite={canWrite}
									nodes={children}
									onAssigneeChange={onAssigneeChange}
									onPriorityChange={onPriorityChange}
									onStatusChange={onStatusChange}
								/>
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}

type ProjectIssueKanbanTreeProps = {
	assignableUserById: Map<string, ProjectAssignableUser>;
	canWrite: boolean;
	draggingIssueId: string | null;
	nodes: ProjectIssueTreeNode[];
	onDragEnd: () => void;
	onDragStart: (event: DragEvent<HTMLElement>, issue: ProjectIssue) => void;
};

export function ProjectIssueKanbanTree({
	assignableUserById,
	canWrite,
	draggingIssueId,
	nodes,
	onDragEnd,
	onDragStart,
}: ProjectIssueKanbanTreeProps) {
	return (
		<>
			{nodes.map((node) => {
				const { issue, children } = node;
				const assignee = issue.assigneeId
					? assignableUserById.get(issue.assigneeId)
					: null;
				const progressLabel = formatChildProgress(issue);
				const completionRate = roundCompletionRate(issue);

				return (
					<div
						key={issue._id}
						className={cn(
							"kanban-tree-node",
							issue.parentIssueId ? "kanban-tree-node-child" : "",
						)}
					>
						<article
							aria-label={`Task ${issue.issueNumber}`}
							className={cn(
								"kanban-card",
								issue.parentIssueId ? "kanban-card-subissue" : "",
								draggingIssueId === issue._id ? "kanban-card-dragging" : "",
							)}
							draggable={canWrite}
							onDragStart={(event) => onDragStart(event, issue)}
							onDragEnd={onDragEnd}
						>
							<Link
								to="/issues/$issueId"
								params={{ issueId: issue._id }}
								className="kanban-card-link no-underline"
							>
								<div className="flex items-center gap-2">
									<Badge className="issue-row-id-badge">
										#{issue.issueNumber}
									</Badge>
									<p className="m-0 truncate text-sm font-medium text-[var(--text)]">
										{issue.title}
									</p>
								</div>
								<p className="m-0 mt-1 truncate text-xs text-[var(--muted-text)]">
									{issue.description?.trim() || "No description"}
								</p>
								<div className="mt-2 flex flex-wrap items-center gap-1.5">
									{progressLabel ? (
										<Badge className="issue-progress-badge">
											{progressLabel} ({completionRate}%)
										</Badge>
									) : null}
								</div>
								{progressLabel ? (
									<div className="issue-progress-inline mt-2">
										<div className="issue-progress-bar" aria-hidden="true">
											<div
												className="issue-progress-bar-fill"
												style={{ width: `${completionRate}%` }}
											/>
										</div>
									</div>
								) : null}
							</Link>

							<div className="mt-2 flex items-center justify-between gap-2">
								<div className="flex items-center gap-1.5">
									<AssigneeAvatar
										name={assignee?.name}
										imageUrl={assignee?.imageUrl}
										unassigned={!assignee}
									/>
									{issue.dueDate ? (
										<Badge className="px-1.5 py-0 text-[10px]">
											{formatDate(issue.dueDate)}
										</Badge>
									) : null}
								</div>
								<IssuePriorityBadge priority={issue.priority} />
							</div>
						</article>

						{children.length ? (
							<div className="kanban-subcards">
								<ProjectIssueKanbanTree
									assignableUserById={assignableUserById}
									canWrite={canWrite}
									draggingIssueId={draggingIssueId}
									nodes={children}
									onDragEnd={onDragEnd}
									onDragStart={onDragStart}
								/>
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}
