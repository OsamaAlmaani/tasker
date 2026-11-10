import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageSquare, MessagesSquare } from "lucide-react";
import { formatRelative } from "#/features/tasker/format";
import { cn } from "#/lib/utils";
import type { Id } from "#convex/_generated/dataModel";
import type { InboxPullRequest } from "#convex/lib/githubReviewInbox";
import {
	formatAge,
	type InboxEntry,
	type InboxGroup,
	oldestOpenAge,
	REASON_LABELS,
	SEVERITY_LABELS,
} from "../reviewInbox";
import { reviewTaskProgress } from "../reviewTaskDisplay";
import { GitHubAvatar, PullRequestStateIcon, ToneBadge } from "./GitHubBadges";
import { type ReviewTask, ReviewTaskChip } from "./ReviewTasks";

const DECISION_LABELS = {
	approved: { label: "Approved", tone: "success" },
	changes_requested: { label: "Changes requested", tone: "danger" },
	review_required: { label: "Review required", tone: "warning" },
} as const;

/** Rough row and header heights, so off-screen groups keep their place. */
const ROW_HEIGHT = 54;
const HEADER_HEIGHT = 38;

/**
 * Conversations grouped by pull request. Group headers stick to the top of
 * the list while their conversations scroll; groups off screen are skipped by
 * the browser until they come close.
 */
