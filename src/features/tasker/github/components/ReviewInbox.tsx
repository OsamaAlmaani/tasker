import { useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCheck, Keyboard, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	applyOverrides,
	badgeCounts,
	buildInbox,
	DEFAULT_FILTERS,
	type InboxEntry,
	type InboxFilters,
	type InboxState,
	type InboxView,
	moveSelection,
	reviewRequestsFor,
	shortcutFor,
	type ThreadOverride,
} from "../reviewInbox";
import { useGitHubData } from "../useGitHubData";
import { useMediaQuery } from "../useMediaQuery";
import { SnippetEditor } from "./ReplySnippets";
import { ReviewInboxDetail } from "./ReviewInboxDetail";
import {
	BulkReplyDialog,
	BulkTrackDialog,
	ShortcutsDialog,
	TrackOneDialog,
} from "./ReviewInboxDialogs";
import { ReviewInboxList, ReviewRequestsList } from "./ReviewInboxList";
import type { ReviewTask, ReviewTaskKind } from "./ReviewTasks";

type Dialog =
	| { type: "track"; threadId: string; kind: ReviewTaskKind }
	| { type: "bulkTrack"; kind: ReviewTaskKind }
	| { type: "bulkReply" }
	| { type: "snippets" }
	| { type: "help" }
	| null;

type Notice = { message: string; failed: boolean } | null;

const VIEW_KEY = "tasker:review-inbox-view";
const FILTERS_KEY = "tasker:review-inbox-filters";

const VIEWS: Array<{ value: InboxView; label: string }> = [
	{ value: "gave", label: "Feedback I gave" },
	{ value: "received", label: "Feedback I received" },
	{ value: "everyone", label: "Everyone" },
	{ value: "requests", label: "Review requests" },
];

const STATES: Array<{ value: InboxState; label: string; empty: string }> = [
	{
		value: "attention",
		label: "Needs attention",
		empty: "Nothing needs you right now.",
	},
	{
		value: "waiting",
		label: "Waiting",
		empty: "Nothing is waiting on others.",
	},
	{
		value: "resolved",
		label: "Resolved",
		empty: "No resolved conversations on the open pull requests.",
	},
];

function readStorage<T>(key: string, parse: (value: unknown) => T | null) {
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? parse(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: unknown) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

function isEditable(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
	);
}

/**
 * The Reviews inbox: review conversations across open pull requests, sorted
 * by whose turn they are, with a detail pane to read and answer them and bulk
 * actions to track, resolve or reply to many at once.
 */
