export type IssueChecklistItem = {
	id: string;
	text: string;
	completed: boolean;
	position: number;
};

type ChecklistProgress = {
	checklistItemCount: number;
	completedChecklistItemCount: number;
	checklistCompletionRate: number;
	hasChecklist: boolean;
};

type ChecklistProgressLike = {
	checklistItems?: IssueChecklistItem[] | null;
	checklistItemCount?: number;
	completedChecklistItemCount?: number;
	checklistCompletionRate?: number;
	hasChecklist?: boolean;
};

export function normalizeIssueChecklistItems(
	checklistItems?: IssueChecklistItem[] | null,
) {
	const seenIds = new Set<string>();

	return [...(checklistItems ?? [])]
		.sort((left, right) => left.position - right.position)
		.map((item) => ({
			id: item.id.trim(),
			text: item.text.trim(),
			completed: Boolean(item.completed),
			position: Number.isFinite(item.position) ? item.position : 0,
		}))
		.filter((item) => {
			if (!item.id || !item.text || seenIds.has(item.id)) {
				return false;
			}
			seenIds.add(item.id);
			return true;
		})
		.map((item, index) => ({
			...item,
			position: index,
		}));
}

export function createIssueChecklistItem(position: number): IssueChecklistItem {
	return {
		id: `checklist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		text: "",
		completed: false,
		position,
	};
}

export function getIssueChecklistProgress(
	issue: ChecklistProgressLike,
): ChecklistProgress {
	if (
		typeof issue.checklistItemCount === "number" &&
		typeof issue.completedChecklistItemCount === "number" &&
		typeof issue.checklistCompletionRate === "number" &&
		typeof issue.hasChecklist === "boolean"
	) {
		return {
			checklistItemCount: issue.checklistItemCount,
			completedChecklistItemCount: issue.completedChecklistItemCount,
			checklistCompletionRate: issue.checklistCompletionRate,
			hasChecklist: issue.hasChecklist,
		};
	}

	const checklistItems = normalizeIssueChecklistItems(issue.checklistItems);
	const completedChecklistItemCount = checklistItems.filter(
		(item) => item.completed,
	).length;

	return {
		checklistItemCount: checklistItems.length,
		completedChecklistItemCount,
		checklistCompletionRate: checklistItems.length
			? completedChecklistItemCount / checklistItems.length
			: 0,
		hasChecklist: checklistItems.length > 0,
	};
}

export function formatChecklistProgress(issue: ChecklistProgressLike) {
	const { hasChecklist, completedChecklistItemCount, checklistItemCount } =
		getIssueChecklistProgress(issue);
	if (!hasChecklist) {
		return null;
	}

	return `${completedChecklistItemCount}/${checklistItemCount} checked`;
}

export function roundChecklistCompletionRate(issue: ChecklistProgressLike) {
	return Math.round(
		getIssueChecklistProgress(issue).checklistCompletionRate * 100,
	);
}
