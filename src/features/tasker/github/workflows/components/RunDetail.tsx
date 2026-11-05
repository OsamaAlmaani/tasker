import { Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import {
	ExternalLink,
	GitBranch,
	GitCommitHorizontal,
	ListChecks,
	RefreshCw,
	RotateCcw,
	Server,
	Square,
	Timer,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	extractErrorLines,
	type RunJob,
	type WorkflowRun,
} from "#convex/lib/githubWorkflowsApi";
import { GitHubAvatar } from "../../components/GitHubBadges";
import { useGitHubData } from "../../useGitHubData";
import { type ParsedLog, parseLog } from "../logModel";
import {
	eventLabel,
	formatDuration,
	isActiveState,
	RUN_STATE_LABELS,
	runDuration,
	runVisualState,
	shortSha,
} from "../workflowDisplay";
import { LogViewer } from "./LogViewer";
import {
	RUN_STATE_FILL,
	RUN_STATE_TEXT,
	RunStatusIcon,
	useNow,
} from "./WorkflowPrimitives";

type RunData = {
	repository: string;
	run: WorkflowRun;
	jobs: RunJob[];
	typicalDurationMs: number | null;
	lastSuccess: {
		id: number;
		runNumber: number;
		headSha: string;
		at: number;
	} | null;
};

type LoadedLog = {
	jobId: number;
	completedAt: number | null;
	text: string;
	parsed: ParsedLog;
	truncated: boolean;
};

export function RunDetail({
	projectId,
	runId,
	repositoryUrl,
	canWrite,
	jobId,
	line,
	onSelect,
}: {
	projectId: Id<"projects">;
	runId: number;
	repositoryUrl: string;
	canWrite: boolean;
	jobId: number | null;
	line: number | null;
	onSelect: (selection: { job?: number | null; line?: number | null }) => void;
}) {
	const getRun = useAction(api.githubWorkflows.getRun);
	const data = useGitHubData<RunData>(
		`run:${projectId}:${runId}`,
		() => getRun({ projectId, runId }),
		"Could not load this run from GitHub.",
	);
	const run = data.data?.run ?? null;
	const state = run ? runVisualState(run) : null;
	const active = state ? isActiveState(state) : false;
	const now = useNow(active);
	const { refetch } = data;

	// Follow a live run until it finishes.
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refetch();
		}, 5000);
		return () => window.clearInterval(timer);
	}, [active, refetch]);

	if (!data.data) {
		if (data.error) {
			return (
				<div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
					<p className="m-0 text-sm text-[var(--danger)]" role="alert">
						{data.error}
					</p>
				</div>
			);
		}
		return <div className="page-loading">Loading run…</div>;
	}

	return (
		<RunDetailContent
			projectId={projectId}
			data={data.data}
			repositoryUrl={repositoryUrl}
			canWrite={canWrite}
			now={now}
			refreshing={data.isLoading}
			onRefresh={() => void refetch()}
			jobId={jobId}
			line={line}
			onSelect={onSelect}
			error={data.error}
		/>
	);
}

