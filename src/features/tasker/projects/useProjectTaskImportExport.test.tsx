// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "#convex/_generated/dataModel";
import { plainDescriptionDoc } from "#convex/lib/issueDescriptions";
import { useProjectTaskImportExport } from "./useProjectTaskImportExport";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("rich task import/export", () => {
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
				issues: [
					{
						title: "Task",
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
