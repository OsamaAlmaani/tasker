import { useAction } from "convex/react";
import {
	CircleCheck,
	CircleDot,
	CircleMinus,
	CircleX,
	ExternalLink,
	FileDiff,
	GitMerge,
	ListTodo,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	allowedMergeMethods,
	checkStateDisplay,
	checksDisplay,
	MERGE_METHOD_LABELS,
	type MergeMethod,
	mergeReadiness,
	type PullRequestDetail as PullRequestDetailData,
	reviewDecisionDisplay,
} from "../pullRequestDisplay";
import {
	GitHubAvatar,
	GitHubLabelChip,
	PullRequestStateBadge,
	ToneBadge,
	toneTextClasses,
} from "./GitHubBadges";
import { MarkdownEditor } from "./GitHubContent";
import { LinkedTasksCard } from "./LinkedTasksCard";
import {
	type ConversationFilters,
	ConversationsCard,
	collectThreads,
	PullRequestConversation,
	threadStartedByBot,
} from "./PullRequestConversation";
import { TrackThreadsDialog, useReviewTasks } from "./ReviewTasks";

type Notice = { tone: "success" | "danger"; message: string } | null;

const FILTERS_STORAGE_KEY = "tasker:pull-request-filters";
const DEFAULT_FILTERS: ConversationFilters = {
	hideBots: false,
	hideResolved: false,
	hideTracked: false,
};

/** Remembers this viewer's conversation filters in the browser. */
function useConversationFilters() {
	const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);
	useEffect(() => {
		try {
			const stored = JSON.parse(
				window.localStorage.getItem(FILTERS_STORAGE_KEY) ?? "null",
			) as Partial<ConversationFilters> | null;
			if (stored) {
				setFilters({
					hideBots: stored.hideBots === true,
					hideResolved: stored.hideResolved === true,
					hideTracked: stored.hideTracked === true,
				});
			}
		} catch {}
	}, []);
	const update = useCallback((next: ConversationFilters) => {
		setFilters(next);
		try {
			window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
		} catch {}
	}, []);
	return [filters, update] as const;
}

