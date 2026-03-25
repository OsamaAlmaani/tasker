import type { IssueDraft } from "#/features/tasker/issues/components/IssueDraftDialog";
import type { ISSUE_PRIORITIES, ISSUE_STATUSES } from "#/features/tasker/model";
import {
	DEFAULT_PROJECT_STATUSES,
	normalizeProjectStatuses,
	type ProjectStatusDefinition,
} from "#/features/tasker/projectStatuses";
import type { ProjectSettingsForm } from "#/features/tasker/projects/components/ProjectSettingsCard";
import { formatIssueInputDate } from "#/features/tasker/projects/issueGrouping";

type ProjectSettingsLike = {
	allowIssueDelete?: boolean | null;
	allowMemberInvites?: boolean | null;
	color?: string | null;
	description?: string | null;
	icon?: string | null;
	name?: string | null;
	statuses?: ProjectStatusDefinition[] | null;
};

type ParentIssueLike = {
	assigneeId?: string | null;
	dueDate?: number | null;
	listId?: string | null;
	priority: (typeof ISSUE_PRIORITIES)[number];
	status: (typeof ISSUE_STATUSES)[number];
};

export function createIssueDraft(): IssueDraft {
	return {
		title: "",
		description: "",
		listId: "",
		parentIssueId: "",
		status: "todo",
		priority: "none",
		assigneeId: "",
		dueDate: "",
		labels: "",
	};
}

export function createProjectSettingsForm(
	project?: ProjectSettingsLike | null,
): ProjectSettingsForm {
	return {
		name: project?.name ?? "",
		description: project?.description ?? "",
		color: project?.color ?? "#4f46e5",
		icon: project?.icon ?? "FolderKanban",
		statuses: normalizeProjectStatuses(
			project?.statuses ?? DEFAULT_PROJECT_STATUSES,
		),
		allowMemberInvites: project?.allowMemberInvites ?? true,
		allowIssueDelete: project?.allowIssueDelete ?? true,
	};
}

export function getProjectInviteResultMessage(resultType: string) {
	switch (resultType) {
		case "added_existing_user":
			return "User already exists and was added to the project.";
		case "already_member":
			return "This user is already a project member.";
		case "already_invited":
			return "A pending invite already exists for this email.";
		case "sent":
			return "Invitation sent.";
		default:
			return "Invite processed.";
	}
}

export function applyParentIssueDraftDefaults(
	draft: IssueDraft,
	nextParentIssueId: string,
	parentIssue: ParentIssueLike | null,
): IssueDraft {
	return {
		...draft,
		parentIssueId: nextParentIssueId,
		listId:
			draft.listId || !parentIssue?.listId ? draft.listId : parentIssue.listId,
		status:
			draft.status === "todo" && parentIssue
				? parentIssue.status
				: draft.status,
		priority:
			draft.priority === "none" && parentIssue
				? parentIssue.priority
				: draft.priority,
		assigneeId:
			draft.assigneeId || !parentIssue?.assigneeId
				? draft.assigneeId
				: parentIssue.assigneeId,
		dueDate:
			draft.dueDate || !parentIssue?.dueDate
				? draft.dueDate
				: formatIssueInputDate(parentIssue.dueDate),
	};
}
