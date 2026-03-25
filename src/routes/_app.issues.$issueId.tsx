import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatRelative } from "#/features/tasker/format";
import {
	IssueMetadataPanel,
	IssueOverviewPanel,
} from "#/features/tasker/issues/components/IssueDetailPanels";
import { IssueDiscussionPanel } from "#/features/tasker/issues/components/IssueDiscussionPanel";
import {
	type IssueDraft,
	IssueDraftDialog,
} from "#/features/tasker/issues/components/IssueDraftDialog";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import type { ISSUE_PRIORITIES, ISSUE_STATUSES } from "#/features/tasker/model";
import {
	commentFormSchema,
	issueFormSchema,
} from "#/features/tasker/validation";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/issues/$issueId")({
	component: IssueDetailPage,
});

type CommentRow = {
	comment: Doc<"comments">;
	author: Doc<"users"> | null;
};

type TimelineItem =
	| {
			type: "comment";
			key: string;
			createdAt: number;
			comment: CommentRow["comment"];
			author: CommentRow["author"];
	  }
	| {
			type: "activity";
			key: string;
			createdAt: number;
			activity: Doc<"activities">;
	  };

type IssueDetailRow = Doc<"issues"> & {
	childIssueCount: number;
	completedChildIssueCount: number;
	childCompletionRate: number;
	hasChildren: boolean;
};

function createSubIssueDraft(parentIssue?: IssueDetailRow): IssueDraft {
	return {
		title: "",
		description: "",
		status: parentIssue?.status ?? ("todo" as (typeof ISSUE_STATUSES)[number]),
		priority:
			parentIssue?.priority ?? ("none" as (typeof ISSUE_PRIORITIES)[number]),
		assigneeId: parentIssue?.assigneeId ?? "",
		listId: parentIssue?.listId ?? "",
		parentIssueId: parentIssue?._id ?? "",
		dueDate: parentIssue?.dueDate
			? new Date(parentIssue.dueDate).toISOString().slice(0, 10)
			: "",
		labels: "",
	};
}

