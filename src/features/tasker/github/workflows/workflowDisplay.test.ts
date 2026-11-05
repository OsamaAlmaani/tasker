import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "#convex/lib/githubWorkflowsApi";
import { assignLinesToSteps, parseAnsi, parseLog } from "./logModel";
import {
	buildReleaseFeed,
	formatDuration,
	groupFailures,
	releaseProgress,
	resolveSelection,
	type TaskerRelease,
	workflowStats,
} from "./workflowDisplay";

const T0 = Date.parse("2026-11-04T12:15:31Z");

function run(overrides: Partial<WorkflowRun> & { id: number }): WorkflowRun {
	return {
		workflowId: overrides.id * 10,
		name: `Workflow ${overrides.id}`,
		title: "Commit",
		runNumber: 1,
		attempt: 1,
		event: "workflow_dispatch",
		status: "completed",
		conclusion: "success",
		branch: "master",
		headSha: "abc",
		commitMessage: null,
		actor: { login: "osama", avatarUrl: null },
		triggeringActor: null,
		createdAt: T0,
		startedAt: T0 + 2000,
		updatedAt: T0 + 60_000,
		htmlUrl: "",
		path: "",
		pullRequests: [],
		...overrides,
	};
}

describe("buildReleaseFeed", () => {
	it("groups Tasker releases, chained runs and single runs", () => {
		const trigger = run({ id: 1, name: "TriggerAll", workflowId: 100 });
		const childA = run({
			id: 2,
			event: "workflow_run",
			workflowId: 200,
			createdAt: T0 + 4000,
		});
		const childB = run({
			id: 3,
			event: "workflow_run",
			workflowId: 300,
			createdAt: T0 + 5000,
		});
		const released = run({ id: 4, createdAt: T0 + 600_000 });
		const single = run({ id: 5, event: "push", createdAt: T0 + 900_000 });
		const release: TaskerRelease = {
			_id: "r1",
			name: "Backend",
			ref: "master",
			headSha: "abc",
			groupIds: [],
			runs: [
				{
					workflowId: 40,
					workflowName: "Workflow 4",
					workflowPath: "",
					runId: 4,
					error: null,
				},
				{
					workflowId: 99,
					workflowName: "Broken",
					workflowPath: "",
					runId: null,
					error: "Nope",
				},
			],
			skipped: [],
			status: "started",
			startedAt: T0 + 599_000,
			startedByName: "Osama",
		};
		const feed = buildReleaseFeed(
			[trigger, childA, childB, released, single],
			[release],
			[
				{ id: 100, name: "TriggerAll", listensTo: [] },
				{ id: 200, name: "A", listensTo: ["TriggerAll"] },
				{ id: 300, name: "B", listensTo: ["TriggerAll"] },
			],
		);
		expect(feed.map((item) => item.key)).toEqual([
			"run:5",
			"release:r1",
			"chain:1",
		]);
		const chain = feed[2];
		expect(
			chain.kind === "release" && chain.runs.map((item) => item.id),
		).toEqual([2, 3]);
		const tasker = feed[1];
		expect(tasker.kind === "release" && tasker.missing).toHaveLength(1);
	});

	it("groups chained runs whose trigger is not loaded", () => {
		const feed = buildReleaseFeed(
			[
				run({ id: 2, event: "workflow_run", workflowId: 200 }),
				run({
					id: 3,
					event: "workflow_run",
					workflowId: 300,
					createdAt: T0 + 1000,
				}),
			],
			[],
			[
				{ id: 200, name: "A", listensTo: ["TriggerAll"] },
				{ id: 300, name: "B", listensTo: ["TriggerAll"] },
			],
		);
		expect(feed).toHaveLength(1);
		expect(feed[0].kind === "release" && feed[0].name).toBe(
			"Started by TriggerAll",
		);
	});
});

describe("releaseProgress", () => {
	it("counts states and failed starts, and runs the clock while active", () => {
		const progress = releaseProgress(
			{
				startedAt: T0,
				runs: [
					run({ id: 1 }),
					run({ id: 2, conclusion: "failure" }),
					run({ id: 3, status: "in_progress", conclusion: null }),
				],
				missing: [
					{
						workflowId: 1,
						workflowName: "x",
						workflowPath: "",
						runId: null,
						error: "no",
					},
				],
			},
			T0 + 120_000,
		);
		expect(progress.total).toBe(4);
		expect(progress.counts.failure).toBe(2);
		expect(progress.state).toBe("running");
		expect(progress.durationMs).toBe(120_000);
		expect(progress.finishedAt).toBeNull();
	});
});

describe("groupFailures", () => {
	it("groups runs with the same error", () => {
		const runs = [run({ id: 1 }), run({ id: 2 }), run({ id: 3 })];
		const summary = (runId: number, line: string) => ({
			runId,
			jobId: 1,
			jobName: "build",
			stepName: "Build and push",
			lines: [line],
			error: null,
		});
		const groups = groupFailures(
			runs,
			new Map([
				[1, summary(1, "failed to push ghcr.io/o/r/a:latest: toomanyrequests")],
				[2, summary(2, "failed to push ghcr.io/o/r/b:latest: toomanyrequests")],
				[3, summary(3, "error CS0246: missing type")],
			]),
		);
		expect(groups.map((group) => group.runs.map((item) => item.id))).toEqual([
			[1, 2],
			[3],
		]);
	});
});

