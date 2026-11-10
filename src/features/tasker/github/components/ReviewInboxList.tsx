import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessagesSquare } from "lucide-react";
import { Fragment } from "react";
import { Card, CardContent } from "#/components/ui/card";
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

/** Conversations grouped by pull request, with selection and bulk checkboxes. */
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
	renderInlineDetail,
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
	/** On narrow screens the selected conversation opens under its row. */
	renderInlineDetail: ((entry: InboxEntry) => React.ReactNode) | null;
}) {
	return (
		<div className="space-y-3">
			{groups.map((group) => {
				const pr = group.pullRequest;
				const ids = group.entries.map((entry) => entry.thread.id);
				const allChecked = ids.every((id) => checked.has(id));
				const progress = reviewTaskProgress(tasksByPull.get(pr.number) ?? []);
				const oldest = oldestOpenAge(pr, now);
				const decision = pr.reviewDecision
					? DECISION_LABELS[pr.reviewDecision]
					: null;
				return (
					<Card key={pr.number} className="overflow-hidden">
						<div className="flex items-start gap-2 border-b border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
							{canSelect ? (
								<input
									type="checkbox"
									className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
									aria-label={`Select every conversation on #${pr.number}`}
									checked={allChecked}
									onChange={() => onToggleGroup(ids, !allChecked)}
								/>
							) : null}
							<div className="min-w-0 flex-1">
								<Link
									to="/projects/$projectId/pulls/$pullNumber"
									params={{ projectId, pullNumber: String(pr.number) }}
									className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--text)] no-underline"
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
								<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted-text)]">
									<span>{pr.author?.login ?? "Someone"}</span>
									{decision ? (
										<ToneBadge tone={decision.tone}>{decision.label}</ToneBadge>
									) : null}
									{oldest !== null ? (
										<span title="Age of the oldest open conversation">
											oldest open {formatAge(oldest)}
										</span>
									) : null}
									{progress.fixes ? (
										<span>
											review tasks {progress.fixesDone}/{progress.fixes} done
										</span>
									) : null}
								</div>
							</div>
						</div>
						<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
							{group.entries.map((entry) => (
								<Fragment key={entry.thread.id}>
									<InboxRow
										entry={entry}
										task={tasksByThread.get(entry.thread.id) ?? null}
										isCurrent={entry.thread.id === currentId}
										isChecked={checked.has(entry.thread.id)}
										canSelect={canSelect}
										now={now}
										onSelect={() => onSelect(entry.thread.id)}
										onToggleChecked={() => onToggleChecked(entry.thread.id)}
									/>
									{renderInlineDetail && entry.thread.id === currentId ? (
										<li className="bg-[var(--surface-muted)] p-2">
											{renderInlineDetail(entry)}
										</li>
									) : null}
								</Fragment>
							))}
						</ul>
					</Card>
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
	return (
		<li
			id={`inbox-${thread.id}`}
			className={cn(
				"relative flex items-start gap-2 px-3 py-2.5",
				isCurrent &&
					"bg-[color-mix(in_oklab,var(--accent)_9%,transparent)] shadow-[inset_3px_0_0_var(--accent)]",
			)}
		>
			{canSelect ? (
				<input
					type="checkbox"
					className="relative z-10 mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
					aria-label={`Select the conversation on ${location}`}
					checked={isChecked}
					onChange={onToggleChecked}
				/>
			) : null}
			<span
				className={cn(
					"mt-2 h-2 w-2 shrink-0 rounded-full",
					entry.unseen ? "bg-[var(--accent)]" : "bg-transparent",
				)}
				title={entry.unseen ? "New since you last looked" : undefined}
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				<button
					type="button"
					onClick={onSelect}
					aria-current={isCurrent ? "true" : undefined}
					className="block w-full bg-transparent p-0 text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--accent)]"
				>
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						<code
							className={cn(
								"truncate text-xs",
								entry.unseen && "font-semibold text-[var(--text)]",
							)}
							title={thread.path}
						>
							{location}
						</code>
						{entry.state === "attention" && entry.reason ? (
							<ToneBadge tone="warning">
								{REASON_LABELS[entry.reason]}
							</ToneBadge>
						) : null}
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
						{thread.isOutdated && !thread.isResolved ? (
							<ToneBadge
								tone="muted"
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
					</span>
					<span className="mt-1 flex items-start gap-1.5 text-sm text-[var(--text)]">
						<span className="mt-0.5 shrink-0">
							<GitHubAvatar
								login={thread.startedBy?.login ?? "?"}
								avatarUrl={thread.startedBy?.avatarUrl ?? null}
								size={16}
							/>
						</span>
						<span className="line-clamp-2">{thread.preview || "Comment"}</span>
					</span>
					<span className="mt-1 block text-[11px] text-[var(--muted-text)]">
						{thread.startedBy?.login ?? "Someone"}
						{thread.replyCount
							? ` · ${thread.replyCount} repl${thread.replyCount === 1 ? "y" : "ies"}, last by ${thread.lastCommentBy ?? "someone"} ${formatRelative(thread.lastCommentAt)}`
							: ` · ${formatRelative(thread.startedAt)}`}
					</span>
				</button>
			</div>
			{task ? (
				<span className="relative z-10 shrink-0">
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
			<Card>
				<CardContent className="p-6 text-center text-sm text-[var(--muted-text)]">
					No open pull requests are waiting on your review.
				</CardContent>
			</Card>
		);
	}
	return (
		<Card className="overflow-hidden">
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
		</Card>
	);
}
