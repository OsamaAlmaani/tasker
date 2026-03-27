import { useAction, useMutation, useQuery } from "convex/react";
import { type DragEvent, type FormEvent, useMemo, useState } from "react";
import type { IssueChecklistItem } from "#/features/tasker/issues/checklists";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import type { ISSUE_PRIORITIES } from "#/features/tasker/model";
import {
	buildIssueCustomFieldSubmission,
	normalizeProjectCustomFields,
} from "#/features/tasker/projectCustomFields";
import { normalizeProjectLabels } from "#/features/tasker/projectLabels";
import {
	normalizeProjectStatuses,
	type ProjectStatusDefinition,
} from "#/features/tasker/projectStatuses";
import {
	buildGroupedIssues,
	buildKanbanColumns,
} from "#/features/tasker/projects/issueGrouping";
import {
	applyParentIssueDraftDefaults,
	createIssueDraft,
	createProjectSettingsForm,
	getProjectInviteResultMessage,
} from "#/features/tasker/projects/projectDrafts";
import {
	type ProjectSearch,
	parseStatusFilters,
} from "#/features/tasker/projects/projectSearch";
import { useProjectTaskImportExport } from "#/features/tasker/projects/useProjectTaskImportExport";
import { issueFormSchema } from "#/features/tasker/validation";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";

export type ProjectIssueRow = Doc<"issues"> & {
	childIssueCount: number;
	completedChildIssueCount: number;
	childCompletionRate: number;
	hasChildren: boolean;
	checklistItems: IssueChecklistItem[];
	checklistItemCount: number;
	completedChecklistItemCount: number;
	checklistCompletionRate: number;
	hasChecklist: boolean;
};

type UseProjectDetailPageOptions = {
	projectId: Id<"projects">;
	routeSearch: ProjectSearch;
	updateProjectSearch: (
		patch: Partial<ProjectSearch>,
		options?: { replace?: boolean },
	) => void;
};

