export const GLOBAL_ROLES = ["owner", "admin", "member", "viewer"] as const;
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
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	viewer: "Viewer",
};

export function isOwnerRole(role: GlobalRole): boolean {
	return role === "owner";
}

export function isAdminRole(role: GlobalRole): boolean {
	return role === "owner" || role === "admin";
}

export function canWriteRole(role: GlobalRole): boolean {
	return isAdminRole(role) || role === "member";
}

export function canManageOwners(role: GlobalRole): boolean {
	return isOwnerRole(role);
}

export function canManageAdmins(role: GlobalRole): boolean {
	return isAdminRole(role);
}