function IssueDetailPage() {
	const { issueId: issueIdParam } = Route.useParams();
	const issueId = issueIdParam as Id<"issues">;
	const navigate = useNavigate();

	const me = useQuery(api.users.me);
	const issueData = useQuery(api.issues.getById, { issueId });
	const commentsData = useQuery(
		api.comments.listByIssue,
		issueData ? { issueId } : "skip",
	);
	const activity = useQuery(
		api.issues.activity,
		issueData ? { issueId, limit: 40 } : "skip",
	);

	const issueProjectId = issueData?.issue.projectId;
	const assignableUsers = useQuery(
		api.users.listAssignableUsers,
		issueProjectId ? { projectId: issueProjectId } : "skip",
	);
	const issueLists = useQuery(
		api.issueLists.listByProject,
		issueProjectId ? { projectId: issueProjectId } : "skip",
	);
	const projectIssues = useQuery(
		api.issues.listByProject,
		issueProjectId
			? { projectId: issueProjectId, sortBy: "created_desc" }
			: "skip",
	);

	const createIssue = useMutation(api.issues.create);
	const updateIssue = useMutation(api.issues.update);
	const deleteIssue = useMutation(api.issues.remove);
	const createComment = useMutation(api.comments.create);
	const updateComment = useMutation(api.comments.update);

	const [comment, setComment] = useState("");
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [editingDescription, setEditingDescription] = useState(false);
	const [descriptionDraft, setDescriptionDraft] = useState("");
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [subIssueFormOpen, setSubIssueFormOpen] = useState(false);
	const [subIssueError, setSubIssueError] = useState<string | null>(null);
	const [subIssueForm, setSubIssueForm] = useState(createSubIssueDraft());

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";

	const commentRows = useMemo<CommentRow[]>(
		() => (commentsData?.comments ?? []) as CommentRow[],
		[commentsData?.comments],
	);
	const {
		completionConfirm,
		confirmCascadeCompletion,
		handleIssueStatusChange,
		isCompletingIssueTree,
		setCompletionConfirm,
		statusUpdateError,
	} = useIssueStatusFlow<IssueDetailRow>({
		issues: (projectIssues ?? []) as IssueDetailRow[],
		updateIssue,
	});
	const timelineItems = useMemo<TimelineItem[]>(() => {
		const commentItems: TimelineItem[] = commentRows.map((row) => ({
			type: "comment",
			key: `comment-${row.comment._id}`,
			createdAt: row.comment.updatedAt,
			comment: row.comment,
			author: row.author,
		}));
		const activityItems: TimelineItem[] = (activity ?? [])
			.filter((row) => !row.action.startsWith("comment."))
			.map((row) => ({
				type: "activity",
				key: `activity-${row._id}`,
				createdAt: row.createdAt,
				activity: row,
			}));

		return [...commentItems, ...activityItems].sort(
			(left, right) => left.createdAt - right.createdAt,
		);
	}, [activity, commentRows]);

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
	const projectId = issueData.project._id;
	const currentIssue = issueData.issue;
	const canDeleteIssue = canWrite && issueData.project.allowIssueDelete;
	const childIssueRows = issueData.childIssues ?? [];

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

	async function submitComment(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const parsed = commentFormSchema.safeParse({ body: comment });
		if (!parsed.success) {
			return;
		}

		await createComment({
			issueId,
			body: parsed.data.body,
		});
		setComment("");
	}

	async function confirmDeleteIssue() {
		if (!canDeleteIssue) {
			setShowDeleteConfirm(false);
			return;
		}

		setIsDeleting(true);
		setDeleteError(null);
		try {
			await deleteIssue({ issueId });
			await navigate({
				to: "/projects/$projectId",
				params: { projectId },
				replace: true,
			});
		} catch (error) {
			setDeleteError(
				getClientErrorMessage(
					error,
					"Task deletion is not allowed for this project.",
				),
			);
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	}

	async function saveTitle() {
		const nextTitle = titleDraft.trim();
		if (!nextTitle || nextTitle === currentIssue.title) {
			setEditingTitle(false);
			return;
		}

		await updateIssue({
			issueId,
			title: nextTitle,
		});
		setEditingTitle(false);
	}

	async function submitSubIssue(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubIssueError(null);

		const parsed = issueFormSchema.safeParse(subIssueForm);
		if (!parsed.success) {
			setSubIssueError(
				parsed.error.issues[0]?.message ?? "Sub-task form is invalid.",
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
				listId: (parsed.data.listId || undefined) as
					| Id<"issueLists">
					| undefined,
				parentIssueId: issueId,
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
			setSubIssueForm(createSubIssueDraft(currentIssue));
			setSubIssueFormOpen(false);
		} catch (error) {
			setSubIssueError(
				getClientErrorMessage(error, "Failed to create sub-task."),
			);
		}
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
					childIssueRows={
						childIssueRows as Array<{
							issue: IssueDetailRow;
							assignee: { name: string } | null;
						}>
					}
					currentIssue={currentIssue as IssueDetailRow}
					descriptionDraft={descriptionDraft}
					editingDescription={editingDescription}
					editingTitle={editingTitle}
					onCancelDescriptionEdit={() => setEditingDescription(false)}
					onCancelTitleEdit={() => setEditingTitle(false)}
					onDescriptionDraftChange={setDescriptionDraft}
					onOpenSubIssueForm={() => {
						setSubIssueError(null);
						setSubIssueForm(createSubIssueDraft(issueData.issue));
						setSubIssueFormOpen(true);
					}}
					onSaveDescription={async () => {
						await updateIssue({
							issueId,
							description: descriptionDraft,
						});
						setEditingDescription(false);
					}}
					onStartDescriptionEdit={() => {
						setEditingDescription(true);
						setDescriptionDraft(issueData.issue.description ?? "");
					}}
					onStartTitleEdit={() => {
						setEditingTitle(true);
						setTitleDraft(issueData.issue.title);
					}}
					onSubmitTitle={async (event) => {
						event.preventDefault();
						await saveTitle();
					}}
					onTitleDraftChange={setTitleDraft}
					parentIssue={issueData.parentIssue ?? null}
					titleDraft={titleDraft}
				/>

				<IssueMetadataPanel
					assignableUsers={assignableUsers}
					assigneeName={issueData.assignee?.name ?? undefined}
					canWrite={canWrite}
					currentIssue={currentIssue as IssueDetailRow}
					issueLists={issueLists}
					onAssigneeChange={(value) =>
						void updateIssue({
							issueId,
							assigneeId: (value || null) as Id<"users"> | null,
						})
					}
					onDueDateChange={(value) =>
						void updateIssue({
							issueId,
							dueDate: value ? new Date(value).getTime() : null,
						})
					}
					onListChange={(value) =>
						void updateIssue({
							issueId,
							listId: (value || null) as Id<"issueLists"> | null,
						})
					}
					onPriorityChange={(value) =>
						void updateIssue({
							issueId,
							priority: value,
						})
					}
					onStatusChange={(value) =>
						void handleIssueStatusChange(currentIssue, value)
					}
				/>

				<IssueDiscussionPanel
					canWrite={canWrite}
					comment={comment}
					commentDraft={commentDraft}
					currentUserId={me?._id}
					editingCommentId={editingCommentId}
					onCancelEditComment={() => setEditingCommentId(null)}
					onCommentChange={setComment}
					onCommentDraftChange={setCommentDraft}
					onCommentSubmit={submitComment}
					onSaveComment={async (commentId) => {
						await updateComment({
							commentId: commentId as Id<"comments">,
							body: commentDraft,
						});
						setEditingCommentId(null);
					}}
					onStartEditComment={(commentId, body) => {
						setEditingCommentId(commentId);
						setCommentDraft(body);
					}}
					timelineItems={timelineItems}
				/>
			</div>

			<IssueDraftDialog
				assignableUsers={assignableUsers}
				dialogLabel="Create sub-task"
				draft={subIssueForm}
				error={subIssueError}
				issueLists={issueLists}
				onClose={() => {
					setSubIssueError(null);
					setSubIssueForm(createSubIssueDraft(currentIssue));
					setSubIssueFormOpen(false);
				}}
				onSubmit={submitSubIssue}
				open={subIssueFormOpen}
				setDraft={setSubIssueForm}
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
