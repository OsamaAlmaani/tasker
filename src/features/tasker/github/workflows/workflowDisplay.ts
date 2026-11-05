import type { FailureSummary } from "#convex/githubWorkflows";
import {
	errorSignature,
	type RunConclusion,
	type RunStatus,
	type WorkflowRun,
	type WorkflowSummary,
} from "#convex/lib/githubWorkflowsApi";

export type RunVisualState =
	| "success"
	| "failure"
	| "cancelled"
	| "running"
	| "queued"
	| "waiting"
	| "skipped"
	| "neutral";

export function runVisualState(run: {
	status: RunStatus;
	conclusion: RunConclusion | null;
}): RunVisualState {
	if (run.status !== "completed") {
		if (run.status === "in_progress") return "running";
		if (run.status === "waiting") return "waiting";
		return "queued";
	}
	switch (run.conclusion) {
		case "success":
			return "success";
		case "failure":
		case "timed_out":
		case "startup_failure":
			return "failure";
		case "cancelled":
			return "cancelled";
		case "skipped":
			return "skipped";
		case "action_required":
			return "waiting";
		default:
			return "neutral";
	}
}

export const RUN_STATE_LABELS: Record<RunVisualState, string> = {
	success: "Succeeded",
	failure: "Failed",
	cancelled: "Cancelled",
	running: "Running",
	queued: "Queued",
	waiting: "Waiting",
	skipped: "Skipped",
	neutral: "Finished",
};

export function isActiveState(state: RunVisualState) {
	return state === "running" || state === "queued" || state === "waiting";
}

/** "4m 41s", "38s", "1h 2m". */
export function formatDuration(ms: number | null | undefined) {
	if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0)
		return "—";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/** Elapsed time of a run, counting to `now` while it is still going. */
export function runDuration(run: WorkflowRun, now: number) {
	const state = runVisualState(run);
	if (state === "queued" || state === "waiting") return null;
	const end = run.status === "completed" ? run.updatedAt : now;
	return Math.max(0, end - run.startedAt);
}

export const EVENT_LABELS: Record<string, string> = {
	workflow_dispatch: "Manual",
	workflow_run: "Chained",
	push: "Push",
	pull_request: "Pull request",
	pull_request_target: "Pull request",
	schedule: "Scheduled",
	release: "Release",
	dynamic: "Automatic",
	repository_dispatch: "API",
	merge_group: "Merge queue",
};

