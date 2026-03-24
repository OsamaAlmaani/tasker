import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	Check,
	History,
	MessageSquare,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";
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

const activityLabel: Record<string, string> = {
	"project.created": "Created project",
	"project.updated": "Updated project",
	"project.archived": "Changed archive state",
	"project.member_added": "Added member",
	"project.member_removed": "Removed member",
	"project.invite_sent": "Sent invitation",
	"project.invite_revoked": "Revoked invitation",
	"project.invite_accepted": "Accepted invitation",
	"issue_list.created": "Created issue list",
	"issue_list.updated": "Updated issue list",
	"issue_list.deleted": "Deleted issue list",
	"issue.created": "Created issue",
	"issue.updated": "Updated issue",
	"issue.deleted": "Deleted issue",
	"issue.list_changed": "Moved issue to a different list",
	"issue.status_changed": "Changed issue status",
	"issue.priority_changed": "Changed issue priority",
	"issue.assignee_changed": "Changed issue assignee",
	"comment.created": "Added comment",
	"comment.edited": "Edited comment",
};

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

type DescendantStats = {
	unfinishedDescendantCount: number;
};

function createSubIssueDraft(parentIssue?: IssueDetailRow) {
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

function formatChildProgress(issue: IssueDetailRow) {
	if (!issue.hasChildren) {
		return null;
	}

	return `${issue.completedChildIssueCount}/${issue.childIssueCount} done`;
}

function roundCompletionRate(issue: IssueDetailRow) {
	return Math.round(issue.childCompletionRate * 100);
}

function buildDescendantStats(rows: IssueDetailRow[]) {
	const childrenByParent = new Map<string, IssueDetailRow[]>();

	for (const issue of rows) {
		if (!issue.parentIssueId) {
			continue;
		}

		const children = childrenByParent.get(issue.parentIssueId) ?? [];
		children.push(issue);
		childrenByParent.set(issue.parentIssueId, children);
	}

	const statsByIssueId = new Map<string, DescendantStats>();

	function visit(issueId: string): DescendantStats {
		const cached = statsByIssueId.get(issueId);
		if (cached) {
			return cached;
		}

		const children = childrenByParent.get(issueId) ?? [];
		let unfinishedDescendantCount = 0;

		for (const child of children) {
			if (child.status !== "done") {
				unfinishedDescendantCount += 1;
			}

			unfinishedDescendantCount += visit(child._id).unfinishedDescendantCount;
		}

		const stats = { unfinishedDescendantCount };
		statsByIssueId.set(issueId, stats);
		return stats;
	}

	for (const issue of rows) {
		visit(issue._id);
	}

	return statsByIssueId;
}

function findDoneAncestorIssue(
	issue: IssueDetailRow,
	issueById: Map<string, IssueDetailRow>,
) {
	let cursor = issue.parentIssueId;

	while (cursor) {
		const parentIssue = issueById.get(cursor);
		if (!parentIssue) {
			return null;
		}
		if (parentIssue.status === "done") {
			return parentIssue;
		}

		cursor = parentIssue.parentIssueId;
	}

	return null;
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
	const [statusUpdateError, setStatusUpdateError] = useState<string | null>(
		null,
	);
	const [subIssueFormOpen, setSubIssueFormOpen] = useState(false);
	const [subIssueError, setSubIssueError] = useState<string | null>(null);
	const [subIssueForm, setSubIssueForm] = useState(createSubIssueDraft());
	const [completionConfirm, setCompletionConfirm] = useState<{
		issueId: Id<"issues">;
		title: string;
		unfinishedDescendantCount: number;
	} | null>(null);
	const [isCompletingIssueTree, setIsCompletingIssueTree] = useState(false);

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";

	const commentRows = useMemo<CommentRow[]>(
		() => (commentsData?.comments ?? []) as CommentRow[],
		[commentsData?.comments],
	);
	const descendantStatsByIssueId = useMemo(
		() => buildDescendantStats((projectIssues ?? []) as IssueDetailRow[]),
		[projectIssues],
	);
	const projectIssueById = useMemo(
		() => new Map((projectIssues ?? []).map((issue) => [issue._id, issue])),
		[projectIssues],
	);
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
		return <div className="page-loading">Loading issue…</div>;
	}

	if (issueData === null) {
		return (
			<div className="mx-auto max-w-xl">
				<Card>
					<CardHeader>
						<CardTitle>Issue not found</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="m-0 text-sm text-[var(--muted-text)]">
							This issue may have been deleted or you no longer have access.
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
					"Issue deletion is not allowed for this project.",
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
				parsed.error.issues[0]?.message ?? "Sub-issue form is invalid.",
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
				getClientErrorMessage(error, "Failed to create sub-issue."),
			);
		}
	}

	async function handleIssueStatusChange(
		issue: IssueDetailRow,
		nextStatus: (typeof ISSUE_STATUSES)[number],
	) {
		setStatusUpdateError(null);

		try {
			if (nextStatus !== "done") {
				const doneAncestor = findDoneAncestorIssue(issue, projectIssueById);
				if (doneAncestor) {
					setStatusUpdateError(
						`Cannot move this sub-issue out of done while parent issue #${doneAncestor.issueNumber} is still done. Reopen the parent first.`,
					);
					return;
				}

				await updateIssue({
					issueId: issue._id,
					status: nextStatus,
				});
				return;
			}

			const unfinishedDescendantCount =
				descendantStatsByIssueId.get(issue._id)?.unfinishedDescendantCount ?? 0;
			if (unfinishedDescendantCount > 0) {
				setCompletionConfirm({
					issueId: issue._id,
					title: issue.title,
					unfinishedDescendantCount,
				});
				return;
			}

			await updateIssue({
				issueId: issue._id,
				status: nextStatus,
			});
		} catch (error) {
			setStatusUpdateError(
				getClientErrorMessage(error, "Failed to update issue status."),
			);
		}
	}

	async function confirmCascadeCompletion() {
		if (!completionConfirm) {
			return;
		}

		setIsCompletingIssueTree(true);
		try {
			setStatusUpdateError(null);
			await updateIssue({
				issueId: completionConfirm.issueId,
				status: "done",
				cascadeDescendantsToDone: true,
			});
			setCompletionConfirm(null);
		} catch (error) {
			setStatusUpdateError(
				getClientErrorMessage(error, "Failed to update issue status."),
			);
		} finally {
			setIsCompletingIssueTree(false);
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
							aria-label="Delete issue"
							title="Delete issue"
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
				<div className="issue-detail-main">
					{issueData.parentIssue ? (
						<section className="issue-overview-block">
							<div className="issue-overview-toolbar">
								<span className="issue-overview-kicker">Parent Issue</span>
							</div>
							<Link
								to="/issues/$issueId"
								params={{ issueId: issueData.parentIssue._id }}
								className="issue-related-link no-underline"
							>
								<div className="flex items-center gap-2">
									<Badge className="issue-row-id-badge">
										#{issueData.parentIssue.issueNumber}
									</Badge>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{issueData.parentIssue.title}
									</p>
								</div>
								<div className="mt-2 flex items-center gap-2">
									<Badge className="issue-hierarchy-badge">Parent</Badge>
									<Badge>
										{issueStatusLabel[issueData.parentIssue.status]}
									</Badge>
								</div>
							</Link>
						</section>
					) : null}

					<section className="issue-overview-block">
						<div className="issue-overview-toolbar">
							<span className="issue-overview-kicker">Title</span>
							{canWrite && !editingTitle ? (
								<Button
									size="sm"
									variant="ghost"
									className="h-7 w-7 p-0"
									aria-label="Edit title"
									title="Edit title"
									onClick={() => {
										setEditingTitle(true);
										setTitleDraft(issueData.issue.title);
									}}
								>
									<Pencil className="h-3.5 w-3.5" />
								</Button>
							) : null}
						</div>
						{editingTitle ? (
							<form
								className="space-y-2"
								onSubmit={async (event) => {
									event.preventDefault();
									await saveTitle();
								}}
							>
								<Input
									value={titleDraft}
									onChange={(event) => setTitleDraft(event.target.value)}
									autoFocus
								/>
								<div className="flex items-center gap-2">
									<Button type="submit" size="sm">
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										type="button"
										onClick={() => setEditingTitle(false)}
									>
										Cancel
									</Button>
								</div>
							</form>
						) : (
							<div className="space-y-3">
								<h1 className="m-0 text-4xl font-bold leading-tight tracking-[-0.02em] text-[var(--text)]">
									{issueData.issue.title}
								</h1>
								{issueData.issue.parentIssueId ? (
									<div>
										<Badge className="issue-hierarchy-badge">Sub-issue</Badge>
									</div>
								) : null}
								{issueData.issue.hasChildren ? (
									<div className="issue-progress-panel">
										<div className="flex items-center justify-between gap-3">
											<span className="issue-progress-text">
												Sub-issue progress
											</span>
											<span className="issue-progress-text">
												{formatChildProgress(issueData.issue as IssueDetailRow)}{" "}
												(
												{roundCompletionRate(issueData.issue as IssueDetailRow)}
												%)
											</span>
										</div>
										<div className="issue-progress-bar" aria-hidden="true">
											<div
												className="issue-progress-bar-fill"
												style={{
													width: `${roundCompletionRate(issueData.issue as IssueDetailRow)}%`,
												}}
											/>
										</div>
									</div>
								) : null}
							</div>
						)}
					</section>

					<section className="issue-overview-block issue-overview-block-description">
						<div className="issue-overview-toolbar">
							<span className="issue-overview-kicker">Description</span>
							{canWrite && !editingDescription ? (
								<Button
									size="sm"
									variant="ghost"
									className="h-7 w-7 p-0"
									aria-label="Edit description"
									title="Edit description"
									onClick={() => {
										setEditingDescription(true);
										setDescriptionDraft(issueData.issue.description ?? "");
									}}
								>
									<Pencil className="h-3.5 w-3.5" />
								</Button>
							) : null}
						</div>
						{editingDescription ? (
							<div className="space-y-2">
								<Textarea
									value={descriptionDraft}
									onChange={(event) => setDescriptionDraft(event.target.value)}
								/>
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										onClick={async () => {
											await updateIssue({
												issueId,
												description: descriptionDraft,
											});
											setEditingDescription(false);
										}}
									>
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setEditingDescription(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<p className="m-0 whitespace-pre-wrap text-[1.05rem] leading-relaxed text-[var(--text)]">
								{issueData.issue.description || "No description provided."}
							</p>
						)}
					</section>

					{!currentIssue.parentIssueId ? (
						<Card className="issue-subissues-card">
							<CardHeader className="pb-2">
								<div className="flex items-center justify-between gap-3">
									<CardTitle className="text-base">
										Sub-issues ({childIssueRows.length})
									</CardTitle>
									{canWrite ? (
										<Button
											type="button"
											size="sm"
											variant={subIssueFormOpen ? "ghost" : "secondary"}
											onClick={() => {
												setSubIssueError(null);
												setSubIssueForm(createSubIssueDraft(issueData.issue));
												setSubIssueFormOpen((current) => !current);
											}}
										>
											<Plus className="mr-1.5 h-3.5 w-3.5" />
											{subIssueFormOpen ? "Close" : "Add sub-issue"}
										</Button>
									) : null}
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								{childIssueRows.length ? (
									<div className="issue-tree-children issue-tree-list">
										{childIssueRows.map((row) => (
											<div
												key={row.issue._id}
												className="issue-tree-node issue-tree-node-child"
											>
												<Link
													to="/issues/$issueId"
													params={{ issueId: row.issue._id }}
													className="issue-related-link no-underline"
												>
													<div className="flex items-center gap-2">
														<Badge className="issue-row-id-badge">
															#{row.issue.issueNumber}
														</Badge>
														<p className="m-0 text-sm font-medium text-[var(--text)]">
															{row.issue.title}
														</p>
														<Badge className="issue-hierarchy-badge">
															Sub-issue
														</Badge>
													</div>
													<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
														{row.issue.description?.trim() || "No description"}
													</p>
													<div className="mt-2 flex flex-wrap items-center gap-2">
														<Badge>{issueStatusLabel[row.issue.status]}</Badge>
														<Badge>
															{issuePriorityLabel[row.issue.priority]}
														</Badge>
														{row.assignee ? (
															<Badge>{row.assignee.name}</Badge>
														) : null}
														{row.issue.hasChildren ? (
															<Badge className="issue-progress-badge">
																{formatChildProgress(row.issue)} (
																{roundCompletionRate(row.issue)}%)
															</Badge>
														) : null}
													</div>
												</Link>
											</div>
										))}
									</div>
								) : (
									<p className="m-0 text-sm text-[var(--muted-text)]">
										No sub-issues yet.
									</p>
								)}

								{subIssueFormOpen ? (
									<form
										onSubmit={submitSubIssue}
										className="grid gap-3 border-t border-[var(--line)] pt-4 md:grid-cols-2"
									>
										<div className="md:col-span-2">
											<Label>Title</Label>
											<Input
												value={subIssueForm.title}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														title: event.target.value,
													}))
												}
											/>
										</div>
										<div className="md:col-span-2">
											<Label>Description</Label>
											<Textarea
												value={subIssueForm.description}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														description: event.target.value,
													}))
												}
											/>
										</div>
										<div>
											<Label>Status</Label>
											<Select
												value={subIssueForm.status}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														status: event.target
															.value as (typeof ISSUE_STATUSES)[number],
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
												value={subIssueForm.priority}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														priority: event.target
															.value as (typeof ISSUE_PRIORITIES)[number],
													}))
												}
											>
												{ISSUE_PRIORITIES.map((value) => (
													<option key={value} value={value}>
														{issuePriorityLabel[value]}
													</option>
												))}
											</Select>
										</div>
										<div>
											<Label>List</Label>
											<Select
												value={subIssueForm.listId}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														listId: event.target.value,
													}))
												}
											>
												<option value="">No list</option>
												{(issueLists ?? []).map((list) => (
													<option key={list._id} value={list._id}>
														{list.name}
													</option>
												))}
											</Select>
										</div>
										<div>
											<Label>Assignee</Label>
											<Select
												value={subIssueForm.assigneeId}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
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
												value={subIssueForm.dueDate}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														dueDate: event.target.value,
													}))
												}
											/>
										</div>
										<div className="md:col-span-2">
											<Label>Labels (comma-separated)</Label>
											<Input
												value={subIssueForm.labels}
												onChange={(event) =>
													setSubIssueForm((prev) => ({
														...prev,
														labels: event.target.value,
													}))
												}
											/>
										</div>
										{subIssueError ? (
											<p className="m-0 text-sm text-[var(--danger)]">
												{subIssueError}
											</p>
										) : null}
										<div className="md:col-span-2 flex items-center justify-end gap-2">
											<Button
												type="button"
												variant="ghost"
												onClick={() => {
													setSubIssueError(null);
													setSubIssueForm(createSubIssueDraft(issueData.issue));
													setSubIssueFormOpen(false);
												}}
											>
												Cancel
											</Button>
											<Button type="submit">Create sub-issue</Button>
										</div>
									</form>
								) : null}
							</CardContent>
						</Card>
					) : null}
				</div>

				<aside className="issue-detail-settings issue-meta-panel">
					<div className="issue-meta-row">
						<span className="issue-meta-label">List</span>
						<div className="issue-meta-value">
							{canWrite ? (
								<Select
									className="issue-meta-control"
									value={issueData.issue.listId ?? ""}
									onChange={(event) =>
										updateIssue({
											issueId,
											listId: (event.target.value ||
												null) as Id<"issueLists"> | null,
										})
									}
								>
									<option value="">No list</option>
									{(issueLists ?? []).map((list) => (
										<option key={list._id} value={list._id}>
											{list.name}
										</option>
									))}
								</Select>
							) : (
								<span className="issue-meta-static">
									{issueLists?.find(
										(list) => list._id === issueData.issue.listId,
									)?.name ?? "No list"}
								</span>
							)}
						</div>
					</div>

					<div className="issue-meta-row">
						<span className="issue-meta-label">Status</span>
						<div className="issue-meta-value">
							{canWrite ? (
								<Select
									className="issue-meta-control"
									value={currentIssue.status}
									onChange={(event) =>
										void handleIssueStatusChange(
											currentIssue,
											event.target.value as (typeof ISSUE_STATUSES)[number],
										)
									}
								>
									{ISSUE_STATUSES.map((value) => (
										<option key={value} value={value}>
											{issueStatusLabel[value]}
										</option>
									))}
								</Select>
							) : (
								<span className="issue-meta-static">
									{issueStatusLabel[issueData.issue.status]}
								</span>
							)}
						</div>
					</div>

					<div className="issue-meta-row">
						<span className="issue-meta-label">Priority</span>
						<div className="issue-meta-value">
							{canWrite ? (
								<Select
									className="issue-meta-control"
									value={issueData.issue.priority}
									onChange={(event) =>
										updateIssue({
											issueId,
											priority: event.target
												.value as (typeof ISSUE_PRIORITIES)[number],
										})
									}
								>
									{ISSUE_PRIORITIES.map((value) => (
										<option key={value} value={value}>
											{issuePriorityLabel[value]}
										</option>
									))}
								</Select>
							) : (
								<span className="issue-meta-static">
									{issuePriorityLabel[issueData.issue.priority]}
								</span>
							)}
						</div>
					</div>

					<div className="issue-meta-row">
						<span className="issue-meta-label">Assignee</span>
						<div className="issue-meta-value">
							{canWrite ? (
								<Select
									className="issue-meta-control"
									value={issueData.issue.assigneeId ?? ""}
									onChange={(event) =>
										updateIssue({
											issueId,
											assigneeId: (event.target.value ||
												null) as Id<"users"> | null,
										})
									}
								>
									<option value="">Unassigned</option>
									{(assignableUsers ?? []).map((user) => (
										<option key={user._id} value={user._id}>
											{user.name}
										</option>
									))}
								</Select>
							) : (
								<span className="issue-meta-static">
									{issueData.assignee?.name ?? "Unassigned"}
								</span>
							)}
						</div>
					</div>

					<div className="issue-meta-row">
						<span className="issue-meta-label">Due Date</span>
						<div className="issue-meta-value">
							{canWrite ? (
								<Input
									className="issue-meta-control"
									type="date"
									value={
										issueData.issue.dueDate
											? new Date(issueData.issue.dueDate)
													.toISOString()
													.slice(0, 10)
											: ""
									}
									onChange={(event) =>
										updateIssue({
											issueId,
											dueDate: event.target.value
												? new Date(event.target.value).getTime()
												: null,
										})
									}
								/>
							) : (
								<span className="issue-meta-static">
									{issueData.issue.dueDate
										? formatDate(issueData.issue.dueDate)
										: "No due date"}
								</span>
							)}
						</div>
					</div>

					<div className="issue-meta-row issue-meta-row-last">
						<span className="issue-meta-label">Labels</span>
						<div className="issue-meta-value">
							{issueData.issue.labels.length ? (
								<div className="flex flex-wrap justify-end gap-1.5">
									{issueData.issue.labels.map((label) => (
										<Badge key={label} className="issue-meta-tag">
											{label}
										</Badge>
									))}
								</div>
							) : (
								<span className="issue-meta-static">None</span>
							)}
						</div>
					</div>
				</aside>

				<div className="issue-detail-discussion">
					<Card className="issue-discussion-card">
						<CardHeader className="pb-2">
							<CardTitle className="text-base">Discussion & Activity</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{timelineItems.length ? (
								<ul className="m-0 divide-y divide-[var(--line)] p-0 pb-2">
									{timelineItems.map((item) => (
										<li
											key={item.key}
											className="flex items-start gap-3 py-3 first:pt-0"
										>
											<span
												className={
													item.type === "comment"
														? "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border border-blue-300/60 bg-blue-50/70 text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/25 dark:text-blue-300"
														: "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border border-amber-300/60 bg-amber-50/70 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-300"
												}
											>
												{item.type === "comment" ? (
													<MessageSquare className="h-3.5 w-3.5" />
												) : (
													<History className="h-3.5 w-3.5" />
												)}
											</span>

											<div className="min-w-0 flex-1">
												{item.type === "comment" ? (
													editingCommentId === item.comment._id ? (
														<div className="space-y-2">
															<Textarea
																value={commentDraft}
																onChange={(event) =>
																	setCommentDraft(event.target.value)
																}
															/>
															<div className="flex items-center gap-1">
																<Button
																	type="button"
																	size="sm"
																	variant="ghost"
																	className="h-7 w-7 p-0"
																	aria-label="Save comment"
																	title="Save"
																	onClick={async () => {
																		await updateComment({
																			commentId: item.comment._id,
																			body: commentDraft,
																		});
																		setEditingCommentId(null);
																	}}
																>
																	<Check className="h-3.5 w-3.5" />
																</Button>
																<Button
																	type="button"
																	size="sm"
																	variant="ghost"
																	className="h-7 w-7 p-0"
																	aria-label="Cancel editing comment"
																	title="Cancel"
																	onClick={() => setEditingCommentId(null)}
																>
																	<X className="h-3.5 w-3.5" />
																</Button>
															</div>
														</div>
													) : (
														<>
															<div className="flex items-center justify-between gap-2">
																<p className="m-0 text-xs text-[var(--muted-text)]">
																	<span className="font-medium text-[var(--text)]">
																		{item.author?.name ?? "Unknown User"}
																	</span>{" "}
																	commented ·{" "}
																	{formatRelative(item.comment.updatedAt)}
																</p>
																{canWrite &&
																me &&
																item.comment.authorId === me._id ? (
																	<Button
																		type="button"
																		size="sm"
																		variant="ghost"
																		className="h-7 w-7 p-0"
																		aria-label="Edit comment"
																		title="Edit comment"
																		onClick={() => {
																			setEditingCommentId(item.comment._id);
																			setCommentDraft(item.comment.body);
																		}}
																	>
																		<Pencil className="h-3.5 w-3.5" />
																	</Button>
																) : null}
															</div>
															<p className="m-0 mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">
																{item.comment.body}
															</p>
														</>
													)
												) : (
													<div>
														<p className="m-0 text-sm text-[var(--text)]">
															{activityLabel[item.activity.action] ??
																item.activity.action}
														</p>
														<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
															{formatRelative(item.activity.createdAt)}
														</p>
													</div>
												)}
											</div>
										</li>
									))}
								</ul>
							) : (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									No discussion or activity yet.
								</p>
							)}

							{canWrite ? (
								<form
									onSubmit={submitComment}
									className="issue-comment-form space-y-2 border-t border-[var(--line)] pt-3"
								>
									<Textarea
										className="issue-comment-input"
										value={comment}
										onChange={(event) => setComment(event.target.value)}
										placeholder="Add a comment"
									/>
									<Button type="submit" size="sm">
										Add comment
									</Button>
								</form>
							) : (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									Viewers cannot add comments.
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</div>

			<ConfirmDialog
				open={showDeleteConfirm}
				title="Delete issue"
				description="This action will permanently remove this issue from active views. You cannot undo this."
				confirmLabel="Delete issue"
				isConfirming={isDeleting}
				onCancel={() => setShowDeleteConfirm(false)}
				onConfirm={confirmDeleteIssue}
			/>

			<ConfirmDialog
				open={Boolean(completionConfirm)}
				title="Complete parent issue and sub-issues"
				description={
					completionConfirm
						? `"${completionConfirm.title}" still has ${completionConfirm.unfinishedDescendantCount} unfinished sub-issue${completionConfirm.unfinishedDescendantCount === 1 ? "" : "s"}. Mark all descendants as done too?`
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
