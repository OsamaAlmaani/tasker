import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	ExternalLink,
	FolderPlus,
	KeyRound,
	Layers,
	ListChecks,
	Play,
	RefreshCw,
	Rows3,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type { FailureSummary } from "#convex/githubWorkflows";
import type { WorkflowRun } from "#convex/lib/githubWorkflowsApi";
import { useGitHubData } from "../../useGitHubData";
import {
	buildReleaseFeed,
	isActiveState,
	resolveSelection,
	runVisualState,
	type TaskerRelease,
	typicalDurations,
} from "../workflowDisplay";
import { type FeedActions, ReleaseFeed } from "./ReleaseFeed";
import { type PlannerRequest, RunPlannerDialog } from "./RunPlannerDialog";
import {
	DeleteGroupDialog,
	type GroupDraft,
	GroupEditorDialog,
	GroupsPanel,
} from "./WorkflowGroups";
import { Kbd, useNow } from "./WorkflowPrimitives";
import { canStart, type WorkflowGroup, WorkflowTable } from "./WorkflowTable";

export type WorkflowsView = "releases" | "workflows";

type FeedFilter = "all" | "releases" | "failed";

const POLL_MS = 8000;

export function WorkflowsWorkspace({
	projectId,
	repository,
	view,
	onViewChange,
	groupFilter,
	onGroupFilterChange,
	highlightReleaseId,
}: {
	projectId: Id<"projects">;
	repository: {
		fullName: string;
		htmlUrl: string;
		defaultBranch: string;
		liveVersion?: number;
	};
	view: WorkflowsView;
	onViewChange: (view: WorkflowsView) => void;
	groupFilter: string | null;
	onGroupFilterChange: (groupId: string | null) => void;
	highlightReleaseId: string | null;
}) {
	const getOverview = useAction(api.githubWorkflows.getOverview);
	const listRuns = useAction(api.githubWorkflows.listRuns);
	const getRunsById = useAction(api.githubWorkflows.getRunsById);
	const getFailureSummaries = useAction(
		api.githubWorkflows.getFailureSummaries,
	);
	const rerunRuns = useAction(api.githubWorkflows.rerunRuns);
	const cancelRuns = useAction(api.githubWorkflows.cancelRuns);
	const setWorkflowEnabled = useAction(api.githubWorkflows.setWorkflowEnabled);
	const addToGroup = useMutation(api.githubWorkflowGroups.addToGroup);
	const workspace = useQuery(api.githubWorkflowGroups.getWorkspace, {
		projectId,
	});

	const overview = useGitHubData(
		`workflows:${projectId}:${repository.fullName}`,
		() => getOverview({ projectId }),
		"Could not load workflows from GitHub.",
		repository.liveVersion,
	);

	// Runs from every source, newest data wins.
	const [extraRuns, setExtraRuns] = useState<Map<number, WorkflowRun>>(
		new Map(),
	);
	const [nextPage, setNextPage] = useState(3);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [olderError, setOlderError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [lastUpdated, setLastUpdated] = useState<number | null>(null);
	const [actionMessage, setActionMessage] = useState<{
		tone: "ok" | "error";
		text: string;
	} | null>(null);
	const requestedRunIds = useRef(new Set<number>());
	const [failures, setFailures] = useState<Map<number, FailureSummary>>(
		new Map(),
	);
	const requestedFailures = useRef(new Set<string>());

	const mergeRuns = useCallback((runs: WorkflowRun[]) => {
		if (!runs.length) return;
		setExtraRuns((current) => {
			const next = new Map(current);
			for (const run of runs) {
				const existing = next.get(run.id);
				if (
					!existing ||
					existing.updatedAt <= run.updatedAt ||
					existing.attempt < run.attempt
				)
					next.set(run.id, run);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (overview.data) setLastUpdated(Date.now());
	}, [overview.data]);

	const runs = useMemo(() => {
		const map = new Map<number, WorkflowRun>();
		for (const run of overview.data?.runs ?? []) map.set(run.id, run);
		for (const [id, run] of extraRuns) {
			const base = map.get(id);
			if (
				!base ||
				base.updatedAt <= run.updatedAt ||
				base.attempt < run.attempt
			)
				map.set(id, run);
		}
		return [...map.values()];
	}, [overview.data, extraRuns]);

	const workflows = overview.data?.workflows ?? [];
	const workflowsById = useMemo(
		() => new Map(workflows.map((workflow) => [workflow.id, workflow])),
		[workflows],
	);
	const groups: WorkflowGroup[] = workspace?.groups ?? [];
	const releases = (workspace?.releases ?? []) as TaskerRelease[];
	const canWrite = workspace?.canWrite ?? false;

	const runsByWorkflow = useMemo(() => {
		const map = new Map<number, WorkflowRun[]>();
		for (const run of runs)
			map.set(run.workflowId, [...(map.get(run.workflowId) ?? []), run]);
		for (const list of map.values())
			list.sort((a, b) => b.createdAt - a.createdAt);
		return map;
	}, [runs]);
	const lastRunByWorkflow = useMemo(() => {
		const map = new Map<number, WorkflowRun>();
		for (const [id, list] of runsByWorkflow) if (list[0]) map.set(id, list[0]);
		return map;
	}, [runsByWorkflow]);

	const feed = useMemo(
		() => buildReleaseFeed(runs, releases, workflows),
		[runs, releases, workflows],
	);
	const typical = useMemo(() => typicalDurations(runs), [runs]);

	const hasActive =
		runs.some((run) => isActiveState(runVisualState(run))) ||
		releases.some(
			(release) =>
				release.status === "starting" ||
				Date.now() - release.startedAt < 60_000,
		);
	const now = useNow(hasActive);

	const refreshRecent = useCallback(async () => {
		setRefreshing(true);
		try {
			const page = await listRuns({ projectId, page: 1, perPage: 100 });
			mergeRuns(page.runs);
			setLastUpdated(Date.now());
		} catch {
			// The next poll or a manual refresh tries again.
		} finally {
			setRefreshing(false);
		}
	}, [listRuns, projectId, mergeRuns]);

	// Poll while anything is running and the tab is visible.
	useEffect(() => {
		if (!hasActive || !overview.data) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refreshRecent();
		}, POLL_MS);
		return () => window.clearInterval(timer);
	}, [hasActive, overview.data, refreshRecent]);

	const loadRunsById = useCallback(
		(runIds: number[]) => {
			const wanted = runIds.filter((id) => !requestedRunIds.current.has(id));
			if (!wanted.length) return;
			for (const id of wanted) requestedRunIds.current.add(id);
			for (let index = 0; index < wanted.length; index += 100) {
				const chunk = wanted.slice(index, index + 100);
				getRunsById({ projectId, runIds: chunk })
					.then(mergeRuns)
					.catch(() => {
						for (const id of chunk) requestedRunIds.current.delete(id);
					});
			}
		},
		[getRunsById, projectId, mergeRuns],
	);

	const loadFailures = useCallback(
		(runIds: number[]) => {
			const byId = new Map(runs.map((run) => [run.id, run]));
			const wanted = runIds.filter((id) => {
				const key = `${id}:${byId.get(id)?.attempt ?? 1}`;
				return !requestedFailures.current.has(key);
			});
			if (!wanted.length) return;
			for (const id of wanted)
				requestedFailures.current.add(`${id}:${byId.get(id)?.attempt ?? 1}`);
			getFailureSummaries({ projectId, runIds: wanted.slice(0, 50) })
				.then((summaries) =>
					setFailures((current) => {
						const next = new Map(current);
						for (const summary of summaries) next.set(summary.runId, summary);
						return next;
					}),
				)
				.catch(() => {
					for (const id of wanted)
						requestedFailures.current.delete(
							`${id}:${byId.get(id)?.attempt ?? 1}`,
						);
				});
		},
		[getFailureSummaries, projectId, runs],
	);

	async function loadOlder() {
		setLoadingOlder(true);
		setOlderError(null);
		try {
			const page = await listRuns({ projectId, page: nextPage, perPage: 100 });
			mergeRuns(page.runs);
			setNextPage((value) => value + 1);
		} catch (error) {
			setOlderError(getClientErrorMessage(error, "Could not load older runs."));
		} finally {
			setLoadingOlder(false);
		}
	}

	// Selection: ticked groups plus individually ticked workflows.
	const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
		new Set(),
	);
	const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<number>>(
		new Set(),
	);
	const selected = useMemo(() => {
		const ids = resolveSelection(groups, selectedGroupIds, selectedWorkflowIds);
		// Only workflows that can start count.
		return new Set(
			[...ids].filter((id) => {
				const workflow = workflowsById.get(id);
				return workflow ? canStart(workflow) : false;
			}),
		);
	}, [groups, selectedGroupIds, selectedWorkflowIds, workflowsById]);

	function toggleWorkflow(workflowId: number, checked: boolean) {
		if (checked) {
			setSelectedWorkflowIds((current) => new Set(current).add(workflowId));
			return;
		}
		// Unticking a workflow that came from a group turns that group into
		// individual picks, minus this one.
		const fromGroups = groups.filter(
			(group) =>
				selectedGroupIds.has(group._id) &&
				group.workflows.some((workflow) => workflow.id === workflowId),
		);
		setSelectedWorkflowIds((current) => {
			const next = new Set(current);
			for (const group of fromGroups)
				for (const workflow of group.workflows) next.add(workflow.id);
			next.delete(workflowId);
			return next;
		});
		if (fromGroups.length) {
			setSelectedGroupIds((current) => {
				const next = new Set(current);
				for (const group of fromGroups) next.delete(group._id);
				return next;
			});
		}
	}

	function toggleMany(workflowIds: number[], checked: boolean) {
		if (checked) {
			setSelectedWorkflowIds((current) => {
				const next = new Set(current);
				for (const id of workflowIds) next.add(id);
				return next;
			});
			return;
		}
		const remove = new Set(workflowIds);
		const fromGroups = groups.filter(
			(group) =>
				selectedGroupIds.has(group._id) &&
				group.workflows.some((workflow) => remove.has(workflow.id)),
		);
		setSelectedWorkflowIds((current) => {
			const next = new Set(current);
			for (const group of fromGroups)
				for (const workflow of group.workflows) next.add(workflow.id);
			for (const id of remove) next.delete(id);
			return next;
		});
		setSelectedGroupIds((current) => {
			const next = new Set(current);
			for (const group of fromGroups) next.delete(group._id);
			return next;
		});
	}

	function toggleGroup(group: WorkflowGroup, checked: boolean) {
		if (checked) {
			setSelectedGroupIds((current) => new Set(current).add(group._id));
			return;
		}
		const ids = new Set(group.workflows.map((workflow) => workflow.id));
		setSelectedGroupIds((current) => {
			const next = new Set(current);
			next.delete(group._id);
			return next;
		});
		// Workflows still covered by another ticked group stay selected.
		setSelectedWorkflowIds(
			(current) => new Set([...current].filter((id) => !ids.has(id))),
		);
	}

	function clearSelection() {
		setSelectedGroupIds(new Set());
		setSelectedWorkflowIds(new Set());
	}

	const selectionName = useMemo(() => {
		const tickedGroups = groups.filter((group) =>
			selectedGroupIds.has(group._id),
		);
		const covered = new Set(
			tickedGroups.flatMap((group) =>
				group.workflows.map((workflow) => workflow.id),
			),
		);
		const extras = [...selected].filter((id) => !covered.has(id)).length;
		if (!tickedGroups.length) return "Custom run";
		const names = tickedGroups.map((group) => group.name).join(" + ");
		return extras ? `${names} + ${extras} more` : names;
	}, [groups, selectedGroupIds, selected]);

	// Dialogs
	const [plannerRequest, setPlannerRequest] = useState<PlannerRequest | null>(
		null,
	);
	const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
	const [deleting, setDeleting] = useState<WorkflowGroup | null>(null);
	const [highlightKey, setHighlightKey] = useState<string | null>(
		highlightReleaseId ? `release:${highlightReleaseId}` : null,
	);

	useEffect(() => {
		if (highlightReleaseId) setHighlightKey(`release:${highlightReleaseId}`);
	}, [highlightReleaseId]);

	function openPlanner(
		workflowIds: number[],
		name: string,
		groupIds: string[],
	) {
		const startable = workflowIds.filter((id) => {
			const workflow = workflowsById.get(id);
			return workflow ? canStart(workflow) : true;
		});
		if (!startable.length) return;
		setPlannerRequest({ workflowIds: startable, name, groupIds });
	}

	const feedActions: FeedActions = {
		canWrite,
		failures,
		loadFailures,
		onLoadRuns: loadRunsById,
		onRerun: async (runIds, failedOnly) => {
			try {
				const results = await rerunRuns({ projectId, runIds, failedOnly });
				const failed = results.filter((result) => !result.ok);
				setActionMessage(
					failed.length
						? {
								tone: "error",
								text: `${failed.length} could not be re-run: ${failed[0].error}`,
							}
						: {
								tone: "ok",
								text: `Re-running ${results.length} ${results.length === 1 ? "run" : "runs"}.`,
							},
				);
			} catch (error) {
				setActionMessage({
					tone: "error",
					text: getClientErrorMessage(error, "GitHub rejected the re-run."),
				});
			}
			window.setTimeout(() => void refreshRecent(), 1500);
		},
		onCancel: async (runIds) => {
			try {
				const results = await cancelRuns({ projectId, runIds });
				const failed = results.filter((result) => !result.ok);
				setActionMessage(
					failed.length
						? {
								tone: "error",
								text: `${failed.length} could not be cancelled: ${failed[0].error}`,
							}
						: {
								tone: "ok",
								text: `Cancelling ${results.length} ${results.length === 1 ? "run" : "runs"}.`,
							},
				);
			} catch (error) {
				setActionMessage({
					tone: "error",
					text: getClientErrorMessage(error, "GitHub rejected the cancel."),
				});
			}
			window.setTimeout(() => void refreshRecent(), 1500);
		},
		onRunAgain: (workflowIds, name, groupIds) =>
			openPlanner(workflowIds, name, groupIds),
	};

	const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
	const filteredFeed = useMemo(() => {
		if (feedFilter === "all") return feed;
		if (feedFilter === "releases")
			return feed.filter((item) => item.kind === "release");
		return feed.filter((item) =>
			item.kind === "release"
				? item.runs.some((run) => runVisualState(run) === "failure") ||
					item.missing.some((entry) => entry.error)
				: runVisualState(item.run) === "failure",
		);
	}, [feed, feedFilter]);

	if (overview.error && !overview.data) {
		const tokenBlocked =
			/not accessible by personal access token|denied the request/i.test(
				overview.error,
			);
		return (
			<Card>
				<CardContent className="space-y-3 p-5">
					<div className="flex items-start gap-3">
						<KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted-text)]" />
						<div className="space-y-1">
							<p className="m-0 font-medium">
								{tokenBlocked
									? "Your GitHub token cannot read Actions yet"
									: "Could not load workflows"}
							</p>
							<p className="m-0 text-sm text-[var(--muted-text)]">
								{tokenBlocked ? (
									<>
										Edit your fine-grained token on GitHub and set{" "}
										<strong className="text-[var(--text)]">Actions</strong> to{" "}
										<strong className="text-[var(--text)]">
											Read and write
										</strong>{" "}
										(read only is enough to view runs). Saving the change keeps
										the same token, so there is nothing to paste into Tasker.
									</>
								) : (
									overview.error
								)}
							</p>
							{tokenBlocked ? (
								<p className="m-0 text-xs text-[var(--muted-text)]">
									GitHub said: {overview.error}
								</p>
							) : null}
						</div>
					</div>
					<div className="flex flex-wrap gap-2 pl-8">
						{tokenBlocked ? (
							<a
								href="https://github.com/settings/personal-access-tokens"
								target="_blank"
								rel="noreferrer"
								className="no-underline"
							>
								<Button size="sm">
									<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
									Open your GitHub tokens
								</Button>
							</a>
						) : null}
						<Button
							size="sm"
							variant="secondary"
							onClick={() => void overview.refetch()}
							disabled={overview.isLoading}
						>
							<RefreshCw
								className={cn(
									"mr-1.5 h-3.5 w-3.5",
									overview.isLoading && "animate-spin",
								)}
							/>
							Try again
						</Button>
						<Link
							to="/projects/$projectId/github"
							params={{ projectId }}
							className="no-underline"
						>
							<Button size="sm" variant="ghost">
								GitHub settings
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!overview.data) {
		return <WorkspaceSkeleton />;
	}

	const selectionCount = selected.size;

	return (
		<div className="workflow-surface space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div
					className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-0.5"
					role="tablist"
					aria-label="Workflows view"
				>
					{(
						[
							{ value: "releases", label: "Releases", icon: ListChecks },
							{ value: "workflows", label: "Workflows", icon: Rows3 },
						] as const
					).map((option) => (
						<button
							key={option.value}
							type="button"
							role="tab"
							aria-selected={view === option.value}
							className={cn(
								"inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors",
								view === option.value
									? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm"
									: "text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
							onClick={() => onViewChange(option.value)}
						>
							<option.icon className="h-3.5 w-3.5" />
							{option.label}
							{option.value === "workflows" ? (
								<span className="text-xs tabular-nums opacity-60">
									{workflows.length}
								</span>
							) : null}
						</button>
					))}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<span className="hidden items-center gap-1.5 text-xs text-[var(--muted-text)] sm:inline-flex">
						{hasActive ? (
							<>
								<span className="workflow-pulse h-2 w-2 rounded-full bg-amber-500" />
								Live
							</>
						) : lastUpdated ? (
							<>
								Updated{" "}
								{new Date(lastUpdated).toLocaleTimeString([], {
									hour: "2-digit",
									minute: "2-digit",
								})}
							</>
						) : null}
					</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							void overview.refetch();
							void refreshRecent();
						}}
						disabled={overview.isLoading || refreshing}
						aria-label="Refresh"
						title="Refresh"
					>
						<RefreshCw
							className={cn(
								"h-4 w-4",
								(overview.isLoading || refreshing) && "animate-spin",
							)}
						/>
					</Button>
					<a
						href={`${repository.htmlUrl}/actions`}
						target="_blank"
						rel="noreferrer"
						className="no-underline"
					>
						<Button variant="ghost" size="sm">
							<ExternalLink className="mr-1.5 h-4 w-4" />
							GitHub
						</Button>
					</a>
				</div>
			</div>

			{actionMessage ? (
				<div
					className={cn(
						"flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
						actionMessage.tone === "ok"
							? "border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200"
							: "border-[color-mix(in_oklab,var(--danger)_45%,var(--line))] text-[var(--danger)]",
					)}
					role="status"
				>
					{actionMessage.text}
					<button
						type="button"
						onClick={() => setActionMessage(null)}
						aria-label="Dismiss"
						className="rounded p-0.5 opacity-70 hover:opacity-100"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			) : null}
			{overview.error ? (
				<p className="m-0 text-sm text-[var(--danger)]" role="alert">
					{overview.error}
				</p>
			) : null}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="min-w-0 space-y-3">
					{view === "releases" ? (
						<>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div
									className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-0.5"
									role="tablist"
									aria-label="Show"
								>
									{(
										[
											{ value: "all", label: "Everything" },
											{ value: "releases", label: "Releases only" },
											{ value: "failed", label: "Failed" },
										] as const
									).map((option) => (
										<button
											key={option.value}
											type="button"
											role="tab"
											aria-selected={feedFilter === option.value}
											className={cn(
												"rounded px-2.5 py-1 text-xs transition-colors",
												feedFilter === option.value
													? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm"
													: "text-[var(--muted-text)] hover:text-[var(--text)]",
											)}
											onClick={() => setFeedFilter(option.value)}
										>
											{option.label}
										</button>
									))}
								</div>
								{canWrite ? (
									<Button
										size="sm"
										onClick={() => onViewChange("workflows")}
										variant="secondary"
									>
										<Play className="mr-1.5 h-3.5 w-3.5" />
										Pick workflows to run
									</Button>
								) : null}
							</div>
							{filteredFeed.length ? (
								<ReleaseFeed
									projectId={projectId}
									items={filteredFeed}
									now={now}
									typical={typical}
									actions={feedActions}
									highlightKey={highlightKey}
									repositoryUrl={repository.htmlUrl}
								/>
							) : (
								<div className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted-text)]">
									{feedFilter === "failed"
										? "Nothing failed in the loaded runs."
										: "No runs yet."}
								</div>
							)}
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-text)]">
								<span>
									{runs.length} of {overview.data.totalRuns.toLocaleString()}{" "}
									runs loaded
								</span>
								{runs.length < overview.data.totalRuns ? (
									<Button
										size="sm"
										variant="secondary"
										onClick={() => void loadOlder()}
										disabled={loadingOlder}
									>
										{loadingOlder ? "Loading…" : "Load older runs"}
									</Button>
								) : null}
							</div>
							{olderError ? (
								<p className="m-0 text-sm text-[var(--danger)]">{olderError}</p>
							) : null}
						</>
					) : (
						<WorkflowTable
							projectId={projectId}
							workflows={workflows}
							runsByWorkflow={runsByWorkflow}
							groups={groups}
							selected={selected}
							onToggle={toggleWorkflow}
							onToggleMany={toggleMany}
							groupFilter={groupFilter}
							onGroupFilterChange={onGroupFilterChange}
							canWrite={canWrite}
							onRunOne={(id) =>
								openPlanner([id], workflowsById.get(id)?.name ?? "Run", [])
							}
							onSetEnabled={async (id, enabled) => {
								await setWorkflowEnabled({
									projectId,
									workflowId: id,
									enabled,
								});
								await overview.refetch();
							}}
							now={now}
						/>
					)}
				</div>
				<aside className="space-y-3 lg:sticky lg:top-4 lg:h-fit">
					<GroupsPanel
						groups={groups}
						workflowsById={workflowsById}
						lastRunByWorkflow={lastRunByWorkflow}
						selected={selected}
						selectedGroupIds={selectedGroupIds}
						onToggleGroup={toggleGroup}
						onRunGroup={(group) =>
							openPlanner(
								group.workflows.map((workflow) => workflow.id),
								group.name,
								[group._id],
							)
						}
						onShowGroup={(groupId) => {
							onGroupFilterChange(groupId);
							onViewChange("workflows");
						}}
						onEdit={(group) =>
							setGroupDraft({
								groupId: group._id,
								name: group.name,
								workflowIds: group.workflows.map((workflow) => workflow.id),
							})
						}
						onNew={() =>
							setGroupDraft({
								groupId: null,
								name: "",
								workflowIds: [...selected],
							})
						}
						onDelete={setDeleting}
						canWrite={canWrite}
						activeGroupFilter={view === "workflows" ? groupFilter : null}
					/>
					{!canWrite ? (
						<p className="m-0 px-1 text-xs text-[var(--muted-text)]">
							You can view runs. Starting and editing groups needs write access
							to this project.
						</p>
					) : null}
				</aside>
			</div>

			{selectionCount && canWrite ? (
				<SelectionBar
					count={selectionCount}
					name={selectionName}
					groups={groups}
					onClear={clearSelection}
					onSaveAsGroup={() =>
						setGroupDraft({
							groupId: null,
							name: "",
							workflowIds: [...selected],
						})
					}
					onAddToGroup={async (groupId) => {
						try {
							const added = await addToGroup({
								projectId,
								groupId: groupId as Id<"githubWorkflowGroups">,
								workflows: [...selected].map((id) => ({
									id,
									path: workflowsById.get(id)?.path ?? "",
								})),
							});
							const group = groups.find(
								(candidate) => candidate._id === groupId,
							);
							setActionMessage({
								tone: "ok",
								text: added
									? `Added ${added} ${added === 1 ? "workflow" : "workflows"} to ${group?.name ?? "the group"}.`
									: `${group?.name ?? "The group"} already had all of them.`,
							});
						} catch (error) {
							setActionMessage({
								tone: "error",
								text: getClientErrorMessage(
									error,
									"Could not update the group.",
								),
							});
						}
					}}
					onRun={() =>
						openPlanner(
							[...selected],
							selectionName,
							groups
								.filter((group) => selectedGroupIds.has(group._id))
								.map((group) => group._id),
						)
					}
				/>
			) : null}

			<RunPlannerDialog
				projectId={projectId}
				request={plannerRequest}
				defaultBranch={overview.data.defaultBranch}
				repositoryUrl={repository.htmlUrl}
				onClose={() => setPlannerRequest(null)}
				onStarted={({ releaseId, runIds }) => {
					setPlannerRequest(null);
					clearSelection();
					onViewChange("releases");
					setFeedFilter("all");
					setHighlightKey(`release:${releaseId}`);
					loadRunsById(runIds);
					window.setTimeout(() => void refreshRecent(), 3000);
				}}
			/>
			<GroupEditorDialog
				projectId={projectId}
				draft={groupDraft}
				workflows={workflows}
				onClose={() => setGroupDraft(null)}
				onSaved={(groupId) => {
					const isNew = groupDraft?.groupId === null;
					setGroupDraft(null);
					if (isNew && selected.size) {
						// The new group replaces the loose selection it was made from.
						setSelectedWorkflowIds(new Set());
						setSelectedGroupIds(new Set([groupId]));
					}
				}}
			/>
			<DeleteGroupDialog
				projectId={projectId}
				group={deleting}
				onClose={() => setDeleting(null)}
			/>
		</div>
	);
}

