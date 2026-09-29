import type { RegisteredMutation } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "#convex/_generated/dataModel";
import type { MutationCtx } from "#convex/_generated/server";
import { bulkRemove, remove } from "#convex/issues";

const projectId = "project" as Id<"projects">;
const userId = "user" as Id<"users">;

// Convex hides the runtime handler from its public types.
function mutationHandler<Args extends Record<string, unknown>, Result>(
	registered: RegisteredMutation<"public", Args, Result>,
) {
	return (
		registered as unknown as {
			_handler: (ctx: MutationCtx, args: Args) => Result;
		}
	)._handler;
}

const deleteTasks = mutationHandler(bulkRemove);
const deleteTask = mutationHandler(remove);

function task(
	id: string,
	overrides: Partial<Doc<"issues">> = {},
): Doc<"issues"> {
	return {
		_id: id as Id<"issues">,
		_creationTime: 1,
		projectId,
		issueNumber: 1,
		title: id,
		status: "todo",
		priority: "none",
		labels: [],
		searchText: id,
		archived: false,
		reporterId: userId,
		createdBy: userId,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function context(
	issues: Doc<"issues">[],
	options: {
		allowIssueDelete?: boolean;
		role?: "member" | "viewer" | "admin";
		signedIn?: boolean;
		hasAccess?: boolean;
	} = {},
) {
	const user = {
		_id: userId,
		globalRole: options.role ?? "member",
		isActive: true,
	};
	const project = {
		_id: projectId,
		createdBy: options.hasAccess === false ? "other-user" : userId,
		allowIssueDelete: options.allowIssueDelete ?? true,
	};
	const records = new Map<string, object>([
		[projectId, project],
		...issues.map((issue): [string, object] => [issue._id, issue]),
	]);
	const patch = vi.fn(async (id: string, changes: object) => {
		records.set(id, { ...records.get(id), ...changes });
	});
	const insert = vi.fn(async () => "activity");
	const query = vi.fn((table: string) => ({
		withIndex: vi.fn(() => ({
			unique: async () => (table === "users" ? user : null),
			collect: async () =>
				issues.filter((issue) => issue.projectId === projectId),
		})),
	}));
	const ctx = {
		auth: {
			getUserIdentity: async () =>
				options.signedIn === false ? null : { subject: "clerk-user" },
		},
		db: {
			get: async (id: string) => records.get(id) ?? null,
			patch,
			insert,
			query,
		},
	} as unknown as MutationCtx;
	return { ctx, records, patch, insert, query };
}

describe("bulkRemove", () => {
	it("deletes overlapping selections once, including archived and hidden descendants", async () => {
		const parent = task("parent");
		const child = task("child", { parentIssueId: parent._id, status: "done" });
		const archived = task("archived", {
			parentIssueId: parent._id,
			archived: true,
		});
		const deleted = task("deleted", {
			parentIssueId: parent._id,
			deletedAt: 2,
		});
		const unrelated = task("unrelated");
		const otherProject = task("other-project", {
			projectId: "other" as Id<"projects">,
		});
		const state = context([
			parent,
			child,
			archived,
			deleted,
			unrelated,
			otherProject,
		]);

		const result = await deleteTasks(state.ctx, {
			projectId,
			issueIds: [parent._id, child._id, parent._id],
		});

		expect(result.deletedIssueCount).toBe(3);
		expect(state.patch.mock.calls.map(([id]) => id)).toEqual([
			"parent",
			"child",
			"archived",
			projectId,
		]);
		for (const id of ["parent", "child", "archived"]) {
			expect(state.records.get(id)).toMatchObject({
				deletedAt: result.deletedAt,
				updatedAt: result.deletedAt,
				archived: true,
			});
		}
		expect(state.records.get("unrelated")).toEqual(unrelated);
		expect(state.records.get("deleted")).toEqual(deleted);
		expect(state.records.get("other-project")).toEqual(otherProject);
		expect(state.insert).toHaveBeenCalledTimes(2);
		expect(state.insert).toHaveBeenCalledWith(
			"activities",
			expect.objectContaining({
				projectId,
				actorId: userId,
				issueId: parent._id,
				action: "issue.deleted",
			}),
		);
		expect(
			state.query.mock.calls.filter(([table]) => table === "issues"),
		).toHaveLength(1);
	});

	it("deleting only a sub-task preserves its parent and siblings", async () => {
		const parent = task("parent");
		const child = task("child", { parentIssueId: parent._id });
		const sibling = task("sibling", { parentIssueId: parent._id });
		const state = context([parent, child, sibling]);

		await deleteTasks(state.ctx, { projectId, issueIds: [child._id] });

		expect(state.records.get("parent")).toEqual(parent);
		expect(state.records.get("sibling")).toEqual(sibling);
		expect(state.patch.mock.calls.map(([id]) => id)).toEqual([
			"child",
			projectId,
		]);
	});

	it.each([
		"missing",
		"deleted",
		"other-project",
	])("rejects a %s selection before any writes", async (invalidId) => {
		const valid = task("valid");
		const state = context([
			valid,
			task("deleted", { deletedAt: 2 }),
			task("other-project", { projectId: "other" as Id<"projects"> }),
		]);

		await expect(
			deleteTasks(state.ctx, {
				projectId,
				issueIds: [valid._id, invalidId as Id<"issues">],
			}),
		).rejects.toThrow(
			"A selected task is no longer available in this project.",
		);
		expect(state.patch).not.toHaveBeenCalled();
		expect(state.insert).not.toHaveBeenCalled();
	});

	it.each([
		{
			options: { allowIssueDelete: false },
			message: "Issue deletion is disabled",
		},
		{ options: { role: "viewer" as const }, message: "read-only" },
		{
			options: { role: "admin" as const, allowIssueDelete: false },
			message: "Issue deletion is disabled",
		},
		{ options: { signedIn: false }, message: "must be signed in" },
		{ options: { hasAccess: false }, message: "do not have access" },
	])("enforces access before deleting: $message", async ({
		options,
		message,
	}) => {
		const issue = task("task");
		const state = context([issue], options);
		await expect(
			deleteTasks(state.ctx, { projectId, issueIds: [issue._id] }),
		).rejects.toThrow(message);
		expect(state.patch).not.toHaveBeenCalled();
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects an empty selection", async () => {
		const state = context([]);
		await expect(
			deleteTasks(state.ctx, { projectId, issueIds: [] }),
		).rejects.toThrow("Select at least one task.");
		expect(state.patch).not.toHaveBeenCalled();
	});

	it("supports selecting all even when there are more than 100 tasks", async () => {
		const issues = Array.from({ length: 101 }, (_, index) =>
			task(`task-${index}`),
		);
		const state = context(issues);
		const result = await deleteTasks(state.ctx, {
			projectId,
			issueIds: issues.map((issue) => issue._id),
		});
		expect(result.deletedIssueCount).toBe(101);
	});
});

describe("remove", () => {
	it("retains single-task deletion and cascading behavior", async () => {
		const parent = task("parent");
		const child = task("child", { parentIssueId: parent._id });
		const state = context([parent, child]);
		const result = await deleteTask(state.ctx, { issueId: parent._id });
		expect(result.deletedIssueCount).toBe(2);
		expect(state.patch.mock.calls.map(([id]) => id)).toEqual([
			"parent",
			"child",
			projectId,
		]);
	});
});
