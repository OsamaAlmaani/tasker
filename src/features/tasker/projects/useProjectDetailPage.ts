import { useAction, useMutation, useQuery } from "convex/react";
import { type DragEvent, useMemo, useState } from "react";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import {
	type ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issueStatusLabel,
} from "#/features/tasker/model";
import type { ProjectSettingsForm } from "#/features/tasker/projects/components/ProjectSettingsCard";
import { useProjectTaskImportExport } from "#/features/tasker/projects/useProjectTaskImportExport";
import { issueFormSchema } from "#/features/tasker/validation";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";

type ProjectSearch = {
	list?: string;
	q?: string;
	statuses?: string;
	priority?: (typeof ISSUE_PRIORITIES)[number];
	assignee?: string;
	groupBy?: "list" | "status";
	view?: "issues" | "activity";
	sort?: "updated_desc" | "created_desc" | "priority_desc" | "due_asc";
	layout?: "list" | "kanban";
};

export type ProjectIssueRow = Doc<"issues"> & {
	childIssueCount: number;
	completedChildIssueCount: number;
	childCompletionRate: number;
	hasChildren: boolean;
};

type IssueTreeNode = {
	issue: ProjectIssueRow;
	children: IssueTreeNode[];
};

export function createIssueDraft() {
	return {
		title: "",
		description: "",
		listId: "",
		parentIssueId: "",
		status: "todo" as (typeof ISSUE_STATUSES)[number],
		priority: "none" as (typeof ISSUE_PRIORITIES)[number],
		assigneeId: "",
		dueDate: "",
		labels: "",
	};
}

