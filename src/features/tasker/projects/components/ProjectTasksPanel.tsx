import { Plus } from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { RemovableIssueStatusBadge } from "#/features/tasker/components/IssueBadges";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issueStatusLabel,
} from "#/features/tasker/model";
import { cn } from "#/lib/utils";

type ProjectIssueGroup = {
	key: string;
	title: string;
	items: unknown[];
	tree: unknown[];
};

type KanbanColumn = {
	status: (typeof ISSUE_STATUSES)[number];
	title: string;
	items: unknown[];
	tree: unknown[];
};

type AssignableUserOption = {
	_id: string;
	name: string;
};

type ProjectTasksPanelProps = {
	assignableUsers?: AssignableUserOption[];
	assigneeId: string;
	canWrite: boolean;
	dragOverStatus: (typeof ISSUE_STATUSES)[number] | null;
	groupBy: string;
	groupedIssues: ProjectIssueGroup[];
	issueLayout: "list" | "kanban";
	kanbanColumns: KanbanColumn[];
	onAddStatusFilter: (value: string) => void;
	onAssigneeChange: (value: string) => void;
	onClearStatuses: () => void;
	onCreateTask: () => void;
	onGroupByChange: (value: string) => void;
	onKanbanColumnDragLeave: (status: (typeof ISSUE_STATUSES)[number]) => void;
	onKanbanColumnDragOver: (
		event: DragEvent<HTMLElement>,
		status: (typeof ISSUE_STATUSES)[number],
	) => void;
	onKanbanColumnDrop: (
		event: DragEvent<HTMLElement>,
		status: (typeof ISSUE_STATUSES)[number],
	) => void;
	onPriorityChange: (value: string) => void;
	onRemoveStatus: (value: (typeof ISSUE_STATUSES)[number]) => void;
	onSearchChange: (value: string) => void;
	onSortChange: (value: string) => void;
	onToggleLayout: (layout: "list" | "kanban") => void;
	priority: string;
	renderKanbanIssueNode: (node: unknown) => ReactNode;
	renderListIssueNode: (node: unknown) => ReactNode;
	search: string;
	selectedStatuses: (typeof ISSUE_STATUSES)[number][];
	showEmptyState: boolean;
	sortBy: string;
	statusPicker: string;
};

export function ProjectTasksPanel({
	assignableUsers,
	assigneeId,
	canWrite,
	dragOverStatus,
	groupBy,
	groupedIssues,
	issueLayout,
	kanbanColumns,
	onAddStatusFilter,
	onAssigneeChange,
	onClearStatuses,
	onCreateTask,
	onGroupByChange,
	onKanbanColumnDragLeave,
	onKanbanColumnDragOver,
	onKanbanColumnDrop,
	onPriorityChange,
	onRemoveStatus,
	onSearchChange,
	onSortChange,
	onToggleLayout,
	priority,
	renderKanbanIssueNode,
	renderListIssueNode,
	search,
	selectedStatuses,
	showEmptyState,
	sortBy,
	statusPicker,
}: ProjectTasksPanelProps) {
	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
				<CardTitle>Tasks</CardTitle>
				{canWrite ? (
					<Button variant="secondary" onClick={onCreateTask}>
						<Plus className="mr-2 h-4 w-4" />
						New Task
					</Button>
				) : null}
			</CardHeader>
			<CardContent>
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<div className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1">
						<Button
							type="button"
							size="sm"
							variant={issueLayout === "list" ? "secondary" : "ghost"}
							className="h-7 px-3"
							onClick={() => onToggleLayout("list")}
						>
							List
						</Button>
						<Button
							type="button"
							size="sm"
							variant={issueLayout === "kanban" ? "secondary" : "ghost"}
							className="h-7 px-3"
							onClick={() => onToggleLayout("kanban")}
						>
							Kanban
						</Button>
					</div>
					{issueLayout === "kanban" ? (
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Drag cards between status columns to update status.
						</p>
					) : null}
				</div>

				<div
					className={cn(
						"mb-3 grid gap-2",
						issueLayout === "list" ? "md:grid-cols-6" : "md:grid-cols-5",
					)}
				>
					<Input
						value={search}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search tasks"
					/>
					<Select
						value={statusPicker}
						onChange={(event) => onAddStatusFilter(event.target.value)}
					>
						<option value="">Add status filter</option>
						{ISSUE_STATUSES.map((value) => (
							<option
								key={value}
								value={value}
								disabled={selectedStatuses.includes(value)}
							>
								{issueStatusLabel[value]}
							</option>
						))}
					</Select>
					<Select
						value={priority}
						onChange={(event) => onPriorityChange(event.target.value)}
					>
						<option value="">All priority</option>
						{ISSUE_PRIORITIES.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</Select>
					<Select
						value={assigneeId}
						onChange={(event) => onAssigneeChange(event.target.value)}
					>
						<option value="">All assignees</option>
						{(assignableUsers ?? []).map((user) => (
							<option key={user._id} value={user._id}>
								{user.name}
							</option>
						))}
					</Select>
					{issueLayout === "list" ? (
						<Select
							value={groupBy}
							onChange={(event) => onGroupByChange(event.target.value)}
						>
							<option value="list">Group: List</option>
							<option value="status">Group: Status</option>
						</Select>
					) : null}
					<Select
						value={sortBy}
						onChange={(event) => onSortChange(event.target.value)}
					>
						<option value="updated_desc">Updated</option>
						<option value="created_desc">Created</option>
						<option value="priority_desc">Priority</option>
						<option value="due_asc">Due date</option>
					</Select>
				</div>

				{selectedStatuses.length ? (
					<div className="mb-3 flex flex-wrap items-center gap-2">
						{selectedStatuses.map((value) => (
							<RemovableIssueStatusBadge
								key={value}
								status={value}
								onRemove={() => onRemoveStatus(value)}
							/>
						))}
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={onClearStatuses}
						>
							Clear statuses
						</Button>
					</div>
				) : null}

				{issueLayout === "list" ? (
					<div className="space-y-4">
						{groupedIssues.map((group) => (
							<div key={group.key} className="space-y-2">
								<div className="flex items-center justify-between">
									<p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
										{group.title}
									</p>
									<Badge>{group.items.length}</Badge>
								</div>

								{group.tree.map((node, index) => (
									<div key={`${group.key}-${index}`}>
										{renderListIssueNode(node)}
									</div>
								))}
							</div>
						))}
						{showEmptyState ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No tasks found.
							</p>
						) : null}
					</div>
				) : (
					<div className="kanban-board">
						{kanbanColumns.map((column) => (
							<section
								key={column.status}
								aria-label={`${column.title} column`}
								className={cn(
									"kanban-column",
									dragOverStatus === column.status
										? "kanban-column-active"
										: "",
								)}
								onDragOver={(event) =>
									onKanbanColumnDragOver(event, column.status)
								}
								onDragLeave={() => onKanbanColumnDragLeave(column.status)}
								onDrop={(event) => onKanbanColumnDrop(event, column.status)}
							>
								<div className="kanban-column-header">
									<p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
										{column.title}
									</p>
									<Badge>{column.items.length}</Badge>
								</div>
								<div className="kanban-column-body">
									{column.items.length ? (
										column.tree.map((node, index) => (
											<div key={`${column.status}-${index}`}>
												{renderKanbanIssueNode(node)}
											</div>
										))
									) : (
										<p className="kanban-empty">No tasks in this status.</p>
									)}
								</div>
							</section>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
