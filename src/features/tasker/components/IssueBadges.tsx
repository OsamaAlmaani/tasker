import { Badge } from "#/components/ui/badge";
import {
	type IssuePriority,
	type IssueStatus,
	issuePriorityLabel,
	issueStatusLabel,
} from "../model";

const statusClasses: Record<IssueStatus, string> = {
	backlog:
		"border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300",
	todo: "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300",
	in_progress:
		"border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300",
	in_review:
		"border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300",
	done: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
};

const priorityClasses: Record<IssuePriority, string> = {
	none: "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300",
	low: "border-cyan-300 text-cyan-700 dark:border-cyan-800 dark:text-cyan-300",
	medium:
		"border-lime-300 text-lime-700 dark:border-lime-800 dark:text-lime-300",
	high: "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-300",
	urgent:
		"border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300",
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
	return (
		<Badge className={statusClasses[status]}>{issueStatusLabel[status]}</Badge>
	);
}

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
	return (
		<Badge className={priorityClasses[priority]}>
			{issuePriorityLabel[priority]}
		</Badge>
	);
}
