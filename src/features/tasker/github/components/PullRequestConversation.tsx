import { useAction } from "convex/react";
import {
	ArrowUpRight,
	Check,
	ChevronRight,
	CircleCheck,
	CircleX,
	Eye,
	FileCode2,
	GitCommitHorizontal,
	MessagesSquare,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type {
	GitHubActor,
	PullRequestComment,
	PullRequestReviewThread,
	PullRequestTimelineItem,
} from "#convex/lib/githubApi";
import { parseDiffHunk } from "../diffHunk";
import { type GitHubHtmlContext, githubHtmlToText } from "../githubHtml";
import {
	type PullRequestDetail as PullRequestDetailData,
	reviewStateLabel,
} from "../pullRequestDisplay";
import { GitHubAvatar, ToneBadge, toneTextClasses } from "./GitHubBadges";
import { GitHubHtml, GitHubReactions, MarkdownEditor } from "./GitHubContent";

export type ConversationFilters = { hideBots: boolean; hideResolved: boolean };

type ReviewItem = Extract<PullRequestTimelineItem, { kind: "review" }>;
type CommentItem = Extract<PullRequestTimelineItem, { kind: "comment" }>;
type CommitItem = Extract<PullRequestTimelineItem, { kind: "commit" }>;

type Entry =
	| { kind: "comment"; key: string; item: CommentItem }
	| {
			kind: "review";
			key: string;
			item: ReviewItem;
			threads: PullRequestReviewThread[];
	  }
	| { kind: "thread"; key: string; thread: PullRequestReviewThread }
	| { kind: "commits"; key: string; commits: CommitItem[] };

type ConversationContext = {
	projectId: Id<"projects">;
	number: number;
	canWrite: boolean;
	html: GitHubHtmlContext;
	onRefresh: () => Promise<void>;
	focusedThreadId: string | null;
	onFocusHandled: () => void;
};

const DIFF_CONTEXT_LINES = 6;

export function collectThreads(
	timeline: PullRequestTimelineItem[],
): PullRequestReviewThread[] {
	return timeline.flatMap((item) =>
		item.kind === "review"
			? item.threads
			: item.kind === "thread"
				? [item.thread]
				: [],
	);
}

export function threadStartedByBot(thread: PullRequestReviewThread) {
	return thread.comments[0]?.author?.isBot ?? false;
}

function buildEntries(
	timeline: PullRequestTimelineItem[],
	filters: ConversationFilters,
) {
	const entries: Entry[] = [];
	let hiddenBots = 0;
	let hiddenResolved = 0;
	const keepThread = (thread: PullRequestReviewThread) => {
		if (filters.hideResolved && thread.isResolved) {
			hiddenResolved += 1;
			return false;
		}
		return true;
	};

	for (const item of timeline) {
		if (item.kind === "commit") {
			const last = entries.at(-1);
			if (last?.kind === "commits") last.commits.push(item);
			else entries.push({ kind: "commits", key: item.id, commits: [item] });
			continue;
		}
		if (item.kind === "comment") {
			if (filters.hideBots && item.author?.isBot) hiddenBots += 1;
			else entries.push({ kind: "comment", key: item.id, item });
			continue;
		}
		if (item.kind === "thread") {
			if (filters.hideBots && threadStartedByBot(item.thread)) hiddenBots += 1;
			else if (keepThread(item.thread))
				entries.push({ kind: "thread", key: item.id, thread: item.thread });
			continue;
		}
		if (filters.hideBots && item.author?.isBot) {
			hiddenBots += 1;
			continue;
		}
		const threads = item.threads.filter(keepThread);
		// A plain "commented" review whose threads are all hidden says nothing.
		if (
			!threads.length &&
			item.threads.length &&
			item.state === "COMMENTED" &&
			!item.bodyHtml.trim()
		) {
			continue;
		}
		entries.push({ kind: "review", key: item.id, item, threads });
	}
	return { entries, hiddenBots, hiddenResolved };
}

function fileParts(path: string) {
	const index = path.lastIndexOf("/");
	return index === -1
		? { directory: "", file: path }
		: { directory: path.slice(0, index + 1), file: path.slice(index + 1) };
}

function lineLabel(thread: PullRequestReviewThread) {
	if (thread.isFileComment || thread.line === null) return null;
	return thread.startLine
		? `Lines ${thread.startLine}–${thread.line}`
		: `Line ${thread.line}`;
}

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

// ---------------------------------------------------------------------------
// Small building blocks

function BotBadge() {
	return (
		<span className="rounded-full border border-[var(--line)] px-1.5 text-[10px] font-medium leading-4 text-[var(--muted-text)]">
			bot
		</span>
	);
}

function AuthorName({ author }: { author: GitHubActor | null }) {
	const login = author?.login ?? "ghost";
	return (
		<>
			{author?.url ? (
				<a
					href={author.url}
					target="_blank"
					rel="noopener noreferrer"
					className="font-semibold text-[var(--text)] no-underline hover:underline"
				>
					{login}
				</a>
			) : (
				<span className="font-semibold text-[var(--text)]">{login}</span>
			)}
			{author?.isBot ? <BotBadge /> : null}
		</>
	);
}

function Timestamp({
	createdAt,
	url,
}: {
	createdAt: number;
	url: string | null;
}) {
	const label = formatRelative(createdAt);
	const title = new Date(createdAt).toLocaleString();
	return url ? (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			title={`${title}. Open on GitHub`}
			className="text-[var(--muted-text)] no-underline hover:text-[var(--text)] hover:underline"
		>
			<time dateTime={new Date(createdAt).toISOString()}>{label}</time>
		</a>
	) : (
		<time
			dateTime={new Date(createdAt).toISOString()}
			title={title}
			className="text-[var(--muted-text)]"
		>
			{label}
		</time>
	);
}

/** One row of the conversation rail: a marker on the line, content beside it. */
function RailRow({
	marker,
	children,
	id,
}: {
	marker: React.ReactNode;
	children: React.ReactNode;
	id?: string;
}) {
	return (
		<li
			id={id}
			className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 sm:grid-cols-[36px_minmax(0,1fr)] sm:gap-3"
		>
			<div className="flex justify-center">{marker}</div>
			<div className="min-w-0">{children}</div>
		</li>
	);
}

function AvatarMarker({ author }: { author: GitHubActor | null }) {
	return (
		<span className="relative z-[1] mt-1 rounded-full bg-[var(--bg)] ring-4 ring-[var(--bg)]">
			<GitHubAvatar
				login={author?.login ?? "?"}
				avatarUrl={author?.avatarUrl ?? null}
				size={28}
			/>
		</span>
	);
}

function IconMarker({
	icon: Icon,
	className,
}: {
	icon: typeof Eye;
	className?: string;
}) {
	return (
		<span className="relative z-[1] mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] ring-4 ring-[var(--bg)]">
			<Icon className={cn("h-3.5 w-3.5", className)} aria-hidden="true" />
		</span>
	);
}

function CommentCard({
	header,
	comment,
	html,
	empty,
}: {
	header?: React.ReactNode;
	comment: Pick<PullRequestComment, "bodyHtml" | "reactions">;
	html: GitHubHtmlContext;
	empty?: React.ReactNode;
}) {
	return (
		<Card className="overflow-hidden">
			{header ? (
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-sm">
					{header}
				</div>
			) : null}
			<div className="px-4 py-3">
				<GitHubHtml
					html={comment.bodyHtml}
					context={html}
					collapsible
					empty={empty}
				/>
				<GitHubReactions reactions={comment.reactions} className="mt-3" />
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Inline review threads

function DiffSnippet({ thread }: { thread: PullRequestReviewThread }) {
	const lines = useMemo(
		() =>
			parseDiffHunk(thread.diffHunk ?? "").filter(
				(line) => line.kind !== "header",
			),
		[thread.diffHunk],
	);
	const [showAll, setShowAll] = useState(false);
	if (!lines.length) return null;
	const visible = showAll ? lines : lines.slice(-DIFF_CONTEXT_LINES);
	const hidden = lines.length - visible.length;
	const end = thread.line;
	const start = thread.startLine ?? end;
	const inRange = (value: number | null) =>
		value !== null &&
		start !== null &&
		end !== null &&
		value >= start &&
		value <= end;
	const marked = visible.map(
		(line) =>
			inRange(line.newLine) ||
			(line.kind === "deletion" && inRange(line.oldLine)),
	);
	// Outdated threads may point at lines that moved; mark the commented line.
	if (!marked.some(Boolean)) marked[marked.length - 1] = true;

	return (
		<div className="border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-muted)_75%,transparent)]">
			{hidden > 0 ? (
				<button
					type="button"
					onClick={() => setShowAll(true)}
					className="block w-full border-b border-[var(--line)] px-4 py-1 text-left text-xs text-[var(--accent)] hover:bg-[var(--surface-muted)]"
				>
					Show {hidden} more line{hidden === 1 ? "" : "s"} of context
				</button>
			) : null}
			<div className="overflow-x-auto">
				<table className="w-full border-collapse font-mono text-[12px] leading-5">
					<tbody>
						{visible.map((line, index) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond position
								key={index}
								className={cn(
									line.kind === "addition" &&
										"bg-[rgba(16,185,129,0.12)] dark:bg-[rgba(52,211,153,0.12)]",
									line.kind === "deletion" &&
										"bg-[rgba(244,63,94,0.1)] dark:bg-[rgba(251,113,133,0.12)]",
									marked[index] && "shadow-[inset_3px_0_0_var(--accent)]",
								)}
							>
								<td className="w-px select-none whitespace-nowrap px-2 text-right text-[var(--muted-text)] opacity-70">
									{line.oldLine ?? ""}
								</td>
								<td className="w-px select-none whitespace-nowrap px-2 text-right text-[var(--muted-text)] opacity-70">
									{line.newLine ?? ""}
								</td>
								<td
									className={cn(
										"w-4 select-none text-center",
										line.kind === "addition"
											? toneTextClasses.success
											: line.kind === "deletion"
												? toneTextClasses.danger
												: "text-transparent",
									)}
									aria-hidden="true"
								>
									{line.kind === "addition"
										? "+"
										: line.kind === "deletion"
											? "−"
											: " "}
								</td>
								<td className="whitespace-pre pr-4 text-[var(--text)] [tab-size:4]">
									{line.text || " "}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ThreadReply({
	thread,
	context,
	onPosted,
}: {
	thread: PullRequestReviewThread;
	context: ConversationContext;
	onPosted: () => Promise<void>;
}) {
	const reply = useAction(api.githubActions.replyToReviewThread);
	const [open, setOpen] = useState(false);
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasBody = body.trim().length > 0;

	async function submit() {
		if (!hasBody || busy) return;
		setBusy(true);
		setError(null);
		try {
			await reply({
				projectId: context.projectId,
				number: context.number,
				threadId: thread.id,
				body,
			});
			setBody("");
			setOpen(false);
			await onPosted();
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not post the reply."));
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="h-9 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-left text-sm text-[var(--muted-text)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
			>
				Reply…
			</button>
		);
	}

	return (
		<div className="w-full space-y-2">
			<MarkdownEditor
				value={body}
				onChange={setBody}
				onSubmit={() => void submit()}
				projectId={context.projectId}
				context={context.html}
				placeholder="Reply to this conversation"
				label="Reply"
				autoFocus
				compact
				disabled={busy}
			/>
			{error ? (
				<p role="alert" className="m-0 text-sm text-[var(--danger)]">
					{error}
				</p>
			) : null}
			<div className="flex justify-end gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => {
						setOpen(false);
						setError(null);
					}}
				>
					Cancel
				</Button>
				<Button
					size="sm"
					disabled={!hasBody || busy}
					onClick={() => void submit()}
				>
					{busy ? "Replying…" : "Reply"}
				</Button>
			</div>
		</div>
	);
}

function ReviewThreadCard({
	thread,
	context,
}: {
	thread: PullRequestReviewThread;
	context: ConversationContext;
}) {
	const setResolved = useAction(api.githubActions.setReviewThreadResolved);
	const [expanded, setExpanded] = useState(!thread.isResolved);
	const [highlighted, setHighlighted] = useState(false);
	const [resolving, setResolving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const { directory, file } = fileParts(thread.path);
	const line = lineLabel(thread);
	const firstUrl = thread.comments[0]?.url ?? null;
	const participants = [
		...new Map(
			thread.comments
				.filter((comment) => comment.author)
				.map((comment) => [comment.author?.login, comment.author]),
		).values(),
	] as GitHubActor[];
	const { focusedThreadId, onFocusHandled } = context;

	useEffect(() => {
		if (focusedThreadId !== thread.id) return;
		setExpanded(true);
		setHighlighted(true);
		onFocusHandled();
		window.requestAnimationFrame(() => {
			cardRef.current?.scrollIntoView({
				behavior: prefersReducedMotion() ? "auto" : "smooth",
				block: "start",
			});
			cardRef.current?.focus({ preventScroll: true });
		});
	}, [focusedThreadId, thread.id, onFocusHandled]);

	useEffect(() => {
		if (!highlighted) return;
		const timer = window.setTimeout(() => setHighlighted(false), 1800);
		return () => window.clearTimeout(timer);
	}, [highlighted]);

	const canReply = context.canWrite && thread.viewerCanReply;
	const canToggleResolved =
		context.canWrite &&
		(thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve);

	async function toggleResolved() {
		setResolving(true);
		setError(null);
		try {
			await setResolved({
				projectId: context.projectId,
				number: context.number,
				threadId: thread.id,
				resolved: !thread.isResolved,
			});
			setExpanded(thread.isResolved);
			await context.onRefresh();
		} catch (caught) {
			setError(
				getClientErrorMessage(
					caught,
					thread.isResolved
						? "Could not reopen the conversation."
						: "Could not resolve the conversation.",
				),
			);
		} finally {
			setResolving(false);
		}
	}

	return (
		<div
			ref={cardRef}
			id={`thread-${thread.id}`}
			tabIndex={-1}
			className="scroll-mt-24 rounded-xl outline-none"
		>
			<Card
				className={cn(
					"overflow-hidden transition-shadow duration-500 motion-reduce:transition-none",
					highlighted &&
						"shadow-[0_0_0_2px_var(--accent),0_8px_24px_rgba(4,10,24,0.08)]",
				)}
			>
				<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1.5 sm:px-3">
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
						className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
					>
						<ChevronRight
							className={cn(
								"h-4 w-4 shrink-0 text-[var(--muted-text)] transition-transform motion-reduce:transition-none",
								expanded && "rotate-90",
							)}
							aria-hidden="true"
						/>
						<FileCode2
							className="h-4 w-4 shrink-0 text-[var(--muted-text)]"
							aria-hidden="true"
						/>
						<span className="flex min-w-0 items-baseline font-mono text-xs">
							<span className="truncate text-[var(--muted-text)]">
								{directory}
							</span>
							<span className="shrink-0 font-semibold text-[var(--text)]">
								{file}
							</span>
						</span>
						{line ? (
							<span className="shrink-0 text-xs text-[var(--muted-text)]">
								{line}
							</span>
						) : null}
					</button>
					{thread.isOutdated ? (
						<ToneBadge
							tone="warning"
							title="The code changed after this comment"
						>
							Outdated
						</ToneBadge>
					) : null}
					{thread.isResolved ? (
						<ToneBadge tone="success">Resolved</ToneBadge>
					) : null}
					{firstUrl ? (
						<a
							href={firstUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-text)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
							aria-label={`Open the conversation on ${file} in GitHub`}
							title="Open on GitHub"
						>
							<ArrowUpRight className="h-4 w-4" />
						</a>
					) : null}
				</div>

				{expanded ? (
					<>
						{!thread.isFileComment ? <DiffSnippet thread={thread} /> : null}
						<ol className="m-0 list-none p-0">
							{thread.comments.map((comment) => (
								<li
									key={comment.id}
									className="flex gap-3 border-b border-[var(--line)] px-3 py-3 last:border-b-0 sm:px-4"
								>
									<GitHubAvatar
										login={comment.author?.login ?? "?"}
										avatarUrl={comment.author?.avatarUrl ?? null}
										size={24}
									/>
									<div className="min-w-0 flex-1">
										<div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-sm">
											<AuthorName author={comment.author} />
											<Timestamp
												createdAt={comment.createdAt}
												url={comment.url}
											/>
										</div>
										<GitHubHtml
											html={comment.bodyHtml}
											context={context.html}
											collapsible
										/>
										<GitHubReactions
											reactions={comment.reactions}
											className="mt-2"
										/>
									</div>
								</li>
							))}
						</ol>
						{thread.totalComments > thread.comments.length && firstUrl ? (
							<a
								href={firstUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="block border-t border-[var(--line)] px-4 py-2 text-xs"
							>
								{thread.totalComments - thread.comments.length} more replies on
								GitHub
							</a>
						) : null}
						{canReply || canToggleResolved ? (
							<div className="flex flex-wrap items-start gap-2 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-muted)_60%,transparent)] px-3 py-2.5 sm:px-4">
								{canReply ? (
									<ThreadReply
										thread={thread}
										context={context}
										onPosted={context.onRefresh}
									/>
								) : null}
								{canToggleResolved ? (
									<Button
										variant="secondary"
										size="sm"
										className="h-9"
										disabled={resolving}
										onClick={() => void toggleResolved()}
									>
										{thread.isResolved ? null : (
											<Check
												className={cn(
													"mr-1.5 h-4 w-4",
													toneTextClasses.success,
												)}
											/>
										)}
										{resolving
											? thread.isResolved
												? "Reopening…"
												: "Resolving…"
											: thread.isResolved
												? "Unresolve"
												: "Resolve conversation"}
									</Button>
								) : null}
								{error ? (
									<p
										role="alert"
										className="m-0 w-full text-sm text-[var(--danger)]"
									>
										{error}
									</p>
								) : null}
							</div>
						) : null}
					</>
				) : (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted-text)] hover:bg-[var(--surface-muted)] sm:px-4"
					>
						<span className="flex -space-x-1.5" aria-hidden="true">
							{participants.slice(0, 4).map((author) => (
								<span
									key={author.login}
									className="rounded-full ring-2 ring-[var(--surface)]"
								>
									<GitHubAvatar
										login={author.login}
										avatarUrl={author.avatarUrl}
										size={18}
									/>
								</span>
							))}
						</span>
						<span>
							{thread.totalComments} comment
							{thread.totalComments === 1 ? "" : "s"}
							{thread.resolvedBy ? `, resolved by ${thread.resolvedBy}` : ""}
						</span>
					</button>
				)}
			</Card>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Timeline entries

function ReviewEntry({
	entry,
	context,
}: {
	entry: Extract<Entry, { kind: "review" }>;
	context: ConversationContext;
}) {
	const { item, threads } = entry;
	const tone =
		item.state === "APPROVED"
			? "success"
			: item.state === "CHANGES_REQUESTED"
				? "danger"
				: "muted";
	const icon =
		item.state === "APPROVED"
			? CircleCheck
			: item.state === "CHANGES_REQUESTED"
				? CircleX
				: Eye;
	const hiddenThreads = item.threads.length - threads.length;
	return (
		<RailRow
			marker={<IconMarker icon={icon} className={toneTextClasses[tone]} />}
		>
			<div className="space-y-2.5">
				<p className="m-0 flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
					<GitHubAvatar
						login={item.author?.login ?? "?"}
						avatarUrl={item.author?.avatarUrl ?? null}
						size={20}
					/>
					<AuthorName author={item.author} />
					<span
						className={cn(
							tone === "muted"
								? "text-[var(--muted-text)]"
								: toneTextClasses[tone],
						)}
					>
						{reviewStateLabel(item.state)}
					</span>
					<Timestamp createdAt={item.createdAt} url={item.url} />
				</p>
				{item.bodyHtml.trim() ? (
					<CommentCard comment={item} html={context.html} />
				) : null}
				{threads.map((thread) => (
					<ReviewThreadCard key={thread.id} thread={thread} context={context} />
				))}
				{hiddenThreads > 0 ? (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						{hiddenThreads} resolved conversation
						{hiddenThreads === 1 ? "" : "s"} hidden
					</p>
				) : null}
			</div>
		</RailRow>
	);
}

function CommitsEntry({ commits }: { commits: CommitItem[] }) {
	return (
		<RailRow
			marker={
				<IconMarker
					icon={GitCommitHorizontal}
					className="text-[var(--muted-text)]"
				/>
			}
		>
			<div className="pt-1">
				<p className="m-0 mb-1 text-sm text-[var(--muted-text)]">
					{commits.length === 1
						? "Added 1 commit"
						: `Added ${commits.length} commits`}
				</p>
				<ul className="m-0 list-none space-y-0.5 p-0">
					{commits.map((commit) => (
						<li
							key={commit.id}
							className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-[var(--surface-muted)]"
						>
							<GitHubAvatar
								login={commit.author?.login ?? commit.authorName ?? "?"}
								avatarUrl={commit.author?.avatarUrl ?? null}
								size={18}
							/>
							<span
								className="min-w-0 flex-1 truncate text-[var(--text)]"
								title={commit.message}
							>
								{commit.message}
							</span>
							{commit.url ? (
								<a
									href={commit.url}
									target="_blank"
									rel="noopener noreferrer"
									className="shrink-0 font-mono text-xs text-[var(--muted-text)] no-underline hover:text-[var(--text)] hover:underline"
									title={`${commit.sha}, ${new Date(commit.createdAt).toLocaleString()}`}
								>
									{commit.shortSha}
								</a>
							) : (
								<span className="shrink-0 font-mono text-xs text-[var(--muted-text)]">
									{commit.shortSha}
								</span>
							)}
						</li>
					))}
				</ul>
			</div>
		</RailRow>
	);
}

function FilterToggle({
	pressed,
	onToggle,
	children,
}: {
	pressed: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onToggle}
			className={cn(
				"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
				pressed
					? "border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--text)]"
					: "border-[var(--line)] text-[var(--muted-text)] hover:text-[var(--text)]",
			)}
		>
			{pressed ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
			{children}
		</button>
	);
}

/** The pull request description followed by its full conversation. */
export function PullRequestConversation({
	pullRequest,
	projectId,
	html,
	canWrite,
	onRefresh,
	filters,
	onFiltersChange,
	focusedThreadId,
	onFocusHandled,
}: {
	pullRequest: PullRequestDetailData;
	projectId: Id<"projects">;
	html: GitHubHtmlContext;
	canWrite: boolean;
	onRefresh: () => Promise<void>;
	filters: ConversationFilters;
	onFiltersChange: (filters: ConversationFilters) => void;
	focusedThreadId: string | null;
	onFocusHandled: () => void;
}) {
	const context: ConversationContext = {
		projectId,
		number: pullRequest.number,
		canWrite,
		html,
		onRefresh,
		focusedThreadId,
		onFocusHandled,
	};
	const { entries, hiddenBots, hiddenResolved } = buildEntries(
		pullRequest.timeline,
		filters,
	);
	const botCount = useMemo(
		() =>
			pullRequest.timeline.filter((item) =>
				item.kind === "thread"
					? threadStartedByBot(item.thread)
					: item.kind !== "commit" && item.author?.isBot,
			).length,
		[pullRequest.timeline],
	);
	const resolvedCount = useMemo(
		() =>
			collectThreads(pullRequest.timeline).filter((thread) => thread.isResolved)
				.length,
		[pullRequest.timeline],
	);

	return (
		<section aria-label="Conversation" className="space-y-3">
			{botCount || resolvedCount ? (
				<div className="flex flex-wrap items-center justify-end gap-1.5">
					{botCount ? (
						<FilterToggle
							pressed={filters.hideBots}
							onToggle={() =>
								onFiltersChange({ ...filters, hideBots: !filters.hideBots })
							}
						>
							Hide bots
							<span className="tabular-nums text-[var(--muted-text)]">
								{filters.hideBots ? hiddenBots : botCount}
							</span>
						</FilterToggle>
					) : null}
					{resolvedCount ? (
						<FilterToggle
							pressed={filters.hideResolved}
							onToggle={() =>
								onFiltersChange({
									...filters,
									hideResolved: !filters.hideResolved,
								})
							}
						>
							Hide resolved
							<span className="tabular-nums text-[var(--muted-text)]">
								{filters.hideResolved ? hiddenResolved : resolvedCount}
							</span>
						</FilterToggle>
					) : null}
				</div>
			) : null}

			<ol className="relative m-0 list-none space-y-5 p-0 before:absolute before:top-4 before:bottom-4 before:left-[13px] before:w-px before:bg-[var(--line)] sm:before:left-[17px]">
				<RailRow marker={<AvatarMarker author={pullRequest.author} />}>
					<CommentCard
						comment={{
							bodyHtml: pullRequest.bodyHtml,
							reactions: pullRequest.reactions,
						}}
						html={html}
						header={
							<>
								<AuthorName author={pullRequest.author} />
								<span className="text-[var(--muted-text)]">opened</span>
								<Timestamp
									createdAt={pullRequest.createdAt}
									url={pullRequest.url}
								/>
							</>
						}
						empty={
							<p className="m-0 text-sm text-[var(--muted-text)] italic">
								No description provided.
							</p>
						}
					/>
				</RailRow>

				{entries.map((entry) => {
					switch (entry.kind) {
						case "commits":
							return <CommitsEntry key={entry.key} commits={entry.commits} />;
						case "comment":
							return (
								<RailRow
									key={entry.key}
									marker={<AvatarMarker author={entry.item.author} />}
								>
									<CommentCard
										comment={entry.item}
										html={html}
										header={
											<>
												<AuthorName author={entry.item.author} />
												<span className="text-[var(--muted-text)]">
													commented
												</span>
												<Timestamp
													createdAt={entry.item.createdAt}
													url={entry.item.url}
												/>
											</>
										}
									/>
								</RailRow>
							);
						case "review":
							return (
								<ReviewEntry key={entry.key} entry={entry} context={context} />
							);
						case "thread":
							return (
								<RailRow
									key={entry.key}
									marker={
										<AvatarMarker
											author={entry.thread.comments[0]?.author ?? null}
										/>
									}
								>
									<ReviewThreadCard thread={entry.thread} context={context} />
								</RailRow>
							);
						default:
							return null;
					}
				})}
			</ol>

			{!entries.length ? (
				<p className="m-0 pl-12 text-sm text-[var(--muted-text)]">
					{hiddenBots || hiddenResolved
						? "Everything else is hidden by the filters above."
						: "No comments or reviews yet."}
				</p>
			) : null}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Sidebar

const CONVERSATION_LIST_LIMIT = 8;

export function ConversationsCard({
	pullRequest,
	onOpenThread,
}: {
	pullRequest: PullRequestDetailData;
	onOpenThread: (thread: PullRequestReviewThread) => void;
}) {
	const [showAll, setShowAll] = useState(false);
	const threads = useMemo(
		() => collectThreads(pullRequest.timeline),
		[pullRequest.timeline],
	);
	const open = useMemo(
		() =>
			threads
				.filter((thread) => !thread.isResolved)
				.sort((a, b) => a.createdAt - b.createdAt),
		[threads],
	);
	const snippets = useMemo(
		() =>
			new Map(
				open.map((thread) => [
					thread.id,
					githubHtmlToText(thread.comments[0]?.bodyHtml ?? "", 110),
				]),
			),
		[open],
	);
	const resolved = threads.length - open.length;
	const listed = showAll ? open : open.slice(0, CONVERSATION_LIST_LIMIT);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="flex items-center gap-2">
					<MessagesSquare className="h-4 w-4" aria-hidden="true" />
					Conversations
				</CardTitle>
				{open.length ? (
					<ToneBadge tone="warning">{open.length} open</ToneBadge>
				) : null}
			</CardHeader>
			<CardContent className="text-sm">
				{!threads.length ? (
					<p className="m-0 text-[var(--muted-text)]">
						No comments on code yet.
					</p>
				) : !open.length ? (
					<p
						className={cn(
							"m-0 flex items-center gap-1.5",
							toneTextClasses.success,
						)}
					>
						<CircleCheck className="h-4 w-4" aria-hidden="true" />
						All {threads.length} resolved
					</p>
				) : (
					<>
						<ul className="-mx-2 m-0 list-none space-y-0.5 p-0">
							{listed.map((thread) => {
								const first = thread.comments[0];
								const { file } = fileParts(thread.path);
								return (
									<li key={thread.id}>
										<button
											type="button"
											onClick={() => onOpenThread(thread)}
											className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
										>
											<span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-[var(--text)]">
												<span className="flex min-w-0" title={thread.path}>
													<span className="truncate">{file}</span>
													{thread.line !== null && !thread.isFileComment ? (
														<span className="shrink-0 text-[var(--muted-text)]">
															:{thread.line}
														</span>
													) : null}
												</span>
												{thread.isOutdated ? (
													<span className="ml-auto shrink-0 font-sans text-[10px] text-amber-600 dark:text-amber-400">
														outdated
													</span>
												) : null}
											</span>
											<span className="mt-0.5 flex items-start gap-1.5 text-xs text-[var(--muted-text)]">
												<span className="mt-px shrink-0">
													<GitHubAvatar
														login={first?.author?.login ?? "?"}
														avatarUrl={first?.author?.avatarUrl ?? null}
														size={14}
													/>
												</span>
												<span className="line-clamp-2">
													{snippets.get(thread.id) || "Comment"}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
						{open.length > CONVERSATION_LIST_LIMIT ? (
							<Button
								variant="ghost"
								size="sm"
								className="mt-1"
								onClick={() => setShowAll((value) => !value)}
							>
								{showAll ? "Show fewer" : `Show all ${open.length}`}
							</Button>
						) : null}
						{resolved ? (
							<p className="m-0 mt-2 text-xs text-[var(--muted-text)]">
								{resolved} resolved
							</p>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
