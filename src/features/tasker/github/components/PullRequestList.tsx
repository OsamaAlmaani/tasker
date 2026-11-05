import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	CircleCheck,
	CircleDot,
	CircleX,
	ExternalLink,
	MessageSquare,
	RefreshCw,
	Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	checksDisplay,
	filterPullRequests,
	PULL_REQUEST_STATE_FILTERS,
	type PullRequestStateFilter,
	type PullRequestSummary,
	reviewDecisionDisplay,
} from "../pullRequestDisplay";
import { useGitHubData } from "../useGitHubData";
import {
	GitHubAvatar,
	GitHubLabelChip,
	PullRequestStateIcon,
	ToneBadge,
	toneTextClasses,
} from "./GitHubBadges";

export function ChecksIcon({
	checks,
}: {
	checks: PullRequestSummary["checks"];
}) {
	const display = checksDisplay(checks);
	if (!display) return null;
	const Icon =
		checks === "success"
			? CircleCheck
			: checks === "failure"
				? CircleX
				: CircleDot;
	return (
		<span title={display.label} className="inline-flex">
			<Icon className={cn("h-4 w-4", toneTextClasses[display.tone])} />
			<span className="sr-only">{display.label}</span>
		</span>
	);
}

export function PullRequestList({
	projectId,
	repository,
	stateFilter,
	onStateFilterChange,
}: {
	projectId: Id<"projects">;
	repository: { fullName: string; htmlUrl: string; liveVersion?: number };
	stateFilter: PullRequestStateFilter;
	onStateFilterChange: (state: PullRequestStateFilter) => void;
}) {
	const listPullRequests = useAction(api.githubActions.listPullRequests);
	const [search, setSearch] = useState("");
	const [morePages, setMorePages] = useState<PullRequestSummary[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

	const firstPage = useGitHubData(
		`pulls:${projectId}:${repository.fullName}:${stateFilter}`,
		() => listPullRequests({ projectId, state: stateFilter }),
		"Could not load pull requests from GitHub.",
		repository.liveVersion,
	);

	// Each fresh first page restarts pagination.
	useEffect(() => {
		setMorePages([]);
		setNextCursor(firstPage.data?.nextCursor ?? null);
		setLoadMoreError(null);
	}, [firstPage.data]);

	async function loadMore() {
		if (!nextCursor) return;
		setIsLoadingMore(true);
		setLoadMoreError(null);
		try {
			const page = await listPullRequests({
				projectId,
				state: stateFilter,
				cursor: nextCursor,
			});
			setMorePages((previous) => [...previous, ...page.items]);
			setNextCursor(page.nextCursor);
		} catch (error) {
			setLoadMoreError(
				getClientErrorMessage(error, "Could not load more pull requests."),
			);
		} finally {
			setIsLoadingMore(false);
		}
	}

	const allPullRequests = useMemo(
		() => [...(firstPage.data?.items ?? []), ...morePages],
		[firstPage.data, morePages],
	);
	const visiblePullRequests = useMemo(
		() => filterPullRequests(allPullRequests, search),
		[allPullRequests, search],
	);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<div
					className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-0.5"
					role="tablist"
					aria-label="Pull request state"
				>
					{PULL_REQUEST_STATE_FILTERS.map((filter) => (
						<button
							key={filter.value}
							type="button"
							role="tab"
							aria-selected={stateFilter === filter.value}
							className={cn(
								"rounded px-3 py-1 text-sm transition-colors",
								stateFilter === filter.value
									? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm"
									: "bg-transparent text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
							onClick={() => onStateFilterChange(filter.value)}
						>
							{filter.label}
						</button>
					))}
				</div>
				<div className="relative min-w-[200px] flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-text)]" />
					<Input
						className="pl-9"
						placeholder="Filter by title, #number, author, branch or label"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						aria-label="Filter pull requests"
					/>
				</div>
				<Button
					variant="secondary"
					onClick={() => void firstPage.refetch()}
					disabled={firstPage.isLoading}
					aria-label="Refresh pull requests"
					title="Refresh"
				>
					<RefreshCw
						className={cn("h-4 w-4", firstPage.isLoading && "animate-spin")}
					/>
				</Button>
				<a
					href={`${repository.htmlUrl}/pulls`}
					target="_blank"
					rel="noreferrer"
					className="no-underline"
				>
					<Button variant="ghost">
						<ExternalLink className="mr-2 h-4 w-4" />
						GitHub
					</Button>
				</a>
			</div>

			{firstPage.error ? (
				<Card>
					<CardContent className="space-y-2 p-4">
						<p className="m-0 text-sm text-[var(--danger)]" role="alert">
							{firstPage.error}
						</p>
						<Link
							to="/projects/$projectId/github"
							params={{ projectId }}
							className="text-sm"
						>
							Check GitHub settings
						</Link>
					</CardContent>
				</Card>
			) : null}

			<Card className="overflow-hidden">
				{firstPage.data === undefined && firstPage.isLoading ? (
					<p className="m-0 p-4 text-sm text-[var(--muted-text)]">
						Loading pull requests…
					</p>
				) : visiblePullRequests.length === 0 && !firstPage.error ? (
					<p className="m-0 p-6 text-center text-sm text-[var(--muted-text)]">
						{search
							? "No loaded pull requests match this filter."
							: stateFilter === "open"
								? "No open pull requests."
								: "No pull requests here."}
					</p>
				) : (
					<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
						{visiblePullRequests.map((pullRequest) => (
							<PullRequestRow
								key={pullRequest.number}
								projectId={projectId}
								pullRequest={pullRequest}
							/>
						))}
					</ul>
				)}
			</Card>

			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-text)]">
				<span>
					{firstPage.data
						? `Showing ${allPullRequests.length} of ${firstPage.data.totalCount}`
						: null}
				</span>
				{nextCursor ? (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void loadMore()}
						disabled={isLoadingMore}
					>
						{isLoadingMore ? "Loading…" : "Load more"}
					</Button>
				) : null}
			</div>
			{loadMoreError ? (
				<p className="m-0 text-sm text-[var(--danger)]">{loadMoreError}</p>
			) : null}
		</div>
	);
}

