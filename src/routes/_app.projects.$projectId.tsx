import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	Download,
	History,
	ListTodo,
	MoreHorizontal,
	Settings2,
	Upload,
} from "lucide-react";
import { type DragEvent, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { ActivityFeed } from "#/features/tasker/components/ActivityFeed";
import { MemberAvatarStack } from "#/features/tasker/components/MemberAvatarStack";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import {
	type IssueDraft,
	IssueDraftDialog,
} from "#/features/tasker/issues/components/IssueDraftDialog";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issueStatusLabel,
} from "#/features/tasker/model";
import { ProjectInviteDialog } from "#/features/tasker/projects/components/ProjectInviteDialog";
import {
	ProjectIssueKanbanTree,
	ProjectIssueListTree,
	type ProjectIssueTreeNode,
} from "#/features/tasker/projects/components/ProjectIssueTree";
import { ProjectMembersDialog } from "#/features/tasker/projects/components/ProjectMembersDialog";
import {
	ProjectSettingsCard,
	type ProjectSettingsForm,
} from "#/features/tasker/projects/components/ProjectSettingsCard";
import { ProjectTasksPanel } from "#/features/tasker/projects/components/ProjectTasksPanel";
import { useProjectTaskImportExport } from "#/features/tasker/projects/useProjectTaskImportExport";
import { issueFormSchema } from "#/features/tasker/validation";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";

const ISSUE_SORT_OPTIONS = [
	"updated_desc",
	"created_desc",
	"priority_desc",
	"due_asc",
] as const;
const ISSUE_GROUP_OPTIONS = ["list", "status"] as const;
const PROJECT_VIEW_OPTIONS = ["issues", "activity"] as const;
const ISSUE_LAYOUT_OPTIONS = ["list", "kanban"] as const;

const projectSearchSchema = z.object({
	list: z.string().optional(),
	q: z.string().optional(),
	statuses: z.string().optional(),
	priority: z.enum(ISSUE_PRIORITIES).optional(),
	assignee: z.string().optional(),
	groupBy: z.enum(ISSUE_GROUP_OPTIONS).optional(),
	view: z.enum(PROJECT_VIEW_OPTIONS).optional(),
	sort: z.enum(ISSUE_SORT_OPTIONS).optional(),
	layout: z.enum(ISSUE_LAYOUT_OPTIONS).optional(),
});

type ProjectSearch = z.infer<typeof projectSearchSchema>;

type ProjectIssueRow = Doc<"issues"> & {
	childIssueCount: number;
	completedChildIssueCount: number;
	childCompletionRate: number;
	hasChildren: boolean;
};

type IssueTreeNode = {
	issue: ProjectIssueRow;
	children: IssueTreeNode[];
};

