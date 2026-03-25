export const GLOBAL_ROLES = ["admin", "member", "viewer"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ISSUE_STATUSES = [
	"todo",
	"backlog",
	"in_progress",
	"in_review",
	"done",
];
export type IssueStatus = string;

export const ISSUE_PRIORITIES = [
	"none",
	"low",
	"medium",
	"high",
	"urgent",
] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const issueStatusLabel: Record<string, string> = {
	todo: "Todo",
	backlog: "Backlog",
	in_progress: "In Progress",
	in_review: "In Review",
	done: "Done",
};

export const issuePriorityLabel: Record<IssuePriority, string> = {
	none: "No Priority",
	low: "Low",
	medium: "Medium",
	high: "High",
	urgent: "Urgent",
};

export const globalRoleLabel: Record<GlobalRole, string> = {
	admin: "Admin",
	member: "Member",
	viewer: "Viewer",
};