export function PullRequestDetail({
	projectId,
	repository,
	pullRequest,
	canWrite,
	isRefreshing,
	onRefresh,
	initialThreadId = null,
}: {
	projectId: Id<"projects">;
	/** `owner/name` of the linked repository. */
	repository: string;
	pullRequest: PullRequestDetailData;
	canWrite: boolean;
	isRefreshing: boolean;
	onRefresh: () => Promise<void>;
	/** Conversation to scroll to on load, from `?thread=`. */
	initialThreadId?: string | null;
}) {
	const setPullRequestState = useAction(api.githubActions.setPullRequestState);
	const setPullRequestDraft = useAction(api.githubActions.setPullRequestDraft);
	const [notice, setNotice] = useState<Notice>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [confirmClose, setConfirmClose] = useState(false);
	const [filters, setFilters] = useConversationFilters();
	const [focusedThreadId, setFocusedThreadId] = useState<string | null>(
		initialThreadId,
	);
	const clearFocusedThread = useCallback(() => setFocusedThreadId(null), []);
	const html = { repository, projectId };
	const reviewTasks = useReviewTasks(
		projectId,
		pullRequest.number,
		pullRequest.author?.login ?? null,
	);
	const [trackTarget, setTrackTarget] = useState<string[] | null>(null);
	const threads = useMemo(
		() => collectThreads(pullRequest.timeline),
		[pullRequest.timeline],
	);
	const onTrack =
		canWrite && reviewTasks.data?.canWrite
			? (threadIds: string[]) => setTrackTarget(threadIds)
			: null;
	const trackThreads = trackTarget
		? threads.filter(
				(thread) =>
					trackTarget.includes(thread.id) &&
					!reviewTasks.byThread.has(thread.id),
			)
		: [];

	// A focused conversation hidden by a filter shows the filtered items again.
	useEffect(() => {
		if (!focusedThreadId) return;
		const thread = threads.find((item) => item.id === focusedThreadId);
		if (!thread) return;
		const showResolved = filters.hideResolved && thread.isResolved;
		const showBots = filters.hideBots && threadStartedByBot(thread);
		const showTracked =
			filters.hideTracked && reviewTasks.byThread.has(thread.id);
		if (showResolved || showBots || showTracked) {
			setFilters({
				hideResolved: filters.hideResolved && !showResolved,
				hideBots: filters.hideBots && !showBots,
				hideTracked: filters.hideTracked && !showTracked,
			});
		}
	}, [focusedThreadId, threads, filters, setFilters, reviewTasks.byThread]);

	async function run(
		name: string,
		task: () => Promise<unknown>,
		successMessage: string | (() => string),
		failureMessage: string,
	) {
		setBusyAction(name);
		setNotice(null);
		try {
			await task();
			setNotice({
				tone: "success",
				message:
					typeof successMessage === "function"
						? successMessage()
						: successMessage,
			});
			await onRefresh();
			return true;
		} catch (error) {
			setNotice({
				tone: "danger",
				message: getClientErrorMessage(error, failureMessage),
			});
			return false;
		} finally {
			setBusyAction(null);
		}
	}

	const isOpen = pullRequest.state === "open";
	const commitsLabel = `${pullRequest.commitCount} commit${pullRequest.commitCount === 1 ? "" : "s"}`;

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<h2 className="m-0 min-w-0 text-xl font-semibold break-words text-[var(--text)]">
						{pullRequest.title}{" "}
						<span className="font-normal text-[var(--muted-text)]">
							#{pullRequest.number}
						</span>
					</h2>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							onClick={() => void onRefresh()}
							disabled={isRefreshing}
							aria-label="Refresh pull request"
							title="Refresh"
						>
							<RefreshCw
								className={cn("h-4 w-4", isRefreshing && "animate-spin")}
							/>
						</Button>
						<a
							href={pullRequest.url}
							target="_blank"
							rel="noreferrer"
							className="no-underline"
						>
							<Button variant="secondary">
								<ExternalLink className="mr-2 h-4 w-4" />
								GitHub
							</Button>
						</a>
						{canWrite && isOpen ? (
							<Button
								variant="secondary"
								disabled={busyAction !== null}
								onClick={() =>
									void run(
										"draft",
										() =>
											setPullRequestDraft({
												projectId,
												number: pullRequest.number,
												draft: !pullRequest.isDraft,
											}),
										pullRequest.isDraft
											? "Marked ready for review."
											: "Converted to draft.",
										"Could not change draft state.",
									)
								}
							>
								{pullRequest.isDraft ? "Ready for review" : "Convert to draft"}
							</Button>
						) : null}
						{canWrite && pullRequest.state !== "merged" ? (
							<Button
								variant="ghost"
								disabled={busyAction !== null}
								onClick={() =>
									isOpen
										? setConfirmClose(true)
										: void run(
												"reopen",
												() =>
													setPullRequestState({
														projectId,
														number: pullRequest.number,
														state: "open",
													}),
												"Pull request reopened.",
												"Could not reopen the pull request.",
											)
								}
							>
								{isOpen ? "Close" : "Reopen"}
							</Button>
						) : null}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted-text)]">
					<PullRequestStateBadge pullRequest={pullRequest} />
					<span>
						<strong className="text-[var(--text)]">
							{pullRequest.author?.login ?? "Someone"}
						</strong>{" "}
						{pullRequest.state === "merged"
							? `merged ${commitsLabel}`
							: `wants to merge ${commitsLabel}`}{" "}
						into <code>{pullRequest.baseRefName}</code> from{" "}
						<code>
							{pullRequest.isCrossRepository && pullRequest.headRepository
								? `${pullRequest.headRepository}:`
								: ""}
							{pullRequest.headRefName}
						</code>
					</span>
					<span className="font-mono text-xs">
						<span className={toneTextClasses.success}>
							+{pullRequest.additions}
						</span>{" "}
						<span className={toneTextClasses.danger}>
							−{pullRequest.deletions}
						</span>
					</span>
				</div>
			</div>

			{notice ? (
				<p
					role={notice.tone === "danger" ? "alert" : "status"}
					className={cn(
						"m-0 rounded-md border px-3 py-2 text-sm",
						notice.tone === "danger"
							? "border-[color-mix(in_oklab,var(--danger)_45%,var(--line))] text-[var(--danger)]"
							: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
					)}
				>
					{notice.message}
				</p>
			) : null}

			{pullRequest.detailsHidden ? (
				<p className="m-0 text-sm text-[var(--muted-text)]">
					Some details of this pull request are hidden because your GitHub token
					can't read them.
				</p>
			) : null}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="min-w-0 space-y-4">
					<PullRequestConversation
						pullRequest={pullRequest}
						projectId={projectId}
						html={html}
						canWrite={canWrite}
						onRefresh={onRefresh}
						filters={filters}
						onFiltersChange={setFilters}
						focusedThreadId={focusedThreadId}
						onFocusHandled={clearFocusedThread}
						reviewTasks={reviewTasks.byThread}
						onTrack={onTrack}
					/>

					{/* Aligned with the conversation cards, right of the rail. */}
					<div className="space-y-4 pl-[38px] sm:pl-12">
						{canWrite && isOpen ? (
							<MergeBox
								projectId={projectId}
								pullRequest={pullRequest}
								disabled={busyAction !== null}
								run={run}
								openReviewTasks={reviewTasks.progress.fixesOpen}
							/>
						) : null}

						{canWrite ? (
							<Composer
								projectId={projectId}
								repository={repository}
								pullRequest={pullRequest}
								disabled={busyAction !== null}
								run={run}
							/>
						) : null}
					</div>
				</div>

				<div className="min-w-0 space-y-4">
					<LinkedTasksCard
						projectId={projectId}
						pullNumber={pullRequest.number}
					/>
					<ReviewSummary pullRequest={pullRequest} />
					<ConversationsCard
						pullRequest={pullRequest}
						onOpenThread={(thread) => setFocusedThreadId(thread.id)}
						reviewTasks={reviewTasks.byThread}
						progress={reviewTasks.progress}
						onTrack={onTrack}
					/>
					<ChecksCard pullRequest={pullRequest} />
					<FilesCard pullRequest={pullRequest} />
				</div>
			</div>

			{trackTarget && reviewTasks.data && trackThreads.length ? (
				<TrackThreadsDialog
					projectId={projectId}
					pullNumber={pullRequest.number}
					threads={trackThreads}
					initialSelected={trackTarget}
					data={reviewTasks.data}
					onClose={() => setTrackTarget(null)}
					onTracked={({ message, failed }) => {
						setNotice({ tone: failed ? "danger" : "success", message });
						void onRefresh();
					}}
				/>
			) : null}

			<ConfirmDialog
				open={confirmClose}
				title={`Close #${pullRequest.number}?`}
				description="The pull request is closed without merging. You can reopen it later."
				confirmLabel="Close pull request"
				confirmingLabel="Closing…"
				isConfirming={busyAction === "close"}
				onConfirm={async () => {
					await run(
						"close",
						() =>
							setPullRequestState({
								projectId,
								number: pullRequest.number,
								state: "closed",
							}),
						"Pull request closed.",
						"Could not close the pull request.",
					);
					setConfirmClose(false);
				}}
				onCancel={() => setConfirmClose(false)}
			/>
		</div>
	);
}

