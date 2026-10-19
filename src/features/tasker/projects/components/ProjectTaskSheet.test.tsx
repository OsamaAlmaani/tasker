// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectIssueRow } from "../useProjectDetailPage";
import ProjectTaskSheet from "./ProjectTaskSheet";

beforeAll(() => {
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(5000);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
});
afterEach(cleanup);

const issue = {
	_id: "task",
	title: "Original task",
	issueNumber: 1,
	status: "todo",
	priority: "none",
	labels: [],
	customFieldValues: { points: 3, approved: false },
	childIssueCount: 0,
	completedChildIssueCount: 0,
	checklistItemCount: 0,
	completedChecklistItemCount: 0,
} as unknown as ProjectIssueRow;

function props(
	overrides: Partial<ComponentProps<typeof ProjectTaskSheet>> = {},
): ComponentProps<typeof ProjectTaskSheet> {
	return {
		issues: [issue],
		projectKey: "TEST",
		canWrite: true,
		disabled: false,
		statuses: [
			{ key: "todo", name: "To do", color: "#000", position: 0 },
			{ key: "done", name: "Done", color: "#000", position: 1 },
		],
		customFields: [
			{ key: "points", name: "Points", type: "number", position: 0 },
			{ key: "approved", name: "Approved", type: "checkbox", position: 1 },
			{ key: "date", name: "Review date", type: "date", position: 2 },
			{
				key: "select",
				name: "Team",
				type: "select",
				position: 3,
				options: ["A", "B"],
			},
		],
		labels: [{ key: "bug", name: "Bug", color: "#000", position: 0 }],
		users: [],
		lists: [],
		parents: [],
		selectedIssueIds: new Set(),
		onSelectionChange: vi.fn(),
		onUpdate: vi.fn().mockResolvedValue(undefined),
		onStatusChange: vi.fn().mockResolvedValue(undefined),
		onOpenIssue: vi.fn(),
		...overrides,
	};
}
function cell(column: number, row = 2) {
	const result = screen
		.getByRole("grid")
		.querySelector<HTMLElement>(
			`[role="row"][aria-rowindex="${row}"] [aria-colindex="${column}"]`,
		);
	if (!result) throw new Error(`Missing column ${column}`);
	return result;
}

