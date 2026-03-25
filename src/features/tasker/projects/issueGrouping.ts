import {
	ISSUE_STATUSES,
	type IssueStatus,
	issueStatusLabel,
} from "#/features/tasker/model";

type TreeIssueLike = {
	_id: string;
	parentIssueId?: string | null;
};

type GroupableIssueLike = TreeIssueLike & {
	listId?: string | null;
	status: IssueStatus;
};

type IssueListLike = {
	_id: string;
	name: string;
	position?: number;
};

export type IssueTreeNode<TIssue extends TreeIssueLike> = {
	issue: TIssue;
	children: IssueTreeNode<TIssue>[];
};

export function formatIssueInputDate(timestamp?: number) {
	return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

export function buildIssueTree<TIssue extends TreeIssueLike>(rows: TIssue[]) {
	const byId = new Map<string, IssueTreeNode<TIssue>>(
		rows.map((issue) => [issue._id, { issue, children: [] }]),
	);
	const roots: IssueTreeNode<TIssue>[] = [];

	for (const issue of rows) {
		const node = byId.get(issue._id);
		if (!node) {
			continue;
		}

		if (issue.parentIssueId) {
			const parentNode = byId.get(issue.parentIssueId);
			if (parentNode) {
				parentNode.children.push(node);
				continue;
			}
		}

		roots.push(node);
	}

	return roots;
}

export function buildGroupedIssues<TIssue extends GroupableIssueLike>(
	rows: TIssue[],
	groupBy: "list" | "status",
	issueListById: Map<string, IssueListLike>,
) {
	const groups = new Map<
		string,
		{
			key: string;
			title: string;
			position: number;
			items: TIssue[];
		}
	>();

	for (const issue of rows) {
		const key = groupBy === "status" ? issue.status : (issue.listId ?? "none");
		const list =
			groupBy === "list" && issue.listId
				? issueListById.get(issue.listId)
				: undefined;
		const group = groups.get(key);
		const statusPosition =
			groupBy === "status" ? ISSUE_STATUSES.indexOf(issue.status) : -1;

		if (group) {
			group.items.push(issue);
			continue;
		}

		groups.set(key, {
			key,
			title:
				groupBy === "status"
					? issueStatusLabel[issue.status]
					: (list?.name ?? "No List"),
			position:
				groupBy === "status"
					? statusPosition
					: (list?.position ?? Number.MAX_SAFE_INTEGER),
			items: [issue],
		});
	}

	return [...groups.values()]
		.sort((a, b) => {
			if (a.position !== b.position) {
				return a.position - b.position;
			}
			return a.title.localeCompare(b.title);
		})
		.map((group) => ({
			...group,
			tree: buildIssueTree(group.items),
		}));
}

export function buildKanbanColumns<TIssue extends GroupableIssueLike>(
	rows: TIssue[],
) {
	return ISSUE_STATUSES.map((status) => ({
		status,
		title: issueStatusLabel[status],
		items: rows.filter((issue) => issue.status === status),
	})).map((column) => ({
		...column,
		tree: buildIssueTree(column.items),
	}));
}