type RunAction = (
	name: string,
	task: () => Promise<unknown>,
	successMessage: string | (() => string),
	failureMessage: string,
) => Promise<boolean>;

function Composer({
	projectId,
	repository,
	pullRequest,
	disabled,
	run,
}: {
	projectId: Id<"projects">;
	repository: string;
	pullRequest: PullRequestDetailData;
	disabled: boolean;
	run: RunAction;
}) {
	const addComment = useAction(api.githubActions.addPullRequestComment);
	const submitReview = useAction(api.githubActions.submitPullRequestReview);
	const [body, setBody] = useState("");
	const hasBody = body.trim().length > 0;
	const canReview = pullRequest.state === "open";

	async function submit(kind: "comment" | "approve" | "request_changes") {
		const ok = await run(
			kind,
			() =>
				kind === "comment"
					? addComment({ projectId, number: pullRequest.number, body })
					: submitReview({
							projectId,
							number: pullRequest.number,
							event: kind,
							body: hasBody ? body : undefined,
						}),
			kind === "comment"
				? "Comment posted."
				: kind === "approve"
					? "Pull request approved."
					: "Changes requested.",
			kind === "comment"
				? "Could not post the comment."
				: "Could not submit the review.",
		);
		if (ok) setBody("");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Add a comment</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<MarkdownEditor
					value={body}
					onChange={setBody}
					onSubmit={() => {
						if (hasBody && !disabled) void submit("comment");
					}}
					projectId={projectId}
					context={{ repository, projectId }}
					placeholder="Leave a comment"
					label="Comment"
					disabled={disabled}
				/>
				<div className="flex flex-wrap gap-2">
					<Button
						onClick={() => void submit("comment")}
						disabled={disabled || !hasBody}
					>
						Comment
					</Button>
					{canReview ? (
						<>
							<Button
								variant="secondary"
								onClick={() => void submit("approve")}
								disabled={disabled}
							>
								<CircleCheck
									className={cn("mr-2 h-4 w-4", toneTextClasses.success)}
								/>
								Approve
							</Button>
							<Button
								variant="secondary"
								onClick={() => void submit("request_changes")}
								disabled={disabled || !hasBody}
								title={hasBody ? undefined : "Write what needs to change first"}
							>
								<CircleX
									className={cn("mr-2 h-4 w-4", toneTextClasses.danger)}
								/>
								Request changes
							</Button>
						</>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

function MergeBox({
	projectId,
	pullRequest,
	disabled,
	run,
	openReviewTasks,
}: {
	projectId: Id<"projects">;
	pullRequest: PullRequestDetailData;
	disabled: boolean;
	run: RunAction;
	/** Fix-before-merge review tasks that are not done yet. */
	openReviewTasks: number;
}) {
	const mergePullRequest = useAction(api.githubActions.mergePullRequest);
	const updateBranch = useAction(api.githubActions.updatePullRequestBranch);
	const methods = allowedMergeMethods(pullRequest.repository);
	const readiness = mergeReadiness(pullRequest);
	const defaultTitle = `${pullRequest.title} (#${pullRequest.number})`;
	const [method, setMethod] = useState<MergeMethod>(
		pullRequest.repository.defaultMergeMethod,
	);
	const [commitTitle, setCommitTitle] = useState(defaultTitle);
	const [deleteBranch, setDeleteBranch] = useState(
		pullRequest.repository.deleteBranchOnMerge,
	);
	const [confirmMerge, setConfirmMerge] = useState(false);
	const [isMerging, setIsMerging] = useState(false);

	useEffect(() => {
		setCommitTitle(defaultTitle);
	}, [defaultTitle]);

	const canDeleteBranch = !pullRequest.isCrossRepository;

	async function merge() {
		setIsMerging(true);
		let branchNote = "";
		await run(
			"merge",
			async () => {
				const result = await mergePullRequest({
					projectId,
					number: pullRequest.number,
					method,
					expectedHeadSha: pullRequest.headSha,
					commitTitle: method === "rebase" ? undefined : commitTitle,
					deleteBranch: canDeleteBranch && deleteBranch,
				});
				if (result.branchDeleted) branchNote = " Branch deleted.";
				else if (result.branchDeleteError)
					branchNote = ` Branch was not deleted: ${result.branchDeleteError}`;
			},
			() => `Pull request merged.${branchNote}`,
			"Could not merge the pull request.",
		);
		setIsMerging(false);
		setConfirmMerge(false);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center gap-2">
				<GitMerge className={cn("h-4 w-4", toneTextClasses[readiness.tone])} />
				<CardTitle>Merge</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className={cn("m-0 text-sm", toneTextClasses[readiness.tone])}>
					{readiness.message}
				</p>
				{openReviewTasks ? (
					<p
						className={cn(
							"m-0 flex items-center gap-1.5 text-sm",
							toneTextClasses.warning,
						)}
					>
						<ListTodo className="h-4 w-4 shrink-0" aria-hidden="true" />
						{openReviewTasks === 1
							? "1 review task is still open."
							: `${openReviewTasks} review tasks are still open.`}
					</p>
				) : null}
				{pullRequest.mergeStateStatus === "BEHIND" ? (
					<Button
						variant="secondary"
						size="sm"
						disabled={disabled}
						onClick={() =>
							void run(
								"update-branch",
								() =>
									updateBranch({
										projectId,
										number: pullRequest.number,
										expectedHeadSha: pullRequest.headSha,
									}),
								"Branch update started. GitHub may take a moment to finish it.",
								"Could not update the branch.",
							)
						}
					>
						Update branch
					</Button>
				) : null}
				{readiness.canMerge && methods.length ? (
					<>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="merge-method">Method</Label>
								<Select
									id="merge-method"
									value={method}
									onChange={(event) =>
										setMethod(event.target.value as MergeMethod)
									}
								>
									{methods.map((option) => (
										<option key={option} value={option}>
											{MERGE_METHOD_LABELS[option]}
										</option>
									))}
								</Select>
							</div>
							{method !== "rebase" ? (
								<div className="space-y-1">
									<Label htmlFor="merge-title">Commit title</Label>
									<Input
										id="merge-title"
										value={commitTitle}
										onChange={(event) => setCommitTitle(event.target.value)}
									/>
								</div>
							) : null}
						</div>
						{canDeleteBranch ? (
							<label className="flex items-center gap-2 text-sm text-[var(--text)]">
								<input
									type="checkbox"
									checked={deleteBranch}
									onChange={(event) => setDeleteBranch(event.target.checked)}
								/>
								Delete <code>{pullRequest.headRefName}</code> after merging
							</label>
						) : null}
						<Button onClick={() => setConfirmMerge(true)} disabled={disabled}>
							<GitMerge className="mr-2 h-4 w-4" />
							{MERGE_METHOD_LABELS[method]}
						</Button>
					</>
				) : readiness.canMerge ? (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						This repository does not allow any merge method.
					</p>
				) : null}
			</CardContent>
			<ConfirmDialog
				open={confirmMerge}
				title={`Merge #${pullRequest.number} into ${pullRequest.baseRefName}?`}
				description={`${MERGE_METHOD_LABELS[method]} on GitHub. Only the commits you are looking at are merged; if new commits were pushed, GitHub rejects the merge.`}
				confirmLabel="Merge"
				confirmingLabel="Merging…"
				confirmVariant="primary"
				isConfirming={isMerging}
				onConfirm={merge}
				onCancel={() => setConfirmMerge(false)}
			/>
		</Card>
	);
}

function ReviewSummary({
	pullRequest,
}: {
	pullRequest: PullRequestDetailData;
}) {
	const decision = reviewDecisionDisplay(pullRequest.reviewDecision);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Reviews</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				{decision ? (
					<ToneBadge tone={decision.tone}>{decision.label}</ToneBadge>
				) : (
					<p className="m-0 text-[var(--muted-text)]">No review decision.</p>
				)}
				{pullRequest.reviewRequests.length ? (
					<div className="space-y-1">
						<p className="m-0 text-xs text-[var(--muted-text)]">Requested</p>
						<p className="m-0">{pullRequest.reviewRequests.join(", ")}</p>
					</div>
				) : null}
				{pullRequest.assignees.length ? (
					<div className="space-y-1">
						<p className="m-0 text-xs text-[var(--muted-text)]">Assignees</p>
						<div className="flex flex-wrap gap-2">
							{pullRequest.assignees.map((assignee) => (
								<span
									key={assignee.login}
									className="inline-flex items-center gap-1"
								>
									<GitHubAvatar
										login={assignee.login}
										avatarUrl={assignee.avatarUrl}
										size={18}
									/>
									{assignee.login}
								</span>
							))}
						</div>
					</div>
				) : null}
				{pullRequest.labels.length ? (
					<div className="flex flex-wrap gap-1">
						{pullRequest.labels.map((label) => (
							<GitHubLabelChip
								key={label.name}
								name={label.name}
								color={label.color}
							/>
						))}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function ChecksCard({ pullRequest }: { pullRequest: PullRequestDetailData }) {
	const summary = checksDisplay(pullRequest.checks);
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle>Checks</CardTitle>
				{summary ? (
					<ToneBadge tone={summary.tone}>{summary.label}</ToneBadge>
				) : null}
			</CardHeader>
			<CardContent>
				{pullRequest.checkRuns.length ? (
					<ul className="m-0 list-none space-y-1.5 p-0 text-sm">
						{pullRequest.checkRuns.map((check) => {
							const display = checkStateDisplay(check.state);
							const Icon =
								check.state === "success"
									? CircleCheck
									: check.state === "failure"
										? CircleX
										: check.state === "pending"
											? CircleDot
											: CircleMinus;
							return (
								<li
									key={`${check.name}:${check.url ?? ""}:${check.description ?? ""}`}
									className="flex items-start gap-2"
									title={check.description ?? display.label}
								>
									<Icon
										className={cn(
											"mt-0.5 h-4 w-4 shrink-0",
											toneTextClasses[display.tone],
										)}
									/>
									<span className="min-w-0 flex-1 break-words">
										{check.url ? (
											<a href={check.url} target="_blank" rel="noreferrer">
												{check.name}
											</a>
										) : (
											check.name
										)}
									</span>
								</li>
							);
						})}
					</ul>
				) : pullRequest.checksHidden ? null : (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						No checks reported for the latest commit.
					</p>
				)}
				{pullRequest.checksHidden ? (
					<p className="m-0 mt-2 text-xs text-[var(--muted-text)]">
						Some checks are hidden because your GitHub token can't read them.
						Fine-grained tokens can't read GitHub check runs; a classic token
						with the <code>repo</code> scope can.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function FilesCard({ pullRequest }: { pullRequest: PullRequestDetailData }) {
	const [expanded, setExpanded] = useState(false);
	const files = expanded ? pullRequest.files : pullRequest.files.slice(0, 12);
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="flex items-center gap-2">
					<FileDiff className="h-4 w-4" />
					Files changed
				</CardTitle>
				<a
					href={`${pullRequest.url}/files`}
					target="_blank"
					rel="noreferrer"
					className="text-xs"
				>
					{pullRequest.fileCount} on GitHub
				</a>
			</CardHeader>
			<CardContent>
				{files.length ? (
					<ul className="m-0 list-none space-y-1 p-0 text-xs">
						{files.map((file) => (
							<li key={file.path} className="flex items-center gap-2">
								<span
									className="min-w-0 flex-1 truncate font-mono"
									title={file.path}
								>
									{file.path}
								</span>
								<span className={cn("font-mono", toneTextClasses.success)}>
									+{file.additions}
								</span>
								<span className={cn("font-mono", toneTextClasses.danger)}>
									−{file.deletions}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className="m-0 text-sm text-[var(--muted-text)]">No files.</p>
				)}
				{pullRequest.files.length > 12 ? (
					<Button
						variant="ghost"
						size="sm"
						className="mt-2"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? "Show fewer" : `Show all ${pullRequest.files.length}`}
					</Button>
				) : null}
			</CardContent>
		</Card>
	);
}
