import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { ArrowUpRight, Check, ExternalLink, ListPlus } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { formatRelative } from "#/features/tasker/format";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	formatAge,
	type InboxEntry,
	REASON_LABELS,
	SEVERITY_LABELS,
} from "../reviewInbox";
import { useGitHubData } from "../useGitHubData";
import { GitHubAvatar, ToneBadge } from "./GitHubBadges";
import { GitHubHtml } from "./GitHubContent";
import { DiffSnippet } from "./PullRequestConversation";
import { SnippetMenu } from "./ReplySnippets";
import type { ReviewTaskKind } from "./ReviewTasks";
import { type ReviewTask, ReviewTaskChip } from "./ReviewTasks";

/**
 * The selected conversation in full, loaded with the viewer's own token:
 * the code it points at, every comment, and the actions to answer it.
 */
export function ReviewInboxDetail({
	projectId,
	repository,
	entry,
	task,
	canWrite,
	snippets,
	replyRef,
	actionsRef,
	now,
	onTrack,
	onEditSnippets,
	onResolvedChange,
	onReplied,
	onSeen,
}: {
	projectId: Id<"projects">;
	repository: string;
	entry: InboxEntry;
	task: ReviewTask | null;
	canWrite: boolean;
	snippets: string[];
	replyRef: RefObject<HTMLTextAreaElement | null>;
	/** Filled with this pane's actions so keyboard shortcuts can run them. */
	actionsRef: RefObject<{ toggleResolved: () => void } | null>;
	now: number;
	onTrack: (kind: ReviewTaskKind) => void;
	onEditSnippets: () => void;
	onResolvedChange: (resolved: boolean) => void;
	onReplied: () => void;
	onSeen: (threadId: string) => void;
}) {
	const { thread, pullRequest } = entry;
	const getThread = useAction(api.githubReviewInboxActions.getReviewThread);
	const reply = useAction(api.githubActions.replyToReviewThread);
	const setResolved = useAction(api.githubActions.setReviewThreadResolved);
	const markSeen = useMutation(api.githubReviewInbox.markThreadsSeen);
	const live = useGitHubData(
		`review-thread:${projectId}:${thread.id}`,
		() => getThread({ projectId, threadId: thread.id }),
		"Could not load the conversation from GitHub.",
		// New replies or a changed resolution in the list reload the conversation.
		thread.lastCommentAt + (thread.isResolved ? 1 : 0),
	);
	const full = live.data?.thread ?? null;
	const [body, setBody] = useState("");
	const [working, setWorking] = useState<"reply" | "resolve" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const seenRef = useRef<string | null>(null);

	useEffect(() => {
		if (!full || full.id !== thread.id || seenRef.current === thread.id) return;
		seenRef.current = thread.id;
		onSeen(thread.id);
		void markSeen({ projectId, threadIds: [thread.id] }).catch(() => {});
	}, [full, thread.id, projectId, markSeen, onSeen]);

	const isResolved = full?.isResolved ?? thread.isResolved;
	const canReply = canWrite && (full?.viewerCanReply ?? false);
	const canToggle =
		canWrite &&
		Boolean(full) &&
		(isResolved ? full?.viewerCanUnresolve : full?.viewerCanResolve);
	useEffect(() => {
		actionsRef.current = {
			toggleResolved: () => {
				if (canToggle && working === null) void toggleResolved();
			},
		};
		return () => {
			actionsRef.current = null;
		};
	});

	const location =
		thread.line && !thread.isFileComment
			? `${thread.path}:${thread.line}`
			: thread.path;

	async function sendReply() {
		const text = body.trim();
		if (!text) return;
		setWorking("reply");
		setError(null);
		try {
			await reply({
				projectId,
				number: pullRequest.number,
				threadId: thread.id,
				body: text,
			});
			setBody("");
			onReplied();
			await live.refetch();
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not post the reply."));
		} finally {
			setWorking(null);
		}
	}

	async function toggleResolved() {
		setWorking("resolve");
		setError(null);
		try {
			await setResolved({
				projectId,
				number: pullRequest.number,
				threadId: thread.id,
				resolved: !isResolved,
			});
			onResolvedChange(!isResolved);
			await live.refetch();
		} catch (caught) {
			setError(
				getClientErrorMessage(
					caught,
					isResolved
						? "Could not reopen the conversation."
						: "Could not resolve the conversation.",
				),
			);
		} finally {
			setWorking(null);
		}
	}

	return (
		<section
			aria-label={`Conversation on ${location}`}
			className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
		>
			<header className="space-y-2 border-b border-[var(--line)] px-4 py-3">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<code className="block break-all text-sm font-semibold text-[var(--text)]">
							{location}
						</code>
						<Link
							to="/projects/$projectId/pulls/$pullNumber"
							params={{ projectId, pullNumber: String(pullRequest.number) }}
							className="mt-0.5 block truncate text-xs text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
						>
							#{pullRequest.number} {pullRequest.title}
						</Link>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Link
							to="/projects/$projectId/pulls/$pullNumber"
							params={{ projectId, pullNumber: String(pullRequest.number) }}
							search={{ thread: thread.id }}
							className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--muted-text)] no-underline hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
							title="Open in the pull request (o)"
						>
							<ArrowUpRight className="h-3.5 w-3.5" />
							Open in PR
						</Link>
						{thread.url ? (
							<a
								href={thread.url}
								target="_blank"
								rel="noreferrer"
								className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
								title="Open on GitHub"
								aria-label="Open the conversation on GitHub"
							>
								<ExternalLink className="h-3.5 w-3.5" />
							</a>
						) : null}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-1.5 text-xs">
					{entry.reason ? (
						<ToneBadge tone={entry.state === "attention" ? "warning" : "muted"}>
							{REASON_LABELS[entry.reason]}
						</ToneBadge>
					) : null}
					{isResolved ? <ToneBadge tone="success">Resolved</ToneBadge> : null}
					{thread.severity ? (
						<ToneBadge
							tone={
								thread.severity === "critical" || thread.severity === "major"
									? "danger"
									: "muted"
							}
						>
							{SEVERITY_LABELS[thread.severity]}
						</ToneBadge>
					) : null}
					{thread.isOutdated ? (
						<ToneBadge
							tone="warning"
							title="The code changed after this comment"
						>
							Outdated
						</ToneBadge>
					) : null}
					{entry.quiet ? (
						<ToneBadge tone="muted" title="No activity for a while">
							Quiet {formatAge(now - thread.lastCommentAt)}
						</ToneBadge>
					) : null}
					{task ? <ReviewTaskChip task={task} /> : null}
				</div>
			</header>

			{full && !full.isFileComment ? <DiffSnippet thread={full} /> : null}

			{full ? (
				<ol className="m-0 max-h-[50vh] list-none overflow-auto p-0">
					{full.comments.map((comment) => (
						<li
							key={comment.id}
							className="flex gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
						>
							<GitHubAvatar
								login={comment.author?.login ?? "?"}
								avatarUrl={comment.author?.avatarUrl ?? null}
								size={24}
							/>
							<div className="min-w-0 flex-1">
								<div className="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
									<strong className="text-sm text-[var(--text)]">
										{comment.author?.login ?? "Someone"}
									</strong>
									<span className="text-[var(--muted-text)]">
										{formatRelative(comment.createdAt)}
									</span>
								</div>
								<GitHubHtml
									html={comment.bodyHtml}
									context={{ repository, projectId }}
									collapsible
								/>
							</div>
						</li>
					))}
					{full.totalComments > full.comments.length ? (
						<li className="px-4 py-2 text-xs text-[var(--muted-text)]">
							{full.totalComments - full.comments.length} more replies on
							GitHub.
						</li>
					) : null}
				</ol>
			) : live.error ? (
				<p role="alert" className="m-0 px-4 py-3 text-sm text-[var(--danger)]">
					{live.error}
				</p>
			) : (
				<div className="space-y-2 px-4 py-4" aria-busy="true">
					<p className="m-0 text-sm text-[var(--muted-text)]">
						{thread.preview || "Loading the conversation…"}
					</p>
					<div className="h-3 w-1/2 animate-pulse rounded bg-[var(--surface-muted)] motion-reduce:animate-none" />
				</div>
			)}

			{canWrite ? (
				<div className="space-y-2 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-muted)_60%,transparent)] px-4 py-3">
					{canReply ? (
						<Textarea
							ref={replyRef}
							aria-label="Reply on GitHub"
							placeholder="Reply on GitHub (Ctrl+Enter to send)"
							className="min-h-20 text-sm"
							value={body}
							onChange={(event) => setBody(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
									event.preventDefault();
									void sendReply();
								}
								if (event.key === "Escape") event.currentTarget.blur();
							}}
						/>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						{canReply ? (
							<SnippetMenu
								snippets={snippets}
								disabled={working !== null}
								onInsert={(snippet) =>
									setBody((current) =>
										current.trim()
											? `${current.trimEnd()}\n\n${snippet}`
											: snippet,
									)
								}
								onEdit={onEditSnippets}
							/>
						) : null}
						<div className="ml-auto flex flex-wrap gap-2">
							{!task ? (
								<>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										title="Track as a fix before merge (t)"
										onClick={() => onTrack("fix")}
									>
										<ListPlus className="mr-1.5 h-3.5 w-3.5" />
										Track
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										title="Track as a follow-up (f)"
										onClick={() => onTrack("follow_up")}
									>
										Follow up
									</Button>
								</>
							) : null}
							{canToggle ? (
								<Button
									type="button"
									size="sm"
									variant="secondary"
									disabled={working !== null}
									title={isResolved ? "Reopen (e)" : "Resolve (e)"}
									onClick={() => void toggleResolved()}
								>
									{isResolved ? null : <Check className="mr-1.5 h-3.5 w-3.5" />}
									{working === "resolve"
										? "Saving…"
										: isResolved
											? "Unresolve"
											: "Resolve"}
								</Button>
							) : null}
							{canReply ? (
								<Button
									type="button"
									size="sm"
									disabled={working !== null || !body.trim()}
									onClick={() => void sendReply()}
								>
									{working === "reply" ? "Replying…" : "Reply"}
								</Button>
							) : null}
						</div>
					</div>
					{error ? (
						<p role="alert" className="m-0 text-xs text-[var(--danger)]">
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
