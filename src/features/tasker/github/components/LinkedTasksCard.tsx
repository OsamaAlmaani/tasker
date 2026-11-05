import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	ChevronDown,
	ChevronRight,
	ListTodo,
	Plus,
	Unlink,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { IssueStatusBadge } from "#/features/tasker/components/IssueBadges";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

/**
 * Tasks a pull request belongs to, with inline status changes and the task's
 * intent (description and checklist) so reviewers review against it.
 */
export function LinkedTasksCard({
	projectId,
	pullNumber,
}: {
	projectId: Id<"projects">;
	pullNumber: number;
}) {
	const data = useQuery(api.githubLinks.listForPullRequest, {
		projectId,
		pullNumber,
	});
	const updateIssue = useMutation(api.issues.update);
	const unlinkPullRequest = useMutation(api.githubLinks.unlinkPullRequest);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [linking, setLinking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!data) return null;

	async function changeStatus(issueId: Id<"issues">, status: string) {
		setError(null);
		try {
			await updateIssue({ issueId, status });
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not change the task status."),
			);
		}
	}

	function toggle(issueId: string) {
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(issueId)) next.delete(issueId);
			else next.add(issueId);
			return next;
		});
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="flex items-center gap-2">
					<ListTodo className="h-4 w-4" />
					Tasks
				</CardTitle>
				{data.canWrite ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1 px-2 text-xs"
						onClick={() => setLinking((value) => !value)}
					>
						<Plus className="h-3.5 w-3.5" />
						Link task
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="space-y-2">
				{linking ? (
					<LinkTaskPicker
						projectId={projectId}
						pullNumber={pullNumber}
						excludeIssueIds={data.items.map((item) => item.issue._id)}
						onDone={() => setLinking(false)}
					/>
				) : null}
				{data.items.length ? (
					<ul className="m-0 list-none space-y-2 p-0">
						{data.items.map(({ linkId, issue }) => {
							const isOpen = expanded.has(issue._id);
							return (
								<li
									key={linkId}
									className="rounded-md border border-[var(--line)] px-2.5 py-2"
								>
									<div className="flex items-start gap-2">
										<button
											type="button"
											className="mt-0.5 shrink-0 bg-transparent p-0 text-[var(--muted-text)]"
											aria-label={
												isOpen ? "Hide task details" : "Show task details"
											}
											onClick={() => toggle(issue._id)}
										>
											{isOpen ? (
												<ChevronDown className="h-4 w-4" />
											) : (
												<ChevronRight className="h-4 w-4" />
											)}
										</button>
										<div className="min-w-0 flex-1">
											<Link
												to="/issues/$issueId"
												params={{ issueId: issue._id }}
												className="block truncate text-sm font-medium text-[var(--text)] no-underline"
												title={`${issue.key} ${issue.title}`}
											>
												<Badge className="issue-row-id-badge mr-1.5">
													{issue.key}
												</Badge>
												{issue.title}
											</Link>
											<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-text)]">
												{data.canWrite ? (
													<Select
														aria-label={`Status of ${issue.key}`}
														className="h-7 w-auto px-2 py-0 text-xs"
														value={issue.status}
														onChange={(event) =>
															void changeStatus(issue._id, event.target.value)
														}
													>
														{data.statuses.map((status) => (
															<option key={status.key} value={status.key}>
																{status.name}
															</option>
														))}
													</Select>
												) : (
													<IssueStatusBadge
														label={issue.statusLabel}
														color={issue.statusColor}
														status={issue.status}
													/>
												)}
												{issue.assignee ? (
													<span>{issue.assignee.name}</span>
												) : (
													<span>Unassigned</span>
												)}
												{issue.checklistItemCount ? (
													<span>
														Checklist {issue.completedChecklistItemCount}/
														{issue.checklistItemCount}
													</span>
												) : null}
											</div>
										</div>
										{data.canWrite ? (
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-7 w-7 shrink-0 p-0"
												title="Unlink task"
												aria-label="Unlink task"
												onClick={async () => {
													setError(null);
													try {
														await unlinkPullRequest({ linkId });
													} catch (caught) {
														setError(
															getClientErrorMessage(
																caught,
																"Could not unlink the task.",
															),
														);
													}
												}}
											>
												<Unlink className="h-3.5 w-3.5" />
											</Button>
										) : null}
									</div>
									{isOpen ? (
										<div className="mt-2 space-y-2 border-t border-[var(--line)] pt-2 text-sm">
											<p className="m-0 whitespace-pre-wrap break-words text-[var(--text)]">
												{issue.description.trim() || "No description."}
											</p>
											{issue.checklistItems.length ? (
												<ul className="m-0 list-none space-y-1 p-0">
													{issue.checklistItems.map((item) => (
														<li
															key={item.id}
															className="flex items-start gap-2 text-xs"
														>
															<input
																type="checkbox"
																checked={item.completed}
																readOnly
																className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
																aria-label={item.text}
															/>
															<span
																className={
																	item.completed
																		? "line-through text-[var(--muted-text)]"
																		: ""
																}
															>
																{item.text}
															</span>
														</li>
													))}
												</ul>
											) : null}
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
				) : (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						No task is linked. Mention a task key in the title or branch, or
						link one here.
					</p>
				)}
				{error ? (
					<p className="m-0 text-xs text-[var(--danger)]">{error}</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function LinkTaskPicker({
	projectId,
	pullNumber,
	excludeIssueIds,
	onDone,
}: {
	projectId: Id<"projects">;
	pullNumber: number;
	excludeIssueIds: string[];
	onDone: () => void;
}) {
	const [search, setSearch] = useState("");
	const [working, setWorking] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const linkPullRequest = useAction(api.githubLinkActions.linkPullRequest);
	const candidates = useQuery(api.githubLinks.searchLinkableIssues, {
		projectId,
		search,
		limit: 15,
	});
	const rows = (candidates ?? []).filter(
		(row) => !excludeIssueIds.includes(row._id),
	);

	async function link(issueId: Id<"issues">) {
		setWorking(issueId);
		setError(null);
		try {
			await linkPullRequest({ issueId, pullNumber });
			onDone();
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not link the task."));
		} finally {
			setWorking(null);
		}
	}

	return (
		<div className="space-y-2 rounded-md border border-[var(--line)] p-2">
			<Input
				autoFocus
				placeholder="Search tasks by title or number"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
			/>
			<div className="max-h-56 overflow-auto">
				{candidates === undefined ? (
					<p className="m-0 p-2 text-xs text-[var(--muted-text)]">Searching…</p>
				) : rows.length ? (
					<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
						{rows.map((row) => (
							<li key={row._id}>
								<button
									type="button"
									className="flex w-full items-center gap-2 bg-transparent px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
									disabled={working !== null}
									onClick={() => void link(row._id)}
								>
									<Badge className="issue-row-id-badge">{row.key}</Badge>
									<span className="min-w-0 flex-1 truncate">{row.title}</span>
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="m-0 p-2 text-xs text-[var(--muted-text)]">
						No matching open tasks.
					</p>
				)}
			</div>
			{error ? (
				<p className="m-0 text-xs text-[var(--danger)]">{error}</p>
			) : null}
			<div className="flex justify-end">
				<Button type="button" size="sm" variant="ghost" onClick={onDone}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