function SelectionBar({
	count,
	name,
	groups,
	onClear,
	onSaveAsGroup,
	onAddToGroup,
	onRun,
}: {
	count: number;
	name: string;
	groups: WorkflowGroup[];
	onClear: () => void;
	onSaveAsGroup: () => void;
	onAddToGroup: (groupId: string) => Promise<void>;
	onRun: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!menuOpen) return;
		const onPointer = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [menuOpen]);

	// R reviews the selection when nothing else has focus.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					"input:not([type=checkbox]), textarea, select, [contenteditable]",
				)
			)
				return;
			if (document.querySelector('[role="dialog"]')) return;
			if (event.key === "Escape") onClear();
			if (
				event.key.toLowerCase() === "r" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault();
				onRun();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClear, onRun]);

	return (
		<div className="pointer-events-none sticky bottom-4 z-30 flex justify-center px-2">
			<section
				className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2 pr-2 pl-4 shadow-[0_18px_50px_rgba(8,12,26,0.25)]"
				aria-label="Selected workflows"
			>
				<span className="text-sm">
					<span className="font-semibold tabular-nums">{count}</span>{" "}
					<span className="text-[var(--muted-text)]">selected</span>
					<span className="hidden text-[var(--muted-text)] sm:inline">
						{" "}
						· {name}
					</span>
				</span>
				<Button
					size="sm"
					variant="ghost"
					onClick={onClear}
					aria-label="Clear selection"
				>
					<X className="h-3.5 w-3.5" />
				</Button>
				<div ref={menuRef} className="relative">
					<Button
						size="sm"
						variant="secondary"
						onClick={() => setMenuOpen((value) => !value)}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
					>
						<Layers className="mr-1.5 h-3.5 w-3.5" />
						Group
					</Button>
					{menuOpen ? (
						<div
							role="menu"
							className="absolute bottom-full left-0 z-40 mb-2 w-60 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] py-1 shadow-lg"
						>
							<button
								type="button"
								role="menuitem"
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-muted)]"
								onClick={() => {
									setMenuOpen(false);
									onSaveAsGroup();
								}}
							>
								<FolderPlus className="h-3.5 w-3.5" />
								Save as a new group
							</button>
							{groups.length ? (
								<p className="m-0 border-t border-[var(--line)] px-3 pt-2 pb-1 text-[11px] text-[var(--muted-text)]">
									Add to an existing group
								</p>
							) : null}
							<div className="max-h-56 overflow-y-auto">
								{groups.map((group) => (
									<button
										key={group._id}
										type="button"
										role="menuitem"
										className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-muted)]"
										onClick={() => {
											setMenuOpen(false);
											void onAddToGroup(group._id);
										}}
									>
										<span className="truncate">{group.name}</span>
										<span className="text-xs text-[var(--muted-text)]">
											{group.workflows.length}
										</span>
									</button>
								))}
							</div>
						</div>
					) : null}
				</div>
				<Button size="sm" onClick={onRun}>
					<Play className="mr-1.5 h-3.5 w-3.5" />
					Review and run
					<span className="ml-2 hidden sm:inline-flex">
						<Kbd>R</Kbd>
					</span>
				</Button>
			</section>
		</div>
	);
}

const SKELETON_TILES = Array.from(
	{ length: 30 },
	(_, index) => `tile-${index}`,
);

function WorkspaceSkeleton() {
	return (
		<div
			className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
			aria-busy="true"
		>
			<span className="sr-only">Loading workflows</span>
			<div className="space-y-3">
				{[0, 1, 2].map((index) => (
					<div
						key={index}
						className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
					>
						<div className="workflow-pulse h-4 w-1/3 rounded bg-[var(--surface-muted)]" />
						<div className="workflow-pulse h-1.5 w-full rounded-full bg-[var(--surface-muted)]" />
						<div className="flex flex-wrap gap-1">
							{SKELETON_TILES.map((tile) => (
								<span
									key={tile}
									className="workflow-pulse h-4 w-4 rounded-[4px] bg-[var(--surface-muted)]"
								/>
							))}
						</div>
					</div>
				))}
			</div>
			<div className="workflow-pulse h-40 rounded-xl border border-[var(--line)] bg-[var(--surface)]" />
		</div>
	);
}
