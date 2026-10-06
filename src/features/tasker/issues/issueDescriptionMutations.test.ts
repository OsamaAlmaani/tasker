import type { FunctionArgs } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "#convex/_generated/server";
import { create, listByProject, update } from "#convex/issues";
import { plainDescriptionDoc } from "#convex/lib/issueDescriptions";

const projectId = "project" as Id<"projects">;
const userId = "user" as Id<"users">;
const issueId = "issue" as Id<"issues">;
const createTask = (
	create as unknown as {
		_handler: (
			ctx: MutationCtx,
			args: FunctionArgs<typeof api.issues.create>,
		) => Promise<Doc<"issues">>;
	}
)._handler;
const updateTask = (
	update as unknown as {
		_handler: (
			ctx: MutationCtx,
			args: FunctionArgs<typeof api.issues.update>,
		) => Promise<Doc<"issues">>;
	}
)._handler;
const listTasks = (
	listByProject as unknown as {
		_handler: (
			ctx: QueryCtx,
			args: FunctionArgs<typeof api.issues.listByProject>,
		) => Promise<Doc<"issues">[]>;
	}
)._handler;

function context() {
	const issue: Doc<"issues"> = {
		_id: issueId,
		_creationTime: 1,
		projectId,
		issueNumber: 1,
		title: "Task",
		description: "Old text",
		descriptionDoc: plainDescriptionDoc("Old text"),
		searchText: "task old text",
		status: "todo",
		priority: "none",
		archived: false,
		labels: [],
		reporterId: userId,
		createdBy: userId,
		createdAt: 1,
		updatedAt: 1,
	};
	const user = { _id: userId, globalRole: "admin", isActive: true };
	const records = new Map<string, object>([
		[projectId, { _id: projectId, createdBy: userId }],
		[userId, user],
		[issueId, issue],
		["counter", { _id: "counter", projectId, nextIssueNumber: 2 }],
	]);
	const patch = vi.fn(async (id: string, changes: object) =>
		records.set(id, { ...records.get(id), ...changes }),
	);
	let nextId = 0;
	const insert = vi.fn(async (table: string, fields: object) => {
		const id = `${table}-${++nextId}`;
		records.set(id, { _id: id, _creationTime: 1, ...fields });
		return id;
	});
	const ctx = {
		auth: { getUserIdentity: async () => ({ subject: "clerk-user" }) },
		db: {
			get: async (id: string) => records.get(id) ?? null,
			patch,
			insert,
			query: (table: string) => ({
				withIndex: () => ({
					unique: async () =>
						table === "users"
							? user
							: table === "projectCounters"
								? records.get("counter")
								: null,
					collect: async () =>
						table === "issues"
							? [...records.values()].filter(
									(record) => (record as Doc<"issues">).title,
								)
							: [],
				}),
			}),
		},
	} as unknown as MutationCtx;
	return { ctx, issue, records, patch };
}

describe("description mutations and task query", () => {
	it("stores rich content and derives search text on creation", async () => {
		const state = context();
		const doc = plainDescriptionDoc("New content");
		const result = await createTask(state.ctx, {
			projectId,
			title: "New task",
			description: "Incorrect",
			descriptionDoc: doc,
		});
		expect(result.descriptionDoc).toEqual(doc);
		expect(result.description).toBe("New content");
		expect(result.searchText).toBe("new task new content");
	});
	it("updates formatted descriptions, search text, and clearing", async () => {
		const state = context();
		const doc = plainDescriptionDoc("Replacement");
		const result = await updateTask(state.ctx, {
			issueId,
			descriptionDoc: doc,
		});
		expect(result.description).toBe("Replacement");
		expect(result.searchText).toBe("task replacement");
		const cleared = await updateTask(state.ctx, {
			issueId,
			descriptionDoc: plainDescriptionDoc(""),
		});
		expect(cleared.description).toBe("");
		expect(cleared.searchText).toBe("task");
	});
	it("preserves rich content for other edits and clears it on a legacy plain-text write", async () => {
		const state = context();
		const renamed = await updateTask(state.ctx, { issueId, title: "Renamed" });
		expect(renamed.descriptionDoc).toEqual(state.issue.descriptionDoc);
		const replaced = await updateTask(state.ctx, {
			issueId,
			description: "Plain replacement",
		});
		expect(replaced.descriptionDoc).toBeUndefined();
		expect(replaced.searchText).toBe("renamed plain replacement");
	});
	it("rejects invalid rich content before modifying tasks", async () => {
		const state = context();
		await expect(
			updateTask(state.ctx, {
				issueId,
				descriptionDoc: { type: "doc", content: [{ type: "script" }] },
			}),
		).rejects.toThrow("Unsupported");
		expect(state.patch).not.toHaveBeenCalled();
	});
	it("applies unassigned and both date ranges in the server query", async () => {
		const state = context();
		state.records.set(issueId, {
			...state.issue,
			startDate: Date.parse("2026-10-01"),
			dueDate: Date.parse("2026-10-06"),
		});
		state.records.set("assigned", {
			...state.records.get(issueId),
			_id: "assigned",
			assigneeId: userId,
		});
		const args = {
			projectId,
			assigneeId: null,
			startFrom: "2026-10-01",
			dueTo: "2026-10-06",
		};
		expect((await listTasks(state.ctx, args)).map((task) => task._id)).toEqual([
			issueId,
		]);
		expect(
			await listTasks(state.ctx, { ...args, dueTo: "2026-10-05" }),
		).toEqual([]);
	});
});
