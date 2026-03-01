import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	Archive,
	Plus,
	RefreshCw,
	Settings2,
	UserPlus,
	Users,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
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
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issueStatusLabel,
} from "#/features/tasker/model";
import { issueFormSchema } from "#/features/tasker/validation";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/projects/$projectId")({
	component: ProjectDetailPage,
});

function ProjectDetailPage() {
	const { projectId: projectIdParam } = Route.useParams();
	const projectId = projectIdParam as Id<"projects">;
	const projectData = useQuery(api.projects.getById, { projectId });
	const me = useQuery(api.users.me);

	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<string>("");
	const [priority, setPriority] = useState<string>("");
	const [assigneeId, setAssigneeId] = useState<string>("");
	const [sortBy, setSortBy] = useState<
		"updated_desc" | "created_desc" | "priority_desc" | "due_asc"
	>("updated_desc");

	const issues = useQuery(api.issues.listByProject, {
		projectId,
		search: search || undefined,
		status: (status || undefined) as
			| (typeof ISSUE_STATUSES)[number]
			| undefined,
		priority: (priority || undefined) as
			| (typeof ISSUE_PRIORITIES)[number]
			| undefined,
		assigneeId: (assigneeId || undefined) as Id<"users"> | undefined,
		sortBy,
	});

	const assignableUsers = useQuery(api.users.listAssignableUsers, {
		projectId,
	});

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

	const [issueForm, setIssueForm] = useState({
		title: "",
		description: "",
		status: "todo",
		priority: "none",
		assigneeId: "",
		dueDate: "",
		labels: "",
	});

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
	const [isRevokingInvite, setIsRevokingInvite] = useState(false);
	const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
	const [isTogglingArchive, setIsTogglingArchive] = useState(false);
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

	if (!projectData) {
		return <div className="page-loading">Loading project…</div>;
	}

	async function submitIssue(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCreateError(null);

		const parsed = issueFormSchema.safeParse(issueForm);
		if (!parsed.success) {
			setCreateError(
				parsed.error.issues[0]?.message ?? "Issue form is invalid.",
			);
			return;
		}

		try {
			await createIssue({
				projectId,
				title: parsed.data.title,
				description: parsed.data.description,
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
			setIssueForm({
				title: "",
				description: "",
				status: "todo",
				priority: "none",
				assigneeId: "",
				dueDate: "",
				labels: "",
			});
			setCreateOpen(false);
		} catch (mutationError) {
			setCreateError(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to create issue.",
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
			setInviteError(
				error instanceof Error ? error.message : "Failed to send invite.",
			);
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

	return (
		<div>
			<PageHeader
				title={`${projectData.project.key} · ${projectData.project.name}`}
				description={projectData.project.description}
				actions={
					<>
						{canWrite ? (
							<Button
								variant="secondary"
								onClick={() => setEditingProject((value) => !value)}
							>
								<Settings2 className="mr-2 h-4 w-4" />
								Settings
							</Button>
						) : null}
						{canWrite ? (
							<Button
								variant="secondary"
								onClick={() => setCreateOpen((value) => !value)}
							>
								<Plus className="mr-2 h-4 w-4" />
								New Issue
							</Button>
						) : null}
						{canWrite ? (
							<Button
								variant="ghost"
								onClick={() => setIsArchiveConfirmOpen(true)}
							>
								<Archive className="mr-2 h-4 w-4" />
								{projectData.project.archived ? "Unarchive" : "Archive"}
							</Button>
						) : null}
					</>
				}
			/>

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
									Allow issue deletion
								</span>
							</div>
							<div className="md:col-span-2">
								<Button type="submit">Save project</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			) : null}

			{createOpen ? (
				<Card className="mb-4">
					<CardHeader>
						<CardTitle>Create Issue</CardTitle>
					</CardHeader>
					<CardContent>
						<form onSubmit={submitIssue} className="grid gap-3 md:grid-cols-2">
							<div className="md:col-span-2">
								<Label>Title</Label>
								<Input
									value={issueForm.title}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											title: event.target.value,
										}))
									}
								/>
							</div>
							<div className="md:col-span-2">
								<Label>Description</Label>
								<Textarea
									value={issueForm.description}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
								/>
							</div>
							<div>
								<Label>Status</Label>
								<Select
									value={issueForm.status}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											status: event.target.value,
										}))
									}
								>
									{ISSUE_STATUSES.map((value) => (
										<option key={value} value={value}>
											{issueStatusLabel[value]}
										</option>
									))}
								</Select>
							</div>
							<div>
								<Label>Priority</Label>
								<Select
									value={issueForm.priority}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											priority: event.target.value,
										}))
									}
								>
									{ISSUE_PRIORITIES.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</Select>
							</div>
							<div>
								<Label>Assignee</Label>
								<Select
									value={issueForm.assigneeId}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											assigneeId: event.target.value,
										}))
									}
								>
									<option value="">Unassigned</option>
									{(assignableUsers ?? []).map((user) => (
										<option key={user._id} value={user._id}>
											{user.name}
										</option>
									))}
								</Select>
							</div>
							<div>
								<Label>Due Date</Label>
								<Input
									type="date"
									value={issueForm.dueDate}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											dueDate: event.target.value,
										}))
									}
								/>
							</div>
							<div className="md:col-span-2">
								<Label>Labels (comma-separated)</Label>
								<Input
									value={issueForm.labels}
									onChange={(event) =>
										setIssueForm((prev) => ({
											...prev,
											labels: event.target.value,
										}))
									}
								/>
							</div>
							{createError ? (
								<p className="m-0 text-sm text-[var(--danger)]">
									{createError}
								</p>
							) : null}
							<div className="md:col-span-2">
								<Button type="submit">Create issue</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Issues</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="mb-3 grid gap-2 md:grid-cols-5">
								<Input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="Search issues"
								/>
								<Select
									value={status}
									onChange={(event) => setStatus(event.target.value)}
								>
									<option value="">All status</option>
									{ISSUE_STATUSES.map((value) => (
										<option key={value} value={value}>
											{issueStatusLabel[value]}
										</option>
									))}
								</Select>
								<Select
									value={priority}
									onChange={(event) => setPriority(event.target.value)}
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
									onChange={(event) => setAssigneeId(event.target.value)}
								>
									<option value="">All assignees</option>
									{(assignableUsers ?? []).map((user) => (
										<option key={user._id} value={user._id}>
											{user.name}
										</option>
									))}
								</Select>
								<Select
									value={sortBy}
									onChange={(event) =>
										setSortBy(
											event.target.value as
												| "updated_desc"
												| "created_desc"
												| "priority_desc"
												| "due_asc",
										)
									}
								>
									<option value="updated_desc">Updated</option>
									<option value="created_desc">Created</option>
									<option value="priority_desc">Priority</option>
									<option value="due_asc">Due date</option>
								</Select>
							</div>

							<div className="space-y-2">
								{(issues ?? []).map((issue) => (
									<div key={issue._id} className="issue-row flex-wrap gap-y-2">
										<Link
											to="/issues/$issueId"
											params={{ issueId: issue._id }}
											className="flex min-w-0 flex-1 no-underline"
										>
											<div className="min-w-0">
												<p className="m-0 truncate text-sm font-medium text-[var(--text)]">
													{issue.title}
												</p>
												<p className="m-0 text-xs text-[var(--muted-text)]">
													#{issue.issueNumber} · Updated{" "}
													{formatRelative(issue.updatedAt)}
												</p>
											</div>
										</Link>
										<div className="ml-auto flex items-center gap-2">
											{issue.dueDate ? (
												<Badge>{formatDate(issue.dueDate)}</Badge>
											) : null}
											<IssuePriorityBadge priority={issue.priority} />
											<IssueStatusBadge status={issue.status} />
											{canWrite ? (
												<Select
													className="w-36"
													value={issue.status}
													onChange={(event) => {
														void updateIssue({
															issueId: issue._id,
															status: event.target
																.value as (typeof ISSUE_STATUSES)[number],
														});
													}}
												>
													{ISSUE_STATUSES.map((value) => (
														<option key={value} value={value}>
															{issueStatusLabel[value]}
														</option>
													))}
												</Select>
											) : null}
										</div>
									</div>
								))}
								{issues && issues.length === 0 ? (
									<p className="m-0 text-sm text-[var(--muted-text)]">
										No issues found.
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Project Activity</CardTitle>
						</CardHeader>
						<CardContent>
							<ActivityFeed activities={projectData.recentActivity} />
						</CardContent>
					</Card>
				</div>

				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Users className="h-4 w-4" />
								Members ({memberRows.length})
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{memberRows.map((row) => (
								<div
									key={row.membership._id}
									className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2"
								>
									<div>
										<p className="m-0 text-sm font-medium text-[var(--text)]">
											{row.user.name}
										</p>
										<p className="m-0 text-xs text-[var(--muted-text)]">
											{row.user.email}
										</p>
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
						</CardContent>
					</Card>

					{projectData.canManageMembers ? (
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<UserPlus className="h-4 w-4" />
									Invite Users
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
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
											size="sm"
											variant="secondary"
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
							</CardContent>
						</Card>
					) : null}
				</div>
			</div>

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
		</div>
	);
}
