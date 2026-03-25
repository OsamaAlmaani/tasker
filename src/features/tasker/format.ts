import { issuePriorityLabel, issueStatusLabel } from "./model";

export function formatDate(timestamp?: number | null) {
	if (!timestamp) {
		return "No date";
	}

	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(timestamp));
}

export function formatRelative(timestamp: number) {
	const now = Date.now();
	const diff = timestamp - now;
	const absMinutes = Math.round(Math.abs(diff) / 60000);

	if (absMinutes < 1) {
		return "just now";
	}
	if (absMinutes < 60) {
		return diff < 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
	}

	const absHours = Math.round(absMinutes / 60);
	if (absHours < 24) {
		return diff < 0 ? `${absHours}h ago` : `in ${absHours}h`;
	}

	const absDays = Math.round(absHours / 24);
	return diff < 0 ? `${absDays}d ago` : `in ${absDays}d`;
}

export function statusLabel(status: string) {
	return issueStatusLabel[status] ?? status;
}

export function priorityLabel(priority: keyof typeof issuePriorityLabel) {
	return issuePriorityLabel[priority];
}
