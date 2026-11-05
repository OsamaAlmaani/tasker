import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	ChevronRight,
	CirclePause,
	ExternalLink,
	MoreHorizontal,
	Play,
	Power,
	Search,
	Timer,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "#/components/ui/input";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type {
	WorkflowRun,
	WorkflowSummary,
} from "#convex/lib/githubWorkflowsApi";
import {
	compactWorkflowName,
	formatDuration,
	RUN_STATE_LABELS,
	runDuration,
	runVisualState,
	type WorkflowStats,
	workflowStats,
} from "../workflowDisplay";
import { Checkbox, RUN_STATE_FILL, RunStatusIcon } from "./WorkflowPrimitives";

export type WorkflowGroup = {
	_id: string;
	name: string;
	workflows: Array<{ id: number; path: string }>;
};

export type WorkflowFilter = "all" | "failing" | "running" | "disabled";

const FILTERS: Array<{ value: WorkflowFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "failing", label: "Failing" },
	{ value: "running", label: "Running" },
	{ value: "disabled", label: "Disabled" },
];

export function canStart(workflow: WorkflowSummary) {
	return workflow.state === "active" && workflow.dispatchable === true;
}

export function startBlockedReason(workflow: WorkflowSummary) {
	if (workflow.state !== "active") return "This workflow is disabled.";
	if (workflow.dispatchable === false)
		return "Its workflow file has no workflow_dispatch trigger, so it cannot be started by hand.";
	if (workflow.dispatchable === null)
		return "Tasker could not read this workflow's file.";
	return null;
}

