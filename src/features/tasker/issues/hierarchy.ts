import type { Doc } from "#convex/_generated/dataModel";

type IssueLike = Pick<Doc<"issues">, "_id" | "parentIssueId" | "status">;

type DescendantStats = {
	unfinishedDescendantCount: number;
};

export function buildDescendantStats<TIssue extends IssueLike>(rows: TIssue[]) {
	const childrenByParent = new Map<string, TIssue[]>();

	for (const issue of rows) {
		if (!issue.parentIssueId) {
			continue;
		}

		const children = childrenByParent.get(issue.parentIssueId) ?? [];
		children.push(issue);
		childrenByParent.set(issue.parentIssueId, children);
	}

	const statsByIssueId = new Map<string, DescendantStats>();

	function visit(issueId: string): DescendantStats {
		const cached = statsByIssueId.get(issueId);
		if (cached) {
			return cached;
		}

		const children = childrenByParent.get(issueId) ?? [];
		let unfinishedDescendantCount = 0;

		for (const child of children) {
			if (child.status !== "done") {
				unfinishedDescendantCount += 1;
			}

			unfinishedDescendantCount += visit(child._id).unfinishedDescendantCount;
		}

		const stats = { unfinishedDescendantCount };
		statsByIssueId.set(issueId, stats);
		return stats;
	}

	for (const issue of rows) {
		visit(issue._id);
	}

	return statsByIssueId;
}

export function findDoneAncestorIssue<TIssue extends IssueLike>(
	issue: TIssue,
	issueById: Map<string, TIssue>,
) {
	let cursor = issue.parentIssueId;

	while (cursor) {
		const parentIssue = issueById.get(cursor);
		if (!parentIssue) {
			return null;
		}
		if (parentIssue.status === "done") {
			return parentIssue;
		}

		cursor = parentIssue.parentIssueId;
	}

	return null;
}