export function ReviewInbox({
	projectId,
	repository,
	canWrite,
	liveVersion,
}: {
	projectId: Id<"projects">;
	repository: string;
	canWrite: boolean;
	liveVersion?: number;
}) {
	const navigate = useNavigate();
	const loadInbox = useAction(api.githubReviewInboxActions.getReviewInbox);
	const resolveMany = useAction(
		api.githubReviewInboxActions.setThreadsResolved,
	);
	const recordCounts = useMutation(api.githubReviewInbox.recordInboxCounts);
	const markAllSeen = useMutation(api.githubReviewInbox.markAllSeen);
	const inboxState = useQuery(api.githubReviewInbox.getInboxState, {
		projectId,
	});
	const tracked = useQuery(api.githubReviewTasks.listTrackedThreads, {
		projectId,
	});
	const live = useGitHubData(
		`review-inbox:${projectId}:${repository}`,
		() => loadInbox({ projectId }),
		"Could not load review conversations from GitHub.",
		liveVersion,
	);

	const [view, setViewState] = useState<InboxView>("gave");
	const [stateTab, setStateTab] = useState<InboxState>("attention");
	const [filters, setFiltersState] = useState<InboxFilters>(DEFAULT_FILTERS);
	const [currentId, setCurrentId] = useState<string | null>(null);
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [overrides, setOverrides] = useState<Map<string, ThreadOverride>>(
		new Map(),
	);
	const [localSeen, setLocalSeen] = useState<Map<string, number>>(new Map());
	const [dialog, setDialog] = useState<Dialog>(null);
	const [notice, setNotice] = useState<Notice>(null);
	const [busy, setBusy] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const wide = useMediaQuery("(min-width: 1024px)");
	const replyRef = useRef<HTMLTextAreaElement>(null);
	const actionsRef = useRef<{ toggleResolved: () => void } | null>(null);

	// Remembered choices.
	useEffect(() => {
		const storedView = readStorage(VIEW_KEY, (value) =>
			VIEWS.some((option) => option.value === value)
				? (value as InboxView)
				: null,
		);
		if (storedView) setViewState(storedView);
		const storedFilters = readStorage(FILTERS_KEY, (value) =>
			value && typeof value === "object"
				? (value as Partial<InboxFilters>)
				: null,
		);
		if (storedFilters) {
			setFiltersState((current) => ({
				...current,
				hideBots: storedFilters.hideBots === true,
			}));
		}
	}, []);
	const setView = (next: InboxView) => {
		setViewState(next);
		setChecked(new Set());
		writeStorage(VIEW_KEY, next);
	};
	const setFilters = (next: InboxFilters) => {
		setFiltersState(next);
		writeStorage(FILTERS_KEY, { hideBots: next.hideBots });
	};

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	// A fresh load replaces changes made on the page.
	useEffect(() => {
		if (live.data) setOverrides(new Map());
	}, [live.data]);

	const viewer = live.data?.viewerLogin ?? "";
	const pullRequests = useMemo(
		() => applyOverrides(live.data?.pullRequests ?? [], overrides),
		[live.data, overrides],
	);
	const seen = useMemo(() => {
		const map = new Map<string, number>();
		for (const item of inboxState?.seen ?? [])
			map.set(item.threadId, item.seenAt);
		for (const [threadId, at] of localSeen)
			map.set(threadId, Math.max(at, map.get(threadId) ?? 0));
		return map;
	}, [inboxState, localSeen]);
	const tasksByThread = useMemo(
		() =>
			new Map(
				(tracked ?? []).map((task) => [task.threadId, task as ReviewTask]),
			),
		[tracked],
	);
	const tasksByPull = useMemo(() => {
		const map = new Map<number, ReviewTask[]>();
		for (const task of tracked ?? [])
			map.set(task.pullNumber, [...(map.get(task.pullNumber) ?? []), task]);
		return map;
	}, [tracked]);

	const inbox = useMemo(
		() =>
			view === "requests" || !viewer
				? null
				: buildInbox({
						pullRequests,
						viewer,
						view,
						filters,
						isTracked: (threadId) => tasksByThread.has(threadId),
						seen,
						baseline: inboxState?.seenBaselineAt ?? null,
						now,
					}),
		[pullRequests, viewer, view, filters, tasksByThread, seen, inboxState, now],
	);
	const requests = useMemo(
		() => (viewer ? reviewRequestsFor(pullRequests, viewer) : []),
		[pullRequests, viewer],
	);
	const groups = inbox?.groups[stateTab] ?? [];
	const orderedIds = useMemo(
		() =>
			groups.flatMap((group) => group.entries.map((entry) => entry.thread.id)),
		[groups],
	);
	const entriesById = useMemo(() => {
		const map = new Map<string, InboxEntry>();
		for (const group of Object.values(inbox?.groups ?? {}))
			for (const entry of group.flatMap((item) => item.entries))
				map.set(entry.thread.id, entry);
		return map;
	}, [inbox]);
	const current = currentId ? (entriesById.get(currentId) ?? null) : null;
	const currentInTab = current && orderedIds.includes(current.thread.id);
	const checkedThreads = useMemo(
		() =>
			pullRequests
				.flatMap((pr) => pr.threads)
				.filter((thread) => checked.has(thread.id)),
		[pullRequests, checked],
	);

	// On wide screens something is always open; the list decides what.
	useEffect(() => {
		if (!wide || view === "requests") return;
		if (!currentInTab && orderedIds.length) setCurrentId(orderedIds[0]);
	}, [wide, view, currentInTab, orderedIds]);

	// Keep the tab badge in step with what this page computed.
	useEffect(() => {
		if (!viewer || !live.data) return;
		const counts = badgeCounts(pullRequests, viewer);
		void recordCounts({
			projectId,
			attentionCount: counts.attention,
			reviewRequestCount: counts.reviewRequests,
		}).catch(() => {});
	}, [pullRequests, viewer, live.data, projectId, recordCounts]);

	const override = useCallback((threadId: string, patch: ThreadOverride) => {
		setOverrides((previous) => {
			const next = new Map(previous);
			next.set(threadId, { ...next.get(threadId), ...patch });
			return next;
		});
	}, []);
	const onSeen = useCallback((threadId: string) => {
		setLocalSeen((previous) => new Map(previous).set(threadId, Date.now()));
	}, []);

	function select(threadId: string | null) {
		setCurrentId(threadId);
		if (threadId) {
			window.requestAnimationFrame(() =>
				document
					.getElementById(`inbox-${threadId}`)
					?.scrollIntoView({ block: "nearest" }),
			);
		}
	}

	function toggleChecked(threadId: string) {
		setChecked((previous) => {
			const next = new Set(previous);
			if (next.has(threadId)) next.delete(threadId);
			else next.add(threadId);
			return next;
		});
	}

	async function resolveChecked() {
		setBusy(true);
		setNotice(null);
		try {
			const ids = checkedThreads
				.filter((thread) => !thread.isResolved)
				.map((thread) => thread.id);
			if (!ids.length) {
				setNotice({
					message: "Every selected conversation is already resolved.",
					failed: false,
				});
				return;
			}
			const result = await resolveMany({
				projectId,
				threadIds: ids,
				resolved: true,
			});
			const failed = new Set(result.failed.map((item) => item.threadId));
			for (const id of ids)
				if (!failed.has(id)) override(id, { isResolved: true });
			setChecked(new Set());
			setNotice({
				message: result.failed.length
					? `Resolved ${result.done}; ${result.failed.length} failed: ${result.failed[0].message}`
					: `Resolved ${result.done} conversation${result.done === 1 ? "" : "s"}.`,
				failed: result.failed.length > 0,
			});
		} catch (caught) {
			setNotice({
				message: getClientErrorMessage(
					caught,
					"Could not resolve the conversations.",
				),
				failed: true,
			});
		} finally {
			setBusy(false);
		}
	}

	// Keyboard shortcuts.
	const tasksByThreadRef = useRef(tasksByThread);
	tasksByThreadRef.current = tasksByThread;
	const keyState = useRef({
		orderedIds,
		currentId,
		current,
		canWrite,
		dialog,
		view,
	});
	keyState.current = { orderedIds, currentId, current, canWrite, dialog, view };
	// biome-ignore lint/correctness/useExhaustiveDependencies: live state is read through refs; the handlers only call stable setters
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const state = keyState.current;
			if (state.dialog || state.view === "requests") return;
			const action = shortcutFor({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				targetIsEditable: isEditable(event.target),
			});
			if (!action) return;
			const entry = state.current;
			switch (action) {
				case "next":
				case "previous":
					select(
						moveSelection(
							state.orderedIds,
							state.currentId,
							action === "next" ? 1 : -1,
						),
					);
					break;
				case "toggleSelect":
					if (!entry || !state.canWrite) return;
					toggleChecked(entry.thread.id);
					break;
				case "trackFix":
				case "trackFollowUp":
					if (
						!entry ||
						!state.canWrite ||
						tasksByThreadRef.current.has(entry.thread.id)
					)
						return;
					setDialog({
						type: "track",
						threadId: entry.thread.id,
						kind: action === "trackFix" ? "fix" : "follow_up",
					});
					break;
				case "reply":
					if (!replyRef.current) return;
					replyRef.current.focus();
					break;
				case "toggleResolved":
					if (!actionsRef.current) return;
					actionsRef.current.toggleResolved();
					break;
				case "open":
					if (!entry) return;
					void navigate({
						to: "/projects/$projectId/pulls/$pullNumber",
						params: { projectId, pullNumber: String(entry.pullRequest.number) },
						search: { thread: entry.thread.id },
					});
					break;
				case "help":
					setDialog({ type: "help" });
					break;
				case "clear":
					setChecked(new Set());
					break;
			}
			event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate, projectId]);

	const renderDetail = (entry: InboxEntry) => (
		<ReviewInboxDetail
			key={entry.thread.id}
			projectId={projectId}
			repository={repository}
			entry={entry}
			task={tasksByThread.get(entry.thread.id) ?? null}
			canWrite={canWrite}
			snippets={inboxState?.snippets ?? []}
			replyRef={replyRef}
			actionsRef={actionsRef}
			now={now}
			onTrack={(kind) =>
				setDialog({ type: "track", threadId: entry.thread.id, kind })
			}
			onEditSnippets={() => setDialog({ type: "snippets" })}
			onResolvedChange={(resolved) =>
				override(entry.thread.id, { isResolved: resolved })
			}
			onReplied={() =>
				override(entry.thread.id, {
					lastCommentAt: Date.now(),
					lastCommentBy: viewer,
					replyCount: entry.thread.replyCount + 1,
				})
			}
			onSeen={onSeen}
		/>
	);

	const trackDialogEntry =
		dialog?.type === "track"
			? (entriesById.get(dialog.threadId) ?? null)
			: null;
	const reviewers = inbox?.reviewers ?? [];
	const authors = inbox?.authors ?? [];
	const filtersActive =
		filters.search ||
		filters.reviewer ||
		filters.author ||
		filters.untrackedOnly ||
		filters.outdatedOnly ||
		filters.unseenOnly;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<fieldset className="m-0 inline-flex flex-wrap rounded-md border border-[var(--line)] p-0.5">
					<legend className="sr-only">Whose conversations</legend>
					{VIEWS.map((option) => (
						<button
							key={option.value}
							type="button"
							aria-pressed={view === option.value}
							onClick={() => setView(option.value)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm",
								view === option.value
									? "bg-[var(--surface-muted)] font-medium text-[var(--text)]"
									: "text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
						>
							{option.label}
							{option.value === "requests" && requests.length ? (
								<span className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold text-white tabular-nums">
									{requests.length}
								</span>
							) : null}
						</button>
					))}
				</fieldset>
				<div className="flex items-center gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						title="Mark everything as seen"
						onClick={() => {
							setLocalSeen(new Map());
							void markAllSeen({ projectId }).catch(() => {});
						}}
					>
						<CheckCheck className="mr-1.5 h-4 w-4" />
						Mark all seen
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-label="Keyboard shortcuts"
						title="Keyboard shortcuts (?)"
						onClick={() => setDialog({ type: "help" })}
					>
						<Keyboard className="h-4 w-4" />
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void live.refetch()}
						disabled={live.isLoading}
						aria-label="Refresh"
						title="Refresh"
					>
						<RefreshCw
							className={cn("h-4 w-4", live.isLoading && "animate-spin")}
						/>
					</Button>
				</div>
			</div>

			{view !== "requests" ? (
				<>
					<div
						role="tablist"
						aria-label="Conversation state"
						className="flex flex-wrap gap-5 border-b border-[var(--line)]"
					>
						{STATES.map((option) => (
							<button
								key={option.value}
								type="button"
								role="tab"
								aria-selected={stateTab === option.value}
								onClick={() => setStateTab(option.value)}
								className={cn(
									"-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium",
									stateTab === option.value
										? "border-[var(--accent)] text-[var(--text)]"
										: "border-transparent text-[var(--muted-text)] hover:text-[var(--text)]",
								)}
							>
								{option.label}
								{inbox ? (
									<span
										className={cn(
											"rounded-full px-1.5 text-[11px] tabular-nums",
											option.value === "attention" && inbox.counts.attention
												? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
												: "bg-[var(--surface-muted)] text-[var(--muted-text)]",
										)}
									>
										{inbox.counts[option.value]}
									</span>
								) : null}
							</button>
						))}
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-48 flex-1 sm:max-w-xs">
							<Search
								className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[var(--muted-text)]"
								aria-hidden="true"
							/>
							<Input
								aria-label="Search conversations"
								placeholder="Search file, text, PR"
								className="pl-8"
								value={filters.search}
								onChange={(event) =>
									setFilters({ ...filters, search: event.target.value })
								}
							/>
						</div>
						<Select
							aria-label="Reviewer"
							className="h-9 w-auto"
							value={filters.reviewer ?? ""}
							onChange={(event) =>
								setFilters({ ...filters, reviewer: event.target.value || null })
							}
						>
							<option value="">Any reviewer</option>
							{reviewers.map((login) => (
								<option key={login} value={login}>
									{login}
								</option>
							))}
						</Select>
						<Select
							aria-label="Pull request author"
							className="h-9 w-auto"
							value={filters.author ?? ""}
							onChange={(event) =>
								setFilters({ ...filters, author: event.target.value || null })
							}
						>
							<option value="">Any PR author</option>
							{authors.map((login) => (
								<option key={login} value={login}>
									{login}
								</option>
							))}
						</Select>
						{(
							[
								["hideBots", "Hide bots"],
								["untrackedOnly", "Untracked"],
								["outdatedOnly", "Outdated"],
								["unseenOnly", "New"],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								aria-pressed={filters[key]}
								onClick={() => setFilters({ ...filters, [key]: !filters[key] })}
								className={cn(
									"inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium",
									filters[key]
										? "border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--text)]"
										: "border-[var(--line)] text-[var(--muted-text)] hover:text-[var(--text)]",
								)}
							>
								{label}
							</button>
						))}
						{filtersActive ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									setFilters({ ...DEFAULT_FILTERS, hideBots: filters.hideBots })
								}
							>
								<X className="mr-1 h-3.5 w-3.5" />
								Clear
							</Button>
						) : null}
					</div>
				</>
			) : null}

			{notice ? (
				<p
					role={notice.failed ? "alert" : "status"}
					className={cn(
						"m-0 rounded-md border px-3 py-2 text-sm",
						notice.failed
							? "border-[color-mix(in_oklab,var(--danger)_45%,var(--line))] text-[var(--danger)]"
							: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
					)}
				>
					{notice.message}
				</p>
			) : null}
			{live.error ? (
				<p role="alert" className="m-0 text-sm text-[var(--danger)]">
					{live.error}
				</p>
			) : null}

			{checked.size && canWrite && view !== "requests" ? (
				<div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 shadow-[0_8px_24px_rgba(8,12,26,0.12)]">
					<span className="text-sm font-medium text-[var(--text)]">
						{checked.size} selected
					</span>
					<div className="flex flex-wrap gap-1.5">
						<Button
							size="sm"
							disabled={busy}
							onClick={() => setDialog({ type: "bulkTrack", kind: "fix" })}
						>
							Track as fix
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={busy}
							onClick={() =>
								setDialog({ type: "bulkTrack", kind: "follow_up" })
							}
						>
							Follow up
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={busy}
							onClick={() => void resolveChecked()}
						>
							{busy ? "Resolving…" : "Resolve"}
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={busy}
							onClick={() => setDialog({ type: "bulkReply" })}
						>
							Reply
						</Button>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className="ml-auto"
						onClick={() => setChecked(new Set())}
					>
						Clear
					</Button>
				</div>
			) : null}

			{!live.data ? (
				live.error ? null : (
					<div className="page-loading">Loading review conversations…</div>
				)
			) : view === "requests" ? (
				<ReviewRequestsList
					projectId={projectId}
					pullRequests={requests}
					now={now}
				/>
			) : groups.length ? (
				<div
					className={cn(
						"grid gap-4",
						wide && "grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start",
					)}
				>
					<ReviewInboxList
						projectId={projectId}
						groups={groups}
						tasksByThread={tasksByThread}
						tasksByPull={tasksByPull}
						currentId={currentId}
						checked={checked}
						canSelect={canWrite}
						now={now}
						onSelect={(threadId) =>
							select(!wide && threadId === currentId ? null : threadId)
						}
						onToggleChecked={toggleChecked}
						onToggleGroup={(ids, selectAll) =>
							setChecked((previous) => {
								const next = new Set(previous);
								for (const id of ids) {
									if (selectAll) next.add(id);
									else next.delete(id);
								}
								return next;
							})
						}
						renderInlineDetail={wide ? null : renderDetail}
					/>
					{wide ? (
						<div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-auto">
							{current && currentInTab ? (
								renderDetail(current)
							) : (
								<Card>
									<CardContent className="p-6 text-sm text-[var(--muted-text)]">
										Pick a conversation to read and answer it.
									</CardContent>
								</Card>
							)}
						</div>
					) : null}
				</div>
			) : (
				<Card>
					<CardContent className="p-6 text-center text-sm text-[var(--muted-text)]">
						{filtersActive
							? "No conversations match these filters."
							: STATES.find((option) => option.value === stateTab)?.empty}
					</CardContent>
				</Card>
			)}

			{live.data ? (
				<div className="space-y-1 text-xs text-[var(--muted-text)]">
					{live.data.totalPullRequests > live.data.checkedPullRequests ? (
						<p className="m-0">
							Showing the {live.data.checkedPullRequests} most recently updated
							of {live.data.totalPullRequests} open pull requests.
						</p>
					) : null}
					{live.data.missingThreads ? (
						<p className="m-0 text-amber-700 dark:text-amber-300">
							GitHub did not return {live.data.missingThreads} conversation
							{live.data.missingThreads === 1 ? "" : "s"}. Refresh to try again.
						</p>
					) : null}
					{view !== "requests" && wide ? (
						<p className="m-0">
							Press <kbd className="font-mono">?</kbd> for keyboard shortcuts.
						</p>
					) : null}
				</div>
			) : null}

			{dialog?.type === "track" && trackDialogEntry ? (
				<TrackOneDialog
					projectId={projectId}
					pullRequest={trackDialogEntry.pullRequest}
					thread={trackDialogEntry.thread}
					kind={dialog.kind}
					onClose={() => setDialog(null)}
					onTracked={(result) => {
						setNotice(result);
						if (dialog.kind === "follow_up")
							override(dialog.threadId, { isResolved: true });
					}}
				/>
			) : null}
			{dialog?.type === "bulkTrack" ? (
				<BulkTrackDialog
					projectId={projectId}
					threads={checkedThreads}
					kind={dialog.kind}
					onClose={() => setDialog(null)}
					onTracked={(result) => {
						setNotice(result);
						if (dialog.kind === "follow_up") {
							for (const thread of checkedThreads)
								override(thread.id, { isResolved: true });
						}
						setChecked(new Set());
					}}
				/>
			) : null}
			{dialog?.type === "bulkReply" ? (
				<BulkReplyDialog
					projectId={projectId}
					threads={checkedThreads}
					snippets={inboxState?.snippets ?? []}
					onEditSnippets={() => setDialog({ type: "snippets" })}
					onClose={() => setDialog(null)}
					onReplied={(result, repliedIds) => {
						setNotice(result);
						const at = Date.now();
						for (const thread of checkedThreads) {
							if (!repliedIds.includes(thread.id)) continue;
							override(thread.id, {
								lastCommentAt: at,
								lastCommentBy: viewer,
								replyCount: thread.replyCount + 1,
							});
						}
						setChecked(new Set());
					}}
				/>
			) : null}
			{dialog?.type === "snippets" && inboxState ? (
				<SnippetEditor
					snippets={inboxState.snippets}
					customized={inboxState.snippetsCustomized}
					onClose={() => setDialog(null)}
				/>
			) : null}
			{dialog?.type === "help" ? (
				<ShortcutsDialog onClose={() => setDialog(null)} />
			) : null}
		</div>
	);
}
