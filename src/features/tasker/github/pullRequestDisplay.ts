import type {
	CheckState,
	ChecksSummary,
	MergeMethod,
	PullRequestDetail,
	PullRequestStateFilter,
	PullRequestSummary,
	ReviewDecision,
} from "#convex/lib/githubApi";

export type {
	CheckState,
	ChecksSummary,
	MergeMethod,
	PullRequestDetail,
	PullRequestStateFilter,
	PullRequestSummary,
	ReviewDecision,
};

export const PULL_REQUEST_STATE_FILTERS: Array<{
	value: PullRequestStateFilter;
	label: string;
}> = [
	{ value: "open", label: "Open" },
	{ value: "merged", label: "Merged" },
	{ value: "closed", label: "Closed" },
	{ value: "all", label: "All" },
];

export function parsePullRequestStateFilter(
	value: unknown,
): PullRequestStateFilter {
	return value === "closed" || value === "merged" || value === "all"
		? value
		: "open";
}

export type DisplayTone = "success" | "danger" | "warning" | "info" | "muted";

export function pullRequestStateDisplay(
	pullRequest: Pick<PullRequestSummary, "state" | "isDraft">,
): { label: string; tone: DisplayTone } {
	if (pullRequest.state === "merged") return { label: "Merged", tone: "info" };
	if (pullRequest.state === "closed")
		return { label: "Closed", tone: "danger" };
	if (pullRequest.isDraft) return { label: "Draft", tone: "muted" };
	return { label: "Open", tone: "success" };
}

export function checksDisplay(
	checks: ChecksSummary,
): { label: string; tone: DisplayTone } | null {
	switch (checks) {
		case "success":
			return { label: "Checks passed", tone: "success" };
		case "failure":
			return { label: "Checks failing", tone: "danger" };
		case "pending":
			return { label: "Checks running", tone: "warning" };
		default:
			return null;
	}
}

export function checkStateDisplay(state: CheckState): {
	label: string;
	tone: DisplayTone;
} {
	switch (state) {
		case "success":
			return { label: "Passed", tone: "success" };
		case "failure":
			return { label: "Failed", tone: "danger" };
		case "pending":
			return { label: "Running", tone: "warning" };
		case "skipped":
			return { label: "Skipped", tone: "muted" };
		default:
			return { label: "Neutral", tone: "muted" };
	}
}

export function reviewDecisionDisplay(
	decision: ReviewDecision,
): { label: string; tone: DisplayTone } | null {
	switch (decision) {
		case "approved":
			return { label: "Approved", tone: "success" };
		case "changes_requested":
			return { label: "Changes requested", tone: "danger" };
		case "review_required":
			return { label: "Review required", tone: "warning" };
		default:
			return null;
	}
}

export function reviewStateLabel(state: string) {
	switch (state) {
		case "APPROVED":
			return "approved these changes";
		case "CHANGES_REQUESTED":
			return "requested changes";
		case "DISMISSED":
			return "left a review (dismissed)";
		default:
			return "reviewed";
	}
}

/**
 * Explains whether GitHub will accept a merge right now, based on
 * `mergeStateStatus`. `canMerge` is advisory: GitHub has the final say.
 */
export function mergeReadiness(
	pullRequest: Pick<
		PullRequestDetail,
		"state" | "isDraft" | "mergeable" | "mergeStateStatus"
	>,
): { canMerge: boolean; tone: DisplayTone; message: string } {
	if (pullRequest.state === "merged") {
		return {
			canMerge: false,
			tone: "info",
			message: "This pull request was merged.",
		};
	}
	if (pullRequest.state === "closed") {
		return {
			canMerge: false,
			tone: "muted",
			message: "This pull request is closed.",
		};
	}
	if (pullRequest.isDraft || pullRequest.mergeStateStatus === "DRAFT") {
		return {
			canMerge: false,
			tone: "muted",
			message: "Draft pull requests must be marked ready for review first.",
		};
	}
	if (
		pullRequest.mergeable === "conflicting" ||
		pullRequest.mergeStateStatus === "DIRTY"
	) {
		return {
			canMerge: false,
			tone: "danger",
			message:
				"This branch has conflicts that must be resolved on GitHub or locally.",
		};
	}
	switch (pullRequest.mergeStateStatus) {
		case "CLEAN":
		case "HAS_HOOKS":
			return {
				canMerge: true,
				tone: "success",
				message: "Ready to merge.",
			};
		case "UNSTABLE":
			return {
				canMerge: true,
				tone: "warning",
				message: "Some non-required checks are failing or still running.",
			};
		case "BEHIND":
			return {
				canMerge: true,
				tone: "warning",
				message:
					"This branch is behind its base. Update it, or merge if branch rules allow it.",
			};
		case "BLOCKED":
			return {
				canMerge: true,
				tone: "warning",
				message:
					"Branch rules are blocking this merge (required reviews or checks). Admins may still be able to merge.",
			};
		default:
			return {
				canMerge: true,
				tone: "muted",
				message: "GitHub is still checking whether this can be merged.",
			};
	}
}

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
	merge: "Create a merge commit",
	squash: "Squash and merge",
	rebase: "Rebase and merge",
};

export function allowedMergeMethods(
	repository: PullRequestDetail["repository"],
): MergeMethod[] {
	const methods: MergeMethod[] = [];
	if (repository.mergeCommitAllowed) methods.push("merge");
	if (repository.squashMergeAllowed) methods.push("squash");
	if (repository.rebaseMergeAllowed) methods.push("rebase");
	return methods;
}

export function filterPullRequests<T extends PullRequestSummary>(
	pullRequests: T[],
	search: string,
) {
	const query = search.trim().toLowerCase();
	if (!query) return pullRequests;
	const number = query.replace(/^#/, "");
	return pullRequests.filter(
		(pullRequest) =>
			String(pullRequest.number) === number ||
			pullRequest.title.toLowerCase().includes(query) ||
			pullRequest.headRefName.toLowerCase().includes(query) ||
			pullRequest.author?.login.toLowerCase().includes(query) ||
			pullRequest.labels.some((label) =>
				label.name.toLowerCase().includes(query),
			),
	);
}
