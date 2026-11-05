import { Link } from "@tanstack/react-router";
import {
	ChevronDown,
	GitBranch,
	GitCommitHorizontal,
	ListChecks,
	Play,
	RotateCcw,
	Square,
	TriangleAlert,
	Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { formatRelative } from "#/features/tasker/format";
import { cn } from "#/lib/utils";
import type { FailureSummary } from "#convex/githubWorkflows";
import type { WorkflowRun } from "#convex/lib/githubWorkflowsApi";
import { GitHubAvatar } from "../../components/GitHubBadges";
import {
	compactWorkflowName,
	estimateRemaining,
	eventLabel,
	type FeedItem,
	type FeedRelease,
	formatDuration,
	groupFailures,
	isActiveState,
	RUN_STATE_LABELS,
	type RunVisualState,
	releaseProgress,
	runDuration,
	runVisualState,
	shortSha,
} from "../workflowDisplay";
import {
	RUN_STATE_FILL,
	RUN_STATE_TEXT,
	RunStatusIcon,
	StateBar,
} from "./WorkflowPrimitives";

export type FeedActions = {
	canWrite: boolean;
	onRerun: (runIds: number[], failedOnly: boolean) => Promise<void>;
	onCancel: (runIds: number[]) => Promise<void>;
	onRunAgain: (workflowIds: number[], name: string, groupIds: string[]) => void;
	onLoadRuns: (runIds: number[]) => void;
	loadFailures: (runIds: number[]) => void;
	failures: Map<number, FailureSummary>;
};

const STATE_ORDER: Record<RunVisualState, number> = {
	failure: 0,
	running: 1,
	waiting: 2,
	queued: 3,
	cancelled: 4,
	neutral: 5,
	success: 6,
	skipped: 7,
};

export function ReleaseFeed({
	projectId,
	items,
	now,
	typical,
	actions,
	highlightKey,
	repositoryUrl,
}: {
	projectId: string;
	items: FeedItem[];
	now: number;
	typical: Map<number, number>;
	actions: FeedActions;
	highlightKey: string | null;
	repositoryUrl: string;
}) {
	// Consecutive single runs share one card so releases stay easy to scan.
	const blocks = useMemo(() => {
		const result: Array<
			| { kind: "release"; item: FeedRelease }
			| { kind: "runs"; key: string; items: WorkflowRun[] }
		> = [];
		for (const item of items) {
			if (item.kind === "release") {
				result.push({ kind: "release", item });
				continue;
			}
			const last = result.at(-1);
			if (last?.kind === "runs") last.items.push(item.run);
			else result.push({ kind: "runs", key: item.key, items: [item.run] });
		}
		return result;
	}, [items]);

	return (
		<div className="space-y-3">
			{blocks.map((block) =>
				block.kind === "release" ? (
					<ReleaseCard
						key={block.item.key}
						projectId={projectId}
						item={block.item}
						now={now}
						typical={typical}
						actions={actions}
						highlighted={highlightKey === block.item.key}
						repositoryUrl={repositoryUrl}
					/>
				) : (
					<SingleRunsCard
						key={block.key}
						projectId={projectId}
						runs={block.items}
						now={now}
					/>
				),
			)}
		</div>
	);
}

function useInView<T extends Element>(ref: React.RefObject<T | null>) {
	const [inView, setInView] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || inView) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setInView(true);
			},
			{ rootMargin: "200px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, inView]);
	return inView;
}

