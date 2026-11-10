import { useAction, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import { reviewThreadLocation } from "./reviewTaskDisplay";

export type ReviewReplyOption = {
	options: Array<{ value: string; label: string }>;
	/** Thread the next task comment is also posted to, or null. */
	selected: string | null;
	setSelected: (threadId: string | null) => void;
	error: string | null;
};

/**
 * Lets a task comment also go to one of the task's review conversations on
 * GitHub, posted with the commenter's own token.
 */
export function useReviewReplyOption(issueId: Id<"issues">) {
	const feedback = useQuery(api.githubReviewTasks.listForIssue, { issueId });
	const reply = useAction(api.githubActions.replyToReviewThread);
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const items = useMemo(
		() => (feedback?.canWrite ? feedback.items : []),
		[feedback],
	);
	const options = useMemo(
		() =>
			items.map((item) => ({
				value: item.threadId,
				label: `${reviewThreadLocation(item.path, item.line, false)} (#${item.pullNumber})${item.isResolved ? " · resolved" : ""}`,
			})),
		[items],
	);

	/** Posts the comment body to the chosen conversation. Returns false on failure. */
	async function send(body: string) {
		setError(null);
		const item = items.find((candidate) => candidate.threadId === selected);
		if (!item || !feedback) return true;
		try {
			await reply({
				projectId: feedback.projectId,
				number: item.pullNumber,
				threadId: item.threadId,
				body,
			});
			return true;
		} catch (caught) {
			setError(
				getClientErrorMessage(
					caught,
					"The comment was saved, but the reply could not be posted on GitHub.",
				),
			);
			return false;
		}
	}

	const control: ReviewReplyOption | null = options.length
		? {
				options,
				selected:
					selected && options.some((option) => option.value === selected)
						? selected
						: null,
				setSelected,
				error,
			}
		: null;
	return { control, send };
}
