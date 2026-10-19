// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utils, writeFileXLSX } from "xlsx";
import type { Id } from "#convex/_generated/dataModel";
import {
	type ProjectIssueRow,
	useProjectDetailPage,
} from "./useProjectDetailPage";

const mocks = vi.hoisted(() => ({
	issues: undefined as ProjectIssueRow[] | undefined,
	allIssues: [] as ProjectIssueRow[] | undefined,
	empty: [],
	project: { project: { key: "TEST", name: "Test" }, membershipRows: [] },
	mutate: vi.fn(),
}));
vi.mock("convex/react", () => ({
	useQuery: (
		reference: Parameters<typeof getFunctionName>[0],
		args: { includeArchived?: boolean; sortBy?: string } | "skip",
	) => {
		if (args === "skip") return undefined;
		const name = getFunctionName(reference);
		if (name === "projects:getById") return mocks.project;
		if (name === "issues:listByProject")
			return args.includeArchived && args.sortBy === "created_desc"
				? mocks.allIssues
				: mocks.issues;
		if (name === "users:me") return null;
		return mocks.empty;
	},
	useMutation: () => mocks.mutate,
	useAction: () => mocks.mutate,
}));
vi.mock("xlsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("xlsx")>()),
	writeFileXLSX: vi.fn(),
}));
beforeEach(() => {
	mocks.issues = undefined;
	mocks.allIssues = [];
	vi.mocked(writeFileXLSX).mockClear();
	vi.stubGlobal("localStorage", {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const issue = {
	_id: "task",
	title: "Task",
	searchText: "Task",
	status: "todo",
	issueNumber: 1,
	labels: [],
} as unknown as ProjectIssueRow;
const options = {
	projectId: "project" as Id<"projects">,
	routeSearch: {},
	updateProjectSearch: vi.fn(),
};

describe("project task loading", () => {
	it("waits for parent metadata and exports archived parent labels", async () => {
		const archivedOptions = {
			...options,
			routeSearch: { archive: "archived" as const },
		};
		mocks.issues = [
			{ ...issue, parentIssueId: "parent" as Id<"issues">, archived: true },
		];
		mocks.allIssues = undefined;
		const { result, rerender } = renderHook(useProjectDetailPage, {
			initialProps: archivedOptions,
		});
		expect(result.current.canExportTasks).toBe(false);
		mocks.allIssues = [
			{
				...issue,
				_id: "parent" as Id<"issues">,
				issueNumber: 2,
				title: "Archived parent",
				archived: true,
			},
			...mocks.issues,
		];
		rerender(archivedOptions);
		expect(result.current.canExportTasks).toBe(true);
		expect(result.current.parentIssueOptions).toEqual([]);
		await act(async () => {
			await result.current.exportTasksToExcel();
		});
		const workbook = vi.mocked(writeFileXLSX).mock.calls[0][0];
		expect(utils.sheet_to_json(workbook.Sheets.Tasks)).toEqual([
			expect.objectContaining({ "Parent task": "TEST-2 Archived parent" }),
		]);
	});
	it("loads once and retains rows while a filtered query refetches", () => {
		const { result, rerender } = renderHook(useProjectDetailPage, {
			initialProps: options,
		});
		expect(result.current.isLoadingIssues).toBe(true);
		expect(result.current.canExportTasks).toBe(false);
		mocks.issues = [issue];
		rerender(options);
		expect(result.current.isLoadingIssues).toBe(false);
		expect(result.current.visibleIssues).toEqual([issue]);
		expect(result.current.canExportTasks).toBe(true);
		mocks.issues = undefined;
		rerender({ ...options, routeSearch: { priority: "high" } });
		expect(result.current.canExportTasks).toBe(false);
		expect(result.current.isLoadingIssues).toBe(false);
		expect(result.current.visibleIssues).toEqual([issue]);
		mocks.issues = [];
		rerender(options);
		expect(result.current.isLoadingIssues).toBe(false);
		expect(result.current.visibleIssues).toEqual([]);
		mocks.issues = undefined;
		rerender(options);
		expect(result.current.isLoadingIssues).toBe(false);
	});
	it("starts loading again for another project without showing the previous project's rows", () => {
		mocks.issues = [issue];
		const { result, rerender } = renderHook(useProjectDetailPage, {
			initialProps: options,
		});
		mocks.issues = undefined;
		rerender({ ...options, projectId: "other-project" as Id<"projects"> });
		expect(result.current.isLoadingIssues).toBe(true);
		expect(result.current.visibleIssues).toEqual([]);
	});
});