function PullRequestRow({
	projectId,
	pullRequest,
}: {
	projectId: Id<"projects">;
	pullRequest: PullRequestSummary;
}) {
	const review = reviewDecisionDisplay(pullRequest.reviewDecision);
	const timestamp =
		pullRequest.state === "merged"
			? `merged ${formatRelative(pullRequest.mergedAt ?? pullRequest.updatedAt)}`
			: pullRequest.state === "closed"
				? `closed ${formatRelative(pullRequest.closedAt ?? pullRequest.updatedAt)}`
				: `opened ${formatRelative(pullRequest.createdAt)}`;

	return (
		<li>
			<Link
				to="/projects/$projectId/pulls/$pullNumber"
				params={{ projectId, pullNumber: String(pullRequest.number) }}
				className="flex items-start gap-3 px-4 py-3 text-[var(--text)] no-underline transition-colors hover:bg-[var(--surface-muted)]"
			>
				<PullRequestStateIcon pullRequest={pullRequest} className="mt-0.5" />
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium break-words">{pullRequest.title}</span>
						{pullRequest.labels.map((label) => (
							<GitHubLabelChip
								key={label.name}
								name={label.name}
								color={label.color}
							/>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-text)]">
						<span>#{pullRequest.number}</span>
						<span>
							{timestamp}
							{pullRequest.author ? ` by ${pullRequest.author.login}` : ""}
						</span>
						<span className="max-w-full truncate font-mono">
							{pullRequest.headRefName} → {pullRequest.baseRefName}
						</span>
						{pullRequest.isDraft && pullRequest.state === "open" ? (
							<ToneBadge tone="muted">Draft</ToneBadge>
						) : null}
						{pullRequest.state === "open" && review ? (
							<ToneBadge tone={review.tone}>{review.label}</ToneBadge>
						) : null}
						{pullRequest.state === "open" &&
						pullRequest.mergeable === "conflicting" ? (
							<ToneBadge tone="danger">Conflicts</ToneBadge>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted-text)]">
					<ChecksIcon checks={pullRequest.checks} />
					<span className="hidden font-mono sm:inline">
						<span className={toneTextClasses.success}>
							+{pullRequest.additions}
						</span>{" "}
						<span className={toneTextClasses.danger}>
							−{pullRequest.deletions}
						</span>
					</span>
					{pullRequest.commentCount ? (
						<span className="inline-flex items-center gap-1">
							<MessageSquare className="h-3.5 w-3.5" />
							{pullRequest.commentCount}
						</span>
					) : null}
					<span className="hidden -space-x-1 md:flex">
						{pullRequest.assignees.slice(0, 3).map((assignee) => (
							<GitHubAvatar
								key={assignee.login}
								login={assignee.login}
								avatarUrl={assignee.avatarUrl}
							/>
						))}
					</span>
				</div>
			</Link>
		</li>
	);
}
