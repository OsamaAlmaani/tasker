import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatRelative } from "#/features/tasker/format";
import {
	IssueMetadataPanel,
	IssueOverviewPanel,
} from "#/features/tasker/issues/components/IssueDetailPanels";
import { IssueDiscussionPanel } from "#/features/tasker/issues/components/IssueDiscussionPanel";
import { IssueDraftDialog } from "#/features/tasker/issues/components/IssueDraftDialog";
import { useIssueDetailPage } from "#/features/tasker/issues/useIssueDetailPage";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/issues/$issueId")({
	component: IssueDetailPage,
});

function IssueDetailPage() {
	const { issueId: issueIdParam } = Route.useParams();
	const issueId = issueIdParam as Id<"issues">;
	const navigate = useNavigate();
	const {
		assignableUsers,
		canDeleteIssue,
		canWrite,
		cancelCommentEdit,
		cancelDescriptionEdit,
		cancelTitleEdit,
		changeAssignee,
		changeDueDate,
		changeList,
		changePriority,
		changeStatus,
		childIssueRows,
		closeSubIssueForm,
		comment,
		commentDraft,
		completionConfirm,
		confirmCascadeCompletion,
		confirmDeleteIssue,
		currentIssue,
		deleteError,
		descriptionDraft,
		editingCommentId,
		editingDescription,
		editingTitle,
		isCompletingIssueTree,
		isDeleting,
		issueData,
		issueLists,
		me,
		openSubIssueForm,
		projectId,
		projectStatuses,
		saveComment,
		saveDescription,
		setComment,
		setCommentDraft,
		setCompletionConfirm,
		setDescriptionDraft,
		setShowDeleteConfirm,
		setSubIssueForm,
		setTitleDraft,
		showDeleteConfirm,
		startCommentEdit,
		startDescriptionEdit,
		startTitleEdit,
		statusUpdateError,
		subIssueError,
		subIssueForm,
		subIssueFormOpen,
		submitComment,
		submitSubIssue,
		submitTitleEdit,
		timelineItems,
		titleDraft,
	} = useIssueDetailPage({
		issueId,
		navigateToProject: (nextProjectId, options) =>
			navigate({
				to: "/projects/$projectId",
				params: { projectId: nextProjectId },
				replace: options?.replace,
			}),
	});

	if (issueData === undefined) {
		return <div className="page-loading">Loading task…</div>;
	}

	if (issueData === null) {
		return (
			<div className="mx-auto max-w-xl">
				<Card>
					<CardHeader>
						<CardTitle>Task not found</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="m-0 text-sm text-[var(--muted-text)]">
							This task may have been deleted or you no longer have access.
						</p>
						<Link to="/projects" className="no-underline">
							<Button>Back to projects</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}
	if (!currentIssue || !projectId) {
		return <div className="page-loading">Loading task…</div>;
	}

	function goBack() {
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back();
			return;
		}

		void navigate({
			to: "/projects/$projectId",
			params: { projectId },
		});
	}

	return (
		<div>
			<PageHeader
				title={
					<span className="inline-flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-8 w-8 p-0"
							aria-label="Go back"
							title="Go back"
							onClick={goBack}
						>
							<ArrowLeft className="h-4 w-4" />
						</Button>
						<span>{`${issueData.project.key}-${issueData.issue.issueNumber}`}</span>
					</span>
				}
				description={`Updated ${formatRelative(issueData.issue.updatedAt)}`}
				actions={
					canDeleteIssue ? (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0 text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] hover:text-[var(--danger)]"
							disabled={isDeleting}
							aria-label="Delete task"
							title="Delete task"
							onClick={() => setShowDeleteConfirm(true)}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					) : null
				}
			/>
			{deleteError ? (
				<p className="mb-3 mt-0 text-sm text-[var(--danger)]">{deleteError}</p>
			) : null}
			{statusUpdateError ? (
				<p className="mb-3 mt-0 text-sm text-[var(--danger)]">
					{statusUpdateError}
				</p>
			) : null}

			<div className="issue-detail-layout">
				<IssueOverviewPanel
					canWrite={canWrite}
					childIssueRows={childIssueRows}
					currentIssue={currentIssue}
					descriptionDraft={descriptionDraft}
					editingDescription={editingDescription}
					editingTitle={editingTitle}
					onCancelDescriptionEdit={cancelDescriptionEdit}
					onCancelTitleEdit={cancelTitleEdit}
					onDescriptionDraftChange={setDescriptionDraft}
					onOpenSubIssueForm={openSubIssueForm}
					onSaveDescription={saveDescription}
					onStartDescriptionEdit={startDescriptionEdit}
					onStartTitleEdit={startTitleEdit}
					onSubmitTitle={submitTitleEdit}
					projectStatuses={projectStatuses}
					onTitleDraftChange={setTitleDraft}
					parentIssue={issueData.parentIssue ?? null}
					titleDraft={titleDraft}
				/>

				<IssueMetadataPanel
					assignableUsers={assignableUsers}
					assigneeName={issueData.assignee?.name ?? undefined}
					canWrite={canWrite}
					currentIssue={currentIssue}
					issueLists={issueLists}
					onAssigneeChange={(value) => void changeAssignee(value)}
					onDueDateChange={(value) => void changeDueDate(value)}
					onListChange={(value) => void changeList(value)}
					onPriorityChange={(value) => void changePriority(value)}
					onStatusChange={(value) => void changeStatus(value)}
					projectStatuses={projectStatuses}
				/>

				<IssueDiscussionPanel
					canWrite={canWrite}
					comment={comment}
					commentDraft={commentDraft}
					currentUserId={me?._id}
					editingCommentId={editingCommentId}
					onCancelEditComment={cancelCommentEdit}
					onCommentChange={setComment}
					onCommentDraftChange={setCommentDraft}
					onCommentSubmit={submitComment}
					onSaveComment={saveComment}
					onStartEditComment={startCommentEdit}
					timelineItems={timelineItems}
				/>
			</div>

			<IssueDraftDialog
				assignableUsers={assignableUsers}
				dialogLabel="Create sub-task"
				draft={subIssueForm}
				error={subIssueError}
				issueLists={issueLists}
				onClose={closeSubIssueForm}
				onSubmit={submitSubIssue}
				open={subIssueFormOpen}
				setDraft={setSubIssueForm}
				statusOptions={projectStatuses}
				submitLabel="Create sub-task"
				title="Create sub-task"
			/>

			<ConfirmDialog
				open={showDeleteConfirm}
				title="Delete task"
				description="This action will permanently remove this task from active views. You cannot undo this."
				confirmLabel="Delete task"
				isConfirming={isDeleting}
				onCancel={() => setShowDeleteConfirm(false)}
				onConfirm={confirmDeleteIssue}
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