export function ReviewInboxList({
	projectId,
	groups,
	tasksByThread,
	tasksByPull,
	currentId,
	checked,
	canSelect,
	now,
	onSelect,
	onToggleChecked,
	onToggleGroup,
}: {
	projectId: Id<"projects">;
	groups: InboxGroup[];
	tasksByThread: ReadonlyMap<string, ReviewTask>;
	tasksByPull: ReadonlyMap<number, ReviewTask[]>;
	currentId: string | null;
	checked: ReadonlySet<string>;
	canSelect: boolean;
	now: number;
	onSelect: (threadId: string) => void;
	onToggleChecked: (threadId: string) => void;
	onToggleGroup: (threadIds: string[], select: boolean) => void;
}) {
	return (
		<div>
			{groups.map((group) => {
				const pr = group.pullRequest;
				const ids = group.entries.map((entry) => entry.thread.id);
				const allChecked = ids.every((id) => checked.has(id));
				const progress = reviewTaskProgress(tasksByPull.get(pr.number) ?? []);
				const oldest = oldestOpenAge(pr, now);
				const decision = pr.reviewDecision
					? DECISION_LABELS[pr.reviewDecision]
					: null;
				const hasCurrent = currentId !== null && ids.includes(currentId);
				return (
					<section
						key={pr.number}
						aria-label={`#${pr.number} ${pr.title}`}
						className="border-b border-[var(--line)] last:border-b-0"
						style={
							hasCurrent
								? undefined
								: {
										contentVisibility: "auto",
										containIntrinsicSize: `auto ${HEADER_HEIGHT + group.entries.length * ROW_HEIGHT}px`,
									}
						}
					>
						<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-muted)_92%,var(--surface))] px-3 py-1.5">
							{canSelect ? (
								<input
									type="checkbox"
									className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
									aria-label={`Select every conversation on #${pr.number}`}
									checked={allChecked}
									onChange={() => onToggleGroup(ids, !allChecked)}
								/>
							) : null}
							<Link
								to="/projects/$projectId/pulls/$pullNumber"
								params={{ projectId, pullNumber: String(pr.number) }}
								className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold text-[var(--text)] no-underline"
								title={`${pr.title} #${pr.number} by ${pr.author?.login ?? "someone"}`}
							>
								<PullRequestStateIcon
									pullRequest={{ state: "open", isDraft: pr.isDraft }}
									className="h-3.5 w-3.5 shrink-0"
								/>
								<span className="truncate">{pr.title}</span>
								<span className="shrink-0 font-normal text-[var(--muted-text)]">
									#{pr.number}
								</span>
							</Link>
							<span className="hidden shrink-0 items-center gap-2 text-[11px] text-[var(--muted-text)] sm:flex">
								<span>{pr.author?.login ?? "Someone"}</span>
								{decision ? (
									<ToneBadge tone={decision.tone}>{decision.label}</ToneBadge>
								) : null}
								{oldest !== null ? (
									<span title="Age of the oldest open conversation">
										{formatAge(oldest)}
									</span>
								) : null}
								{progress.fixes ? (
									<span title="Review tasks done">
										{progress.fixesDone}/{progress.fixes} tasks
									</span>
								) : null}
							</span>
						</div>
						<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
							{group.entries.map((entry) => (
								<InboxRow
									key={entry.thread.id}
									entry={entry}
									task={tasksByThread.get(entry.thread.id) ?? null}
									isCurrent={entry.thread.id === currentId}
									isChecked={checked.has(entry.thread.id)}
									canSelect={canSelect}
									now={now}
									onSelect={() => onSelect(entry.thread.id)}
									onToggleChecked={() => onToggleChecked(entry.thread.id)}
								/>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

function InboxRow({
	entry,
	task,
	isCurrent,
	isChecked,
	canSelect,
	now,
	onSelect,
	onToggleChecked,
}: {
	entry: InboxEntry;
	task: ReviewTask | null;
	isCurrent: boolean;
	isChecked: boolean;
	canSelect: boolean;
	now: number;
	onSelect: () => void;
	onToggleChecked: () => void;
}) {
	const { thread } = entry;
	const file = thread.path.split("/").pop() || thread.path;
	const location =
		thread.line && !thread.isFileComment ? `${file}:${thread.line}` : file;
	const activity = thread.replyCount
		? `${thread.replyCount} repl${thread.replyCount === 1 ? "y" : "ies"}, last by ${thread.lastCommentBy ?? "someone"} ${formatRelative(thread.lastCommentAt)}`
		: `${thread.startedBy?.login ?? "Someone"} ${formatRelative(thread.startedAt)}`;
	const smallBadge = "shrink-0 px-1.5 py-0 text-[10px]";
	return (
		<li
			id={`inbox-${thread.id}`}
			className={cn(
				"relative flex items-start gap-2 px-3 py-2 hover:bg-[var(--surface-muted)]",
				isCurrent &&
					"bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[inset_3px_0_0_var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]",
			)}
		>
			{canSelect ? (
				<input
					type="checkbox"
					className="relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
					aria-label={`Select the conversation on ${location}`}
					checked={isChecked}
					onChange={onToggleChecked}
				/>
			) : null}
			<span
				className={cn(
					"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
					entry.unseen ? "bg-[var(--accent)]" : "bg-transparent",
				)}
				title={entry.unseen ? "New since you last looked" : undefined}
				aria-hidden="true"
			/>
			<button
				type="button"
				onClick={onSelect}
				aria-current={isCurrent ? "true" : undefined}
				title={`${thread.path}\n${activity}`}
				className="min-w-0 flex-1 bg-transparent p-0 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--accent)]"
			>
				<span className="flex min-w-0 items-center gap-1.5">
					<code
						className={cn(
							"min-w-0 truncate text-xs",
							entry.unseen
								? "font-semibold text-[var(--text)]"
								: "text-[var(--muted-text)]",
						)}
					>
						{location}
					</code>
					{thread.severity ? (
						<ToneBadge
							tone={
								thread.severity === "critical" || thread.severity === "major"
									? "danger"
									: "muted"
							}
							className={smallBadge}
						>
							{SEVERITY_LABELS[thread.severity]}
						</ToneBadge>
					) : null}
					{entry.state === "attention" && entry.reason ? (
						<ToneBadge tone="warning" className={smallBadge}>
							{REASON_LABELS[entry.reason]}
						</ToneBadge>
					) : null}
					{thread.isOutdated && !thread.isResolved ? (
						<ToneBadge
							tone="muted"
							className={smallBadge}
							title="The code changed after this comment"
						>
							Outdated
						</ToneBadge>
					) : null}
					{entry.quiet ? (
						<ToneBadge
							tone="muted"
							className={smallBadge}
							title="No activity for a while"
						>
							Quiet
						</ToneBadge>
					) : null}
					<span className="ml-auto shrink-0 pl-2 text-[11px] text-[var(--muted-text)] tabular-nums">
						{formatAge(now - thread.lastCommentAt)}
					</span>
				</span>
				<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text)]">
					<GitHubAvatar
						login={thread.startedBy?.login ?? "?"}
						avatarUrl={thread.startedBy?.avatarUrl ?? null}
						size={14}
					/>
					<span
						className={cn("min-w-0 truncate", entry.unseen && "font-medium")}
					>
						{thread.preview || "Comment"}
					</span>
					{thread.replyCount ? (
						<span className="ml-auto inline-flex shrink-0 items-center gap-0.5 pl-1 text-[11px] text-[var(--muted-text)]">
							<MessageSquare className="h-3 w-3" aria-hidden="true" />
							{thread.replyCount}
						</span>
					) : null}
				</span>
			</button>
			{task ? (
				<span className="relative z-10 shrink-0 self-center">
					<ReviewTaskChip task={task} />
				</span>
			) : null}
		</li>
	);
}

/** Open pull requests waiting on the viewer's review, longest waiting first. */
export function ReviewRequestsList({
	projectId,
	pullRequests,
	now,
}: {
	projectId: Id<"projects">;
	pullRequests: InboxPullRequest[];
	now: number;
}) {
	if (!pullRequests.length) {
		return (
			<p className="m-0 p-6 text-center text-sm text-[var(--muted-text)]">
				No open pull requests are waiting on your review.
			</p>
		);
	}
	return (
		<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
			{pullRequests.map((pr) => {
				const open = pr.threads.filter((thread) => !thread.isResolved).length;
				return (
					<li key={pr.number} className="flex items-center gap-3 px-4 py-3">
						<GitHubAvatar
							login={pr.author?.login ?? "?"}
							avatarUrl={pr.author?.avatarUrl ?? null}
							size={28}
						/>
						<div className="min-w-0 flex-1">
							<Link
								to="/projects/$projectId/pulls/$pullNumber"
								params={{ projectId, pullNumber: String(pr.number) }}
								className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--text)] no-underline"
							>
								<PullRequestStateIcon
									pullRequest={{ state: "open", isDraft: pr.isDraft }}
									className="h-4 w-4 shrink-0"
								/>
								<span className="truncate">{pr.title}</span>
								<span className="shrink-0 font-normal text-[var(--muted-text)]">
									#{pr.number}
								</span>
							</Link>
							<p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted-text)]">
								<span>{pr.author?.login ?? "Someone"}</span>
								<span>opened {formatAge(now - pr.createdAt)} ago</span>
								{open ? (
									<span className="inline-flex items-center gap-1">
										<MessagesSquare className="h-3 w-3" aria-hidden="true" />
										{open} open conversation{open === 1 ? "" : "s"}
									</span>
								) : null}
							</p>
						</div>
						<Link
							to="/projects/$projectId/pulls/$pullNumber"
							params={{ projectId, pullNumber: String(pr.number) }}
							className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--text)] no-underline hover:bg-[var(--surface-muted)]"
						>
							Review
							<ArrowUpRight className="h-3.5 w-3.5" />
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
