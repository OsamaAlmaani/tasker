export const GLOBAL_ROLES = ["admin", "member", "viewer"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ISSUE_STATUSES = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"done",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = [
	"none",
	"low",
	"medium",
	"high",
	"urgent",
] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const issueStatusLabel: Record<IssueStatus, string> = {
	backlog: "Backlog",
	todo: "Todo",
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
