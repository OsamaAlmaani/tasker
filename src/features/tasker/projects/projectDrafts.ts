import type { IssueDraft } from "#/features/tasker/issues/components/IssueDraftDialog";
import type { ISSUE_PRIORITIES, ISSUE_STATUSES } from "#/features/tasker/model";
import {
	normalizeProjectCustomFields,
	type ProjectCustomFieldDefinition,
} from "#/features/tasker/projectCustomFields";
import {
	normalizeProjectLabels,
	type ProjectLabelDefinition,
} from "#/features/tasker/projectLabels";
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
	customFields?: ProjectCustomFieldDefinition[] | null;
	description?: string | null;
	icon?: string | null;
	labels?: ProjectLabelDefinition[] | null;
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
	return createIssueDraftWithOverrides();
}

export function createIssueDraftWithOverrides(
	overrides: Partial<IssueDraft> = {},
): IssueDraft {
	return {
		title: "",
		description: "",
		listId: "",
		parentIssueId: "",
		status: "todo",
		priority: "none",
		assigneeId: "",
		dueDate: "",
		customFieldValues: {},
		labels: [],
		...overrides,
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
		customFields: normalizeProjectCustomFields(project?.customFields),
		labels: normalizeProjectLabels(project?.labels),
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
		listId: parentIssue ? (parentIssue.listId ?? "") : draft.listId,
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
