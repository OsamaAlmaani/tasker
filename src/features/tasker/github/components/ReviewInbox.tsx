import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight, ListPlus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import { formatRelative } from "#/features/tasker/format";
import { cn } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import { githubHtmlToText } from "../githubHtml";
import { filterReviewInbox, type ReviewInboxScope } from "../reviewTaskDisplay";
import { useGitHubData } from "../useGitHubData";
import { GitHubAvatar, PullRequestStateIcon, ToneBadge } from "./GitHubBadges";
import {
	ReviewTaskChip,
	TrackThreadsDialog,
	useReviewTasks,
} from "./ReviewTasks";

type InboxData = FunctionReturnType<
	typeof api.githubReviewTaskActions.listOpenReviewThreads
>;
type InboxPullRequest = InboxData["pullRequests"][number];

const SCOPE_STORAGE_KEY = "tasker:review-inbox-scope";

function useScope() {
	const [scope, setScope] = useState<ReviewInboxScope>("mine");
	useEffect(() => {
		try {
			const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
			if (stored === "all" || stored === "mine") setScope(stored);
		} catch {}
	}, []);
	return [
		scope,
		(next: ReviewInboxScope) => {
			setScope(next);
			try {
				window.localStorage.setItem(SCOPE_STORAGE_KEY, next);
			} catch {}
		},
	] as const;
}

