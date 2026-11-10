import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	Check,
	ChevronRight,
	ExternalLink,
	MessageSquareText,
	Unlink,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type { PullRequestReviewThread } from "#convex/lib/githubApi";
import { reviewThreadLocation } from "../reviewTaskDisplay";
import { useGitHubData } from "../useGitHubData";
import { GitHubAvatar, ToneBadge } from "./GitHubBadges";
import { GitHubHtml } from "./GitHubContent";

type ReviewFeedbackItem = NonNullable<
	FunctionReturnType<typeof api.githubReviewTasks.listForIssue>
>["items"][number];

/**
 * Review conversations a task came from, shown in its Development panel. With
 * a GitHub token the conversation is loaded live, so replies show up here and
 * can be answered or resolved without leaving the task.
 */
export function ReviewFeedbackSection({
	issueId,
	projectId,
	items,
	canWrite,
	viewerConnected,
}: {
	issueId: Id<"issues">;
	projectId: Id<"projects">;
	items: ReviewFeedbackItem[];
	canWrite: boolean;
	viewerConnected: boolean;
}) {
	const getThreads = useAction(
		api.githubReviewTaskActions.getIssueReviewThreads,
	);
	// Replies and resolution recorded by webhooks change this and refetch.
	const version = items.reduce(
		(sum, item) => sum + item.replyCount * 2 + (item.isResolved ? 1 : 0),
		0,
	);
	const live = useGitHubData(
		viewerConnected ? `review-threads:${issueId}` : null,
		() => getThreads({ issueId }),
		"Could not load the review conversations from GitHub.",
		version,
	);
	const threads = useMemo(
		() =>
			new Map(
				(live.data?.threads ?? []).map((item) => [item.thread.id, item.thread]),
			),
		[live.data],
	);

	return (
		<div className="space-y-1.5">
			<p className="m-0 text-xs font-medium text-[var(--muted-text)]">
				Review feedback
			</p>
			<ul className="m-0 list-none space-y-1.5 p-0">
				{items.map((item) => (
					<FeedbackItem
						key={item.linkId}
						item={item}
						projectId={projectId}
						canWrite={canWrite}
						thread={threads.get(item.threadId) ?? null}
						repository={live.data?.repository ?? null}
						defaultOpen={items.length === 1 && !item.isResolved}
						onChanged={live.refetch}
					/>
				))}
			</ul>
			{live.error ? (
				<p className="m-0 text-xs text-[var(--danger)]">{live.error}</p>
			) : null}
		</div>
	);
}

function FeedbackItem({
	item,
	projectId,
	canWrite,
	thread,
	repository,
	defaultOpen,
	onChanged,
}: {
	item: ReviewFeedbackItem;
	projectId: Id<"projects">;
	canWrite: boolean;
	thread: PullRequestReviewThread | null;
	repository: string | null;
	defaultOpen: boolean;
	onChanged: () => Promise<void>;
}) {
	const unlink = useMutation(api.githubReviewTasks.unlink);
	const [open, setOpen] = useState(defaultOpen);
	const [error, setError] = useState<string | null>(null);
	const isResolved = thread?.isResolved ?? item.isResolved;

	return (
		<li className="rounded-md border border-[var(--line)]">
			<div className="flex items-start gap-2 px-2.5 py-2">
				<button
					type="button"
					className="mt-0.5 shrink-0 bg-transparent p-0 text-[var(--muted-text)] disabled:opacity-40"
					aria-label={open ? "Hide conversation" : "Show conversation"}
					aria-expanded={open}
					disabled={!thread}
					title={thread ? undefined : "Connect GitHub to read the conversation"}
					onClick={() => setOpen((value) => !value)}
				>
					<ChevronRight
						className={cn(
							"h-4 w-4 transition-transform motion-reduce:transition-none",
							open && thread && "rotate-90",
						)}
					/>
				</button>
				<div className="min-w-0 flex-1">
					<Link
						to="/projects/$projectId/pulls/$pullNumber"
						params={{ projectId, pullNumber: String(item.pullNumber) }}
						search={{ thread: item.threadId }}
						className="flex min-w-0 items-center gap-1.5 text-xs font-medium no-underline"
						title="Open the conversation in Tasker"
					>
						<MessageSquareText
							className="h-3.5 w-3.5 shrink-0 text-[var(--muted-text)]"
							aria-hidden="true"
						/>
						<code className="truncate">
							{reviewThreadLocation(item.path, item.line, false)}
						</code>
						<span className="shrink-0 text-[var(--muted-text)]">
							#{item.pullNumber}
						</span>
					</Link>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-text)]">
						{isResolved ? (
							<ToneBadge tone="success">Resolved</ToneBadge>
						) : (
							<ToneBadge tone="warning">Open</ToneBadge>
						)}
						{item.isOutdated ? (
							<ToneBadge
								tone="muted"
								title="The code changed after this comment"
							>
								Outdated
							</ToneBadge>
						) : null}
						{item.kind === "follow_up" ? (
							<ToneBadge tone="muted">Follow-up</ToneBadge>
						) : null}
						{item.authorLogin ? <span>by {item.authorLogin}</span> : null}
						{item.replyCount && item.lastReplyAt ? (
							<span>
								· {item.replyCount} repl{item.replyCount === 1 ? "y" : "ies"},
								last {item.lastReplyLogin ? `by ${item.lastReplyLogin} ` : ""}
								{formatRelative(item.lastReplyAt)}
							</span>
						) : null}
					</div>
				</div>
				<a
					href={thread?.comments[0]?.url ?? `${item.pullUrl}`}
					target="_blank"
					rel="noreferrer"
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
					title="Open on GitHub"
					aria-label="Open the conversation on GitHub"
				>
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
				{canWrite ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 w-7 shrink-0 p-0"
						title="Stop tracking this conversation"
						aria-label="Stop tracking this conversation"
						onClick={async () => {
							setError(null);
							try {
								await unlink({ linkId: item.linkId });
							} catch (caught) {
								setError(
									getClientErrorMessage(
										caught,
										"Could not stop tracking the conversation.",
									),
								);
							}
						}}
					>
						<Unlink className="h-3.5 w-3.5" />
					</Button>
				) : null}
			</div>
			{open && thread && repository ? (
				<ThreadView
					thread={thread}
					projectId={projectId}
					pullNumber={item.pullNumber}
					repository={repository}
					canWrite={canWrite}
					onChanged={onChanged}
				/>
			) : null}
			{error ? (
				<p className="m-0 px-2.5 pb-2 text-xs text-[var(--danger)]">{error}</p>
			) : null}
		</li>
	);
}

