import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useMemo, useState } from "react";
import type { IssueDraft } from "#/features/tasker/issues/components/IssueDraftDialog";
import { useIssueStatusFlow } from "#/features/tasker/issues/useIssueStatusFlow";
import type { ISSUE_PRIORITIES, ISSUE_STATUSES } from "#/features/tasker/model";
import {
	buildIssueCustomFieldSubmission,
	normalizeIssueCustomFieldDraftValues,
	normalizeProjectCustomFields,
} from "#/features/tasker/projectCustomFields";
import { normalizeProjectLabels } from "#/features/tasker/projectLabels";
import { normalizeProjectStatuses } from "#/features/tasker/projectStatuses";
import {
	commentFormSchema,
	issueFormSchema,
} from "#/features/tasker/validation";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Doc, Id } from "#convex/_generated/dataModel";

type CommentRow = {
	comment: Doc<"comments">;
	author: Doc<"users"> | null;
};

export type TimelineItem =
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

export type IssueDetailRow = Doc<"issues"> & {
	childIssueCount: number;
	completedChildIssueCount: number;
	childCompletionRate: number;
	hasChildren: boolean;
};

type ChildIssueRow = {
	issue: IssueDetailRow;
	assignee: { name: string } | null;
};

type UseIssueDetailPageOptions = {
	issueId: Id<"issues">;
	navigateToProject: (
		projectId: Id<"projects">,
		options?: { replace?: boolean },
	) => void | Promise<void>;
};

function createSubIssueDraft(
	parentIssue?: IssueDetailRow,
	projectCustomFields?: ReturnType<typeof normalizeProjectCustomFields>,
): IssueDraft {
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
		customFieldValues: normalizeIssueCustomFieldDraftValues(
			projectCustomFields,
			parentIssue?.customFieldValues,
		),
		labels: parentIssue?.labels ?? [],
	};
}

export function useIssueDetailPage({
	issueId,
	navigateToProject,
}: UseIssueDetailPageOptions) {
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
	const [subIssueForm, setSubIssueForm] = useState(() => createSubIssueDraft());

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";
	const currentIssue = issueData?.issue as IssueDetailRow | undefined;
	const projectId = issueData?.project._id;
	const canDeleteIssue = Boolean(
		canWrite && issueData?.project.allowIssueDelete,
	);
	const projectStatuses = useMemo(
		() => normalizeProjectStatuses(issueData?.project.statuses),
		[issueData?.project.statuses],
	);
	const projectCustomFields = useMemo(
		() => normalizeProjectCustomFields(issueData?.project.customFields),
		[issueData?.project.customFields],
	);
	const projectLabels = useMemo(
		() => normalizeProjectLabels(issueData?.project.labels),
		[issueData?.project.labels],
	);

	const childIssueRows = useMemo(
		() => (issueData?.childIssues ?? []) as ChildIssueRow[],
		[issueData?.childIssues],
	);
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

		if (!projectId) {
			setDeleteError("Project context is unavailable for this task.");
			setShowDeleteConfirm(false);
			return;
		}

		setIsDeleting(true);
		setDeleteError(null);
		try {
			await deleteIssue({ issueId });
			await navigateToProject(projectId, { replace: true });
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

	function startTitleEdit() {
		if (!currentIssue) {
			return;
		}

		setEditingTitle(true);
		setTitleDraft(currentIssue.title);
	}

	function cancelTitleEdit() {
		setEditingTitle(false);
	}

	async function saveTitle() {
		if (!currentIssue) {
			return;
		}

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

	async function submitTitleEdit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await saveTitle();
	}

	function startDescriptionEdit() {
		setEditingDescription(true);
		setDescriptionDraft(currentIssue?.description ?? "");
	}

	function cancelDescriptionEdit() {
		setEditingDescription(false);
	}

	async function saveDescription() {
		await updateIssue({
			issueId,
			description: descriptionDraft,
		});
		setEditingDescription(false);
	}

	function openSubIssueForm() {
		setSubIssueError(null);
		setSubIssueForm(createSubIssueDraft(currentIssue, projectCustomFields));
		setSubIssueFormOpen(true);
	}

	function closeSubIssueForm() {
		setSubIssueError(null);
		setSubIssueForm(createSubIssueDraft(currentIssue, projectCustomFields));
		setSubIssueFormOpen(false);
	}

	async function submitSubIssue(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubIssueError(null);

		if (!projectId) {
			setSubIssueError("Project context is unavailable for this task.");
			return;
		}

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
				customFieldValues: buildIssueCustomFieldSubmission(
					projectCustomFields,
					parsed.data.customFieldValues,
				),
				labels: parsed.data.labels,
			});
			setSubIssueForm(createSubIssueDraft(currentIssue, projectCustomFields));
			setSubIssueFormOpen(false);
		} catch (error) {
			setSubIssueError(
				getClientErrorMessage(error, "Failed to create sub-task."),
			);
		}
	}

	function startCommentEdit(commentId: string, body: string) {
		setEditingCommentId(commentId);
		setCommentDraft(body);
	}

	function cancelCommentEdit() {
		setEditingCommentId(null);
	}

	async function saveComment(commentId: string) {
		await updateComment({
			commentId: commentId as Id<"comments">,
			body: commentDraft,
		});
		setEditingCommentId(null);
	}

	async function changeAssignee(value: string) {
		await updateIssue({
			issueId,
			assigneeId: (value || null) as Id<"users"> | null,
		});
	}

	async function changeDueDate(value: string) {
		await updateIssue({
			issueId,
			dueDate: value ? new Date(value).getTime() : null,
		});
	}

	async function changeList(value: string) {
		await updateIssue({
			issueId,
			listId: (value || null) as Id<"issueLists"> | null,
		});
	}

	async function changePriority(value: (typeof ISSUE_PRIORITIES)[number]) {
		await updateIssue({
			issueId,
			priority: value,
		});
	}

	async function changeStatus(value: (typeof ISSUE_STATUSES)[number]) {
		if (!currentIssue) {
			return;
		}

		await handleIssueStatusChange(currentIssue, value);
	}

	async function changeLabels(labels: string[]) {
		await updateIssue({
			issueId,
			labels,
		});
	}

	async function changeCustomFieldValues(
		customFieldValues: Record<string, string | boolean>,
	) {
		await updateIssue({
			issueId,
			customFieldValues: buildIssueCustomFieldSubmission(
				projectCustomFields,
				customFieldValues,
			),
		});
	}

	return {
		assignableUsers,
		canDeleteIssue,
		canWrite,
		cancelCommentEdit,
		cancelDescriptionEdit,
		cancelTitleEdit,
		changeAssignee,
		changeDueDate,
		changeCustomFieldValues,
		changeList,
		changeLabels,
		changePriority,
		changeStatus,
		childIssueRows,
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
		closeSubIssueForm,
		openSubIssueForm,
		projectId,
		projectCustomFields,
		projectLabels,
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
	};
}
