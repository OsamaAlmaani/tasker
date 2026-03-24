import { useMemo, useState } from "react";
import type { ISSUE_STATUSES } from "#/features/tasker/model";
import { getClientErrorMessage } from "#/lib/utils";
import type { Doc, Id } from "#convex/_generated/dataModel";
import { buildDescendantStats, findDoneAncestorIssue } from "./hierarchy";

type IssueStatusIssue = Pick<
	Doc<"issues">,
	"_id" | "issueNumber" | "parentIssueId" | "status" | "title"
>;

type CompletionConfirm = {
	issueId: Id<"issues">;
	title: string;
	unfinishedDescendantCount: number;
};

type UpdateIssueStatusArgs = {
	issueId: Id<"issues">;
	status: (typeof ISSUE_STATUSES)[number];
	cascadeDescendantsToDone?: boolean;
};

type UseIssueStatusFlowOptions<TIssue extends IssueStatusIssue> = {
	issues: TIssue[] | undefined;
	updateIssue: (args: UpdateIssueStatusArgs) => Promise<unknown>;
	errorMessage?: string;
};

export function useIssueStatusFlow<TIssue extends IssueStatusIssue>({
	issues,
	updateIssue,
	errorMessage = "Failed to update task status.",
}: UseIssueStatusFlowOptions<TIssue>) {
	const [statusUpdateError, setStatusUpdateError] = useState<string | null>(
		null,
	);
	const [completionConfirm, setCompletionConfirm] =
		useState<CompletionConfirm | null>(null);
	const [isCompletingIssueTree, setIsCompletingIssueTree] = useState(false);

	const descendantStatsByIssueId = useMemo(
		() => buildDescendantStats(issues ?? []),
		[issues],
	);
	const issueById = useMemo(
		() => new Map((issues ?? []).map((issue) => [issue._id, issue])),
		[issues],
	);

	async function handleIssueStatusChange(
		issue: TIssue,
		nextStatus: (typeof ISSUE_STATUSES)[number],
	) {
		setStatusUpdateError(null);

		try {
			if (nextStatus !== "done") {
				const doneAncestor = findDoneAncestorIssue(issue, issueById);
				if (doneAncestor) {
					setStatusUpdateError(
						`Cannot move this sub-task out of done while parent task #${doneAncestor.issueNumber} is still done. Reopen the parent first.`,
					);
					return;
				}

				await updateIssue({
					issueId: issue._id,
					status: nextStatus,
				});
				return;
			}

			const unfinishedDescendantCount =
				descendantStatsByIssueId.get(issue._id)?.unfinishedDescendantCount ?? 0;
			if (unfinishedDescendantCount > 0) {
				setCompletionConfirm({
					issueId: issue._id,
					title: issue.title,
					unfinishedDescendantCount,
				});
				return;
			}

			await updateIssue({
				issueId: issue._id,
				status: nextStatus,
			});
		} catch (error) {
			setStatusUpdateError(getClientErrorMessage(error, errorMessage));
		}
	}

	async function confirmCascadeCompletion() {
		if (!completionConfirm) {
			return;
		}

		setIsCompletingIssueTree(true);
		try {
			setStatusUpdateError(null);
			await updateIssue({
				issueId: completionConfirm.issueId,
				status: "done",
				cascadeDescendantsToDone: true,
			});
			setCompletionConfirm(null);
		} catch (error) {
			setStatusUpdateError(getClientErrorMessage(error, errorMessage));
		} finally {
			setIsCompletingIssueTree(false);
		}
	}

	return {
		completionConfirm,
		confirmCascadeCompletion,
		handleIssueStatusChange,
		isCompletingIssueTree,
		isStatusUpdateBlocked: Boolean(statusUpdateError),
		setCompletionConfirm,
		statusUpdateError,
	};
}
