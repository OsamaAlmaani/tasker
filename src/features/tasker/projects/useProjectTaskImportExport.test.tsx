// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { utils, writeFileXLSX } from "xlsx";
import type { Id } from "#convex/_generated/dataModel";
import { plainDescriptionDoc } from "#convex/lib/issueDescriptions";
import { useProjectTaskImportExport } from "./useProjectTaskImportExport";

vi.mock("xlsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("xlsx")>()),
	writeFileXLSX: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("rich task import/export", () => {
	it("downloads the current rows for viewers and waits for a loaded result", async () => {
		const projectId = "project" as Id<"projects">;
		const issue = {
			issueNumber: 5,
			title: "Visible task",
			status: "todo",
			priority: "none" as const,
			labels: [],
		};
		const options = {
			canWrite: false,
			createIssue: vi.fn(),
			projectId,
			project: { _id: projectId, key: "TEST", name: "Test" },
			filters: {},
			issueListById: new Map(),
			issueLists: [],
			projectLabels: [],
			projectStatuses: [],
			sheetOptions: {
				statuses: [],
				customFields: [],
				labels: [],
				users: [],
				lists: [],
				parents: [],
			},
		};
		const { result, rerender } = renderHook(
			({ issues }: { issues: (typeof issue)[] | undefined }) =>
				useProjectTaskImportExport({ ...options, issues }),
			{
				initialProps: { issues: undefined } as {
					issues: (typeof issue)[] | undefined;
				},
			},
		);
		vi.mocked(writeFileXLSX).mockClear();
		await act(async () => {
			await result.current.exportTasksToExcel();
		});
		expect(writeFileXLSX).not.toHaveBeenCalled();
		rerender({ issues: [issue] });
		await act(async () => {
			await result.current.exportTasksToExcel();
		});
		expect(writeFileXLSX).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^test-tasks-\d{4}-\d{2}-\d{2}\.xlsx$/),
		);
		const workbook = vi.mocked(writeFileXLSX).mock.calls[0][0];
		expect(utils.sheet_to_json(workbook.Sheets.Tasks)).toEqual([
			expect.objectContaining({ Task: "TEST-5", Title: "Visible task" }),
		]);
		expect(result.current.importExportMessage).toBe(
			"Exported 1 task to Excel.",
		);
		expect(options.createIssue).not.toHaveBeenCalled();
		rerender({ issues: [] });
		vi.mocked(writeFileXLSX).mockImplementationOnce(() => {
			throw new Error("Download failed");
		});
		await act(async () => {
			await result.current.exportTasksToExcel();
		});
		expect(result.current.importExportError).toBe("Download failed");
		expect(result.current.isExportingExcel).toBe(false);
	});
	it("preserves formatted descriptions and date filter metadata across export/import", async () => {
		let exported: NodeBlob | undefined;
		vi.stubGlobal("Blob", NodeBlob);
		vi.stubGlobal(
			"URL",
			class extends URL {
				static createObjectURL(blob: Blob | MediaSource) {
					exported = blob as unknown as NodeBlob;
					return "blob:test";
				}
				static revokeObjectURL() {}
			},
		);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
		const doc = plainDescriptionDoc("Formatted task");
		const text = doc.content[0].content?.[0];
		if (!text) throw new Error("Expected text");
		text.marks = [{ type: "bold" }];
		const createIssue = vi.fn(async () => undefined);
		const projectId = "project" as Id<"projects">;
		const { result } = renderHook(() =>
			useProjectTaskImportExport({
				canWrite: true,
				createIssue,
				projectId,
				project: { _id: projectId, key: "TEST", name: "Test" },
				filters: {
					assigneeId: "unassigned",
					startFrom: "2026-10-01",
					dueTo: "2026-10-06",
				},
				issueListById: new Map(),
				issueLists: [],
				projectLabels: [],
				projectStatuses: [],
				sheetOptions: {
					statuses: [],
					customFields: [],
					labels: [],
					users: [],
					lists: [],
					parents: [],
				},
				issues: [
					{
						title: "Task",
						issueNumber: 1,
						description: "Formatted task",
						descriptionDoc: doc,
						status: "todo",
						priority: "none",
						labels: [],
					},
				],
			}),
		);
		act(() => {
			result.current.exportTasks();
		});
		if (!exported) throw new Error("Expected an export");
		const json = await exported.text();
		const payload = JSON.parse(json);
		expect(payload.tasks[0].descriptionDoc).toEqual(doc);
		expect(payload.filters).toMatchObject({
			assigneeId: "unassigned",
			startFrom: "2026-10-01",
			dueTo: "2026-10-06",
		});
		await act(async () => {
			await result.current.handleImportTasksFile({
				target: { files: [{ text: async () => json }], value: "" },
			} as unknown as ChangeEvent<HTMLInputElement>);
		});
		expect(createIssue).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Task",
				description: "Formatted task",
				descriptionDoc: doc,
			}),
		);
		expect(result.current.importExportError).toBeNull();
	});
});
