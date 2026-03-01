import type { Doc } from "#convex/_generated/dataModel";
import { formatRelative } from "../format";

const activityLabel: Record<string, string> = {
	"project.created": "Created project",
	"project.updated": "Updated project",
	"project.archived": "Changed archive state",
	"project.member_added": "Added member",
	"project.member_removed": "Removed member",
	"project.invite_sent": "Sent invitation",
	"project.invite_revoked": "Revoked invitation",
	"project.invite_accepted": "Accepted invitation",
	"issue_list.created": "Created issue list",
	"issue_list.updated": "Updated issue list",
	"issue_list.deleted": "Deleted issue list",
	"issue.created": "Created issue",
	"issue.updated": "Updated issue",
	"issue.deleted": "Deleted issue",
	"issue.list_changed": "Moved issue to a different list",
	"issue.status_changed": "Changed issue status",
	"issue.priority_changed": "Changed issue priority",
	"issue.assignee_changed": "Changed issue assignee",
	"comment.created": "Added comment",
	"comment.edited": "Edited comment",
};

export function ActivityFeed({
	activities,
}: {
	activities: Doc<"activities">[];
}) {
	if (!activities.length) {
		return <p className="text-sm text-[var(--muted-text)]">No activity yet.</p>;
	}

	return (
		<ul className="m-0 space-y-2 p-0">
			{activities.map((activity) => (
				<li
					key={activity._id}
					className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
				>
					<div className="text-sm text-[var(--text)]">
						{activityLabel[activity.action] ?? activity.action}
					</div>
					<div className="text-xs text-[var(--muted-text)]">
						{formatRelative(activity.createdAt)}
					</div>
				</li>
			))}
		</ul>
	);
}