export function eventLabel(event: string) {
	return EVENT_LABELS[event] ?? event.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Releases

export type TaskerRelease = {
	_id: string;
	name: string;
	ref: string;
	headSha: string;
	groupIds: string[];
	runs: Array<{
		workflowId: number;
		workflowName: string;
		workflowPath: string;
		runId: number | null;
		error: string | null;
	}>;
	skipped: Array<{
		workflowId: number;
		workflowName: string;
		reason: "unchanged" | "removed";
	}>;
	status: "starting" | "started";
	startedAt: number;
	startedByName: string | null;
};

export type FeedRelease = {
	kind: "release";
	key: string;
	source: "tasker" | "trigger";
	name: string;
	startedAt: number;
	startedBy: string | null;
	ref: string | null;
	headSha: string | null;
	/** The run that started the others, for chained releases. */
	parent: WorkflowRun | null;
	runs: WorkflowRun[];
	/** Tasker release entries whose run is not loaded, or did not start. */
	missing: TaskerRelease["runs"];
	skipped: TaskerRelease["skipped"];
	release: TaskerRelease | null;
};

export type FeedRun = {
	kind: "run";
	key: string;
	startedAt: number;
	run: WorkflowRun;
};

export type FeedItem = FeedRelease | FeedRun;

/** How long after a trigger run its chained runs may be created. */
const CHAIN_WINDOW_MS = 3 * 60_000;

/**
 * Turns runs into a feed: runs Tasker started together become one release,
 * runs chained from another run (`workflow_run`) are grouped under it, and
 * everything else is listed on its own. Newest first.
 */
export function buildReleaseFeed(
	runs: WorkflowRun[],
	releases: TaskerRelease[],
	workflows: Pick<WorkflowSummary, "id" | "name" | "listensTo">[],
): FeedItem[] {
	const byId = new Map(runs.map((run) => [run.id, run]));
	const claimed = new Set<number>();
	const items: FeedItem[] = [];

	for (const release of releases) {
		const loaded: WorkflowRun[] = [];
		const missing: TaskerRelease["runs"] = [];
		for (const entry of release.runs) {
			const run = entry.runId ? byId.get(entry.runId) : undefined;
			if (run) {
				loaded.push(run);
				claimed.add(run.id);
			} else {
				missing.push(entry);
			}
		}
		items.push({
			kind: "release",
			key: `release:${release._id}`,
			source: "tasker",
			name: release.name,
			startedAt: release.startedAt,
			startedBy: release.startedByName,
			ref: release.ref,
			headSha: release.headSha,
			parent: null,
			runs: loaded,
			missing,
			skipped: release.skipped,
			release,
		});
	}

	const listensTo = new Map(
		workflows.map((workflow) => [workflow.id, new Set(workflow.listensTo)]),
	);
	const chained = runs
		.filter((run) => run.event === "workflow_run" && !claimed.has(run.id))
		.sort((a, b) => a.createdAt - b.createdAt);
	const parents = runs
		.filter(
			(run) =>
				run.event !== "workflow_run" &&
				!claimed.has(run.id) &&
				chained.some((child) => listensTo.get(child.workflowId)?.has(run.name)),
		)
		.sort((a, b) => a.createdAt - b.createdAt);

	const childrenOf = new Map<number, WorkflowRun[]>();
	const orphans: WorkflowRun[] = [];
	for (const child of chained) {
		const listened = listensTo.get(child.workflowId);
		// The latest trigger run created just before this one.
		let parent: WorkflowRun | null = null;
		for (const candidate of parents) {
			if (candidate.createdAt > child.createdAt + 5_000) break;
			if (
				child.createdAt - candidate.createdAt <= CHAIN_WINDOW_MS &&
				listened?.has(candidate.name)
			) {
				parent = candidate;
			}
		}
		if (parent) {
			childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), child]);
		} else {
			orphans.push(child);
		}
	}

	for (const parent of parents) {
		const children = childrenOf.get(parent.id);
		if (!children?.length) continue;
		claimed.add(parent.id);
		for (const child of children) claimed.add(child.id);
		items.push({
			kind: "release",
			key: `chain:${parent.id}`,
			source: "trigger",
			name: parent.name,
			startedAt: parent.createdAt,
			startedBy: parent.triggeringActor?.login ?? parent.actor?.login ?? null,
			ref: parent.branch,
			headSha: parent.headSha,
			parent,
			runs: children,
			missing: [],
			skipped: [],
			release: null,
		});
	}

	// Chained runs whose trigger is not loaded: group runs created close together.
	let bucket: WorkflowRun[] = [];
	const flush = () => {
		// A lone chained run is listed on its own below.
		if (bucket.length > 1) {
			const first = bucket[0];
			for (const run of bucket) claimed.add(run.id);
			const listened = [...(listensTo.get(first.workflowId) ?? [])][0];
			items.push({
				kind: "release",
				key: `chain-orphan:${first.id}`,
				source: "trigger",
				name: listened ? `Started by ${listened}` : "Chained runs",
				startedAt: first.createdAt,
				startedBy: first.triggeringActor?.login ?? first.actor?.login ?? null,
				ref: first.branch,
				headSha: first.headSha,
				parent: null,
				runs: bucket,
				missing: [],
				skipped: [],
				release: null,
			});
		}
		bucket = [];
	};
	for (const run of orphans) {
		if (bucket.length && run.createdAt - bucket[0].createdAt > CHAIN_WINDOW_MS)
			flush();
		bucket.push(run);
	}
	flush();

	for (const run of runs) {
		if (claimed.has(run.id)) continue;
		items.push({
			kind: "run",
			key: `run:${run.id}`,
			startedAt: run.createdAt,
			run,
		});
	}

	return items.sort((a, b) => b.startedAt - a.startedAt);
}

export type RunCounts = Record<RunVisualState, number>;

export type ReleaseProgress = {
	total: number;
	counts: RunCounts;
	done: number;
	state: RunVisualState;
	startedAt: number;
	finishedAt: number | null;
	durationMs: number;
};

export function emptyCounts(): RunCounts {
	return {
		success: 0,
		failure: 0,
		cancelled: 0,
		running: 0,
		queued: 0,
		waiting: 0,
		skipped: 0,
		neutral: 0,
	};
}

export function releaseProgress(
	item: Pick<FeedRelease, "runs" | "startedAt" | "missing">,
	now: number,
): ReleaseProgress {
	const counts = emptyCounts();
	let finishedAt = 0;
	for (const run of item.runs) {
		const state = runVisualState(run);
		counts[state]++;
		if (!isActiveState(state)) finishedAt = Math.max(finishedAt, run.updatedAt);
	}
	// Entries that failed to start count as failures.
	const failedToStart = item.missing.filter(
		(entry) => entry.runId === null && entry.error,
	).length;
	counts.failure += failedToStart;
	const total = item.runs.length + failedToStart;
	const active = counts.running + counts.queued + counts.waiting;
	const state: RunVisualState = active
		? counts.running
			? "running"
			: "queued"
		: counts.failure
			? "failure"
			: counts.cancelled
				? "cancelled"
				: total === 0
					? "neutral"
					: "success";
	const done = total - active;
	const isFinished = active === 0;
	const end = isFinished ? finishedAt || item.startedAt : now;
	return {
		total,
		counts,
		done,
		state,
		startedAt: item.startedAt,
		finishedAt: isFinished ? end : null,
		durationMs: Math.max(0, end - item.startedAt),
	};
}

