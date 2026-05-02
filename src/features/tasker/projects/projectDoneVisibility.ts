export const HIDE_DONE_TASKS_STORAGE_KEY = "tasker.projects.hideDone";

export function parseHideDoneTasksPreference(value?: string | null): boolean {
	if (value === "0") {
		return false;
	}

	if (value === "1") {
		return true;
	}

	return true;
}

export function readHideDoneTasksPreference(): boolean {
	if (typeof window === "undefined") {
		return true;
	}

	return parseHideDoneTasksPreference(
		window.localStorage.getItem(HIDE_DONE_TASKS_STORAGE_KEY),
	);
}

export function persistHideDoneTasksPreference(nextValue: boolean) {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(
		HIDE_DONE_TASKS_STORAGE_KEY,
		nextValue ? "1" : "0",
	);
}

export function filterDoneTasks<T extends { status: string }>(
	issues: T[],
	options: {
		archiveState: "active" | "archived";
		hideDoneTasks: boolean;
	},
): T[] {
	if (options.archiveState === "archived" || !options.hideDoneTasks) {
		return issues;
	}

	return issues.filter((issue) => issue.status !== "done");
}