function formatIssueInputDate(timestamp?: number) {
	return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function buildIssueTree(rows: ProjectIssueRow[]): IssueTreeNode[] {
	const byId = new Map<string, IssueTreeNode>(
		rows.map((issue) => [issue._id, { issue, children: [] }]),
	);
	const roots: IssueTreeNode[] = [];

	for (const issue of rows) {
		const node = byId.get(issue._id);
		if (!node) {
			continue;
		}

		if (issue.parentIssueId) {
			const parentNode = byId.get(issue.parentIssueId);
			if (parentNode) {
				parentNode.children.push(node);
				continue;
			}
		}

		roots.push(node);
	}

	return roots;
}

function parseStatusFilters(raw?: string): (typeof ISSUE_STATUSES)[number][] {
	if (!raw) {
		return [];
	}

	const allowed = new Set<string>(ISSUE_STATUSES);
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter((value): value is (typeof ISSUE_STATUSES)[number] =>
			allowed.has(value),
		);
}

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
	const priority = routeSearch.priority ?? "";
	const assigneeId = routeSearch.assignee ?? "";
	const listFilter = routeSearch.list ?? "all";
	const groupBy = routeSearch.groupBy ?? "list";
	const projectView = routeSearch.view ?? "issues";
	const sortBy = routeSearch.sort ?? "updated_desc";
	const issueLayout = routeSearch.layout ?? "list";

	const issues = useQuery(
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
					sortBy,
				}
			: "skip",
	);

	function addStatusFilter(nextStatus: string) {
		if (
			!nextStatus ||
			!ISSUE_STATUSES.includes(nextStatus as (typeof ISSUE_STATUSES)[number])
		) {
			return;
		}

		const statusValue = nextStatus as (typeof ISSUE_STATUSES)[number];
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
	const [projectForm, setProjectForm] = useState<ProjectSettingsForm>({
		name: projectData?.project.name ?? "",
		description: projectData?.project.description ?? "",
		color: projectData?.project.color ?? "#4f46e5",
		icon: projectData?.project.icon ?? "FolderKanban",
		allowMemberInvites: projectData?.project.allowMemberInvites ?? true,
		allowIssueDelete: projectData?.project.allowIssueDelete ?? true,
	});
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
	const [dragOverStatus, setDragOverStatus] = useState<
		(typeof ISSUE_STATUSES)[number] | null
	>(null);

	const issueLists = useQuery(
		api.issueLists.listByProject,
		projectData ? { projectId } : "skip",
	);
	const allProjectIssues = useQuery(
		api.issues.listByProject,
		projectData
			? {
					projectId,
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
				.filter((issue) => !issue.parentIssueId)
				.sort((left, right) => left.issueNumber - right.issueNumber)
				.map((issue) => ({
					value: issue._id,
					label: `#${issue.issueNumber} ${issue.title}`,
				})),
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
	});

	const groupedIssues = useMemo(() => {
		const rows = (issues ?? []) as ProjectIssueRow[];
		const groups = new Map<
			string,
			{
				key: string;
				title: string;
				position: number;
				items: ProjectIssueRow[];
			}
		>();

		for (const issue of rows) {
			const key =
				groupBy === "status" ? issue.status : (issue.listId ?? "none");
			const list =
				groupBy === "list" && issue.listId
					? issueListById.get(issue.listId)
					: undefined;
			const group = groups.get(key);
			const statusPosition =
				groupBy === "status" ? ISSUE_STATUSES.indexOf(issue.status) : -1;

			if (group) {
				group.items.push(issue);
				continue;
			}

			groups.set(key, {
				key,
				title:
					groupBy === "status"
						? issueStatusLabel[issue.status]
						: (list?.name ?? "No List"),
				position:
					groupBy === "status"
						? statusPosition
						: (list?.position ?? Number.MAX_SAFE_INTEGER),
				items: [issue],
			});
		}

		return [...groups.values()]
			.sort((a, b) => {
				if (a.position !== b.position) {
					return a.position - b.position;
				}
				return a.title.localeCompare(b.title);
			})
			.map((group) => ({
				...group,
				tree: buildIssueTree(group.items),
			}));
	}, [issues, issueListById, groupBy]);

	const kanbanColumns = useMemo(
		() =>
			ISSUE_STATUSES.map((status) => ({
				status,
				title: issueStatusLabel[status],
				items: (issues ?? []).filter(
					(issue): issue is ProjectIssueRow => issue.status === status,
				),
			})).map((column) => ({
				...column,
				tree: buildIssueTree(column.items),
			})),
		[issues],
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
				labels: parsed.data.labels
					? parsed.data.labels
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean)
					: undefined,
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

		await updateProject({
			projectId,
			name: projectForm.name,
			description: projectForm.description,
			color: projectForm.color,
			icon: projectForm.icon,
			allowMemberInvites: projectForm.allowMemberInvites,
			allowIssueDelete: projectForm.allowIssueDelete,
		});

		setEditingProject(false);
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
			switch (result.resultType) {
				case "added_existing_user":
					setInviteMessage("User already exists and was added to the project.");
					break;
				case "already_member":
					setInviteMessage("This user is already a project member.");
					break;
				case "already_invited":
					setInviteMessage("A pending invite already exists for this email.");
					break;
				case "sent":
					setInviteMessage("Invitation sent.");
					break;
				default:
					setInviteMessage("Invite processed.");
			}
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

		setProjectForm({
			name: projectData.project.name ?? "",
			description: projectData.project.description ?? "",
			color: projectData.project.color ?? "#4f46e5",
			icon: projectData.project.icon ?? "FolderKanban",
			allowMemberInvites: projectData.project.allowMemberInvites ?? true,
			allowIssueDelete: projectData.project.allowIssueDelete ?? true,
		});
	}

	function handleKanbanDragStart(
		event: DragEvent<HTMLElement>,
		issue: Doc<"issues">,
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
		status: (typeof ISSUE_STATUSES)[number],
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
		nextStatus: (typeof ISSUE_STATUSES)[number],
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
				status?: (typeof ISSUE_STATUSES)[number];
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
			? projectIssueById.get(nextParentIssueId as Id<"issues">)
			: null;

		setIssueForm((prev) => ({
			...prev,
			parentIssueId: nextParentIssueId,
			listId:
				prev.listId || !parentIssue?.listId ? prev.listId : parentIssue.listId,
			status:
				prev.status === "todo" && parentIssue
					? parentIssue.status
					: prev.status,
			priority:
				prev.priority === "none" && parentIssue
					? parentIssue.priority
					: prev.priority,
			assigneeId:
				prev.assigneeId || !parentIssue?.assigneeId
					? prev.assigneeId
					: parentIssue.assigneeId,
			dueDate:
				prev.dueDate || !parentIssue?.dueDate
					? prev.dueDate
					: formatIssueInputDate(parentIssue.dueDate),
		}));
	}

	return {
		addMember,
		addStatusFilter,
		allProjectIssues,
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
		projectInvites,
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
		setStatusPicker,
		setIssueForm,
		sortBy,
		statusPicker,
		statusUpdateError,
		submitEmailInvite,
		submitIssue,
		submitProjectSettings,
		syncProjectFormWithCurrentProject,
		toggleImportExportMenu: importExport.toggleImportExportMenu,
		updateIssue,
		exportTasks: importExport.exportTasks,
	};
}
