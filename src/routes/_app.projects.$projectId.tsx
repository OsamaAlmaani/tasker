import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	Archive,
	Download,
	History,
	ListTodo,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Settings2,
	Upload,
	UserPlus,
	Users,
} from "lucide-react";
import {
	type DragEvent,
	type FormEvent,
	type ReactNode,
	useMemo,
	useState,
} from "react";
import { z } from "zod";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { ActivityFeed } from "#/features/tasker/components/ActivityFeed";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
	RemovableIssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { MemberAvatarStack } from "#/features/tasker/components/MemberAvatarStack";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import {
	type IssueDraft,
	IssueDraftDialog,
} from "#/features/tasker/issues/components/IssueDraftDialog";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";
import { useProjectTaskImportExport } from "#/features/tasker/projects/useProjectTaskImportExport";
import { issueFormSchema } from "#/features/tasker/validation";
import { cn, getClientErrorMessage } from "#/lib/utils";
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

function formatChildProgress(issue: ProjectIssueRow) {
	if (!issue.hasChildren) {
		return null;
	}

	return `${issue.completedChildIssueCount}/${issue.childIssueCount} done`;
}

function roundCompletionRate(issue: ProjectIssueRow) {
	return Math.round(issue.childCompletionRate * 100);
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

function InlineSelectTrigger({
	ariaLabel,
	value,
	options,
	onChange,
	children,
	className,
}: {
	ariaLabel: string;
	value: string;
	options: Array<{ value: string; label: string; disabled?: boolean }>;
	onChange: (value: string) => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<label className={cn("issue-inline-select", className)}>
			<span className="issue-inline-select-display">{children}</span>
			<select
				aria-label={ariaLabel}
				className="issue-inline-select-native"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function AssigneeAvatar({
	name,
	imageUrl,
	unassigned = false,
}: {
	name?: string;
	imageUrl?: string;
	unassigned?: boolean;
}) {
	const initials =
		name
			?.split(" ")
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() ?? "?";

	return (
		<span
			className={cn(
				"issue-assignee-avatar",
				unassigned ? "issue-assignee-avatar-unassigned" : "",
			)}
			title={name ?? "Unassigned"}
		>
			{imageUrl && !unassigned ? (
				<img
					src={imageUrl}
					alt={name ?? "Assignee"}
					className="h-full w-full object-cover"
				/>
			) : unassigned ? null : (
				initials
			)}
		</span>
	);
}

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

	const [projectForm, setProjectForm] = useState({
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

	function renderListIssueNode(node: IssueTreeNode) {
		const { issue, children } = node;
		const assignee = issue.assigneeId
			? assignableUserById.get(issue.assigneeId)
			: null;
		const progressLabel = formatChildProgress(issue);
		const completionRate = roundCompletionRate(issue);

		return (
			<div
				key={issue._id}
				className={cn(
					"issue-tree-node",
					issue.parentIssueId ? "issue-tree-node-child" : "",
				)}
			>
				<div
					className={cn(
						"issue-row issue-row-compact",
						issue.parentIssueId ? "issue-row-subissue" : "",
					)}
				>
					<Link
						to="/issues/$issueId"
						params={{ issueId: issue._id }}
						className="issue-row-main no-underline"
					>
						<div className="min-w-0">
							<div className="flex min-w-0 items-center gap-2">
								<Badge className="issue-row-id-badge">
									#{issue.issueNumber}
								</Badge>
								<p className="m-0 truncate whitespace-nowrap text-sm font-medium text-[var(--text)]">
									{issue.title}
								</p>
								{issue.parentIssueId ? (
									<Badge className="issue-hierarchy-badge">Sub-task</Badge>
								) : null}
							</div>
							<p className="m-0 truncate whitespace-nowrap text-xs text-[var(--muted-text)]">
								{issue.description?.trim() || "No description"}
							</p>
							{progressLabel ? (
								<div className="issue-progress-inline">
									<div className="issue-progress-bar" aria-hidden="true">
										<div
											className="issue-progress-bar-fill"
											style={{ width: `${completionRate}%` }}
										/>
									</div>
									<span className="issue-progress-text">
										{progressLabel} ({completionRate}%)
									</span>
								</div>
							) : null}
						</div>
					</Link>

					<div className="issue-row-col issue-row-col-assignee">
						{canWrite ? (
							<InlineSelectTrigger
								ariaLabel="Assign task"
								value={issue.assigneeId ?? ""}
								onChange={(nextAssigneeId) => {
									void updateIssue({
										issueId: issue._id,
										assigneeId: (nextAssigneeId || null) as Id<"users"> | null,
									});
								}}
								options={[
									{ value: "", label: "Unassigned" },
									...(assignableUsers ?? []).map((user) => ({
										value: user._id,
										label: user.name,
									})),
								]}
								className="issue-inline-select-assignee"
							>
								<AssigneeAvatar
									name={assignee?.name}
									imageUrl={assignee?.imageUrl}
									unassigned={!assignee}
								/>
							</InlineSelectTrigger>
						) : (
							<AssigneeAvatar
								name={assignee?.name}
								imageUrl={assignee?.imageUrl}
								unassigned={!assignee}
							/>
						)}
					</div>

					<div className="issue-row-col issue-row-col-due">
						<Badge className="issue-row-badge">
							{issue.dueDate ? formatDate(issue.dueDate) : "No due"}
						</Badge>
					</div>

					<div className="issue-row-col issue-row-col-status">
						{canWrite ? (
							<InlineSelectTrigger
								ariaLabel="Update status"
								value={issue.status}
								onChange={(nextStatus) => {
									void handleIssueStatusChange(
										issue,
										nextStatus as (typeof ISSUE_STATUSES)[number],
									);
								}}
								options={ISSUE_STATUSES.map((value) => ({
									value,
									label: issueStatusLabel[value],
								}))}
								className="issue-inline-select-full"
							>
								<span className="issue-row-badge-slot">
									<IssueStatusBadge status={issue.status} />
								</span>
							</InlineSelectTrigger>
						) : (
							<span className="issue-row-badge-slot">
								<IssueStatusBadge status={issue.status} />
							</span>
						)}
					</div>

					<div className="issue-row-col issue-row-col-priority">
						{canWrite ? (
							<InlineSelectTrigger
								ariaLabel="Update priority"
								value={issue.priority}
								onChange={(nextPriority) => {
									void updateIssue({
										issueId: issue._id,
										priority: nextPriority as (typeof ISSUE_PRIORITIES)[number],
									});
								}}
								options={ISSUE_PRIORITIES.map((value) => ({
									value,
									label: issuePriorityLabel[value],
								}))}
								className="issue-inline-select-full"
							>
								<span className="issue-row-badge-slot">
									<IssuePriorityBadge priority={issue.priority} />
								</span>
							</InlineSelectTrigger>
						) : (
							<span className="issue-row-badge-slot">
								<IssuePriorityBadge priority={issue.priority} />
							</span>
						)}
					</div>
				</div>

				{children.length ? (
					<div className="issue-tree-children">
						{children.map((childNode) => renderListIssueNode(childNode))}
					</div>
				) : null}
			</div>
		);
	}

	function renderKanbanIssueNode(node: IssueTreeNode) {
		const { issue, children } = node;
		const assignee = issue.assigneeId
			? assignableUserById.get(issue.assigneeId)
			: null;
		const progressLabel = formatChildProgress(issue);
		const completionRate = roundCompletionRate(issue);

		return (
			<div
				key={issue._id}
				className={cn(
					"kanban-tree-node",
					issue.parentIssueId ? "kanban-tree-node-child" : "",
				)}
			>
				<article
					aria-label={`Task ${issue.issueNumber}`}
					className={cn(
						"kanban-card",
						issue.parentIssueId ? "kanban-card-subissue" : "",
						draggingIssueId === issue._id ? "kanban-card-dragging" : "",
					)}
					draggable={canWrite}
					onDragStart={(event) => handleKanbanDragStart(event, issue)}
					onDragEnd={handleKanbanDragEnd}
				>
					<Link
						to="/issues/$issueId"
						params={{ issueId: issue._id }}
						className="kanban-card-link no-underline"
					>
						<div className="flex items-center gap-2">
							<Badge className="issue-row-id-badge">#{issue.issueNumber}</Badge>
							<p className="m-0 truncate text-sm font-medium text-[var(--text)]">
								{issue.title}
							</p>
						</div>
						<p className="m-0 mt-1 truncate text-xs text-[var(--muted-text)]">
							{issue.description?.trim() || "No description"}
						</p>
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							{issue.parentIssueId ? (
								<Badge className="issue-hierarchy-badge">Sub-task</Badge>
							) : null}
							{progressLabel ? (
								<Badge className="issue-progress-badge">
									{progressLabel} ({completionRate}%)
								</Badge>
							) : null}
						</div>
						{progressLabel ? (
							<div className="issue-progress-inline mt-2">
								<div className="issue-progress-bar" aria-hidden="true">
									<div
										className="issue-progress-bar-fill"
										style={{ width: `${completionRate}%` }}
									/>
								</div>
							</div>
						) : null}
					</Link>

					<div className="mt-2 flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5">
							<AssigneeAvatar
								name={assignee?.name}
								imageUrl={assignee?.imageUrl}
								unassigned={!assignee}
							/>
							{issue.dueDate ? (
								<Badge className="px-1.5 py-0 text-[10px]">
									{formatDate(issue.dueDate)}
								</Badge>
							) : null}
						</div>
						<IssuePriorityBadge priority={issue.priority} />
					</div>
				</article>

				{children.length ? (
					<div className="kanban-subcards">
						{children.map((childNode) => renderKanbanIssueNode(childNode))}
					</div>
				) : null}
			</div>
		);
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

			{editingProject ? (
				<Card className="mb-4">
					<CardHeader>
						<CardTitle>Project Settings</CardTitle>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={submitProjectSettings}
							className="grid gap-3 md:grid-cols-2"
						>
							<div>
								<Label>Name</Label>
								<Input
									value={projectForm.name}
									onChange={(event) =>
										setProjectForm((prev) => ({
											...prev,
											name: event.target.value,
										}))
									}
								/>
							</div>
							<div>
								<Label>Color</Label>
								<Input
									type="color"
									value={projectForm.color}
									onChange={(event) =>
										setProjectForm((prev) => ({
											...prev,
											color: event.target.value,
										}))
									}
								/>
							</div>
							<div className="md:col-span-2">
								<Label>Description</Label>
								<Textarea
									value={projectForm.description}
									onChange={(event) =>
										setProjectForm((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
								/>
							</div>
							<div className="flex items-center gap-2">
								<Switch
									checked={projectForm.allowMemberInvites}
									onChange={(next) =>
										setProjectForm((prev) => ({
											...prev,
											allowMemberInvites: next,
										}))
									}
								/>
								<span className="text-sm text-[var(--muted-text)]">
									Allow member invites
								</span>
							</div>
							<div className="flex items-center gap-2">
								<Switch
									checked={projectForm.allowIssueDelete}
									onChange={(next) =>
										setProjectForm((prev) => ({
											...prev,
											allowIssueDelete: next,
										}))
									}
								/>
								<span className="text-sm text-[var(--muted-text)]">
									Allow task deletion
								</span>
							</div>
							<div className="md:col-span-2">
								<Button type="submit">Save project</Button>
							</div>
							<div className="md:col-span-2">
								<div className="flex justify-end border-t border-[var(--line)] pt-3">
									<Button
										type="button"
										variant={
											projectData.project.archived ? "secondary" : "danger"
										}
										onClick={() => setIsArchiveConfirmOpen(true)}
									>
										<Archive className="mr-2 h-4 w-4" />
										{projectData.project.archived
											? "Unarchive project"
											: "Archive project"}
									</Button>
								</div>
							</div>
						</form>
					</CardContent>
				</Card>
			) : null}

			<div className="space-y-4">
				{projectView === "issues" ? (
					<Card>
						<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
							<CardTitle>Tasks</CardTitle>
							{canWrite ? (
								<Button
									variant="secondary"
									onClick={() => {
										setCreateError(null);
										setIssueForm(createIssueDraft());
										setCreateOpen(true);
									}}
								>
									<Plus className="mr-2 h-4 w-4" />
									New Task
								</Button>
							) : null}
						</CardHeader>
						<CardContent>
							<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
								<div className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1">
									<Button
										type="button"
										size="sm"
										variant={issueLayout === "list" ? "secondary" : "ghost"}
										className="h-7 px-3"
										onClick={() =>
											updateProjectSearch(
												{
													layout: "list",
												},
												{ replace: true },
											)
										}
									>
										List
									</Button>
									<Button
										type="button"
										size="sm"
										variant={issueLayout === "kanban" ? "secondary" : "ghost"}
										className="h-7 px-3"
										onClick={() =>
											updateProjectSearch(
												{
													layout: "kanban",
												},
												{ replace: true },
											)
										}
									>
										Kanban
									</Button>
								</div>
								{issueLayout === "kanban" ? (
									<p className="m-0 text-xs text-[var(--muted-text)]">
										Drag cards between status columns to update status.
									</p>
								) : null}
							</div>

							<div
								className={cn(
									"mb-3 grid gap-2",
									issueLayout === "list" ? "md:grid-cols-6" : "md:grid-cols-5",
								)}
							>
								<Input
									value={search}
									onChange={(event) =>
										updateProjectSearch(
											{ q: event.target.value },
											{ replace: true },
										)
									}
									placeholder="Search tasks"
								/>
								<Select
									value={statusPicker}
									onChange={(event) => addStatusFilter(event.target.value)}
								>
									<option value="">Add status filter</option>
									{ISSUE_STATUSES.map((value) => (
										<option
											key={value}
											value={value}
											disabled={selectedStatuses.includes(value)}
										>
											{issueStatusLabel[value]}
										</option>
									))}
								</Select>
								<Select
									value={priority}
									onChange={(event) =>
										updateProjectSearch(
											{
												priority: (event.target.value ||
													undefined) as ProjectSearch["priority"],
											},
											{ replace: true },
										)
									}
								>
									<option value="">All priority</option>
									{ISSUE_PRIORITIES.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</Select>
								<Select
									value={assigneeId}
									onChange={(event) =>
										updateProjectSearch(
											{ assignee: event.target.value || undefined },
											{ replace: true },
										)
									}
								>
									<option value="">All assignees</option>
									{(assignableUsers ?? []).map((user) => (
										<option key={user._id} value={user._id}>
											{user.name}
										</option>
									))}
								</Select>
								{issueLayout === "list" ? (
									<Select
										value={groupBy}
										onChange={(event) =>
											updateProjectSearch(
												{
													groupBy: event.target
														.value as ProjectSearch["groupBy"],
												},
												{ replace: true },
											)
										}
									>
										<option value="list">Group: List</option>
										<option value="status">Group: Status</option>
									</Select>
								) : null}
								<Select
									value={sortBy}
									onChange={(event) =>
										updateProjectSearch(
											{
												sort: event.target.value as ProjectSearch["sort"],
											},
											{ replace: true },
										)
									}
								>
									<option value="updated_desc">Updated</option>
									<option value="created_desc">Created</option>
									<option value="priority_desc">Priority</option>
									<option value="due_asc">Due date</option>
								</Select>
							</div>

							{selectedStatuses.length ? (
								<div className="mb-3 flex flex-wrap items-center gap-2">
									{selectedStatuses.map((value) => (
										<RemovableIssueStatusBadge
											key={value}
											status={value}
											onRemove={() =>
												updateProjectSearch(
													{
														statuses: serializeStatusFilters(
															selectedStatuses.filter((item) => item !== value),
														),
													},
													{ replace: true },
												)
											}
										/>
									))}
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() =>
											updateProjectSearch(
												{
													statuses: undefined,
												},
												{ replace: true },
											)
										}
									>
										Clear statuses
									</Button>
								</div>
							) : null}

							{issueLayout === "list" ? (
								<div className="space-y-4">
									{groupedIssues.map((group) => (
										<div key={group.key} className="space-y-2">
											<div className="flex items-center justify-between">
												<p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
													{group.title}
												</p>
												<Badge>{group.items.length}</Badge>
											</div>

											{group.tree.map((node) => renderListIssueNode(node))}
										</div>
									))}
									{issues && issues.length === 0 ? (
										<p className="m-0 text-sm text-[var(--muted-text)]">
											No tasks found.
										</p>
									) : null}
								</div>
							) : (
								<div className="kanban-board">
									{kanbanColumns.map((column) => (
										<section
											key={column.status}
											aria-label={`${column.title} column`}
											className={cn(
												"kanban-column",
												dragOverStatus === column.status
													? "kanban-column-active"
													: "",
											)}
											onDragOver={(event) =>
												handleKanbanColumnDragOver(event, column.status)
											}
											onDragLeave={() =>
												setDragOverStatus((current) =>
													current === column.status ? null : current,
												)
											}
											onDrop={(event) =>
												handleKanbanColumnDrop(event, column.status)
											}
										>
											<div className="kanban-column-header">
												<p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
													{column.title}
												</p>
												<Badge>{column.items.length}</Badge>
											</div>
											<div className="kanban-column-body">
												{column.items.length ? (
													column.tree.map((node) => renderKanbanIssueNode(node))
												) : (
													<p className="kanban-empty">
														No tasks in this status.
													</p>
												)}
											</div>
										</section>
									))}
								</div>
							)}
						</CardContent>
					</Card>
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

			{isMembersModalOpen ? (
				<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Project members"
						className="w-full max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
					>
						<div className="mb-4 flex items-center justify-between gap-3">
							<h2 className="m-0 flex items-center gap-2 text-base font-semibold text-[var(--text)]">
								<Users className="h-4 w-4" />
								Members ({memberRows.length})
							</h2>
							<div className="flex items-center gap-2">
								{projectData.canManageMembers ? (
									<Button
										size="sm"
										variant="secondary"
										onClick={() => {
											setIsMembersModalOpen(false);
											setIsInviteModalOpen(true);
										}}
									>
										<UserPlus className="mr-1.5 h-3.5 w-3.5" />
										Invite members
									</Button>
								) : null}
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setIsMembersModalOpen(false)}
								>
									Close
								</Button>
							</div>
						</div>

						<div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
							{memberRows.map((row) => (
								<div
									key={row.membership._id}
									className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2"
								>
									<div className="flex items-center gap-3">
										<div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-muted)] text-[11px] font-semibold text-[var(--muted-text)]">
											{row.user.imageUrl ? (
												<img
													src={row.user.imageUrl}
													alt={row.user.name}
													className="h-full w-full object-cover"
												/>
											) : (
												row.user.name.slice(0, 2).toUpperCase()
											)}
										</div>
										<div>
											<p className="m-0 text-sm font-medium text-[var(--text)]">
												{row.user.name}
											</p>
											<p className="m-0 text-xs text-[var(--muted-text)]">
												{row.user.email}
											</p>
										</div>
									</div>
									{projectData.canManageMembers &&
									row.user._id !== projectData.project.createdBy ? (
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setMemberToRemove({
													id: row.user._id,
													name: row.user.name,
												})
											}
										>
											Remove
										</Button>
									) : null}
								</div>
							))}
						</div>
					</div>
				</div>
			) : null}

			{projectData.canManageMembers && isInviteModalOpen ? (
				<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Invite members"
						className="w-full max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
					>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="m-0 flex items-center gap-2 text-base font-semibold text-[var(--text)]">
								<UserPlus className="h-4 w-4" />
								Invite members
							</h2>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setIsInviteModalOpen(false)}
							>
								Close
							</Button>
						</div>

						<div className="space-y-3">
							<form onSubmit={submitEmailInvite} className="space-y-2">
								<Label>Invite by email</Label>
								<div className="flex gap-2">
									<Input
										type="email"
										value={inviteEmail}
										onChange={(event) => setInviteEmail(event.target.value)}
										placeholder="teammate@company.com"
									/>
									<Button
										type="submit"
										size="md"
										variant="secondary"
										className="whitespace-nowrap"
										disabled={isSendingInvite}
									>
										{isSendingInvite ? "Sending..." : "Send invite"}
									</Button>
								</div>
								{inviteError ? (
									<p className="m-0 text-sm text-[var(--danger)]">
										{inviteError}
									</p>
								) : null}
								{inviteMessage ? (
									<p className="m-0 text-sm text-[var(--muted-text)]">
										{inviteMessage}
									</p>
								) : null}
							</form>

							<div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
								<p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
									Pending invites
								</p>
								<div className="space-y-2">
									{(projectInvites ?? [])
										.filter((row) => row.invite.status === "pending")
										.map((row) => (
											<div
												key={row.invite._id}
												className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
											>
												<div>
													<p className="m-0 text-sm font-medium text-[var(--text)]">
														{row.invite.email}
													</p>
													<p className="m-0 text-xs text-[var(--muted-text)]">
														Sent {formatRelative(row.invite.createdAt)}
													</p>
												</div>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() =>
														setInviteToRevoke({
															id: row.invite._id,
															email: row.invite.email,
														})
													}
												>
													Revoke
												</Button>
											</div>
										))}
									{!projectInvites?.some(
										(row) => row.invite.status === "pending",
									) ? (
										<p className="m-0 text-sm text-[var(--muted-text)]">
											No pending invites.
										</p>
									) : null}
								</div>
							</div>

							<Label>Add existing users</Label>
							<Input
								value={inviteSearch}
								onChange={(event) => setInviteSearch(event.target.value)}
								placeholder="Search users"
							/>
							{(inviteCandidates ?? []).map((user) => (
								<div
									key={user._id}
									className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2"
								>
									<div>
										<p className="m-0 text-sm font-medium text-[var(--text)]">
											{user.name}
										</p>
										<p className="m-0 text-xs text-[var(--muted-text)]">
											{user.email}
										</p>
									</div>
									<Button
										size="sm"
										variant="secondary"
										onClick={() =>
											addMember({
												projectId,
												userId: user._id,
											})
										}
									>
										<RefreshCw className="mr-1 h-3.5 w-3.5" />
										Add
									</Button>
								</div>
							))}
							{!inviteCandidates?.length ? (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									No invite candidates.
								</p>
							) : null}
						</div>
					</div>
				</div>
			) : null}

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
