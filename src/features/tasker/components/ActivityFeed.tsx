import type { Doc } from "#convex/_generated/dataModel";
import { formatRelative } from "../format";
import { describeGitHubActivity } from "../github/linkDisplay";

const activityLabel: Record<string, string> = {
	"project.created": "Created project",
	"project.updated": "Updated project",
	"project.archived": "Changed archive state",
	"project.member_added": "Added member",
	"project.member_removed": "Removed member",
	"project.invite_sent": "Sent invitation",
	"project.invite_revoked": "Revoked invitation",
	"project.invite_accepted": "Accepted invitation",
	"issue_list.created": "Created task list",
	"issue_list.updated": "Updated task list",
	"issue_list.deleted": "Deleted task list",
	"issue.created": "Created task",
	"issue.updated": "Updated task",
	"issue.deleted": "Deleted task",
	"issue.list_changed": "Moved task to a different list",
	"issue.status_changed": "Changed task status",
	"issue.priority_changed": "Changed task priority",
	"issue.assignee_changed": "Changed task assignee",
	"comment.created": "Added comment",
	"comment.edited": "Edited comment",
	"github.repo_linked": "Linked GitHub repository",
	"github.repo_unlinked": "Unlinked GitHub repository",
	"github.pr_merged": "Merged pull request",
	"github.pr_closed": "Closed pull request",
	"github.pr_reopened": "Reopened pull request",
	"github.workflows_started": "Started workflows",
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
			{activities.map((activity) => {
				const github = describeGitHubActivity(
					activity.action,
					activity.metadata,
				);
				return (
					<li
						key={activity._id}
						className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2"
					>
						<div className="min-w-0 text-sm text-[var(--text)]">
							{github?.label ??
								activityLabel[activity.action] ??
								activity.action}
							{github?.detail ? (
								<span className="ml-1 text-[var(--muted-text)]">
									{github.detail}
								</span>
							) : null}
						</div>
						<div className="text-xs text-[var(--muted-text)]">
							{formatRelative(activity.createdAt)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
