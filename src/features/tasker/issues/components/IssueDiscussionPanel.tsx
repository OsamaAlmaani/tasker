import { Check, History, MessageSquare, Pencil, X } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Textarea } from "#/components/ui/textarea";
import { formatRelative } from "#/features/tasker/format";

const activityLabel: Record<string, string> = {
	"project.created": "Created project",
	"project.updated": "Updated project",
	"project.archived": "Changed archive state",
	"project.member_added": "Added member",
	"project.member_removed": "Removed member",
	"project.invite_sent": "Sent invitation",
	"project.invite_revoked": "Revoked invitation",
	"project.invite_accepted": "Accepted invitation",
	"issue_list.created": "Created task list",
	"issue_list.updated": "Updated task list",
	"issue_list.deleted": "Deleted task list",
	"issue.created": "Created task",
	"issue.updated": "Updated task",
	"issue.deleted": "Deleted task",
	"issue.list_changed": "Moved task to a different list",
	"issue.status_changed": "Changed task status",
	"issue.priority_changed": "Changed task priority",
	"issue.assignee_changed": "Changed task assignee",
	"comment.created": "Added comment",
	"comment.edited": "Edited comment",
};

type TimelineItem =
	| {
			type: "comment";
			key: string;
			comment: {
				_id: string;
				authorId: string;
				body: string;
				updatedAt: number;
			};
			author: {
				name: string;
			} | null;
	  }
	| {
			type: "activity";
			key: string;
			activity: {
				action: string;
				createdAt: number;
			};
	  };

type IssueDiscussionPanelProps = {
	canWrite: boolean;
	comment: string;
	commentDraft: string;
	currentUserId?: string;
	editingCommentId: string | null;
	onCancelEditComment: () => void;
	onCommentChange: (value: string) => void;
	onCommentDraftChange: (value: string) => void;
	onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	onSaveComment: (commentId: string) => void | Promise<void>;
	onStartEditComment: (commentId: string, body: string) => void;
	timelineItems: TimelineItem[];
};

export function IssueDiscussionPanel({
	canWrite,
	comment,
	commentDraft,
	currentUserId,
	editingCommentId,
	onCancelEditComment,
	onCommentChange,
	onCommentDraftChange,
	onCommentSubmit,
	onSaveComment,
	onStartEditComment,
	timelineItems,
}: IssueDiscussionPanelProps) {
	return (
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
															onCommentDraftChange(event.target.value)
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
															onClick={() =>
																void onSaveComment(item.comment._id)
															}
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
															onClick={onCancelEditComment}
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
														currentUserId &&
														item.comment.authorId === currentUserId ? (
															<Button
																type="button"
																size="sm"
																variant="ghost"
																className="h-7 w-7 p-0"
																aria-label="Edit comment"
																title="Edit comment"
																onClick={() =>
																	onStartEditComment(
																		item.comment._id,
																		item.comment.body,
																	)
																}
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
							onSubmit={onCommentSubmit}
							className="issue-comment-form space-y-2 border-t border-[var(--line)] pt-3"
						>
							<Textarea
								className="issue-comment-input"
								value={comment}
								onChange={(event) => onCommentChange(event.target.value)}
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
	);
}