function ReleaseCard({
	projectId,
	item,
	now,
	typical,
	actions,
	highlighted,
	repositoryUrl,
}: {
	projectId: string;
	item: FeedRelease;
	now: number;
	typical: Map<number, number>;
	actions: FeedActions;
	highlighted: boolean;
	repositoryUrl: string;
}) {
	const cardRef = useRef<HTMLElement>(null);
	const inView = useInView(cardRef);
	const [expanded, setExpanded] = useState(false);
	const [showSkipped, setShowSkipped] = useState(false);
	const [busy, setBusy] = useState<"rerun" | "cancel" | null>(null);
	const progress = releaseProgress(item, now);
	const active = progress.state === "running" || progress.state === "queued";
	const remaining = active ? estimateRemaining(item.runs, typical, now) : null;

	const sortedRuns = useMemo(
		() =>
			[...item.runs].sort((a, b) => {
				const order =
					STATE_ORDER[runVisualState(a)] - STATE_ORDER[runVisualState(b)];
				return order || a.name.localeCompare(b.name);
			}),
		[item.runs],
	);
	const failedRuns = useMemo(
		() => item.runs.filter((run) => runVisualState(run) === "failure"),
		[item.runs],
	);
	const activeRuns = item.runs.filter((run) =>
		isActiveState(runVisualState(run)),
	);
	const notLoaded = item.missing.filter((entry) => entry.runId !== null);
	const failedToStart = item.missing.filter(
		(entry) => entry.runId === null && entry.error,
	);

	// Error lines load once the card is on screen.
	const failedKey = failedRuns
		.map((run) => `${run.id}:${run.attempt}`)
		.join(",");
	const { loadFailures, onLoadRuns } = actions;
	useEffect(() => {
		if (!inView || !failedKey) return;
		loadFailures(
			failedKey.split(",").map((entry) => Number(entry.split(":")[0])),
		);
	}, [inView, failedKey, loadFailures]);

	const notLoadedKey = notLoaded.map((entry) => entry.runId).join(",");
	useEffect(() => {
		if (!inView || !notLoadedKey) return;
		onLoadRuns(notLoadedKey.split(",").map(Number));
	}, [inView, notLoadedKey, onLoadRuns]);

	useEffect(() => {
		if (highlighted)
			cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
	}, [highlighted]);

	const failureGroups = useMemo(
		() => groupFailures(failedRuns, actions.failures),
		[failedRuns, actions.failures],
	);

	const workflowIds = [
		...new Set([
			...item.runs.map((run) => run.workflowId),
			...item.missing.map((entry) => entry.workflowId),
		]),
	];
	const summaryParts = [
		progress.counts.success ? `${progress.counts.success} passed` : null,
		progress.counts.failure ? `${progress.counts.failure} failed` : null,
		progress.counts.cancelled ? `${progress.counts.cancelled} cancelled` : null,
		progress.counts.running ? `${progress.counts.running} running` : null,
		progress.counts.queued + progress.counts.waiting
			? `${progress.counts.queued + progress.counts.waiting} waiting`
			: null,
		progress.counts.skipped ? `${progress.counts.skipped} skipped` : null,
	].filter(Boolean);

	async function rerunFailed(runIds: number[]) {
		setBusy("rerun");
		try {
			await actions.onRerun(runIds, true);
		} finally {
			setBusy(null);
		}
	}

	const releaseStart = item.parent?.createdAt ?? item.startedAt;
	const timelineEnd = Math.max(
		releaseStart + 1000,
		...item.runs.map((run) =>
			run.status === "completed" ? run.updatedAt : now,
		),
	);

	return (
		<article
			ref={cardRef}
			className={cn(
				"overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] transition-shadow",
				highlighted && "workflow-flash",
			)}
			aria-label={`${item.name}, ${RUN_STATE_LABELS[progress.state]}`}
		>
			<div className="space-y-3 p-4">
				<div className="flex items-start gap-3">
					<RunStatusIcon state={progress.state} className="mt-0.5 h-5 w-5" />
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<h3 className="m-0 truncate text-[15px] font-semibold text-[var(--text)]">
								{item.name}
							</h3>
							<span
								className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted-text)]"
								title={
									item.source === "tasker"
										? "Started together from Tasker"
										: "Runs started by another workflow"
								}
							>
								{item.source === "tasker" ? (
									<ListChecks className="h-3 w-3" />
								) : (
									<Workflow className="h-3 w-3" />
								)}
								{item.source === "tasker" ? "Release" : "Chained"}
							</span>
						</div>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted-text)]">
							{item.startedBy ? <span>{item.startedBy}</span> : null}
							{item.ref ? (
								<span className="inline-flex items-center gap-1">
									<GitBranch className="h-3 w-3" />
									<span className="font-mono">{item.ref}</span>
								</span>
							) : null}
							{item.headSha ? (
								<a
									href={`${repositoryUrl}/commit/${item.headSha}`}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 font-mono text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
								>
									<GitCommitHorizontal className="h-3 w-3" />
									{shortSha(item.headSha)}
								</a>
							) : null}
							{item.runs[0]?.title ? (
								<span className="max-w-[28rem] truncate">
									{item.runs[0].title}
								</span>
							) : null}
						</div>
					</div>
					<div className="shrink-0 text-right">
						<div
							className={cn(
								"font-mono text-sm tabular-nums",
								active ? RUN_STATE_TEXT.running : "text-[var(--text)]",
							)}
							title={active ? "Elapsed" : "Total time"}
						>
							{formatDuration(progress.durationMs)}
						</div>
						<div
							className="text-xs text-[var(--muted-text)]"
							title={new Date(item.startedAt).toLocaleString()}
						>
							{formatRelative(item.startedAt)}
						</div>
					</div>
				</div>

				<div className="space-y-2 pl-8">
					<StateBar counts={progress.counts} total={progress.total} />
					<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
						<span className="text-[var(--muted-text)]">
							{active ? (
								<>
									<span className="font-medium text-[var(--text)]">
										{progress.done} of {progress.total}
									</span>{" "}
									done
									{progress.counts.failure
										? ` · ${progress.counts.failure} failed`
										: ""}
									{remaining !== null
										? ` · about ${formatDuration(remaining)} left`
										: ""}
								</>
							) : (
								<>
									<span className="font-medium text-[var(--text)]">
										{progress.total}{" "}
										{progress.total === 1 ? "workflow" : "workflows"}
									</span>
									{summaryParts.length ? ` · ${summaryParts.join(" · ")}` : ""}
								</>
							)}
						</span>
						{item.skipped.length ? (
							<button
								type="button"
								className="text-[var(--muted-text)] hover:text-[var(--text)]"
								onClick={() => setShowSkipped((value) => !value)}
								aria-expanded={showSkipped}
							>
								{item.skipped.length} left out
								<ChevronDown
									className={cn(
										"ml-0.5 inline h-3 w-3 transition-transform",
										showSkipped && "rotate-180",
									)}
								/>
							</button>
						) : null}
					</div>

					<RunTiles projectId={projectId} runs={sortedRuns} />

					{notLoaded.length ? (
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Loading {notLoaded.length} more{" "}
							{notLoaded.length === 1 ? "run" : "runs"}…
						</p>
					) : null}

					{showSkipped ? (
						<div className="rounded-lg border border-dashed border-[var(--line)] p-3 text-xs text-[var(--muted-text)]">
							<p className="m-0 mb-1.5 font-medium text-[var(--text)]">
								Left out of this release
							</p>
							<ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
								{item.skipped.map((entry) => (
									<li key={entry.workflowId} className="truncate">
										{compactWorkflowName(entry.workflowName)}{" "}
										<span className="opacity-75">
											·{" "}
											{entry.reason === "unchanged"
												? "no code changes"
												: "removed before start"}
										</span>
									</li>
								))}
							</ul>
						</div>
					) : null}

					{failedToStart.length ? (
						<div className="rounded-lg border border-rose-300/60 bg-rose-500/5 p-3 text-xs dark:border-rose-800/60">
							<p className="m-0 mb-1 flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-300">
								<TriangleAlert className="h-3.5 w-3.5" />
								{failedToStart.length} did not start
							</p>
							<ul className="m-0 list-none space-y-0.5 p-0 text-[var(--muted-text)]">
								{failedToStart.map((entry) => (
									<li key={entry.workflowId}>
										<span className="text-[var(--text)]">
											{compactWorkflowName(entry.workflowName)}
										</span>
										: {entry.error}
									</li>
								))}
							</ul>
						</div>
					) : null}

					{failureGroups.length ? (
						<div className="space-y-2">
							{failureGroups.map((group) => (
								<FailureGroupCard
									key={group.signature}
									projectId={projectId}
									runs={group.runs}
									line={group.line}
									stepName={group.stepName}
									loading={group.runs.some(
										(run) => !actions.failures.has(run.id),
									)}
									canWrite={actions.canWrite}
									busy={busy === "rerun"}
									onRerun={() =>
										void rerunFailed(group.runs.map((run) => run.id))
									}
								/>
							))}
						</div>
					) : null}

					{expanded ? (
						<RunTimeline
							projectId={projectId}
							runs={sortedRuns}
							start={releaseStart}
							end={timelineEnd}
							now={now}
							typical={typical}
						/>
					) : null}
				</div>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2">
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--muted-text)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
					disabled={!item.runs.length}
				>
					<ChevronDown
						className={cn(
							"h-3.5 w-3.5 transition-transform",
							expanded && "rotate-180",
						)}
					/>
					{expanded ? "Hide timeline" : `Timeline of ${item.runs.length}`}
				</button>
				<div className="flex flex-wrap items-center gap-1.5">
					{item.parent ? (
						<Link
							to="/projects/$projectId/workflows/runs/$runId"
							params={{ projectId, runId: String(item.parent.id) }}
							className="rounded-md px-2 py-1 text-xs text-[var(--muted-text)] no-underline hover:bg-[var(--surface)] hover:text-[var(--text)]"
						>
							{item.parent.name} #{item.parent.runNumber}
						</Link>
					) : null}
					{actions.canWrite && activeRuns.length ? (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy !== null}
							onClick={async () => {
								setBusy("cancel");
								try {
									await actions.onCancel(activeRuns.map((run) => run.id));
								} finally {
									setBusy(null);
								}
							}}
						>
							<Square className="mr-1.5 h-3.5 w-3.5" />
							{busy === "cancel"
								? "Cancelling…"
								: `Cancel ${activeRuns.length}`}
						</Button>
					) : null}
					{actions.canWrite && failedRuns.length && !active ? (
						<Button
							size="sm"
							variant="secondary"
							disabled={busy !== null}
							onClick={() => void rerunFailed(failedRuns.map((run) => run.id))}
						>
							<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
							{busy === "rerun"
								? "Re-running…"
								: `Re-run ${failedRuns.length} failed`}
						</Button>
					) : null}
					{actions.canWrite && workflowIds.length ? (
						<Button
							size="sm"
							variant="secondary"
							onClick={() =>
								actions.onRunAgain(
									workflowIds,
									item.name,
									item.release?.groupIds ?? [],
								)
							}
						>
							<Play className="mr-1.5 h-3.5 w-3.5" />
							Run again
						</Button>
					) : null}
				</div>
			</div>
		</article>
	);
}