describe("workflowStats", () => {
	it("flags slow and re-run-only passes", () => {
		const stats = workflowStats([
			run({
				id: 1,
				createdAt: T0 + 5,
				updatedAt: T0 + 5 + 400_000,
				startedAt: T0 + 5,
			}),
			run({
				id: 2,
				createdAt: T0 + 4,
				startedAt: T0 + 4,
				updatedAt: T0 + 4 + 60_000,
				attempt: 2,
			}),
			run({
				id: 3,
				createdAt: T0 + 3,
				startedAt: T0 + 3,
				updatedAt: T0 + 3 + 60_000,
			}),
			run({
				id: 4,
				createdAt: T0 + 2,
				startedAt: T0 + 2,
				updatedAt: T0 + 2 + 60_000,
				conclusion: "failure",
			}),
		]);
		expect(stats.successRate).toBe(0.75);
		expect(stats.slow).toBe(true);
		expect(stats.flaky).toBe(true);
	});
});

describe("resolveSelection", () => {
	it("merges groups and single picks without duplicates", () => {
		const ids = resolveSelection(
			[
				{ _id: "g1", workflows: [{ id: 1 }, { id: 2 }] },
				{ _id: "g2", workflows: [{ id: 2 }, { id: 3 }] },
			],
			new Set(["g1", "g2"]),
			new Set([3, 4]),
		);
		expect([...ids].sort()).toEqual([1, 2, 3, 4]);
	});
});

describe("formatDuration", () => {
	it("formats short and long durations", () => {
		expect(formatDuration(38_000)).toBe("38s");
		expect(formatDuration(281_000)).toBe("4m 41s");
		expect(formatDuration(3_720_000)).toBe("1h 2m");
		expect(formatDuration(null)).toBe("—");
	});
});

describe("parseLog", () => {
	it("reads groups, markers and colors", () => {
		const log = parseLog(
			[
				"2026-10-18T09:18:08.5Z ##[group]Run actions/checkout@v4",
				"2026-10-18T09:18:08.6Z with: x",
				"2026-10-18T09:18:08.7Z ##[endgroup]",
				"2026-10-18T09:18:09.0Z \u001b[31mred\u001b[0m plain",
				"2026-10-18T09:18:10.0Z ##[error]Boom",
			].join("\n"),
		);
		expect(log.groups).toHaveLength(1);
		expect(log.lines.map((line) => line.kind)).toEqual([
			"group",
			"normal",
			"normal",
			"error",
		]);
		expect(log.lines[1].parentGroup).toBe(0);
		expect(log.lines[2].segments).toEqual([
			{ text: "red", style: expect.objectContaining({ fg: 1 }) },
			{ text: " plain", style: null },
		]);
		expect(log.lines[3].text).toBe("Boom");
	});

	it("carries colors across segments", () => {
		const state = {
			fg: null,
			bg: null,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		};
		parseAnsi("\u001b[1;32mstart", state);
		expect(state).toMatchObject({ fg: 2, bold: true });
	});

	it("assigns lines to steps at their Run header", () => {
		const log = parseLog(
			[
				"2026-10-18T09:18:06.1Z setting up",
				"2026-10-18T09:18:08.3Z ##[group]Run actions/checkout@v4",
				"2026-10-18T09:18:08.4Z ##[endgroup]",
				"2026-10-18T09:18:08.5Z checkout output",
				"2026-10-18T09:18:13.3Z ##[group]Run docker/setup-buildx-action@v3",
				"2026-10-18T09:18:14.0Z buildx output",
			].join("\n"),
		);
		const steps = [
			{
				number: 1,
				name: "Set up job",
				startedAt: Date.parse("2026-10-18T09:18:06Z"),
				completedAt: Date.parse("2026-10-18T09:18:08Z"),
			},
			{
				number: 3,
				name: "Run actions/checkout@v4",
				startedAt: Date.parse("2026-10-18T09:18:08Z"),
				completedAt: Date.parse("2026-10-18T09:18:13Z"),
			},
			{
				number: 4,
				name: "Set up Docker Buildx",
				startedAt: Date.parse("2026-10-18T09:18:13Z"),
				completedAt: Date.parse("2026-10-18T09:18:22Z"),
			},
		];
		const byStep = assignLinesToSteps(log.lines, steps);
		expect(byStep.get(1)?.map((line) => line.text)).toEqual(["setting up"]);
		expect(byStep.get(3)?.map((line) => line.text)).toEqual([
			"Run actions/checkout@v4",
			"checkout output",
		]);
		expect(byStep.get(4)?.map((line) => line.text)).toEqual([
			"Run docker/setup-buildx-action@v3",
			"buildx output",
		]);
	});
});