function RunDetailContent({
	projectId,
	data,
	repositoryUrl,
	canWrite,
	now,
	refreshing,
	onRefresh,
	jobId,
	line,
	onSelect,
	error,
}: {
	projectId: Id<"projects">;
	data: RunData;
	repositoryUrl: string;
	canWrite: boolean;
	now: number;
	refreshing: boolean;
	onRefresh: () => void;
	jobId: number | null;
	line: number | null;
	onSelect: (selection: { job?: number | null; line?: number | null }) => void;
	error: string | null;
}) {
	const { run, jobs } = data;
	const state = runVisualState(run);
	const active = isActiveState(state);
	const duration = runDuration(run, now);
	const rerunRuns = useAction(api.githubWorkflows.rerunRuns);
	const cancelRuns = useAction(api.githubWorkflows.cancelRuns);
	const getJobLog = useAction(api.githubWorkflows.getJobLog);
	const workspace = useQuery(api.githubWorkflowGroups.getWorkspace, {
		projectId,
	});
	const [busy, setBusy] = useState<"rerun-failed" | "rerun" | "cancel" | null>(
		null,
	);
	const [actionError, setActionError] = useState<string | null>(null);
	const [logs, setLogs] = useState<Map<number, LoadedLog>>(new Map());
	const [logError, setLogError] = useState<Map<number, string>>(new Map());

	const release = workspace?.releases.find((candidate) =>
		candidate.runs.some((entry) => entry.runId === run.id),
	);

	const selectedJob =
		jobs.find((job) => job.id === jobId) ??
		jobs.find((job) => job.conclusion === "failure") ??
		jobs.find((job) => job.status === "in_progress") ??
		jobs[0] ??
		null;

	const loadLog = useCallback(
		async (job: RunJob) => {
			setLogError((value) => {
				const next = new Map(value);
				next.delete(job.id);
				return next;
			});
			try {
				const result = await getJobLog({ projectId, jobId: job.id });
				setLogs((value) =>
					new Map(value).set(job.id, {
						jobId: job.id,
						completedAt: job.completedAt,
						text: result.text,
						parsed: parseLog(result.text),
						truncated: result.truncated,
					}),
				);
			} catch (caught) {
				setLogError((value) =>
					new Map(value).set(
						job.id,
						getClientErrorMessage(caught, "Could not load the log."),
					),
				);
			}
		},
		[getJobLog, projectId],
	);

	// Logs exist once a job finishes; reload after a re-run finishes again.
	useEffect(() => {
		if (!selectedJob || selectedJob.status !== "completed") return;
		const loaded = logs.get(selectedJob.id);
		if (loaded && loaded.completedAt === selectedJob.completedAt) return;
		if (logError.has(selectedJob.id)) return;
		void loadLog(selectedJob);
	}, [selectedJob, logs, logError, loadLog]);

	async function runAction(kind: "rerun-failed" | "rerun" | "cancel") {
		setBusy(kind);
		setActionError(null);
		try {
			const [result] =
				kind === "cancel"
					? await cancelRuns({ projectId, runIds: [run.id] })
					: await rerunRuns({
							projectId,
							runIds: [run.id],
							failedOnly: kind === "rerun-failed",
						});
			if (result && !result.ok) setActionError(result.error);
			window.setTimeout(onRefresh, 1500);
		} catch (caught) {
			setActionError(
				getClientErrorMessage(caught, "GitHub rejected the request."),
			);
		} finally {
			setBusy(null);
		}
	}

	const slower =
		run.status === "completed" &&
		duration !== null &&
		data.typicalDurationMs !== null &&
		duration > data.typicalDurationMs * 1.25 &&
		duration - data.typicalDurationMs > 20_000;
	const failed = state === "failure";
	const log = selectedJob ? logs.get(selectedJob.id) : undefined;
	const errorLines = useMemo(
		() =>
			log && selectedJob?.conclusion === "failure"
				? extractErrorLines(log.text, 8)
				: [],
		[log, selectedJob],
	);
	const failedStep =
		selectedJob?.steps.find((step) => step.conclusion === "failure") ?? null;

	return (
		<div className="space-y-4">
			<section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
				<div className="flex flex-wrap items-start gap-3 p-4">
					<RunStatusIcon state={state} className="mt-1 h-6 w-6" />
					<div className="min-w-0 flex-1 space-y-1.5">
						<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
							<h2 className="m-0 text-lg font-semibold">{run.name}</h2>
							<span className="text-sm text-[var(--muted-text)]">
								#{run.runNumber}
							</span>
							{run.attempt > 1 ? (
								<span className="rounded-full border border-[var(--line)] px-1.5 text-[11px] text-[var(--muted-text)]">
									Attempt {run.attempt}
								</span>
							) : null}
							<span
								className={cn("text-sm font-medium", RUN_STATE_TEXT[state])}
							>
								{RUN_STATE_LABELS[state]}
							</span>
						</div>
						{run.title && run.title !== run.name ? (
							<p className="m-0 text-sm text-[var(--text)]">{run.title}</p>
						) : null}
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-text)]">
							<span>{eventLabel(run.event)}</span>
							{(run.triggeringActor ?? run.actor) ? (
								<span className="inline-flex items-center gap-1">
									<GitHubAvatar
										login={(run.triggeringActor ?? run.actor)?.login ?? ""}
										avatarUrl={
											(run.triggeringActor ?? run.actor)?.avatarUrl ?? null
										}
										size={16}
									/>
									{(run.triggeringActor ?? run.actor)?.login}
								</span>
							) : null}
							{run.branch ? (
								<span className="inline-flex items-center gap-1 font-mono">
									<GitBranch className="h-3 w-3" />
									{run.branch}
								</span>
							) : null}
							<a
								href={`${repositoryUrl}/commit/${run.headSha}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 font-mono text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
							>
								<GitCommitHorizontal className="h-3 w-3" />
								{shortSha(run.headSha)}
							</a>
							<span title={new Date(run.createdAt).toLocaleString()}>
								Started {formatRelative(run.createdAt)}
							</span>
							{release ? (
								<Link
									to="/projects/$projectId/workflows"
									params={{ projectId }}
									search={{ release: release._id }}
									className="inline-flex items-center gap-1 text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
								>
									<ListChecks className="h-3 w-3" />
									Part of {release.name}
								</Link>
							) : null}
						</div>
					</div>
					<div className="text-right">
						<div
							className={cn(
								"font-mono text-xl tabular-nums",
								active ? RUN_STATE_TEXT.running : "text-[var(--text)]",
							)}
						>
							{formatDuration(duration)}
						</div>
						{data.typicalDurationMs !== null ? (
							<div
								className={cn(
									"inline-flex items-center gap-1 text-xs",
									slower
										? "text-amber-600 dark:text-amber-400"
										: "text-[var(--muted-text)]",
								)}
							>
								<Timer className="h-3 w-3" />
								usually {formatDuration(data.typicalDurationMs)}
							</div>
						) : null}
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2">
					<div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted-text)]">
						{data.lastSuccess && failed ? (
							<a
								href={`${repositoryUrl}/compare/${data.lastSuccess.headSha}...${run.headSha}`}
								target="_blank"
								rel="noreferrer"
								className="text-[var(--muted-text)] hover:text-[var(--text)]"
							>
								Changes since the last success (#{data.lastSuccess.runNumber},{" "}
								{formatRelative(data.lastSuccess.at)})
							</a>
						) : null}
						{active ? (
							<span className="inline-flex items-center gap-1.5">
								<span className="workflow-pulse h-2 w-2 rounded-full bg-amber-500" />
								Live · updates every few seconds
							</span>
						) : null}
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							size="sm"
							variant="ghost"
							onClick={onRefresh}
							disabled={refreshing}
							aria-label="Refresh"
						>
							<RefreshCw
								className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
							/>
						</Button>
						{canWrite && active ? (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy !== null}
								onClick={() => void runAction("cancel")}
							>
								<Square className="mr-1.5 h-3.5 w-3.5" />
								{busy === "cancel" ? "Cancelling…" : "Cancel run"}
							</Button>
						) : null}
						{canWrite && !active && failed ? (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy !== null}
								onClick={() => void runAction("rerun-failed")}
							>
								<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
								{busy === "rerun-failed" ? "Re-running…" : "Re-run failed jobs"}
							</Button>
						) : null}
						{canWrite && !active ? (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy !== null}
								onClick={() => void runAction("rerun")}
							>
								<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
								{busy === "rerun" ? "Re-running…" : "Re-run all"}
							</Button>
						) : null}
						<a
							href={run.htmlUrl}
							target="_blank"
							rel="noreferrer"
							className="no-underline"
						>
							<Button size="sm" variant="ghost">
								<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
								GitHub
							</Button>
						</a>
					</div>
				</div>
				{actionError || error ? (
					<p
						className="m-0 border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--danger)]"
						role="alert"
					>
						{actionError ?? error}
					</p>
				) : null}
			</section>

			{failed && selectedJob?.conclusion === "failure" ? (
				<section className="overflow-hidden rounded-xl border border-rose-300/70 bg-[var(--surface)] dark:border-rose-900/70">
					<div className="flex flex-wrap items-center gap-2 bg-rose-500/[0.07] px-4 py-2.5">
						<TriangleAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
						<h3 className="m-0 text-sm font-semibold text-rose-700 dark:text-rose-300">
							Why it failed
						</h3>
						<span className="text-xs text-[var(--muted-text)]">
							{selectedJob.name}
							{failedStep
								? ` · step ${failedStep.number}, “${failedStep.name}”`
								: ""}
						</span>
					</div>
					<div className="px-4 py-3">
						{errorLines.length ? (
							<pre className="m-0 max-h-60 overflow-auto rounded-md bg-[var(--surface-muted)] px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--text)]">
								{errorLines.join("\n")}
							</pre>
						) : logError.get(selectedJob.id) ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								{logError.get(selectedJob.id)}
							</p>
						) : (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								Reading the log…
							</p>
						)}
					</div>
				</section>
			) : null}

			<div
				className={cn(
					"grid gap-4",
					jobs.length > 1 && "lg:grid-cols-[16rem_minmax(0,1fr)]",
				)}
			>
				{jobs.length > 1 ? (
					<nav
						aria-label="Jobs"
						className="h-fit overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
					>
						<p className="m-0 border-b border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--muted-text)]">
							{jobs.length} jobs
						</p>
						<ul className="m-0 list-none p-1">
							{jobs.map((job) => {
								const jobState = runVisualState(job);
								const jobDuration =
									job.startedAt !== null
										? (job.completedAt ?? now) - job.startedAt
										: null;
								return (
									<li key={job.id}>
										<button
											type="button"
											className={cn(
												"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-muted)]",
												selectedJob?.id === job.id &&
													"bg-[var(--surface-muted)] font-medium",
											)}
											onClick={() => onSelect({ job: job.id, line: null })}
											aria-current={
												selectedJob?.id === job.id ? "true" : undefined
											}
										>
											<RunStatusIcon state={jobState} className="h-3.5 w-3.5" />
											<span className="min-w-0 flex-1 truncate">
												{job.name}
											</span>
											<span className="text-xs text-[var(--muted-text)] tabular-nums">
												{formatDuration(jobDuration)}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</nav>
				) : null}

				{selectedJob ? (
					<div className="min-w-0 space-y-4">
						<StepTimeline job={selectedJob} now={now} />
						{selectedJob.status !== "completed" ? (
							<div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--muted-text)]">
								{selectedJob.status === "in_progress"
									? "GitHub publishes the log when this job finishes. The steps above update live."
									: "This job has not started yet."}
							</div>
						) : log ? (
							<LogViewer
								key={`${log.jobId}:${log.completedAt}`}
								log={log.parsed}
								rawText={log.text}
								steps={selectedJob.steps}
								truncated={log.truncated}
								selectedLine={line}
								onSelectLine={(number) =>
									onSelect({ job: selectedJob.id, line: number })
								}
								fileName={`${run.name}-${selectedJob.name}-${run.runNumber}.log`.replace(
									/[^\w.-]+/g,
									"_",
								)}
							/>
						) : logError.get(selectedJob.id) ? (
							<div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
								<p className="m-0 text-sm text-[var(--danger)]">
									{logError.get(selectedJob.id)}
								</p>
								<Button
									size="sm"
									variant="secondary"
									onClick={() => void loadLog(selectedJob)}
								>
									Try again
								</Button>
							</div>
						) : (
							<div className="page-loading">Loading log…</div>
						)}
					</div>
				) : (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						This run has no jobs yet.
					</p>
				)}
			</div>
		</div>
	);
}

/** Steps as bars on the job's own time axis. */
function StepTimeline({ job, now }: { job: RunJob; now: number }) {
	const start =
		job.startedAt ??
		job.steps.find((step) => step.startedAt)?.startedAt ??
		null;
	const end = job.completedAt ?? now;
	const span = start !== null ? Math.max(end - start, 1000) : 1;
	const jobState = runVisualState(job);
	return (
		<section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-2.5">
				<RunStatusIcon state={jobState} />
				<h3 className="m-0 text-sm font-semibold">{job.name}</h3>
				<span className="text-xs text-[var(--muted-text)] tabular-nums">
					{start !== null ? formatDuration(end - start) : "Not started"}
				</span>
				{job.runnerName ? (
					<span
						className="ml-auto inline-flex min-w-0 items-center gap-1 truncate text-xs text-[var(--muted-text)]"
						title={job.labels.join(", ")}
					>
						<Server className="h-3 w-3 shrink-0" />
						<span className="truncate">{job.labels[0] ?? job.runnerName}</span>
					</span>
				) : null}
			</header>
			<ol className="m-0 list-none p-0">
				{job.steps.map((step) => {
					const state = runVisualState(step);
					const stepStart = step.startedAt;
					const stepEnd =
						step.completedAt ?? (step.status === "in_progress" ? now : null);
					const left =
						start !== null && stepStart !== null
							? ((stepStart - start) / span) * 100
							: 0;
					const width =
						stepStart !== null && stepEnd !== null
							? Math.max(((stepEnd - stepStart) / span) * 100, 0.6)
							: 0;
					return (
						<li
							key={step.number}
							className={cn(
								"grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-3 px-4 py-1.5 text-xs sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4rem]",
								state === "failure" && "bg-rose-500/[0.05]",
							)}
						>
							<span className="flex min-w-0 items-center gap-2">
								<RunStatusIcon state={state} className="h-3.5 w-3.5" />
								<span
									className={cn(
										"truncate",
										state === "skipped" && "text-[var(--muted-text)]",
									)}
								>
									{step.name}
								</span>
							</span>
							<span
								className="relative hidden h-2 rounded-full bg-[var(--surface-muted)] sm:block"
								aria-hidden="true"
							>
								{width ? (
									<span
										className={cn(
											"absolute inset-y-0 rounded-full",
											RUN_STATE_FILL[state],
											state === "running" && "workflow-stripes",
										)}
										style={{ left: `${left}%`, width: `${width}%` }}
									/>
								) : null}
							</span>
							<span className="text-right font-mono text-[var(--muted-text)] tabular-nums">
								{stepStart !== null && stepEnd !== null
									? formatDuration(stepEnd - stepStart)
									: "—"}
							</span>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
