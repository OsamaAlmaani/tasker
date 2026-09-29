// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueBulkActionsBar } from "#/features/tasker/issues/components/IssueBulkActionsBar";
import { buildGroupedIssues } from "#/features/tasker/projects/issueGrouping";
import { ProjectTasksPanel } from "./ProjectTasksPanel";

afterEach(cleanup);

const issues = [
	{ _id: "parent", listId: "a", status: "todo" },
	{ _id: "child", listId: "a", parentIssueId: "parent", status: "done" },
	{ _id: "other", listId: "b", status: "todo" },
];
const lists = new Map([
	["a", { _id: "a", name: "Alpha" }],
	["b", { _id: "b", name: "Beta" }],
]);

function panelProps(
	overrides: Partial<ComponentProps<typeof ProjectTasksPanel>> = {},
): ComponentProps<typeof ProjectTasksPanel> {
	const noop = vi.fn();
	return {
		archiveState: "active",
		archivedCount: 0,
		assigneeId: "",
		canWrite: true,
		dragOverStatus: null,
		emptyStateDescription: "No tasks",
		emptyStateTitle: "No tasks",
		groupBy: "list",
		groupedIssues: buildGroupedIssues(issues, "list", lists),
		hideDoneTasks: false,
		issueLayout: "list",
		isApplyingBulkAction: false,
		kanbanColumns: [],
		onAddStatusFilter: noop,
		onArchiveStateChange: noop,
		onAssigneeChange: noop,
		onClearStatuses: noop,
		onCreateTask: noop,
		onGroupByChange: noop,
		onHideDoneTasksChange: noop,
		onKanbanColumnDragLeave: noop,
		onKanbanColumnDragOver: noop,
		onKanbanColumnDrop: noop,
		onPriorityChange: noop,
		onRemoveStatus: noop,
		onSearchChange: noop,
		onSelectionChange: vi.fn(),
		onSortChange: noop,
		onToggleLayout: noop,
		priority: "",
		renderKanbanIssueNode: () => null,
		renderListIssueNode: () => null,
		search: "",
		selectedIssueIds: new Set(),
		selectedStatuses: [],
		showEmptyState: false,
		sortBy: "updated_desc",
		statusOptions: [],
		statusPicker: "",
		...overrides,
	};
}

describe("list selection", () => {
	it("selects all displayed tasks including nested children", () => {
		const props = panelProps();
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible tasks" }),
		);
		expect(props.onSelectionChange).toHaveBeenCalledWith(
			["parent", "child", "other"],
			true,
		);
	});

	it("limits group selection and deselection to that group's tasks", () => {
		const props = panelProps({
			selectedIssueIds: new Set(["parent", "child", "other"]),
		});
		const { rerender } = render(<ProjectTasksPanel {...props} />);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all tasks in Alpha" }),
		);
		expect(props.onSelectionChange).toHaveBeenLastCalledWith(
			["parent", "child"],
			false,
		);
		rerender(
			<ProjectTasksPanel {...props} selectedIssueIds={new Set(["other"])} />,
		);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all tasks in Alpha" }),
		);
		expect(props.onSelectionChange).toHaveBeenLastCalledWith(
			["parent", "child"],
			true,
		);
	});

	it("shows mixed states and selects the remaining tasks when clicked", () => {
		const props = panelProps({ selectedIssueIds: new Set(["parent"]) });
		const { rerender } = render(<ProjectTasksPanel {...props} />);
		const all = screen.getByRole<HTMLInputElement>("checkbox", {
			name: "Select all visible tasks",
		});
		const group = screen.getByRole<HTMLInputElement>("checkbox", {
			name: "Select all tasks in Alpha",
		});
		expect(all.indeterminate).toBe(true);
		expect(group.getAttribute("aria-checked")).toBe("mixed");
		fireEvent.click(all);
		expect(props.onSelectionChange).toHaveBeenLastCalledWith(
			["parent", "child", "other"],
			true,
		);
		rerender(
			<ProjectTasksPanel
				{...props}
				selectedIssueIds={new Set(["parent", "child", "other"])}
			/>,
		);
		expect(all.checked).toBe(true);
		expect(all.indeterminate).toBe(false);
		fireEvent.click(all);
		expect(props.onSelectionChange).toHaveBeenLastCalledWith(
			["parent", "child", "other"],
			false,
		);
	});

	it("selects only filtered tasks when grouping by status", () => {
		const props = panelProps({
			groupBy: "status",
			groupedIssues: buildGroupedIssues([issues[1]], "status", lists),
		});
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all tasks in Done" }),
		);
		expect(props.onSelectionChange).toHaveBeenCalledWith(["child"], true);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible tasks" }),
		);
		expect(props.onSelectionChange).toHaveBeenLastCalledWith(["child"], true);
	});

	it("disables selection while a bulk action is saving", () => {
		render(
			<ProjectTasksPanel {...panelProps({ isApplyingBulkAction: true })} />,
		);
		for (const checkbox of screen.getAllByRole<HTMLInputElement>("checkbox")) {
			expect(checkbox.disabled).toBe(true);
		}
	});

	it.each([
		{ canWrite: false },
		{ groupedIssues: [], showEmptyState: true },
		{ issueLayout: "kanban" as const },
	])("hides select-all when unavailable: %j", (overrides) => {
		render(<ProjectTasksPanel {...panelProps(overrides)} />);
		expect(screen.queryByRole("checkbox", { name: /Select all/ })).toBeNull();
	});
});

describe("bulk delete control", () => {
	it("offers deletion only when a delete handler is supplied and disables it during saves", () => {
		const onDelete = vi.fn();
		const props = {
			selectedCount: 3,
			onClearSelection: vi.fn(),
			onArchiveChange: vi.fn(),
			onPriorityChange: vi.fn(),
		};
		const { rerender } = render(<IssueBulkActionsBar {...props} />);
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		rerender(<IssueBulkActionsBar {...props} onDelete={onDelete} />);
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onDelete).toHaveBeenCalledOnce();
		rerender(<IssueBulkActionsBar {...props} onDelete={onDelete} isApplying />);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Delete" })
				.disabled,
		).toBe(true);
	});
});
