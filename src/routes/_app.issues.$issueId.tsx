import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	ArrowLeft,
	Check,
	History,
	MessageSquare,
	Pencil,
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
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";
import { commentFormSchema } from "#/features/tasker/validation";
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

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";

	const commentRows = useMemo<CommentRow[]>(
		() => (commentsData?.comments ?? []) as CommentRow[],
		[commentsData?.comments],
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
	const canDeleteIssue = canWrite && issueData.project.allowIssueDelete;

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
				error instanceof Error
					? error.message
					: "Issue deletion is not allowed for this project.",
			);
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	}

	async function saveTitle() {
		const nextTitle = titleDraft.trim();
		if (!nextTitle || nextTitle === issueData.issue.title) {
			setEditingTitle(false);
			return;
		}

		await updateIssue({
			issueId,
			title: nextTitle,
		});
		setEditingTitle(false);
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

			<div className="space-y-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0">
						<CardTitle>Title</CardTitle>
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
					</CardHeader>
					<CardContent className="space-y-3">
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
							<h2 className="m-0 text-xl font-semibold text-[var(--text)]">
								{issueData.issue.title}
							</h2>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0">
						<CardTitle>Description</CardTitle>
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
					</CardHeader>
					<CardContent className="space-y-3">
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
							<p className="m-0 whitespace-pre-wrap text-sm text-[var(--text)]">
								{issueData.issue.description || "No description provided."}
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div>
							<Label>List</Label>
							{canWrite ? (
								<Select
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
								<p className="m-0 text-sm text-[var(--text)]">
									{issueLists?.find(
										(list) => list._id === issueData.issue.listId,
									)?.name ?? "No list"}
								</p>
							)}
						</div>

						<div>
							<Label>Status</Label>
							{canWrite ? (
								<Select
									value={issueData.issue.status}
									onChange={(event) =>
										updateIssue({
											issueId,
											status: event.target
												.value as (typeof ISSUE_STATUSES)[number],
										})
									}
								>
									{ISSUE_STATUSES.map((value) => (
										<option key={value} value={value}>
											{issueStatusLabel[value]}
										</option>
									))}
								</Select>
							) : (
								<div className="pt-1">
									<IssueStatusBadge status={issueData.issue.status} />
								</div>
							)}
						</div>

						<div>
							<Label>Priority</Label>
							{canWrite ? (
								<Select
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
								<div className="pt-1">
									<IssuePriorityBadge priority={issueData.issue.priority} />
								</div>
							)}
						</div>

						<div>
							<Label>Assignee</Label>
							{canWrite ? (
								<Select
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
								<p className="m-0 text-sm text-[var(--text)]">
									{issueData.assignee?.name ?? "Unassigned"}
								</p>
							)}
						</div>

						<div>
							<Label>Due Date</Label>
							{canWrite ? (
								<Input
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
								<p className="m-0 text-sm text-[var(--text)]">
									{issueData.issue.dueDate
										? formatDate(issueData.issue.dueDate)
										: "No due date"}
								</p>
							)}
						</div>

						<div>
							<Label>Labels</Label>
							<div className="pt-1">
								{issueData.issue.labels.length ? (
									<div className="flex flex-wrap gap-1.5">
										{issueData.issue.labels.map((label) => (
											<Badge key={label}>{label}</Badge>
										))}
									</div>
								) : (
									<p className="m-0 text-sm text-[var(--muted-text)]">
										No labels
									</p>
								)}
							</div>
						</div>

						<div className="rounded-md border border-[var(--line)] p-3 text-xs text-[var(--muted-text)]">
							<p className="m-0">
								Created {formatRelative(issueData.issue.createdAt)}
							</p>
							<p className="m-0 mt-1">
								Reporter: {issueData.reporter?.name ?? "Unknown"}
							</p>
							{issueData.issue.completedAt ? (
								<p className="m-0 mt-1">
									Completed {formatDate(issueData.issue.completedAt)}
								</p>
							) : null}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Discussion & Activity</CardTitle>
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
								className="space-y-2 border-t border-[var(--line)] pt-3"
							>
								<Textarea
									value={comment}
									onChange={(event) => setComment(event.target.value)}
									placeholder="Add a comment"
								/>
								<Button type="submit">Add comment</Button>
							</form>
						) : (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								Viewers cannot add comments.
							</p>
						)}
					</CardContent>
				</Card>
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
		</div>
	);
}
