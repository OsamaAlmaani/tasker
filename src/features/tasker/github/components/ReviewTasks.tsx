import { Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, ListPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type { PullRequestReviewThread } from "#convex/lib/githubApi";
import { githubHtmlToText } from "../githubHtml";
import {
	reviewTaskProgress,
	reviewThreadLocation,
	trackSummary,
} from "../reviewTaskDisplay";
import { ToneBadge } from "./GitHubBadges";
import { Modal } from "./Modal";

export type ReviewTasksData = NonNullable<
	FunctionReturnType<typeof api.githubReviewTasks.listForPullRequest>
>;
export type ReviewTask = ReviewTasksData["threads"][number];
export type ReviewTaskKind = ReviewTask["kind"];

/** Review tasks of a pull request, keyed by GitHub thread id. */
export function useReviewTasks(
	projectId: Id<"projects">,
	pullNumber: number,
	authorLogin: string | null,
) {
	const data = useQuery(api.githubReviewTasks.listForPullRequest, {
		projectId,
		pullNumber,
		authorLogin: authorLogin ?? undefined,
	});
	const byThread = useMemo(
		() => new Map((data?.threads ?? []).map((task) => [task.threadId, task])),
		[data],
	);
	const progress = useMemo(
		() => reviewTaskProgress(data?.threads ?? []),
		[data],
	);
	return { data: data ?? null, byThread, progress };
}

/** Compact link to a review task with its status color. */
export function ReviewTaskChip({
	task,
	className,
}: {
	task: ReviewTask;
	className?: string;
}) {
	const { issue } = task;
	return (
		<Link
			to="/issues/$issueId"
			params={{ issueId: issue._id }}
			title={`${issue.key} ${issue.title} · ${issue.statusLabel}${task.kind === "follow_up" ? " · follow-up" : ""}`}
			className={cn(
				"inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--text)] no-underline hover:border-[var(--accent)]",
				className,
			)}
		>
			{issue.isDone ? (
				<CircleCheck
					className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
			) : (
				<span
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: issue.statusColor ?? "var(--muted-text)" }}
					aria-hidden="true"
				/>
			)}
			<span className="shrink-0">{issue.key}</span>
			<span className="hidden truncate font-normal text-[var(--muted-text)] sm:inline">
				{task.kind === "follow_up" ? "Follow-up" : issue.statusLabel}
			</span>
		</Link>
	);
}

// ---------------------------------------------------------------------------
// Tracking dialog

const KIND_OPTIONS: Array<{
	kind: ReviewTaskKind;
	label: string;
	description: string;
}> = [
	{
		kind: "fix",
		label: "Fix before merge",
		description:
			"The task is done when the conversation is resolved, and finishing the task resolves the conversation.",
	},
	{
		kind: "follow_up",
		label: "Follow up later",
		description:
			"Tasker replies with a link to the task and resolves the conversation, so the pull request can merge.",
	},
];