function createIssueDraft(): IssueDraft {
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

function serializeStatusFilters(
	values: (typeof ISSUE_STATUSES)[number][],
): string | undefined {
	if (!values.length) {
		return undefined;
	}

	return [...new Set(values)].join(",");
}

export const Route = createFileRoute("/_app/projects/$projectId")({
	validateSearch: projectSearchSchema,
	component: ProjectDetailPage,
});

function ProjectDetailPage() {
	const { projectId: projectIdParam } = Route.useParams();
	const routeSearch = Route.useSearch();
	const navigate = useNavigate();
	const projectId = projectIdParam as Id<"projects">;
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

	function updateProjectSearch(
		patch: Partial<ProjectSearch>,
		options?: { replace?: boolean },
	) {
		void navigate({
			to: "/projects/$projectId",
			params: { projectId },
			replace: options?.replace ?? false,
			search: (previous) => {
				const next: ProjectSearch = { ...previous, ...patch };
				const normalizedStatuses = serializeStatusFilters(
					parseStatusFilters(next.statuses),
				);
				next.statuses = normalizedStatuses;

				next.q = next.q?.trim();
				if (!next.q) {
					delete next.q;
				}
				if (!next.statuses) {
					delete next.statuses;
				}
				if (!next.assignee) {
					delete next.assignee;
				}
				if (next.list === "all" || !next.list) {
					delete next.list;
				}
				if (next.groupBy === "list" || !next.groupBy) {
					delete next.groupBy;
				}
				if (next.view === "issues" || !next.view) {
					delete next.view;
				}
				if (next.sort === "updated_desc" || !next.sort) {
					delete next.sort;
				}
				if (next.layout === "list" || !next.layout) {
					delete next.layout;
				}

				return next;
			},
		});
	}

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
			{ statuses: serializeStatusFilters(nextStatuses) },
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
	const {
		exportTasks,
		handleImportTasksFile,
		importExportError,
		importExportMenuRef,
		importExportMessage,
		importFileInputRef,
		isImportExportMenuOpen,
		isImportingTasks,
		openImportPicker,
		toggleImportExportMenu,
	} = useProjectTaskImportExport({
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

	if (projectData === undefined) {
		return <div className="page-loading">Loading project…</div>;
	}

	if (projectData === null) {
		return (
			<div className="mx-auto max-w-xl">
				<Card>
					<CardHeader>
						<CardTitle>Project not found</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="m-0 text-sm text-[var(--muted-text)]">
							This project may have been deleted or you no longer have access.
						</p>
						<Link to="/projects" className="no-underline">
							<Button>Back to projects</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

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

	return (
		<div>
			<PageHeader
				title={`${projectData.project.key} · ${projectData.project.name}`}
				description={projectData.project.description}
				actions={
					<>
						<button
							type="button"
							onClick={() => setIsMembersModalOpen(true)}
							className="inline-flex items-center gap-2 rounded-md bg-transparent px-1 py-0.5 text-[var(--muted-text)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
							aria-label="View members"
							title="View members"
						>
							<MemberAvatarStack members={membersForStack} maxVisible={5} />
							<span className="text-xs text-[var(--muted-text)]">
								{memberRows.length}
							</span>
						</button>
						{canWrite ? (
							<Button
								variant="secondary"
								onClick={() => {
									if (!editingProject) {
										syncProjectFormWithCurrentProject();
									}
									setEditingProject((value) => !value);
								}}
							>
								<Settings2 className="mr-2 h-4 w-4" />
								Project Settings
							</Button>
						) : null}
						<Button
							variant="secondary"
							onClick={() =>
								updateProjectSearch(
									{
										view: projectView === "issues" ? "activity" : "issues",
									},
									{ replace: true },
								)
							}
						>
							{projectView === "issues" ? (
								<>
									<History className="mr-2 h-4 w-4" />
									Activity
								</>
							) : (
								<>
									<ListTodo className="mr-2 h-4 w-4" />
									Tasks
								</>
							)}
						</Button>
						<div className="relative" ref={importExportMenuRef}>
							<Button
								type="button"
								variant="secondary"
								size="md"
								className="h-9 w-9 rounded-full p-0"
								aria-label="More actions"
								aria-haspopup="menu"
								aria-expanded={isImportExportMenuOpen}
								onClick={toggleImportExportMenu}
							>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
							{isImportExportMenuOpen ? (
								<div
									role="menu"
									className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[0_20px_50px_rgba(8,12,26,0.2)]"
								>
									<button
										type="button"
										role="menuitem"
										className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
										disabled={!canWrite || isImportingTasks}
										onClick={openImportPicker}
									>
										<Upload className="h-4 w-4" />
										Import tasks
									</button>
									<button
										type="button"
										role="menuitem"
										className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
										disabled={!issues}
										onClick={() => {
											setIsImportExportMenuOpen(false);
											exportTasks();
										}}
									>
										<Download className="h-4 w-4" />
										Export tasks
									</button>
								</div>
							) : null}
							<input
								ref={importFileInputRef}
								type="file"
								accept="application/json,.json"
								className="hidden"
								onChange={handleImportTasksFile}
							/>
						</div>
					</>
				}
			/>
			{importExportError ? (
				<p className="mb-4 text-sm text-[var(--danger)]">{importExportError}</p>
			) : null}
			{importExportMessage ? (
				<p className="mb-4 text-sm text-[var(--muted-text)]">
					{importExportMessage}
				</p>
			) : null}
			{statusUpdateError ? (
				<p className="mb-4 text-sm text-[var(--danger)]">{statusUpdateError}</p>
			) : null}

			<ProjectSettingsCard
				archived={projectData.project.archived}
				form={projectForm}
				onArchiveClick={() => setIsArchiveConfirmOpen(true)}
				onSubmit={submitProjectSettings}
				open={editingProject}
				setForm={setProjectForm}
			/>

			<div className="space-y-4">
				{projectView === "issues" ? (
					<ProjectTasksPanel
						assignableUsers={assignableUsers}
						assigneeId={assigneeId}
						canWrite={canWrite}
						dragOverStatus={dragOverStatus}
						groupBy={groupBy}
						groupedIssues={groupedIssues}
						issueLayout={issueLayout}
						kanbanColumns={kanbanColumns}
						onAddStatusFilter={addStatusFilter}
						onAssigneeChange={(value) =>
							updateProjectSearch(
								{ assignee: value || undefined },
								{ replace: true },
							)
						}
						onClearStatuses={() =>
							updateProjectSearch(
								{
									statuses: undefined,
								},
								{ replace: true },
							)
						}
						onCreateTask={() => {
							setCreateError(null);
							setIssueForm(createIssueDraft());
							setCreateOpen(true);
						}}
						onGroupByChange={(value) =>
							updateProjectSearch(
								{
									groupBy: value as ProjectSearch["groupBy"],
								},
								{ replace: true },
							)
						}
						onKanbanColumnDragLeave={(status) =>
							setDragOverStatus((current) =>
								current === status ? null : current,
							)
						}
						onKanbanColumnDragOver={handleKanbanColumnDragOver}
						onKanbanColumnDrop={handleKanbanColumnDrop}
						onPriorityChange={(value) =>
							updateProjectSearch(
								{
									priority: (value || undefined) as ProjectSearch["priority"],
								},
								{ replace: true },
							)
						}
						onRemoveStatus={(value) =>
							updateProjectSearch(
								{
									statuses: serializeStatusFilters(
										selectedStatuses.filter((item) => item !== value),
									),
								},
								{ replace: true },
							)
						}
						onSearchChange={(value) =>
							updateProjectSearch({ q: value }, { replace: true })
						}
						onSortChange={(value) =>
							updateProjectSearch(
								{
									sort: value as ProjectSearch["sort"],
								},
								{ replace: true },
							)
						}
						onToggleLayout={(layout) =>
							updateProjectSearch(
								{
									layout,
								},
								{ replace: true },
							)
						}
						priority={priority}
						renderKanbanIssueNode={(node) => (
							<ProjectIssueKanbanTree
								assignableUserById={assignableUserById}
								canWrite={canWrite}
								draggingIssueId={draggingIssueId}
								nodes={[node as ProjectIssueTreeNode]}
								onDragEnd={handleKanbanDragEnd}
								onDragStart={handleKanbanDragStart}
							/>
						)}
						renderListIssueNode={(node) => (
							<ProjectIssueListTree
								assignableUserById={assignableUserById}
								assignableUsers={assignableUsers}
								canWrite={canWrite}
								nodes={[node as ProjectIssueTreeNode]}
								onAssigneeChange={(issueId, nextAssigneeId) => {
									void updateIssue({
										issueId: issueId as Id<"issues">,
										assigneeId: (nextAssigneeId || null) as Id<"users"> | null,
									});
								}}
								onPriorityChange={(issueId, nextPriority) => {
									void updateIssue({
										issueId: issueId as Id<"issues">,
										priority: nextPriority,
									});
								}}
								onStatusChange={(issue, nextStatus) => {
									void handleIssueStatusChange(
										issue as ProjectIssueRow,
										nextStatus,
									);
								}}
							/>
						)}
						search={search}
						selectedStatuses={selectedStatuses}
						showEmptyState={Boolean(issues) && issues.length === 0}
						sortBy={sortBy}
						statusPicker={statusPicker}
					/>
				) : (
					<Card className="min-h-[calc(100dvh-220px)]">
						<CardHeader>
							<CardTitle>Project Activity</CardTitle>
						</CardHeader>
						<CardContent>
							{projectActivity === undefined ? (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									Loading activity…
								</p>
							) : (
								<ActivityFeed activities={projectActivity} />
							)}
						</CardContent>
					</Card>
				)}
			</div>

			<ProjectMembersDialog
				canManageMembers={projectData.canManageMembers}
				createdBy={projectData.project.createdBy}
				memberRows={memberRows}
				onClose={() => setIsMembersModalOpen(false)}
				onInviteMembers={() => {
					setIsMembersModalOpen(false);
					setIsInviteModalOpen(true);
				}}
				onRemoveMember={(member) =>
					setMemberToRemove({
						id: member.id as Id<"users">,
						name: member.name,
					})
				}
				open={isMembersModalOpen}
			/>

			<ProjectInviteDialog
				inviteCandidates={inviteCandidates}
				inviteEmail={inviteEmail}
				inviteError={inviteError}
				inviteMessage={inviteMessage}
				inviteSearch={inviteSearch}
				isSendingInvite={isSendingInvite}
				onAddMember={(userId) =>
					void addMember({
						projectId,
						userId: userId as Id<"users">,
					})
				}
				onClose={() => setIsInviteModalOpen(false)}
				onInviteEmailChange={setInviteEmail}
				onInviteSearchChange={setInviteSearch}
				onRevokeInvite={(invite) =>
					setInviteToRevoke({
						id: invite.id as Id<"projectInvites">,
						email: invite.email,
					})
				}
				onSubmit={submitEmailInvite}
				open={projectData.canManageMembers && isInviteModalOpen}
				projectInvites={projectInvites}
			/>

			<IssueDraftDialog
				assignableUsers={assignableUsers}
				dialogLabel="Create task"
				draft={issueForm}
				error={createError}
				issueLists={issueLists}
				onClose={() => {
					setCreateError(null);
					setIssueForm(createIssueDraft());
					setCreateOpen(false);
				}}
				onParentIssueChange={(nextParentIssueId) => {
					const parentIssue = nextParentIssueId
						? projectIssueById.get(nextParentIssueId as Id<"issues">)
						: null;

					setIssueForm((prev) => ({
						...prev,
						parentIssueId: nextParentIssueId,
						listId:
							prev.listId || !parentIssue?.listId
								? prev.listId
								: parentIssue.listId,
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
				}}
				onSubmit={submitIssue}
				open={createOpen}
				parentIssueOptions={parentIssueOptions}
				setDraft={setIssueForm}
				submitLabel="Create task"
				title="Create Task"
			/>

			<ConfirmDialog
				open={Boolean(memberToRemove)}
				title="Remove project member"
				description={`Remove ${memberToRemove?.name ?? "this user"} from the project? They will lose access immediately.`}
				confirmLabel="Remove member"
				confirmingLabel="Removing..."
				isConfirming={isRemovingMember}
				onCancel={() => setMemberToRemove(null)}
				onConfirm={confirmRemoveMember}
			/>

			<ConfirmDialog
				open={Boolean(inviteToRevoke)}
				title="Revoke invite"
				description={`Revoke invite for ${inviteToRevoke?.email ?? "this email"}? They will no longer be able to join using this invite.`}
				confirmLabel="Revoke invite"
				confirmingLabel="Revoking..."
				isConfirming={isRevokingInvite}
				onCancel={() => setInviteToRevoke(null)}
				onConfirm={confirmRevokeInvite}
			/>

			<ConfirmDialog
				open={isArchiveConfirmOpen}
				title={
					projectData.project.archived ? "Unarchive project" : "Archive project"
				}
				description={
					projectData.project.archived
						? "Unarchive this project and make it active again?"
						: "Archive this project? It will be hidden from active project views."
				}
				confirmLabel={projectData.project.archived ? "Unarchive" : "Archive"}
				confirmingLabel="Updating..."
				isConfirming={isTogglingArchive}
				onCancel={() => setIsArchiveConfirmOpen(false)}
				onConfirm={confirmArchiveToggle}
			/>

			<ConfirmDialog
				open={Boolean(completionConfirm)}
				title="Complete parent task and sub-tasks"
				description={
					completionConfirm
						? `"${completionConfirm.title}" still has ${completionConfirm.unfinishedDescendantCount} unfinished sub-task${completionConfirm.unfinishedDescendantCount === 1 ? "" : "s"}. Mark all descendants as done too?`
						: ""
				}
				confirmLabel="Mark all done"
				confirmingLabel="Updating..."
				confirmVariant="primary"
				isConfirming={isCompletingIssueTree}
				onCancel={() => setCompletionConfirm(null)}
				onConfirm={confirmCascadeCompletion}
			/>
		</div>
	);
}