/**
 * Unresolved review conversations across open pull requests, so a day of
 * reviewing can be turned into tasks in one place.
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
	const listThreads = useAction(
		api.githubReviewTaskActions.listOpenReviewThreads,
	);
	const live = useGitHubData(
		`review-inbox:${projectId}:${repository}`,
		() => listThreads({ projectId }),
		"Could not load review conversations from GitHub.",
		liveVersion,
	);
	const [scope, setScope] = useScope();
	const [notice, setNotice] = useState<{
		message: string;
		failed: boolean;
	} | null>(null);
	const pullRequests = useMemo(
		() =>
			live.data
				? filterReviewInbox(
						live.data.pullRequests,
						scope,
						live.data.viewerLogin,
					)
				: [],
		[live.data, scope],
	);
	const threadCount = pullRequests.reduce(
		(sum, pr) => sum + pr.threads.length,
		0,
	);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<fieldset className="m-0 inline-flex rounded-md border border-[var(--line)] p-0.5">
					<legend className="sr-only">Whose conversations</legend>
					{(
						[
							["mine", "Started by me"],
							["all", "Everyone"],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							aria-pressed={scope === value}
							onClick={() => setScope(value)}
							className={cn(
								"rounded px-3 py-1 text-sm",
								scope === value
									? "bg-[var(--surface-muted)] font-medium text-[var(--text)]"
									: "text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
						>
							{label}
						</button>
					))}
				</fieldset>
				<div className="flex items-center gap-3 text-sm text-[var(--muted-text)]">
					{live.data ? (
						<span>
							{threadCount} open conversation{threadCount === 1 ? "" : "s"} on{" "}
							{pullRequests.length} pull request
							{pullRequests.length === 1 ? "" : "s"}
						</span>
					) : null}
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

			{!live.data ? (
				live.error ? null : (
					<div className="page-loading">Loading review conversations…</div>
				)
			) : pullRequests.length ? (
				pullRequests.map((pullRequest) => (
					<PullRequestGroup
						key={pullRequest.number}
						projectId={projectId}
						pullRequest={pullRequest}
						canWrite={canWrite}
						onTracked={(result) => {
							setNotice(result);
							void live.refetch();
						}}
					/>
				))
			) : (
				<Card>
					<CardContent className="p-6 text-center text-sm text-[var(--muted-text)]">
						{scope === "mine"
							? "No open review conversations that you started."
							: "No open review conversations."}
					</CardContent>
				</Card>
			)}
			{live.data &&
			live.data.totalPullRequests > live.data.checkedPullRequests ? (
				<p className="m-0 text-xs text-[var(--muted-text)]">
					Showing conversations from the {live.data.checkedPullRequests} most
					recently updated of {live.data.totalPullRequests} open pull requests.
				</p>
			) : null}
		</div>
	);
}

function PullRequestGroup({
	projectId,
	pullRequest,
	canWrite,
	onTracked,
}: {
	projectId: Id<"projects">;
	pullRequest: InboxPullRequest;
	canWrite: boolean;
	onTracked: (result: { message: string; failed: boolean }) => void;
}) {
	const reviewTasks = useReviewTasks(
		projectId,
		pullRequest.number,
		pullRequest.author?.login ?? null,
	);
	const canTrack = canWrite && Boolean(reviewTasks.data?.canWrite);
	const untracked = pullRequest.threads.filter(
		(thread) => !reviewTasks.byThread.has(thread.id),
	);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [dialogOpen, setDialogOpen] = useState(false);
	const chosen = untracked.filter((thread) => selected.has(thread.id));

	function toggle(threadId: string) {
		setSelected((previous) => {
			const next = new Set(previous);
			if (next.has(threadId)) next.delete(threadId);
			else next.add(threadId);
			return next;
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<Link
						to="/projects/$projectId/pulls/$pullNumber"
						params={{ projectId, pullNumber: String(pullRequest.number) }}
						className="flex min-w-0 items-center gap-2 font-semibold text-[var(--text)] no-underline"
					>
						<PullRequestStateIcon
							pullRequest={{ state: "open", isDraft: pullRequest.isDraft }}
							className="h-4 w-4 shrink-0"
						/>
						<span className="truncate">{pullRequest.title}</span>
						<span className="shrink-0 font-normal text-[var(--muted-text)]">
							#{pullRequest.number}
						</span>
					</Link>
					<p className="m-0 mt-0.5 text-xs text-[var(--muted-text)]">
						{pullRequest.author?.login ?? "Someone"} · updated{" "}
						{formatRelative(pullRequest.updatedAt)}
						{reviewTasks.progress.fixes
							? ` · review tasks ${reviewTasks.progress.fixesDone}/${reviewTasks.progress.fixes} done`
							: ""}
					</p>
				</div>
				{canTrack && untracked.length ? (
					<Button
						type="button"
						size="sm"
						variant={chosen.length ? "primary" : "secondary"}
						onClick={() => {
							if (!chosen.length)
								setSelected(new Set(untracked.map((t) => t.id)));
							setDialogOpen(true);
						}}
					>
						<ListPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
						{chosen.length
							? `Track ${chosen.length} as task${chosen.length === 1 ? "" : "s"}`
							: `Track all ${untracked.length}`}
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="p-0">
				<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
					{pullRequest.threads.map((thread) => {
						const first = thread.comments[0];
						const task = reviewTasks.byThread.get(thread.id);
						const snippet = githubHtmlToText(first?.bodyHtml ?? "", 160);
						const file = thread.path.split("/").pop() || thread.path;
						return (
							<li
								key={thread.id}
								className="flex items-start gap-3 px-4 py-2.5"
							>
								{canTrack ? (
									<input
										type="checkbox"
										className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
										aria-label={`Select the conversation on ${file}`}
										disabled={Boolean(task)}
										checked={Boolean(task) || selected.has(thread.id)}
										onChange={() => toggle(thread.id)}
									/>
								) : null}
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 flex-wrap items-center gap-1.5">
										<code className="truncate text-xs" title={thread.path}>
											{thread.line && !thread.isFileComment
												? `${file}:${thread.line}`
												: file}
										</code>
										{thread.isOutdated ? (
											<ToneBadge tone="warning">Outdated</ToneBadge>
										) : null}
										{thread.totalComments > 1 ? (
											<span className="text-xs text-[var(--muted-text)]">
												{thread.totalComments - 1} repl
												{thread.totalComments === 2 ? "y" : "ies"}
											</span>
										) : null}
									</div>
									<p className="m-0 mt-0.5 flex items-start gap-1.5 text-sm text-[var(--text)]">
										<span className="mt-0.5 shrink-0">
											<GitHubAvatar
												login={first?.author?.login ?? "?"}
												avatarUrl={first?.author?.avatarUrl ?? null}
												size={16}
											/>
										</span>
										<span className="line-clamp-2">{snippet || "Comment"}</span>
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									{task ? <ReviewTaskChip task={task} /> : null}
									<Link
										to="/projects/$projectId/pulls/$pullNumber"
										params={{
											projectId,
											pullNumber: String(pullRequest.number),
										}}
										search={{ thread: thread.id }}
										className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
										title="Open the conversation"
										aria-label={`Open the conversation on ${file}`}
									>
										<ArrowUpRight className="h-4 w-4" />
									</Link>
								</div>
							</li>
						);
					})}
				</ul>
			</CardContent>
			{dialogOpen && reviewTasks.data ? (
				<TrackThreadsDialog
					projectId={projectId}
					pullNumber={pullRequest.number}
					threads={untracked}
					initialSelected={[...selected].filter((id) =>
						untracked.some((thread) => thread.id === id),
					)}
					data={reviewTasks.data}
					onClose={() => setDialogOpen(false)}
					onTracked={(result) => {
						setSelected(new Set());
						onTracked({
							...result,
							message: `#${pullRequest.number}: ${result.message}`,
						});
					}}
				/>
			) : null}
		</Card>
	);
}