export function TrackThreadsDialog({
	projectId,
	pullNumber,
	threads,
	initialSelected,
	data,
	onClose,
	onTracked,
}: {
	projectId: Id<"projects">;
	pullNumber: number;
	/** Conversations that are not tracked yet. */
	threads: PullRequestReviewThread[];
	initialSelected: string[];
	data: ReviewTasksData;
	onClose: () => void;
	onTracked: (result: { message: string; failed: boolean }) => void;
}) {
	const trackThreads = useAction(api.githubReviewTaskActions.trackThreads);
	const [selected, setSelected] = useState(() => new Set(initialSelected));
	const chosen = threads.filter((thread) => selected.has(thread.id));
	const allResolved =
		chosen.length > 0 && chosen.every((thread) => thread.isResolved);
	const [kind, setKind] = useState<ReviewTaskKind>(
		allResolved ? "follow_up" : "fix",
	);
	const [parentId, setParentId] = useState<string>(
		data.parentCandidates[0]?._id ?? "",
	);
	const [assignToAuthor, setAssignToAuthor] = useState(
		Boolean(data.authorAssignee),
	);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const skippedResolved =
		kind === "fix" ? chosen.filter((thread) => thread.isResolved).length : 0;
	const creating = chosen.length - skippedResolved;

	function toggle(threadId: string) {
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(threadId)) next.delete(threadId);
			else next.add(threadId);
			return next;
		});
	}

	async function submit() {
		setWorking(true);
		setError(null);
		try {
			const result = await trackThreads({
				projectId,
				pullNumber,
				threadIds: chosen.map((thread) => thread.id),
				kind,
				parentIssueId:
					kind === "fix" && parentId ? (parentId as Id<"issues">) : undefined,
				assignToAuthor,
			});
			onTracked(trackSummary(result.results, result.warnings));
			onClose();
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not create the review tasks."),
			);
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal
			title={
				threads.length === 1
					? "Track conversation as a task"
					: "Track conversations as tasks"
			}
			onClose={onClose}
		>
			<div className="space-y-4 text-sm">
				{threads.length === 1 ? (
					<ThreadSummary thread={threads[0]} />
				) : (
					<fieldset className="m-0 space-y-1 border-0 p-0">
						<legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-[var(--muted-text)]">
							<span>
								{chosen.length} of {threads.length} selected
							</span>
							<button
								type="button"
								className="bg-transparent p-0 text-xs text-[var(--accent)]"
								onClick={() =>
									setSelected(
										chosen.length === threads.length
											? new Set()
											: new Set(threads.map((thread) => thread.id)),
									)
								}
							>
								{chosen.length === threads.length
									? "Select none"
									: "Select all"}
							</button>
						</legend>
						<ul className="m-0 max-h-60 list-none space-y-1 overflow-auto p-0">
							{threads.map((thread) => (
								<li key={thread.id}>
									<label className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--line)] px-2 py-1.5 hover:bg-[var(--surface-muted)]">
										<input
											type="checkbox"
											className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
											checked={selected.has(thread.id)}
											onChange={() => toggle(thread.id)}
										/>
										<ThreadSummary thread={thread} compact />
									</label>
								</li>
							))}
						</ul>
					</fieldset>
				)}

				<fieldset className="m-0 space-y-1.5 border-0 p-0">
					<legend className="mb-1.5 text-xs font-medium text-[var(--muted-text)]">
						What should the task do?
					</legend>
					{KIND_OPTIONS.map((option) => (
						<label
							key={option.kind}
							className={cn(
								"flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2",
								kind === option.kind
									? "border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
									: "border-[var(--line)]",
							)}
						>
							<input
								type="radio"
								name="review-task-kind"
								className="mt-1 accent-[var(--accent)]"
								checked={kind === option.kind}
								onChange={() => setKind(option.kind)}
							/>
							<span>
								<span className="block font-medium text-[var(--text)]">
									{option.label}
								</span>
								<span className="block text-xs text-[var(--muted-text)]">
									{option.description}
								</span>
							</span>
						</label>
					))}
				</fieldset>

				{kind === "fix" ? (
					<div className="space-y-1">
						<Label htmlFor="review-task-parent">Parent task</Label>
						<Select
							id="review-task-parent"
							value={parentId}
							onChange={(event) => setParentId(event.target.value)}
						>
							{data.parentCandidates.map((issue) => (
								<option key={issue._id} value={issue._id}>
									{issue.key} {issue.title}
								</option>
							))}
							<option value="">No parent task</option>
						</Select>
						{!data.parentCandidates.length ? (
							<p className="m-0 text-xs text-[var(--muted-text)]">
								Link this pull request to a task to group its review tasks under
								it.
							</p>
						) : null}
					</div>
				) : null}

				{data.authorAssignee ? (
					<label className="flex items-center gap-2 text-[var(--text)]">
						<input
							type="checkbox"
							className="h-3.5 w-3.5 accent-[var(--accent)]"
							checked={assignToAuthor}
							onChange={(event) => setAssignToAuthor(event.target.checked)}
						/>
						Assign to {data.authorAssignee.name}, the pull request author
					</label>
				) : (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						The pull request author has no Tasker account in this project, so
						the tasks start unassigned.
					</p>
				)}

				{skippedResolved ? (
					<p className="m-0 text-xs text-amber-700 dark:text-amber-300">
						{skippedResolved} selected conversation
						{skippedResolved === 1 ? " is" : "s are"} already resolved and will
						be skipped. Track {skippedResolved === 1 ? "it" : "them"} as a
						follow-up instead.
					</p>
				) : null}
				{error ? (
					<p role="alert" className="m-0 text-xs text-[var(--danger)]">
						{error}
					</p>
				) : null}

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={working || creating === 0}
						onClick={() => void submit()}
					>
						<ListPlus className="mr-1.5 h-4 w-4" />
						{working
							? "Creating…"
							: creating
								? `Create ${creating} task${creating === 1 ? "" : "s"}`
								: "Create tasks"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function ThreadSummary({
	thread,
	compact = false,
}: {
	thread: PullRequestReviewThread;
	compact?: boolean;
}) {
	const first = thread.comments[0];
	const snippet = githubHtmlToText(first?.bodyHtml ?? "", compact ? 90 : 240);
	return (
		<span className="block min-w-0">
			<span className="flex min-w-0 items-center gap-1.5">
				<code className="truncate text-xs" title={thread.path}>
					{reviewThreadLocation(thread.path, thread.line, thread.isFileComment)}
				</code>
				{thread.isResolved ? (
					<ToneBadge tone="success">Resolved</ToneBadge>
				) : null}
				{thread.isOutdated ? (
					<ToneBadge tone="warning">Outdated</ToneBadge>
				) : null}
			</span>
			<span
				className={cn(
					"mt-0.5 block text-xs text-[var(--muted-text)]",
					compact && "line-clamp-2",
				)}
			>
				{first?.author ? `${first.author.login}: ` : ""}
				{snippet || "Comment"}
			</span>
		</span>
	);
}