export function WorkflowTable({
	projectId,
	workflows,
	runsByWorkflow,
	groups,
	selected,
	onToggle,
	onToggleMany,
	groupFilter,
	onGroupFilterChange,
	canWrite,
	onRunOne,
	onSetEnabled,
	now,
}: {
	projectId: Id<"projects">;
	workflows: WorkflowSummary[];
	runsByWorkflow: Map<number, WorkflowRun[]>;
	groups: WorkflowGroup[];
	selected: Set<number>;
	onToggle: (workflowId: number, checked: boolean) => void;
	onToggleMany: (workflowIds: number[], checked: boolean) => void;
	groupFilter: string | null;
	onGroupFilterChange: (groupId: string | null) => void;
	canWrite: boolean;
	onRunOne: (workflowId: number) => void;
	onSetEnabled: (workflowId: number, enabled: boolean) => Promise<void>;
	now: number;
}) {
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<WorkflowFilter>("all");
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	// "/" jumps to the filter box, as on GitHub.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable]")) return;
			if (document.querySelector('[role="dialog"]')) return;
			event.preventDefault();
			searchRef.current?.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const stats = useMemo(() => {
		const result = new Map<number, WorkflowStats>();
		for (const workflow of workflows) {
			result.set(
				workflow.id,
				workflowStats(runsByWorkflow.get(workflow.id) ?? []),
			);
		}
		return result;
	}, [workflows, runsByWorkflow]);

	const groupsByWorkflow = useMemo(() => {
		const result = new Map<number, WorkflowGroup[]>();
		for (const group of groups) {
			for (const workflow of group.workflows) {
				result.set(workflow.id, [...(result.get(workflow.id) ?? []), group]);
			}
		}
		return result;
	}, [groups]);

	const activeGroup = groups.find((group) => group._id === groupFilter) ?? null;

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		const groupIds = activeGroup
			? new Set(activeGroup.workflows.map((workflow) => workflow.id))
			: null;
		return workflows.filter((workflow) => {
			if (groupIds && !groupIds.has(workflow.id)) return false;
			if (
				needle &&
				!workflow.name.toLowerCase().includes(needle) &&
				!workflow.path.toLowerCase().includes(needle)
			)
				return false;
			const last = stats.get(workflow.id)?.last;
			const state = last ? runVisualState(last) : null;
			if (filter === "failing") return state === "failure";
			if (filter === "running")
				return state === "running" || state === "queued" || state === "waiting";
			if (filter === "disabled") return workflow.state !== "active";
			return true;
		});
	}, [workflows, search, filter, stats, activeGroup]);

	const startable = visible.filter(canStart);
	const selectedVisible = startable.filter((workflow) =>
		selected.has(workflow.id),
	);
	const allChecked =
		startable.length > 0 && selectedVisible.length === startable.length;
	const counts = useMemo(() => {
		let failing = 0;
		let running = 0;
		let disabled = 0;
		for (const workflow of workflows) {
			if (workflow.state !== "active") disabled++;
			const last = stats.get(workflow.id)?.last;
			if (!last) continue;
			const state = runVisualState(last);
			if (state === "failure") failing++;
			if (state === "running" || state === "queued" || state === "waiting")
				running++;
		}
		return { all: workflows.length, failing, running, disabled };
	}, [workflows, stats]);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-[220px] flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-text)]" />
					<Input
						ref={searchRef}
						className="pr-9 pl-9"
						placeholder="Filter workflows by name or file"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						aria-label="Filter workflows"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setSearch("");
								event.currentTarget.blur();
							}
						}}
					/>
					{search ? (
						<button
							type="button"
							className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-[var(--muted-text)] hover:text-[var(--text)]"
							onClick={() => setSearch("")}
							aria-label="Clear filter"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					) : (
						<span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-[var(--line)] px-1.5 font-mono text-[10px] text-[var(--muted-text)] sm:inline">
							/
						</span>
					)}
				</div>
				<div
					className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-0.5"
					role="tablist"
					aria-label="Workflow status"
				>
					{FILTERS.map((option) => (
						<button
							key={option.value}
							type="button"
							role="tab"
							aria-selected={filter === option.value}
							className={cn(
								"rounded px-2.5 py-1 text-xs transition-colors",
								filter === option.value
									? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm"
									: "text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
							onClick={() => setFilter(option.value)}
						>
							{option.label}
							<span className="ml-1 tabular-nums opacity-60">
								{counts[option.value]}
							</span>
						</button>
					))}
				</div>
			</div>

			{activeGroup ? (
				<div className="flex items-center gap-2 text-xs text-[var(--muted-text)]">
					<span>
						Showing group{" "}
						<span className="font-medium text-[var(--text)]">
							{activeGroup.name}
						</span>
					</span>
					<button
						type="button"
						className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
						onClick={() => onGroupFilterChange(null)}
					>
						<X className="h-3 w-3" />
						Show all
					</button>
				</div>
			) : null}

			<div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
				<div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-[11px] font-medium tracking-wide text-[var(--muted-text)] uppercase md:grid-cols-[1.25rem_minmax(0,1fr)_9.5rem_7.5rem_4rem_3.5rem]">
					{canWrite ? (
						<Checkbox
							checked={allChecked}
							indeterminate={!allChecked && selectedVisible.length > 0}
							disabled={!startable.length}
							label="Select all shown workflows"
							onChange={(checked) =>
								onToggleMany(
									startable.map((workflow) => workflow.id),
									checked,
								)
							}
						/>
					) : (
						<span />
					)}
					<span>
						{visible.length} {visible.length === 1 ? "workflow" : "workflows"}
					</span>
					<span className="hidden md:block">Recent runs</span>
					<span className="hidden md:block">Last run</span>
					<span className="hidden text-right md:block">Passing</span>
					<span className="sr-only">Actions</span>
				</div>
				{visible.length === 0 ? (
					<p className="m-0 p-8 text-center text-sm text-[var(--muted-text)]">
						{search || filter !== "all" || activeGroup
							? "No workflows match these filters."
							: "This repository has no workflows."}
					</p>
				) : (
					<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
						{visible.map((workflow) => (
							<WorkflowRow
								key={workflow.id}
								projectId={projectId}
								workflow={workflow}
								stats={stats.get(workflow.id) as WorkflowStats}
								groups={groupsByWorkflow.get(workflow.id) ?? []}
								checked={selected.has(workflow.id)}
								onToggle={(checked) => onToggle(workflow.id, checked)}
								canWrite={canWrite}
								expanded={expandedId === workflow.id}
								onExpand={() =>
									setExpandedId((current) =>
										current === workflow.id ? null : workflow.id,
									)
								}
								onRun={() => onRunOne(workflow.id)}
								onSetEnabled={(enabled) => onSetEnabled(workflow.id, enabled)}
								onGroupClick={onGroupFilterChange}
								now={now}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function WorkflowRow({
	projectId,
	workflow,
	stats,
	groups,
	checked,
	onToggle,
	canWrite,
	expanded,
	onExpand,
	onRun,
	onSetEnabled,
	onGroupClick,
	now,
}: {
	projectId: Id<"projects">;
	workflow: WorkflowSummary;
	stats: WorkflowStats;
	groups: WorkflowGroup[];
	checked: boolean;
	onToggle: (checked: boolean) => void;
	canWrite: boolean;
	expanded: boolean;
	onExpand: () => void;
	onRun: () => void;
	onSetEnabled: (enabled: boolean) => Promise<void>;
	onGroupClick: (groupId: string) => void;
	now: number;
}) {
	const blocked = startBlockedReason(workflow);
	const last = stats.last;
	const lastState = last ? runVisualState(last) : null;
	const disabled = workflow.state !== "active";
	return (
		<li
			className={cn(
				checked && "bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]",
			)}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the row toggles details; the name button inside handles keyboard use */}
			<div
				className="grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-muted)] md:grid-cols-[1.25rem_minmax(0,1fr)_9.5rem_7.5rem_4rem_3.5rem]"
				onClick={onExpand}
			>
				{canWrite ? (
					<Checkbox
						checked={checked}
						disabled={Boolean(blocked)}
						label={`Select ${workflow.name}`}
						title={blocked ?? undefined}
						onChange={onToggle}
					/>
				) : (
					<span />
				)}
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<button
							type="button"
							className="inline-flex min-w-0 items-center gap-1 text-left text-sm font-medium text-[var(--text)]"
							onClick={(event) => {
								event.stopPropagation();
								onExpand();
							}}
							aria-expanded={expanded}
						>
							<ChevronRight
								className={cn(
									"h-3.5 w-3.5 shrink-0 text-[var(--muted-text)] transition-transform",
									expanded && "rotate-90",
								)}
							/>
							<span className={cn("truncate", disabled && "opacity-60")}>
								{workflow.name}
							</span>
						</button>
						{disabled ? (
							<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted-text)]">
								<CirclePause className="h-3 w-3" />
								Disabled
							</span>
						) : null}
						{stats.slow ? (
							<span
								className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
								title={`The last run took much longer than the usual ${formatDuration(stats.typicalMs)}`}
							>
								<Timer className="h-3 w-3" />
								Slower
							</span>
						) : null}
						{stats.flaky ? (
							<span
								className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-300 px-1.5 py-0.5 text-[10px] text-violet-700 dark:border-violet-800 dark:text-violet-300"
								title="A recent run only passed after a re-run"
							>
								<TriangleAlert className="h-3 w-3" />
								Unreliable
							</span>
						) : null}
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[18px] text-xs text-[var(--muted-text)]">
						<span className="truncate font-mono text-[11px]">
							{workflow.path.replace(/^\.github\/workflows\//, "")}
						</span>
						{groups.map((group) => (
							<button
								key={group._id}
								type="button"
								className="rounded-full bg-[var(--surface-muted)] px-1.5 py-px text-[10px] text-[var(--muted-text)] hover:text-[var(--text)]"
								onClick={(event) => {
									event.stopPropagation();
									onGroupClick(group._id);
								}}
								title={`Show the ${group.name} group`}
							>
								{group.name}
							</button>
						))}
					</div>
				</div>
				<div className="hidden md:block">
					<RecentRuns projectId={projectId} runs={stats.recent} now={now} />
				</div>
				<div className="hidden min-w-0 text-xs md:block">
					{last && lastState ? (
						<div className="flex items-center gap-1.5">
							<RunStatusIcon state={lastState} className="h-3.5 w-3.5" />
							<span className="truncate text-[var(--text)]">
								{formatRelative(last.createdAt)}
							</span>
						</div>
					) : (
						<span className="text-[var(--muted-text)]">No recent runs</span>
					)}
					{last ? (
						<div className="pl-5 font-mono text-[11px] text-[var(--muted-text)] tabular-nums">
							{formatDuration(runDuration(last, now))}
						</div>
					) : null}
				</div>
				<div className="hidden text-right text-xs tabular-nums md:block">
					{stats.successRate === null ? (
						<span className="text-[var(--muted-text)]">—</span>
					) : (
						<span
							className={cn(
								stats.successRate >= 0.9
									? "text-emerald-600 dark:text-emerald-400"
									: stats.successRate >= 0.6
										? "text-amber-600 dark:text-amber-400"
										: "text-rose-600 dark:text-rose-400",
							)}
						>
							{Math.round(stats.successRate * 100)}%
						</span>
					)}
				</div>
				<div className="flex items-center justify-end gap-0.5">
					{canWrite ? (
						<button
							type="button"
							className="rounded-md p-1.5 text-[var(--muted-text)] hover:bg-[var(--surface)] hover:text-[var(--accent)] disabled:pointer-events-none disabled:opacity-30"
							onClick={(event) => {
								event.stopPropagation();
								onRun();
							}}
							disabled={Boolean(blocked)}
							title={blocked ?? `Run ${workflow.name}`}
							aria-label={`Run ${workflow.name}`}
						>
							<Play className="h-4 w-4" />
						</button>
					) : null}
					<RowMenu
						workflow={workflow}
						canWrite={canWrite}
						onSetEnabled={onSetEnabled}
					/>
				</div>
			</div>
			{expanded ? (
				<WorkflowHistory projectId={projectId} workflow={workflow} now={now} />
			) : null}
		</li>
	);
}

function RecentRuns({
	projectId,
	runs,
	now,
}: {
	projectId: Id<"projects">;
	runs: WorkflowRun[];
	now: number;
}) {
	if (!runs.length)
		return <span className="text-xs text-[var(--muted-text)]">—</span>;
	// Oldest on the left, like a timeline.
	const ordered = [...runs].slice(0, 10).reverse();
	return (
		<ul
			className="m-0 flex list-none items-center gap-[3px] p-0"
			aria-label="Recent runs"
		>
			{ordered.map((run) => {
				const state = runVisualState(run);
				return (
					<li key={run.id}>
						<Link
							to="/projects/$projectId/workflows/runs/$runId"
							params={{ projectId, runId: String(run.id) }}
							onClick={(event) => event.stopPropagation()}
							className={cn(
								"workflow-tile block h-4 w-2 rounded-[3px] hover:scale-y-125",
								RUN_STATE_FILL[state],
								state === "running" && "workflow-pulse",
							)}
							data-label={`#${run.runNumber} · ${RUN_STATE_LABELS[state]}\n${formatRelative(run.createdAt)} · ${formatDuration(runDuration(run, now))}`}
							aria-label={`Run ${run.runNumber}: ${RUN_STATE_LABELS[state]}`}
						/>
					</li>
				);
			})}
		</ul>
	);
}

function RowMenu({
	workflow,
	canWrite,
	onSetEnabled,
}: {
	workflow: WorkflowSummary;
	canWrite: boolean;
	onSetEnabled: (enabled: boolean) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const enabled = workflow.state === "active";
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: stops row toggling; the menu button handles the keyboard
		<div
			ref={ref}
			className="relative"
			onClick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				className="rounded-md p-1.5 text-[var(--muted-text)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
				aria-label={`More for ${workflow.name}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<MoreHorizontal className="h-4 w-4" />
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] py-1 text-sm shadow-lg"
				>
					{workflow.htmlUrl ? (
						<a
							role="menuitem"
							href={workflow.htmlUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-2 px-3 py-1.5 text-[var(--text)] no-underline hover:bg-[var(--surface-muted)]"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Open workflow file on GitHub
						</a>
					) : null}
					{canWrite && workflow.state !== "deleted" ? (
						<button
							type="button"
							role="menuitem"
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								setError(null);
								try {
									await onSetEnabled(!enabled);
									setOpen(false);
								} catch (caught) {
									setError(
										getClientErrorMessage(
											caught,
											"GitHub did not accept that.",
										),
									);
								} finally {
									setBusy(false);
								}
							}}
						>
							<Power className="h-3.5 w-3.5" />
							{busy
								? "Saving…"
								: enabled
									? "Disable workflow"
									: "Enable workflow"}
						</button>
					) : null}
					{error ? (
						<p className="m-0 px-3 py-1.5 text-xs text-[var(--danger)]">
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** Durations of the last 30 runs as bars, with simple stats. */
function WorkflowHistory({
	projectId,
	workflow,
	now,
}: {
	projectId: Id<"projects">;
	workflow: WorkflowSummary;
	now: number;
}) {
	const listRuns = useAction(api.githubWorkflows.listRuns);
	const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		listRuns({ projectId, page: 1, perPage: 30, workflowId: workflow.id })
			.then((result) => {
				if (!cancelled) setRuns(result.runs);
			})
			.catch((caught: unknown) => {
				if (!cancelled)
					setError(
						getClientErrorMessage(caught, "Could not load run history."),
					);
			});
		return () => {
			cancelled = true;
		};
	}, [listRuns, projectId, workflow.id]);

	const stats = useMemo(() => (runs ? workflowStats(runs) : null), [runs]);
	const ordered = useMemo(() => (runs ? [...runs].reverse() : []), [runs]);
	const maxDuration = Math.max(
		1,
		...ordered.map((run) => runDuration(run, now) ?? 0),
	);

	return (
		<div className="border-t border-dashed border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 pl-12">
			{error ? (
				<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
			) : !runs ? (
				<p className="m-0 text-xs text-[var(--muted-text)]">Loading history…</p>
			) : !runs.length ? (
				<p className="m-0 text-xs text-[var(--muted-text)]">
					This workflow has not run yet.
				</p>
			) : (
				<div className="space-y-3">
					<dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-xs">
						<Stat
							label="Passing"
							value={
								stats?.successRate === null || !stats
									? "—"
									: `${Math.round(stats.successRate * 100)}%`
							}
						/>
						<Stat label="Usual time" value={formatDuration(stats?.typicalMs)} />
						<Stat
							label="Last success"
							value={(() => {
								const success = runs.find(
									(run) => run.conclusion === "success",
								);
								return success ? formatRelative(success.updatedAt) : "—";
							})()}
						/>
						<Stat label="Runs shown" value={String(runs.length)} />
					</dl>
					<div
						className="flex h-20 items-end gap-[3px]"
						role="img"
						aria-label={`Durations of the last ${runs.length} runs`}
					>
						{ordered.map((run) => {
							const state = runVisualState(run);
							const duration = runDuration(run, now) ?? 0;
							return (
								<Link
									key={run.id}
									to="/projects/$projectId/workflows/runs/$runId"
									params={{ projectId, runId: String(run.id) }}
									className={cn(
										"workflow-tile block min-w-[6px] flex-1 rounded-t-[3px] opacity-85 hover:opacity-100",
										RUN_STATE_FILL[state],
									)}
									style={{
										height: `${Math.max((duration / maxDuration) * 100, 6)}%`,
									}}
									data-label={`#${run.runNumber} · ${RUN_STATE_LABELS[state]} · ${formatDuration(duration)}\n${formatRelative(run.createdAt)}${run.branch ? ` · ${run.branch}` : ""}`}
									aria-label={`Run ${run.runNumber}: ${RUN_STATE_LABELS[state]}, ${formatDuration(duration)}`}
								/>
							);
						})}
					</div>
					<div className="flex justify-between text-[10px] text-[var(--muted-text)]">
						<span>{formatRelative(ordered[0].createdAt)}</span>
						<span>
							{compactWorkflowName(workflow.name)} · newest on the right
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-[var(--muted-text)]">{label}</dt>
			<dd className="m-0 font-medium text-[var(--text)] tabular-nums">
				{value}
			</dd>
		</div>
	);
}