/** Median successful duration per workflow, from runs already loaded. */
export function typicalDurations(runs: WorkflowRun[]) {
	const durations = new Map<number, number[]>();
	for (const run of runs) {
		if (run.status !== "completed" || run.conclusion !== "success") continue;
		const list = durations.get(run.workflowId) ?? [];
		if (list.length < 15) list.push(run.updatedAt - run.startedAt);
		durations.set(run.workflowId, list);
	}
	const result = new Map<number, number>();
	for (const [id, list] of durations) {
		const sorted = [...list].sort((a, b) => a - b);
		result.set(id, sorted[Math.floor(sorted.length / 2)]);
	}
	return result;
}

/** Rough time left for a running release, from each workflow's usual duration. */
export function estimateRemaining(
	runs: WorkflowRun[],
	typical: Map<number, number>,
	now: number,
) {
	let remaining = 0;
	let known = false;
	for (const run of runs) {
		const state = runVisualState(run);
		if (!isActiveState(state)) continue;
		const usual = typical.get(run.workflowId);
		if (usual === undefined) continue;
		known = true;
		const elapsed = state === "running" ? now - run.startedAt : 0;
		remaining = Math.max(remaining, usual - elapsed);
	}
	return known ? Math.max(remaining, 0) : null;
}

export type FailureGroup = {
	signature: string;
	line: string | null;
	stepName: string | null;
	runs: WorkflowRun[];
};

/** Groups failed runs whose main error reads the same. */
export function groupFailures(
	runs: WorkflowRun[],
	summaries: Map<number, FailureSummary>,
): FailureGroup[] {
	const groups = new Map<string, FailureGroup>();
	for (const run of runs) {
		const summary = summaries.get(run.id);
		const line = summary?.lines.at(-1) ?? null;
		const primary = summary?.lines[0] ?? null;
		const signature = primary
			? `${summary?.stepName ?? ""}|${errorSignature(primary)}`
			: `unknown|${summary?.stepName ?? ""}`;
		const group = groups.get(signature) ?? {
			signature,
			line: primary ?? line,
			stepName: summary?.stepName ?? null,
			runs: [],
		};
		group.runs.push(run);
		groups.set(signature, group);
	}
	return [...groups.values()].sort((a, b) => b.runs.length - a.runs.length);
}

// ---------------------------------------------------------------------------
// Workflows

export type WorkflowStats = {
	last: WorkflowRun | null;
	/** Newest first. */
	recent: WorkflowRun[];
	successRate: number | null;
	typicalMs: number | null;
	/** The last finished run took much longer than usual. */
	slow: boolean;
	/** A recent run passed only after a re-run. */
	flaky: boolean;
};

export function workflowStats(runs: WorkflowRun[]): WorkflowStats {
	const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
	const completed = sorted.filter(
		(run) => run.status === "completed" && run.conclusion !== "skipped",
	);
	const successes = completed.filter((run) => run.conclusion === "success");
	const durations = successes
		.slice(0, 15)
		.map((run) => run.updatedAt - run.startedAt)
		.sort((a, b) => a - b);
	const typicalMs = durations.length
		? durations[Math.floor(durations.length / 2)]
		: null;
	const lastCompleted = completed[0];
	const lastDuration = lastCompleted
		? lastCompleted.updatedAt - lastCompleted.startedAt
		: null;
	return {
		last: sorted[0] ?? null,
		recent: sorted.slice(0, 12),
		successRate: completed.length ? successes.length / completed.length : null,
		typicalMs,
		slow:
			durations.length >= 3 &&
			typicalMs !== null &&
			lastDuration !== null &&
			lastDuration > typicalMs * 1.5 &&
			lastDuration - typicalMs > 30_000,
		flaky: sorted
			.slice(0, 12)
			.some((run) => run.attempt > 1 && run.conclusion === "success"),
	};
}

/** Selected workflow ids from ticked groups plus individually ticked workflows. */
export function resolveSelection(
	groups: Array<{ _id: string; workflows: Array<{ id: number }> }>,
	selectedGroupIds: Set<string>,
	selectedWorkflowIds: Set<number>,
) {
	const ids = new Set(selectedWorkflowIds);
	for (const group of groups) {
		if (!selectedGroupIds.has(group._id)) continue;
		for (const workflow of group.workflows) ids.add(workflow.id);
	}
	return ids;
}

export function shortSha(sha: string | null | undefined) {
	return sha ? sha.slice(0, 7) : "";
}

/** Short workflow label: drops a common "Docker - " style prefix. */
export function compactWorkflowName(name: string) {
	return name.replace(/^docker\s*[-–:]\s*/i, "");
}