function runLabel(run: WorkflowRun, now: number) {
	const state = runVisualState(run);
	const duration = runDuration(run, now);
	return `${compactWorkflowName(run.name)}\n${RUN_STATE_LABELS[state]}${duration !== null ? ` · ${formatDuration(duration)}` : ""}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}`;
}

function RunTiles({
	projectId,
	runs,
}: {
	projectId: string;
	runs: WorkflowRun[];
}) {
	const now = Date.now();
	if (!runs.length) return null;
	return (
		<ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Runs">
			{runs.map((run) => {
				const state = runVisualState(run);
				return (
					<li key={run.id}>
						<Link
							to="/projects/$projectId/workflows/runs/$runId"
							params={{ projectId, runId: String(run.id) }}
							className={cn(
								"workflow-tile block h-4 w-4 rounded-[4px] transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]",
								RUN_STATE_FILL[state],
								state === "running" && "workflow-pulse",
							)}
							data-label={runLabel(run, now)}
							aria-label={`${run.name}: ${RUN_STATE_LABELS[state]}`}
						/>
					</li>
				);
			})}
		</ul>
	);
}

function FailureGroupCard({
	projectId,
	runs,
	line,
	stepName,
	loading,
	canWrite,
	busy,
	onRerun,
}: {
	projectId: string;
	runs: WorkflowRun[];
	line: string | null;
	stepName: string | null;
	loading: boolean;
	canWrite: boolean;
	busy: boolean;
	onRerun: () => void;
}) {
	const [showAll, setShowAll] = useState(false);
	const visible = showAll ? runs : runs.slice(0, 8);
	return (
		<div className="overflow-hidden rounded-lg border border-rose-300/70 dark:border-rose-900/70">
			<div className="flex flex-wrap items-center justify-between gap-2 bg-rose-500/[0.06] px-3 py-2">
				<p className="m-0 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
					<RunStatusIcon
						state="failure"
						className="h-3.5 w-3.5"
						label={false}
					/>
					{runs.length} failed
					{stepName ? (
						<span className="font-normal text-[var(--muted-text)]">
							at “{stepName}”
						</span>
					) : null}
				</p>
				{canWrite ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-2 text-xs"
						disabled={busy}
						onClick={onRerun}
					>
						<RotateCcw className="mr-1 h-3 w-3" />
						Re-run {runs.length === 1 ? "it" : `these ${runs.length}`}
					</Button>
				) : null}
			</div>
			<div className="space-y-2 px-3 py-2">
				{line ? (
					<pre className="m-0 max-h-28 overflow-auto rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--text)]">
						{line}
					</pre>
				) : loading ? (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						Reading the error from the log…
					</p>
				) : null}
				<ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs">
					{visible.map((run) => (
						<li key={run.id}>
							<Link
								to="/projects/$projectId/workflows/runs/$runId"
								params={{ projectId, runId: String(run.id) }}
								className="text-[var(--text)] underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--text)]"
							>
								{compactWorkflowName(run.name)}
							</Link>
						</li>
					))}
					{runs.length > visible.length ? (
						<li>
							<button
								type="button"
								className="text-[var(--muted-text)] hover:text-[var(--text)]"
								onClick={() => setShowAll(true)}
							>
								+{runs.length - visible.length} more
							</button>
						</li>
					) : null}
				</ul>
			</div>
		</div>
	);
}