export function useProjectDetailPage({
	projectId,
	routeSearch,
	updateProjectSearch,
}: UseProjectDetailPageOptions) {
	const projectData = useQuery(api.projects.getById, { projectId });
	const me = useQuery(api.users.me);

	const [statusPicker, setStatusPicker] = useState<string>("");
	const search = routeSearch.q ?? "";
	const selectedStatuses = useMemo(
		() => parseStatusFilters(routeSearch.statuses),
		[routeSearch.statuses],
	);
	const archive = routeSearch.archive ?? "active";
	const isArchivedView = archive === "archived";
	const priority = routeSearch.priority ?? "";
	const assigneeId = routeSearch.assignee ?? "";
	const listFilter = routeSearch.list ?? "all";
	const groupBy = routeSearch.groupBy ?? "list";
	const projectView = routeSearch.view ?? "issues";
	const sortBy = routeSearch.sort ?? "updated_desc";
	const savedIssueLayout = routeSearch.layout ?? "list";
	const issueLayout = isArchivedView ? "list" : savedIssueLayout;

	const issueResults = useQuery(
		api.issues.listByProject,
		projectData
			? {
					projectId,
					search: search || undefined,
					statuses: selectedStatuses.length ? selectedStatuses : undefined,
					priority: (priority || undefined) as
						| (typeof ISSUE_PRIORITIES)[number]
						| undefined,
					assigneeId: (assigneeId || undefined) as Id<"users"> | undefined,
					listId:
						listFilter === "all"
							? undefined
							: listFilter === "none"
								? null
								: (listFilter as Id<"issueLists">),
					includeArchived: isArchivedView || undefined,
					sortBy,
				}
			: "skip",
	);
	const issues = useMemo(
		() =>
			(issueResults ?? []).filter((issue) =>
				isArchivedView ? issue.archived : !issue.archived,
			),
		[issueResults, isArchivedView],
	);

	function addStatusFilter(nextStatus: string) {
		if (
			!nextStatus ||
			!projectStatuses.some((status) => status.key === nextStatus)
		) {
			return;
		}

		const statusValue = nextStatus;
		const nextStatuses = selectedStatuses.includes(statusValue)
			? selectedStatuses
			: [...selectedStatuses, statusValue];
		updateProjectSearch(
			{ statuses: [...new Set(nextStatuses)].join(",") },
			{ replace: true },
		);
		setStatusPicker("");
	}

	const assignableUsers = useQuery(
		api.users.listAssignableUsers,
		projectData ? { projectId } : "skip",
	);

	const createIssue = useMutation(api.issues.create);
	const updateIssue = useMutation(api.issues.update);
	const updateProject = useMutation(api.projects.update);
	const deleteProjectStatus = useMutation(api.projects.deleteStatus);
	const archiveProject = useMutation(api.projects.archive);
	const addMember = useMutation(api.projects.addMember);
	const removeMember = useMutation(api.projects.removeMember);
	const sendProjectInvite = useAction(api.invitationsActions.sendProjectInvite);
	const revokeProjectInvite = useAction(
		api.invitationsActions.revokeProjectInvite,
	);

	const [createOpen, setCreateOpen] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [editingProject, setEditingProject] = useState(false);
	const [issueForm, setIssueForm] = useState(createIssueDraft);
	const [projectForm, setProjectForm] = useState(() =>
		createProjectSettingsForm(projectData?.project),
	);
	const [projectSettingsError, setProjectSettingsError] = useState<
		string | null
	>(null);
	const [statusToDelete, setStatusToDelete] =
		useState<ProjectStatusDefinition | null>(null);
	const [transferStatusKey, setTransferStatusKey] = useState("");
	const [isDeletingStatus, setIsDeletingStatus] = useState(false);
	const [inviteSearch, setInviteSearch] = useState("");
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteMessage, setInviteMessage] = useState<string | null>(null);
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [isSendingInvite, setIsSendingInvite] = useState(false);
	const [memberToRemove, setMemberToRemove] = useState<{
		id: Id<"users">;
		name: string;
	} | null>(null);
	const [isRemovingMember, setIsRemovingMember] = useState(false);
	const [inviteToRevoke, setInviteToRevoke] = useState<{
		id: Id<"projectInvites">;
		email: string;
	} | null>(null);
	const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
	const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
	const [isRevokingInvite, setIsRevokingInvite] = useState(false);
	const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
	const [isTogglingArchive, setIsTogglingArchive] = useState(false);
	const [draggingIssueId, setDraggingIssueId] = useState<Id<"issues"> | null>(
		null,
	);
	const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

	const issueLists = useQuery(
		api.issueLists.listByProject,
		projectData ? { projectId } : "skip",
	);
	const allProjectIssues = useQuery(
		api.issues.listByProject,
		projectData
			? {
					projectId,
					includeArchived: true,
					sortBy: "created_desc",
				}
			: "skip",
	);
	const projectActivity = useQuery(
		api.projects.activity,
		projectData && projectView === "activity"
			? { projectId, limit: 80 }
			: "skip",
	);
	const inviteCandidates = useQuery(
		api.projects.searchInviteCandidates,
		projectData?.canManageMembers
			? {
					projectId,
					search: inviteSearch || undefined,
				}
			: "skip",
	);
	const projectInvites = useQuery(
		api.invitations.listByProject,
		projectData?.canManageMembers ? { projectId } : "skip",
	);

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";
	const projectStatuses = useMemo(
		() => normalizeProjectStatuses(projectData?.project.statuses),
		[projectData?.project.statuses],
	);
	const projectCustomFields = useMemo(
		() => normalizeProjectCustomFields(projectData?.project.customFields),
		[projectData?.project.customFields],
	);
	const projectLabels = useMemo(
		() => normalizeProjectLabels(projectData?.project.labels),
		[projectData?.project.labels],
	);

	const memberRows = useMemo(
		() => projectData?.membershipRows ?? [],
		[projectData?.membershipRows],
	);
	const membersForStack = useMemo(
		() =>
			memberRows.map((row) => ({
				_id: row.user._id,
				name: row.user.name,
				imageUrl: row.user.imageUrl,
			})),
		[memberRows],
	);
	const issueListById = useMemo(
		() => new Map((issueLists ?? []).map((list) => [list._id, list])),
		[issueLists],
	);
	const assignableUserById = useMemo(
		() => new Map((assignableUsers ?? []).map((user) => [user._id, user])),
		[assignableUsers],
	);
	const projectIssueById = useMemo(
		() => new Map((allProjectIssues ?? []).map((issue) => [issue._id, issue])),
		[allProjectIssues],
	);
	const parentIssueOptions = useMemo(
		() =>
			[...(allProjectIssues ?? [])]
				.filter((issue) => !issue.parentIssueId && !issue.archived)
				.sort((left, right) => left.issueNumber - right.issueNumber)
				.map((issue) => ({
					value: issue._id,
					label: `#${issue.issueNumber} ${issue.title}`,
				})),
		[allProjectIssues],
	);
	const archivedIssueCount = useMemo(
		() => (allProjectIssues ?? []).filter((issue) => issue.archived).length,
		[allProjectIssues],
	);

	const {
		completionConfirm,
		confirmCascadeCompletion,
		handleIssueStatusChange,
		isCompletingIssueTree,
		setCompletionConfirm,
		statusUpdateError,
	} = useIssueStatusFlow<ProjectIssueRow>({
		issues: (allProjectIssues ?? []) as ProjectIssueRow[],
		updateIssue,
	});

	const importExport = useProjectTaskImportExport({
		canWrite,
		createIssue,
		filters: {
			assigneeId,
			archive,
			groupBy,
			layout: issueLayout,
			list: listFilter,
			priority,
			search,
			sort: sortBy,
			statuses: selectedStatuses,
			view: projectView,
		},
		issueListById,
		issueLists,
		issues: issues as ProjectIssueRow[] | undefined,
		project: projectData?.project,
		projectId,
		projectLabels,
		projectStatuses,
	});

	const groupedIssues = useMemo(
		() =>
			buildGroupedIssues(
				(issues ?? []) as ProjectIssueRow[],
				groupBy,
				issueListById,
				projectStatuses,
			),
		[issues, issueListById, groupBy, projectStatuses],
	);

	const kanbanColumns = useMemo(
		() =>
			buildKanbanColumns((issues ?? []) as ProjectIssueRow[], projectStatuses),
		[issues, projectStatuses],
	);

	async function submitIssue(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCreateError(null);

		const parsed = issueFormSchema.safeParse(issueForm);
		if (!parsed.success) {
			setCreateError(
				parsed.error.issues[0]?.message ?? "Task form is invalid.",
			);
			return;
		}

		try {
			await createIssue({
				projectId,
				title: parsed.data.title,
				description: parsed.data.description,
				listId: (parsed.data.listId || undefined) as
					| Id<"issueLists">
					| undefined,
				parentIssueId: (parsed.data.parentIssueId || undefined) as
					| Id<"issues">
					| undefined,
				status: parsed.data.status,
				priority: parsed.data.priority,
				assigneeId: (parsed.data.assigneeId || undefined) as
					| Id<"users">
					| undefined,
				dueDate: parsed.data.dueDate
					? new Date(parsed.data.dueDate).getTime()
					: undefined,
				customFieldValues: buildIssueCustomFieldSubmission(
					projectCustomFields,
					parsed.data.customFieldValues,
				),
				labels: parsed.data.labels,
			});
			setIssueForm(createIssueDraft());
			setCreateOpen(false);
		} catch (mutationError) {
			setCreateError(
				getClientErrorMessage(mutationError, "Failed to create task."),
			);
		}
	}

	async function submitProjectSettings(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setProjectSettingsError(null);

		try {
			await updateProject({
				projectId,
				name: projectForm.name,
				description: projectForm.description,
				color: projectForm.color,
				icon: projectForm.icon,
				customFields: projectForm.customFields,
				labels: projectForm.labels,
				statuses: projectForm.statuses,
				allowMemberInvites: projectForm.allowMemberInvites,
				allowIssueDelete: projectForm.allowIssueDelete,
			});

			setEditingProject(false);
		} catch (error) {
			setProjectSettingsError(
				getClientErrorMessage(error, "Failed to update project settings."),
			);
		}
	}

	async function submitEmailInvite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setInviteError(null);
		setInviteMessage(null);

		const email = inviteEmail.trim().toLowerCase();
		if (!email) {
			setInviteError("Please enter an email.");
			return;
		}

		setIsSendingInvite(true);
		try {
			const result = await sendProjectInvite({ projectId, email });
			setInviteMessage(getProjectInviteResultMessage(result.resultType));
			setInviteEmail("");
		} catch (error) {
			setInviteError(getClientErrorMessage(error, "Failed to send invite."));
		} finally {
			setIsSendingInvite(false);
		}
	}

	async function confirmRemoveMember() {
		if (!memberToRemove) {
			return;
		}
		setIsRemovingMember(true);
		try {
			await removeMember({
				projectId,
				userId: memberToRemove.id,
			});
		} finally {
			setIsRemovingMember(false);
			setMemberToRemove(null);
		}
	}

	async function confirmRevokeInvite() {
		if (!inviteToRevoke) {
			return;
		}
		setIsRevokingInvite(true);
		try {
			await revokeProjectInvite({
				projectInviteId: inviteToRevoke.id,
			});
		} finally {
			setIsRevokingInvite(false);
			setInviteToRevoke(null);
		}
	}

	async function confirmArchiveToggle() {
		if (!projectData) {
			return;
		}
		setIsTogglingArchive(true);
		try {
			await archiveProject({
				projectId,
				archived: !projectData.project.archived,
			});
		} finally {
			setIsTogglingArchive(false);
			setIsArchiveConfirmOpen(false);
		}
	}

	function syncProjectFormWithCurrentProject() {
		if (!projectData) {
			return;
		}

		setProjectSettingsError(null);
		setProjectForm(createProjectSettingsForm(projectData.project));
	}

	function requestStatusDelete(statusKey: string) {
		const status = projectStatuses.find((item) => item.key === statusKey);
		if (!status) {
			return;
		}

		const fallbackTransferStatusKey =
			projectStatuses.find((item) => item.key !== statusKey)?.key ?? "";
		setProjectSettingsError(null);
		setTransferStatusKey(fallbackTransferStatusKey);
		setStatusToDelete(status);
	}

	function cancelStatusDelete() {
		setStatusToDelete(null);
		setTransferStatusKey("");
		setProjectSettingsError(null);
	}

	async function confirmStatusDelete() {
		if (!statusToDelete || !transferStatusKey) {
			return;
		}

		setIsDeletingStatus(true);
		setProjectSettingsError(null);
		try {
			await deleteProjectStatus({
				projectId,
				statusKey: statusToDelete.key,
				transferToStatusKey: transferStatusKey,
			});
			setProjectForm((previous) => ({
				...previous,
				statuses: previous.statuses.filter(
					(status) => status.key !== statusToDelete.key,
				),
			}));
			cancelStatusDelete();
		} catch (error) {
			setProjectSettingsError(
				getClientErrorMessage(error, "Failed to delete project status."),
			);
		} finally {
			setIsDeletingStatus(false);
		}
	}

	function handleKanbanDragStart(
		event: DragEvent<HTMLElement>,
		issue: Pick<ProjectIssueRow, "_id" | "status">,
	) {
		if (!canWrite) {
			return;
		}
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(
			"application/tasker-issue",
			JSON.stringify({
				issueId: issue._id,
				status: issue.status,
			}),
		);
		setDraggingIssueId(issue._id);
	}

	function handleKanbanDragEnd() {
		setDraggingIssueId(null);
		setDragOverStatus(null);
	}

	function handleKanbanColumnDragOver(
		event: DragEvent<HTMLElement>,
		status: string,
	) {
		if (!canWrite) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		if (dragOverStatus !== status) {
			setDragOverStatus(status);
		}
	}

	function handleKanbanColumnDrop(
		event: DragEvent<HTMLElement>,
		nextStatus: string,
	) {
		if (!canWrite) {
			return;
		}

		event.preventDefault();
		const payload =
			event.dataTransfer.getData("application/tasker-issue") ||
			event.dataTransfer.getData("text/plain");
		if (!payload) {
			handleKanbanDragEnd();
			return;
		}

		try {
			const parsed = JSON.parse(payload) as {
				issueId?: string;
				status?: string;
			};
			if (!parsed.issueId || !parsed.status) {
				handleKanbanDragEnd();
				return;
			}
			if (parsed.status !== nextStatus) {
				const issue = (issues ?? []).find(
					(candidate) => candidate._id === parsed.issueId,
				) as ProjectIssueRow | undefined;
				if (issue) {
					void handleIssueStatusChange(issue, nextStatus);
				}
			}
		} catch {
			// Ignore malformed drag payloads.
		} finally {
			handleKanbanDragEnd();
		}
	}

	function handleParentIssueChange(nextParentIssueId: string) {
		const parentIssue = nextParentIssueId
			? (projectIssueById.get(nextParentIssueId as Id<"issues">) ?? null)
			: null;

		setIssueForm((prev) =>
			applyParentIssueDraftDefaults(prev, nextParentIssueId, parentIssue),
		);
	}

	return {
		addMember,
		addStatusFilter,
		allProjectIssues,
		archive,
		archivedIssueCount,
		assignableUserById,
		assignableUsers,
		assigneeId,
		canWrite,
		completionConfirm,
		confirmArchiveToggle,
		confirmCascadeCompletion,
		confirmRemoveMember,
		confirmRevokeInvite,
		createError,
		createOpen,
		draggingIssueId,
		dragOverStatus,
		editingProject,
		groupBy,
		groupedIssues,
		handleIssueStatusChange,
		handleKanbanColumnDragOver,
		handleKanbanColumnDrop,
		handleKanbanDragEnd,
		handleKanbanDragStart,
		handleImportTasksFile: importExport.handleImportTasksFile,
		handleParentIssueChange,
		importExportError: importExport.importExportError,
		importExportMenuRef: importExport.importExportMenuRef,
		importExportMessage: importExport.importExportMessage,
		importFileInputRef: importExport.importFileInputRef,
		inviteCandidates,
		inviteEmail,
		inviteError,
		inviteMessage,
		inviteSearch,
		inviteToRevoke,
		isArchivedView,
		isArchiveConfirmOpen,
		isCompletingIssueTree,
		isImportExportMenuOpen: importExport.isImportExportMenuOpen,
		isImportingTasks: importExport.isImportingTasks,
		isInviteModalOpen,
		isMembersModalOpen,
		isRemovingMember,
		isRevokingInvite,
		isSendingInvite,
		isTogglingArchive,
		issueForm,
		issueLayout,
		issueLists,
		issues,
		kanbanColumns,
		listFilter,
		me,
		memberRows,
		memberToRemove,
		membersForStack,
		openImportPicker: importExport.openImportPicker,
		parentIssueOptions,
		priority,
		projectActivity,
		projectData,
		projectForm,
		projectSettingsError,
		projectCustomFields,
		projectStatuses,
		projectInvites,
		projectLabels,
		projectIssueById,
		projectView,
		search,
		selectedStatuses,
		sendProjectInvite,
		setCompletionConfirm,
		setCreateError,
		setCreateOpen,
		setDragOverStatus,
		setEditingProject,
		setInviteEmail,
		setInviteSearch,
		setInviteToRevoke,
		setIsArchiveConfirmOpen,
		setIsInviteModalOpen,
		setIsMembersModalOpen,
		setMemberToRemove,
		setProjectForm,
		statusToDelete,
		transferStatusKey,
		setTransferStatusKey,
		setStatusPicker,
		setIssueForm,
		sortBy,
		statusPicker,
		statusUpdateError,
		submitEmailInvite,
		submitIssue,
		submitProjectSettings,
		syncProjectFormWithCurrentProject,
		requestStatusDelete,
		cancelStatusDelete,
		confirmStatusDelete,
		isDeletingStatus,
		toggleImportExportMenu: importExport.toggleImportExportMenu,
		updateIssue,
		exportTasks: importExport.exportTasks,
	};
}

export type ProjectDetailPageState = ReturnType<typeof useProjectDetailPage>;
export {
	createIssueDraft,
	createIssueDraftWithOverrides,
} from "#/features/tasker/projects/projectDrafts";
