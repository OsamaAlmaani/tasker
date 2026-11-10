// Pure display helpers for review tasks on pull request and task pages.

export function reviewThreadLocation(
	path: string,
	line: number | null | undefined,
	isFileComment: boolean,
) {
	const file = path.split("/").pop() || path;
	return line && !isFileComment ? `${file}:${line}` : file;
}

type ProgressTask = { kind: "fix" | "follow_up"; issue: { isDone: boolean } };

/** Fix tasks gate the merge; follow-ups are counted separately. */
export function reviewTaskProgress(tasks: ReadonlyArray<ProgressTask>) {
	const fixes = tasks.filter((task) => task.kind === "fix");
	const fixesDone = fixes.filter((task) => task.issue.isDone).length;
	return {
		total: tasks.length,
		fixes: fixes.length,
		fixesDone,
		fixesOpen: fixes.length - fixesDone,
		followUps: tasks.length - fixes.length,
	};
}

type TrackResult = {
	outcome: "created" | "existing" | "skipped_resolved";
	key: string | null;
};

/** One line describing what tracking did, for the page notice. */
export function trackSummary(
	results: ReadonlyArray<TrackResult>,
	warnings: ReadonlyArray<string>,
) {
	const created = results.filter((result) => result.outcome === "created");
	const existing = results.filter((result) => result.outcome === "existing");
	const skipped = results.filter(
		(result) => result.outcome === "skipped_resolved",
	);
	const parts: string[] = [];
	if (created.length) {
		const keys = created
			.map((result) => result.key)
			.filter(Boolean)
			.slice(0, 5)
			.join(", ");
		const more = created.length > 5 ? ` and ${created.length - 5} more` : "";
		parts.push(
			`Created ${created.length} task${created.length === 1 ? "" : "s"}${keys ? ` (${keys}${more})` : ""}.`,
		);
	}
	if (existing.length) {
		parts.push(
			`${existing.length} conversation${existing.length === 1 ? " was" : "s were"} already tracked.`,
		);
	}
	if (skipped.length) {
		parts.push(
			`Skipped ${skipped.length} resolved conversation${skipped.length === 1 ? "" : "s"}.`,
		);
	}
	if (warnings.length) {
		parts.push(`Could not update GitHub for ${warnings.join("; ")}.`);
	}
	return {
		message: parts.join(" ") || "Nothing to track.",
		failed:
			warnings.length > 0 || (created.length === 0 && existing.length === 0),
	};
}