/** Each run as a bar on the release's own time axis. */
function RunTimeline({
	projectId,
	runs,
	start,
	end,
	now,
	typical,
}: {
	projectId: string;
	runs: WorkflowRun[];
	start: number;
	end: number;
	now: number;
	typical: Map<number, number>;
}) {
	const span = Math.max(end - start, 1000);
	return (
		<div className="rounded-lg border border-[var(--line)]">
			<div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--muted-text)]">
				<span>Started</span>
				<span>+{formatDuration(span)}</span>
			</div>
			<ul className="m-0 max-h-[26rem] list-none divide-y divide-[var(--line)] overflow-y-auto p-0">
				{runs.map((run) => {
					const state = runVisualState(run);
					const runStart = Math.max(run.startedAt, start);
					const runEnd = run.status === "completed" ? run.updatedAt : now;
					const queuedLeft = ((run.createdAt - start) / span) * 100;
					const left = ((runStart - start) / span) * 100;
					const width = Math.max(((runEnd - runStart) / span) * 100, 0.8);
					const duration = runDuration(run, now);
					const usual = typical.get(run.workflowId);
					const slow =
						duration !== null &&
						usual !== undefined &&
						run.status === "completed" &&
						duration > usual * 1.5 &&
						duration - usual > 30_000;
					return (
						<li key={run.id}>
							<Link
								to="/projects/$projectId/workflows/runs/$runId"
								params={{ projectId, runId: String(run.id) }}
								className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4.5rem] items-center gap-3 px-3 py-1.5 text-xs text-[var(--text)] no-underline hover:bg-[var(--surface-muted)] max-sm:grid-cols-[minmax(0,1fr)_4.5rem]"
							>
								<span className="flex min-w-0 items-center gap-2">
									<RunStatusIcon state={state} className="h-3.5 w-3.5" />
									<span className="truncate">
										{compactWorkflowName(run.name)}
									</span>
									{run.attempt > 1 ? (
										<span className="shrink-0 text-[10px] text-[var(--muted-text)]">
											#{run.attempt}
										</span>
									) : null}
								</span>
								<span
									className="relative h-2.5 rounded-full bg-[var(--surface-muted)] max-sm:hidden"
									aria-hidden="true"
								>
									{run.startedAt > run.createdAt + 2000 ? (
										<span
											className="absolute top-1/2 h-px -translate-y-1/2 bg-[var(--line)]"
											style={{
												left: `${Math.max(queuedLeft, 0)}%`,
												width: `${Math.max(left - queuedLeft, 0)}%`,
											}}
										/>
									) : null}
									<span
										className={cn(
											"absolute inset-y-0 rounded-full",
											RUN_STATE_FILL[state],
											state === "running" && "workflow-stripes",
										)}
										style={{ left: `${left}%`, width: `${width}%` }}
									/>
								</span>
								<span
									className={cn(
										"text-right font-mono tabular-nums",
										slow
											? "text-amber-600 dark:text-amber-400"
											: "text-[var(--muted-text)]",
									)}
									title={
										slow && usual !== undefined
											? `Usually ${formatDuration(usual)}`
											: undefined
									}
								>
									{formatDuration(duration)}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function SingleRunsCard({
	projectId,
	runs,
	now,
}: {
	projectId: string;
	runs: WorkflowRun[];
	now: number;
}) {
	const [showAll, setShowAll] = useState(false);
	const visible = showAll ? runs : runs.slice(0, 6);
	return (
		<div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
			<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
				{visible.map((run) => (
					<li key={run.id}>
						<RunRow projectId={projectId} run={run} now={now} />
					</li>
				))}
			</ul>
			{runs.length > visible.length ? (
				<button
					type="button"
					className="w-full border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-1.5 text-xs text-[var(--muted-text)] hover:text-[var(--text)]"
					onClick={() => setShowAll(true)}
				>
					Show {runs.length - visible.length} more runs
				</button>
			) : null}
		</div>
	);
}

export function RunRow({
	projectId,
	run,
	now,
	showName = true,
}: {
	projectId: string;
	run: WorkflowRun;
	now: number;
	showName?: boolean;
}) {
	const state = runVisualState(run);
	const duration = runDuration(run, now);
	return (
		<Link
			to="/projects/$projectId/workflows/runs/$runId"
			params={{ projectId, runId: String(run.id) }}
			className="flex items-center gap-3 px-4 py-2.5 text-[var(--text)] no-underline transition-colors hover:bg-[var(--surface-muted)]"
		>
			<RunStatusIcon state={state} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-medium">
						{showName ? run.name : run.title || run.name}
					</span>
					<span className="shrink-0 text-xs text-[var(--muted-text)]">
						#{run.runNumber}
					</span>
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-[var(--muted-text)]">
					<span>{eventLabel(run.event)}</span>
					{run.branch ? (
						<span className="truncate font-mono">{run.branch}</span>
					) : null}
					{showName && run.title && run.title !== run.name ? (
						<span className="hidden max-w-[22rem] truncate md:inline">
							{run.title}
						</span>
					) : null}
				</div>
			</div>
			{run.actor ? (
				<span className="hidden sm:inline-flex" title={run.actor.login}>
					<GitHubAvatar
						login={run.actor.login}
						avatarUrl={run.actor.avatarUrl}
					/>
				</span>
			) : null}
			<div className="w-20 shrink-0 text-right text-xs">
				<div
					className={cn(
						"font-mono tabular-nums",
						state === "running" ? RUN_STATE_TEXT.running : "text-[var(--text)]",
					)}
				>
					{formatDuration(duration)}
				</div>
				<div className="text-[var(--muted-text)]">
					{formatRelative(run.createdAt)}
				</div>
			</div>
		</Link>
	);
}