function ThreadView({
	thread,
	projectId,
	pullNumber,
	repository,
	canWrite,
	onChanged,
}: {
	thread: PullRequestReviewThread;
	projectId: Id<"projects">;
	pullNumber: number;
	repository: string;
	canWrite: boolean;
	onChanged: () => Promise<void>;
}) {
	const reply = useAction(api.githubActions.replyToReviewThread);
	const setResolved = useAction(api.githubActions.setReviewThreadResolved);
	const [body, setBody] = useState("");
	const [working, setWorking] = useState<"reply" | "resolve" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const html = { repository, projectId };
	const canReply = canWrite && thread.viewerCanReply;
	const canToggle =
		canWrite &&
		(thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve);

	async function run(
		kind: "reply" | "resolve",
		task: () => Promise<unknown>,
		failure: string,
	) {
		setWorking(kind);
		setError(null);
		try {
			await task();
			await onChanged();
			return true;
		} catch (caught) {
			setError(getClientErrorMessage(caught, failure));
			return false;
		} finally {
			setWorking(null);
		}
	}

	return (
		<div className="border-t border-[var(--line)]">
			<ol className="m-0 max-h-96 list-none overflow-auto p-0">
				{thread.comments.map((comment) => (
					<li
						key={comment.id}
						className="flex gap-2 border-b border-[var(--line)] px-2.5 py-2 last:border-b-0"
					>
						<GitHubAvatar
							login={comment.author?.login ?? "?"}
							avatarUrl={comment.author?.avatarUrl ?? null}
							size={20}
						/>
						<div className="min-w-0 flex-1 text-sm">
							<div className="mb-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
								<strong className="text-[var(--text)]">
									{comment.author?.login ?? "Someone"}
								</strong>
								<span className="text-[var(--muted-text)]">
									{formatRelative(comment.createdAt)}
								</span>
							</div>
							<GitHubHtml html={comment.bodyHtml} context={html} collapsible />
						</div>
					</li>
				))}
			</ol>
			{thread.totalComments > thread.comments.length ? (
				<p className="m-0 border-t border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--muted-text)]">
					{thread.totalComments - thread.comments.length} more replies on
					GitHub.
				</p>
			) : null}
			{canReply || canToggle ? (
				<div className="space-y-2 border-t border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2">
					{canReply ? (
						<Textarea
							aria-label="Reply on GitHub"
							placeholder="Reply on GitHub"
							className="min-h-16 text-sm"
							value={body}
							onChange={(event) => setBody(event.target.value)}
						/>
					) : null}
					<div className="flex flex-wrap justify-end gap-2">
						{canToggle ? (
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={working !== null}
								onClick={() =>
									void run(
										"resolve",
										() =>
											setResolved({
												projectId,
												number: pullNumber,
												threadId: thread.id,
												resolved: !thread.isResolved,
											}),
										thread.isResolved
											? "Could not reopen the conversation."
											: "Could not resolve the conversation.",
									)
								}
							>
								{thread.isResolved ? null : (
									<Check className="mr-1.5 h-3.5 w-3.5" />
								)}
								{working === "resolve"
									? "Saving…"
									: thread.isResolved
										? "Unresolve"
										: "Resolve"}
							</Button>
						) : null}
						{canReply ? (
							<Button
								type="button"
								size="sm"
								disabled={working !== null || !body.trim()}
								onClick={async () => {
									const sent = await run(
										"reply",
										() =>
											reply({
												projectId,
												number: pullNumber,
												threadId: thread.id,
												body,
											}),
										"Could not post the reply.",
									);
									if (sent) setBody("");
								}}
							>
								{working === "reply" ? "Replying…" : "Reply"}
							</Button>
						) : null}
					</div>
					{error ? (
						<p role="alert" className="m-0 text-xs text-[var(--danger)]">
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
