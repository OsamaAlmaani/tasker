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
		dateFilters: {},
		onDateFiltersChange: noop,
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
	it("offers an unassigned filter and forwards date ranges", () => {
		const props = panelProps();
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.change(
			screen.getByRole("combobox", { name: "Assignee filter" }),
			{ target: { value: "unassigned" } },
		);
		expect(props.onAssigneeChange).toHaveBeenCalledWith("unassigned");
		fireEvent.click(screen.getByText("Dates"));
		fireEvent.change(screen.getByLabelText("Start date from"), {
			target: { value: "2026-10-01" },
		});
		fireEvent.change(screen.getByLabelText("Due date to"), {
			target: { value: "2026-10-06" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(props.onDateFiltersChange).toHaveBeenCalledWith({
			startFrom: "2026-10-01",
			startTo: undefined,
			dueFrom: undefined,
			dueTo: "2026-10-06",
		});
	});
	it("keeps invalid date drafts out of the active filters", () => {
		const props = panelProps();
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Filters" }));
		fireEvent.click(screen.getByText("Dates"));
		fireEvent.change(screen.getByLabelText("Due date from"), {
			target: { value: "2026-10-06" },
		});
		fireEvent.change(screen.getByLabelText("Due date to"), {
			target: { value: "2026-10-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(props.onDateFiltersChange).not.toHaveBeenCalled();
		expect(screen.getByRole("alert").textContent).toContain("cannot be after");
	});
	it("clears all four date bounds", () => {
		const props = panelProps({
			dateFilters: { startFrom: "2026-10-01", dueTo: "2026-10-06" },
		});
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }));
		fireEvent.click(screen.getByText("Dates (2)"));
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(props.onDateFiltersChange).toHaveBeenCalledWith({
			startFrom: undefined,
			startTo: undefined,
			dueFrom: undefined,
			dueTo: undefined,
		});
	});
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

describe("compact toolbar", () => {
	it("toggles the filter row without clearing filters or remounting the task view", () => {
		const props = panelProps({
			search: "waste",
			assigneeId: "unassigned",
			dateFilters: { dueTo: "2026-10-20" },
			resultSummary: '3 tasks match "waste"',
			renderListIssueNode: () => <span>Task card</span>,
		});
		render(<ProjectTasksPanel {...props} />);
		const toggle = screen.getByRole("button", { name: "Filters (3)" });
		const taskCard = screen.getAllByText("Task card")[0];
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByPlaceholderText("Search tasks")).toBeNull();
		expect(screen.getByText('3 tasks match "waste"')).toBeTruthy();

		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByDisplayValue("waste")).toBeTruthy();
		expect(screen.getByDisplayValue("Unassigned")).toBeTruthy();
		expect(
			document.getElementById(toggle.getAttribute("aria-controls") ?? ""),
		).toBeTruthy();

		fireEvent.click(toggle);
		expect(screen.queryByPlaceholderText("Search tasks")).toBeNull();
		expect(taskCard.isConnected).toBe(true);
		expect(props.onSearchChange).not.toHaveBeenCalled();
		expect(props.onAssigneeChange).not.toHaveBeenCalled();
		fireEvent.click(toggle);
		expect(screen.getByDisplayValue("waste")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New Task" }));
		expect(props.onCreateTask).toHaveBeenCalledOnce();
	});
});

describe("sheet layout", () => {
	it.each([
		"list",
		"kanban",
		"calendar",
		"gantt",
		"sheet",
	] as const)("shows initial loading in the toolbar for %s without false empty messages", (issueLayout) => {
		const props = panelProps({
			issueLayout,
			isLoading: true,
			showEmptyState: true,
			groupedIssues: [],
			sheet: <div>Sheet grid</div>,
			calendar: <div>Calendar grid</div>,
			gantt: <div>Gantt grid</div>,
		});
		const { rerender } = render(<ProjectTasksPanel {...props} />);
		expect(screen.getByRole("status", { name: "Loading tasks" })).toBeTruthy();
		expect(screen.queryByText("No tasks")).toBeNull();
		const view = ["sheet", "calendar", "gantt"].includes(issueLayout)
			? screen.getByText(
					`${issueLayout === "sheet" ? "Sheet" : issueLayout === "calendar" ? "Calendar" : "Gantt"} grid`,
				)
			: undefined;
		rerender(<ProjectTasksPanel {...props} isLoading={false} />);
		expect(screen.queryByRole("status", { name: "Loading tasks" })).toBeNull();
		if (view) expect(view.isConnected).toBe(true);
		else expect(screen.getAllByText("No tasks").length).toBeGreaterThan(0);
	});
	it("switches to Sheet, renders its grid and retains bulk controls", () => {
		const props = panelProps({
			issueLayout: "sheet",
			sheet: <div>Sheet grid</div>,
			bulkActions: <div>Bulk actions</div>,
		});
		render(<ProjectTasksPanel {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Sheet" }));
		expect(props.onToggleLayout).toHaveBeenCalledWith("sheet");
		expect(screen.getByText("Sheet grid")).toBeTruthy();
		expect(screen.getByText("Bulk actions")).toBeTruthy();
		expect(screen.queryByText("Group: List")).toBeNull();
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
