import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
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
import { commentFormSchema } from "#/features/tasker/validation";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/issues/$issueId")({
	component: IssueDetailPage,
});

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
	const [editingDescription, setEditingDescription] = useState(false);
	const [descriptionDraft, setDescriptionDraft] = useState("");
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";

	const commentRows = useMemo(
		() => commentsData?.comments ?? [],
		[commentsData?.comments],
	);

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
		setIsDeleting(true);
		try {
			await deleteIssue({ issueId });
			await navigate({
				to: "/projects/$projectId",
				params: { projectId },
				replace: true,
			});
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	}

	return (
		<div>
			<PageHeader
				title={`${issueData.project.key}-${issueData.issue.issueNumber} · ${issueData.issue.title}`}
				description={`Updated ${formatRelative(issueData.issue.updatedAt)}`}
				actions={
					canWrite ? (
						<Button
							variant="danger"
							disabled={isDeleting}
							onClick={() => setShowDeleteConfirm(true)}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</Button>
					) : null
				}
			/>

			<div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Description</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							{editingDescription ? (
								<div className="space-y-2">
									<Textarea
										value={descriptionDraft}
										onChange={(event) =>
											setDescriptionDraft(event.target.value)
										}
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
								<>
									<p className="m-0 whitespace-pre-wrap text-sm text-[var(--text)]">
										{issueData.issue.description || "No description provided."}
									</p>
									{canWrite ? (
										<Button
											size="sm"
											variant="secondary"
											onClick={() => {
												setEditingDescription(true);
												setDescriptionDraft(issueData.issue.description ?? "");
											}}
										>
											<Pencil className="mr-2 h-3.5 w-3.5" />
											Edit Description
										</Button>
									) : null}
								</>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Comments</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							{commentRows.map((row) => (
								<div
									key={row.comment._id}
									className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3"
								>
									<div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-text)]">
										<span>{row.author?.name ?? "Unknown User"}</span>
										<span>{formatRelative(row.comment.updatedAt)}</span>
									</div>

									{editingCommentId === row.comment._id ? (
										<div className="space-y-2">
											<Textarea
												value={commentDraft}
												onChange={(event) =>
													setCommentDraft(event.target.value)
												}
											/>
											<div className="flex items-center gap-2">
												<Button
													size="sm"
													onClick={async () => {
														await updateComment({
															commentId: row.comment._id,
															body: commentDraft,
														});
														setEditingCommentId(null);
													}}
												>
													Save
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setEditingCommentId(null)}
												>
													Cancel
												</Button>
											</div>
										</div>
									) : (
										<>
											<p className="m-0 whitespace-pre-wrap text-sm text-[var(--text)]">
												{row.comment.body}
											</p>
											{canWrite && me && row.comment.authorId === me._id ? (
												<Button
													size="sm"
													variant="ghost"
													className="mt-2"
													onClick={() => {
														setEditingCommentId(row.comment._id);
														setCommentDraft(row.comment.body);
													}}
												>
													Edit
												</Button>
											) : null}
										</>
									)}
								</div>
							))}

							{canWrite ? (
								<form onSubmit={submitComment} className="space-y-2">
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

				<div className="space-y-4">
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
												{value}
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
							<CardTitle>Activity</CardTitle>
						</CardHeader>
						<CardContent>
							<ActivityFeed activities={activity ?? []} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Labels</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-1.5">
							{issueData.issue.labels.map((label) => (
								<Badge key={label}>{label}</Badge>
							))}
							{!issueData.issue.labels.length ? (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									No labels
								</p>
							) : null}
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
		</div>
	);
}
