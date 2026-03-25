import {
	Download,
	History,
	ListTodo,
	MoreHorizontal,
	Settings2,
	Upload,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { ActivityFeed } from "#/features/tasker/components/ActivityFeed";
import { MemberAvatarStack } from "#/features/tasker/components/MemberAvatarStack";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { IssueDraftDialog } from "#/features/tasker/issues/components/IssueDraftDialog";
import { ProjectInviteDialog } from "#/features/tasker/projects/components/ProjectInviteDialog";
import {
	ProjectIssueKanbanTree,
	ProjectIssueListTree,
	type ProjectIssueTreeNode,
} from "#/features/tasker/projects/components/ProjectIssueTree";
import { ProjectMembersDialog } from "#/features/tasker/projects/components/ProjectMembersDialog";
import { ProjectSettingsCard } from "#/features/tasker/projects/components/ProjectSettingsCard";
import { ProjectTasksPanel } from "#/features/tasker/projects/components/ProjectTasksPanel";
import {
	type ProjectSearch,
	serializeStatusFilters,
} from "#/features/tasker/projects/projectSearch";
import {
	createIssueDraft,
	type ProjectDetailPageState,
	type ProjectIssueRow,
} from "#/features/tasker/projects/useProjectDetailPage";
import type { Id } from "#convex/_generated/dataModel";

type ProjectDetailContentProps = {
	page: ProjectDetailPageState;
	projectData: NonNullable<ProjectDetailPageState["projectData"]>;
	projectId: Id<"projects">;
	updateProjectSearch: (
		patch: Partial<ProjectSearch>,
		options?: { replace?: boolean },
	) => void;
};

export function ProjectDetailContent({
	page,
	projectData,
	projectId,
	updateProjectSearch,
}: ProjectDetailContentProps) {
	const {
		addMember,
		addStatusFilter,
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
		exportTasks,
		groupBy,
		groupedIssues,
		handleImportTasksFile,
		handleIssueStatusChange,
		handleKanbanColumnDragOver,
		handleKanbanColumnDrop,
		handleKanbanDragEnd,
		handleKanbanDragStart,
		handleParentIssueChange,
		importExportError,
		importExportMenuRef,
		importExportMessage,
		importFileInputRef,
		inviteCandidates,
		inviteEmail,
		inviteError,
		inviteMessage,
		inviteSearch,
		inviteToRevoke,
		isArchiveConfirmOpen,
		isCompletingIssueTree,
		isImportExportMenuOpen,
		isImportingTasks,
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
		memberRows,
		memberToRemove,
		membersForStack,
		openImportPicker,
		parentIssueOptions,
		priority,
		projectActivity,
		projectForm,
		projectInvites,
		projectView,
		search,
		selectedStatuses,
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
		setIssueForm,
		setMemberToRemove,
		setProjectForm,
		sortBy,
		statusPicker,
		statusUpdateError,
		submitEmailInvite,
		submitIssue,
		submitProjectSettings,
		syncProjectFormWithCurrentProject,
		toggleImportExportMenu,
		updateIssue,
	} = page;

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
							updateProjectSearch({ statuses: undefined }, { replace: true })
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
							updateProjectSearch({ layout }, { replace: true })
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
				onParentIssueChange={handleParentIssueChange}
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