describe("task sheet using the real React Data Grid", () => {
	it("keeps the sheet mounted while its initial loading count resolves", () => {
		const p = props({ issues: [], isLoading: true });
		const { rerender } = render(<ProjectTaskSheet {...p} />);
		const grid = screen.getByRole("grid", { name: "Task sheet" });
		expect(screen.getByRole("status").textContent).toBe("Loading tasks…");
		expect(screen.queryByText(/Double-click or press Enter/)).toBeNull();
		rerender(<ProjectTaskSheet {...p} isLoading={false} />);
		expect(screen.getByRole("grid")).toBe(grid);
		expect(screen.getByRole("status").textContent).toBe("0 tasks");
	});
	it.each([
		"Enter",
		"Escape",
	])("keeps drafts through live refreshes and reordering until %s", async (key) => {
		const second = { ...issue, _id: "second" as ProjectIssueRow["_id"] };
		const p = props({ issues: [issue, second] });
		const { rerender } = render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(3));
		fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
			target: { value: "Unsaved draft" },
		});
		rerender(
			<ProjectTaskSheet
				{...p}
				parents={[{ value: "second", label: "Changed by teammate" }]}
				issues={[
					{ ...second, title: "Changed by teammate" },
					{ ...issue, title: "Refreshed task" },
				]}
			/>,
		);
		expect(
			(screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
				.value,
		).toBe("Unsaved draft");
		expect(p.onUpdate).not.toHaveBeenCalled();
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key,
		});
		await waitFor(() =>
			expect(cell(3).textContent).toBe("Changed by teammate"),
		);
		if (key === "Enter") {
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				title: "Unsaved draft",
			});
		} else {
			expect(p.onUpdate).not.toHaveBeenCalled();
		}
	});
	it("merges a custom cell edit with the latest task values", async () => {
		const p = props();
		const { rerender } = render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(12));
		fireEvent.change(screen.getByRole("spinbutton", { name: "Points" }), {
			target: { value: "8" },
		});
		rerender(
			<ProjectTaskSheet
				{...p}
				issues={[
					{ ...issue, customFieldValues: { points: 3, approved: true } },
				]}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Points" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				customFieldValues: { points: 8, approved: true },
			}),
		);
	});
	it("rejects a draft if its task disappears instead of updating a different row", async () => {
		const second = { ...issue, _id: "second" as ProjectIssueRow["_id"] };
		const p = props({ issues: [issue, second] });
		const { rerender } = render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(3));
		fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
			target: { value: "Unsaved draft" },
		});
		rerender(<ProjectTaskSheet {...p} issues={[second]} />);
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"no longer available",
			),
		);
		expect(p.onUpdate).not.toHaveBeenCalled();
	});
	it("copies an assignee ID so duplicate names paste onto the correct user", async () => {
		const p = props({
			issues: [
				{ ...issue, assigneeId: "user-one" as ProjectIssueRow["assigneeId"] },
				{ ...issue, _id: "second" as ProjectIssueRow["_id"] },
			],
			users: [
				{ _id: "user-one", name: "Alex" },
				{ _id: "user-two", name: "Alex" },
			],
		});
		render(<ProjectTaskSheet {...p} />);
		fireEvent.mouseDown(cell(6), { buttons: 1 });
		let copied = "";
		fireEvent.copy(cell(6), {
			clipboardData: {
				setData: (_type: string, value: string) => {
					copied = value;
				},
			},
		});
		expect(copied).toBe("user-one");
		fireEvent.mouseDown(cell(6, 3), { buttons: 1 });
		fireEvent.paste(cell(6, 3), {
			clipboardData: { getData: () => copied },
		});
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "second",
				assigneeId: "user-one",
			}),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});
	it("edits a title with Enter, cancels with Escape, and opens task details", async () => {
		const p = props();
		render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(3));
		fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
			target: { value: "Updated task" },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				title: "Updated task",
			}),
		);
		fireEvent.doubleClick(cell(3));
		fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
			target: { value: "Discard this" },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key: "Escape",
		});
		expect(p.onUpdate).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "TEST-1" }));
		expect(p.onOpenIssue).toHaveBeenCalledWith("task");
	});
	it("routes status edits through the existing confirmation flow", async () => {
		const p = props();
		render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(4));
		const select = screen.getByRole("combobox", { name: "Status" });
		fireEvent.change(select, { target: { value: "done" } });
		fireEvent.keyDown(select, { key: "Enter" });
		await waitFor(() =>
			expect(p.onStatusChange).toHaveBeenCalledWith(issue, "done"),
		);
		expect(p.onUpdate).not.toHaveBeenCalled();
	});
	it("uses typed custom number, checkbox, date and select editors", async () => {
		const p = props();
		render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(12));
		const number = screen.getByRole("spinbutton", { name: "Points" });
		fireEvent.change(number, { target: { value: "4.5" } });
		fireEvent.keyDown(number, { key: "Tab" });
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				customFieldValues: { points: 4.5, approved: false },
			}),
		);
		fireEvent.doubleClick(cell(13));
		const checkbox = screen.getByRole("switch", { name: "Approved" });
		fireEvent.click(checkbox);
		fireEvent.keyDown(checkbox, { key: "Enter" });
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				customFieldValues: { points: 3, approved: true },
			}),
		);
		fireEvent.doubleClick(cell(14));
		expect(screen.getByLabelText("Review date").getAttribute("type")).toBe(
			"date",
		);
		fireEvent.keyDown(screen.getByLabelText("Review date"), { key: "Escape" });
		fireEvent.doubleClick(cell(15));
		fireEvent.change(screen.getByRole("combobox", { name: "Team" }), {
			target: { value: "B" },
		});
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Team" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				customFieldValues: { points: 3, approved: false, select: "B" },
			}),
		);
	});
	it("copies and pastes a cell and rejects rectangular or invalid pastes without losing data", async () => {
		const p = props();
		render(<ProjectTaskSheet {...p} />);
		fireEvent.mouseDown(cell(12), { buttons: 1 });
		const setData = vi.fn();
		fireEvent.copy(cell(12), { clipboardData: { setData } });
		expect(setData).toHaveBeenCalledWith("text/plain", "3");
		fireEvent.paste(cell(12), { clipboardData: { getData: () => "8" } });
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				customFieldValues: { points: 8, approved: false },
			}),
		);
		fireEvent.paste(cell(12), { clipboardData: { getData: () => "1\t2" } });
		expect(screen.getByRole("alert").textContent).toContain("one cell");
		fireEvent.paste(cell(12), { clipboardData: { getData: () => "NaN" } });
		expect(screen.getByRole("alert").textContent).toContain("finite number");
		expect(p.onUpdate).toHaveBeenCalledTimes(1);
	});
	it("shows failed saves and leaves the confirmed value intact", async () => {
		const p = props({
			onUpdate: vi.fn().mockRejectedValue(new Error("Permission changed")),
		});
		render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(3));
		fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
			target: { value: "Rejected" },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
			key: "Enter",
		});
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"Permission changed",
			),
		);
		expect(cell(3).textContent).toBe("Original task");
	});
	it("selects rows for bulk actions and edits labels with Apply and Cancel", async () => {
		const p = props();
		render(<ProjectTaskSheet {...p} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "Select" }));
		expect(p.onSelectionChange).toHaveBeenCalledWith(new Set(["task"]));
		fireEvent.doubleClick(cell(11));
		fireEvent.click(screen.getByRole("button", { name: "Bug" }));
		fireEvent.click(screen.getByRole("button", { name: "Apply labels" }));
		await waitFor(() =>
			expect(p.onUpdate).toHaveBeenCalledWith({
				issueId: "task",
				labels: ["bug"],
			}),
		);
		fireEvent.doubleClick(cell(11));
		fireEvent.click(screen.getByRole("button", { name: "Bug" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(p.onUpdate).toHaveBeenCalledTimes(1);
	});
	it("fills typed values through the library handle and reports partial server failures", async () => {
		const p = props({
			issues: [
				issue,
				{
					...issue,
					_id: "second" as ProjectIssueRow["_id"],
					customFieldValues: { points: 1 },
				},
				{
					...issue,
					_id: "third" as ProjectIssueRow["_id"],
					customFieldValues: { points: 2 },
				},
			],
			onUpdate: vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error("Network failure")),
		});
		render(<ProjectTaskSheet {...p} />);
		fireEvent.mouseDown(cell(12), { buttons: 1 });
		const handle = screen
			.getByRole("grid")
			.querySelector('[style*="--rdg-drag-handle-size"]');
		if (!handle) throw new Error("Missing fill handle");
		fireEvent.doubleClick(handle);
		await waitFor(() => expect(p.onUpdate).toHaveBeenCalledTimes(2));
		expect(p.onUpdate).toHaveBeenNthCalledWith(1, {
			issueId: "second",
			customFieldValues: { points: 3 },
		});
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"1 task(s) saved before the error. Network failure",
			),
		);
	});

	it("keeps viewers read-only and prevents edits during a bulk operation", () => {
		const p = props({ canWrite: false });
		const { rerender } = render(<ProjectTaskSheet {...p} />);
		fireEvent.doubleClick(cell(2));
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("checkbox")).toBeNull();
		rerender(<ProjectTaskSheet {...p} canWrite disabled />);
		fireEvent.doubleClick(cell(3));
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(p.onUpdate).not.toHaveBeenCalled();
	});
});
