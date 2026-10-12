import { useAction, useMutation, useQuery } from "convex/react";
import {
	GitBranch,
	GitPullRequest,
	Pause,
	Play,
	RefreshCw,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { formatRelative } from "#/features/tasker/format";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

type Props = {
	issueId: Id<"issues">;
	canWrite: boolean;
	archived: boolean;
	completed: boolean;
};

export function GithubIssuePanel({
	issueId,
	canWrite,
	archived,
	completed,
}: Props) {
	const data = useQuery(api.github.issueLink, { issueId });
	const create = useAction(api.githubActions.createBranch);
	const refresh = useAction(api.githubActions.refreshIssue);
	const toggle = useMutation(api.github.setIssueSync);
	const id = useId();
	const [branchDraft, setBranchDraft] = useState<string | null>(null);
	const [baseDraft, setBaseDraft] = useState<string | null>(null);
	const [pending, setPending] = useState<
		"create" | "link" | "refresh" | "toggle" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const link = data?.link;
	const connection = data?.connection;
	const ready = link?.creationState === "ready";
	const canAct = canWrite && !archived && connection?.enabled;
	const branch = branchDraft ?? link?.branch ?? data?.suggestedBranch ?? "";
	const baseBranch =
		baseDraft ?? link?.baseBranch ?? connection?.baseBranch ?? "";
	const creationBusy =
		link?.creationState === "pending" && link.creationLeaseUntil > Date.now();
	const repositoryUrl = connection
		? `https://github.com/${connection.owner}/${connection.repo}`
		: "";

	async function request(mode: "create" | "link") {
		if (pending || !canAct || completed || creationBusy) return;
		setPending(mode);
		setError(null);
		setNotice(null);
		try {
			await create({
				issueId,
				branch: branch.trim(),
				baseBranch: baseBranch.trim(),
				mode,
			});
			setNotice(
				mode === "create"
					? "Branch created and linked."
					: "Existing branch linked.",
			);
		} catch (cause) {
			setError(
				getClientErrorMessage(cause, "Could not create or link this branch."),
			);
		} finally {
			setPending(null);
		}
	}

	async function update(kind: "refresh" | "toggle") {
		if (pending || !canAct || !link) return;
		setPending(kind);
		setError(null);
		setNotice(null);
		try {
			if (kind === "refresh") await refresh({ issueId });
			else await toggle({ issueId, enabled: !link.syncEnabled });
		} catch (cause) {
			setError(
				getClientErrorMessage(
					cause,
					"Could not update GitHub synchronization.",
				),
			);
		} finally {
			setPending(null);
		}
	}

	return (
		<Card className="issue-detail-github col-span-full min-w-0">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<GitBranch className="h-4 w-4" aria-hidden="true" />
						GitHub
					</CardTitle>
					{ready && (
						<span className="text-xs text-[var(--muted-text)]">
							{!connection?.enabled
								? "Disconnected"
								: link.syncEnabled
									? "Status sync on"
									: "Status sync paused"}
						</span>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{!data ? (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Loading GitHub…
					</p>
				) : !connection ? (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Connect a repository in Project Settings to create branches from
						tasks.
					</p>
				) : (
					<>
						<a
							href={repositoryUrl}
							target="_blank"
							rel="noreferrer"
							className="text-xs text-[var(--muted-text)] underline underline-offset-4"
						>
							{connection.owner}/{connection.repo}
						</a>
						{ready ? (
							<>
								<div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-sm">
									<GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
									<a
										href={`${repositoryUrl}/tree/${link.branch.split("/").map(encodeURIComponent).join("/")}`}
										target="_blank"
										rel="noreferrer"
										className="min-w-0 break-all font-mono text-[var(--text)] underline underline-offset-4"
									>
										{link.branch}
									</a>
									{link.branchExists === false && (
										<span className="ml-auto shrink-0 text-xs text-[var(--muted-text)]">
											Deleted
										</span>
									)}
								</div>
								<p className="m-0 text-xs text-[var(--muted-text)]">
									Target branch:{" "}
									<span className="font-mono">{link.baseBranch}</span>
								</p>
								{link.pullNumber ? (
									<div className="flex items-center gap-2 text-sm">
										<GitPullRequest
											className="h-4 w-4 shrink-0"
											aria-hidden="true"
										/>
										<a
											href={`${repositoryUrl}/pull/${link.pullNumber}`}
											target="_blank"
											rel="noreferrer"
											className="text-[var(--text)] underline underline-offset-4"
										>
											PR #{link.pullNumber} ·{" "}
											{link.pullState === "draft"
												? "Draft"
												: link.pullState === "merged"
													? "Merged"
													: link.pullState === "closed"
														? "Closed"
														: "Open"}
										</a>
									</div>
								) : (
									<p className="m-0 text-sm text-[var(--muted-text)]">
										Open a pull request from this branch to start review.
									</p>
								)}
								{!link.syncEnabled && (
									<p className="m-0 text-xs text-[var(--muted-text)]">
										{link.pauseReason} Resuming applies the branch’s current
										lifecycle to this task.
									</p>
								)}
								<p className="m-0 text-xs text-[var(--muted-text)]">
									{link.lastSyncedAt
										? `Last synced ${formatRelative(link.lastSyncedAt)}`
										: "Waiting for the first sync…"}
								</p>
								{canWrite && !archived && (
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={Boolean(pending) || !connection.enabled}
											onClick={() => void update("refresh")}
										>
											<RefreshCw
												className={`mr-1.5 h-3.5 w-3.5 ${pending === "refresh" ? "animate-spin" : ""}`}
												aria-hidden="true"
											/>
											Refresh GitHub
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											disabled={Boolean(pending) || !connection.enabled}
											onClick={() => void update("toggle")}
										>
											{link.syncEnabled ? (
												<Pause
													className="mr-1.5 h-3.5 w-3.5"
													aria-hidden="true"
												/>
											) : (
												<Play
													className="mr-1.5 h-3.5 w-3.5"
													aria-hidden="true"
												/>
											)}
											{link.syncEnabled
												? "Pause status sync"
												: "Resume status sync"}
										</Button>
									</div>
								)}
							</>
						) : canAct && !completed ? (
							<form
								className="space-y-3"
								onSubmit={(event) => {
									event.preventDefault();
									void request("create");
								}}
							>
								<fieldset
									disabled={Boolean(pending) || creationBusy}
									className="m-0 space-y-3 border-0 p-0"
								>
									<div className="space-y-1">
										<label
											htmlFor={`${id}-branch`}
											className="text-xs font-semibold text-[var(--muted-text)]"
										>
											Branch name
										</label>
										<Input
											id={`${id}-branch`}
											value={branch}
											onChange={(event) => setBranchDraft(event.target.value)}
											maxLength={200}
											required
											className="font-mono text-xs"
										/>
									</div>
									<div className="space-y-1">
										<label
											htmlFor={`${id}-base`}
											className="text-xs font-semibold text-[var(--muted-text)]"
										>
											Base branch
										</label>
										<Input
											id={`${id}-base`}
											value={baseBranch}
											onChange={(event) => setBaseDraft(event.target.value)}
											maxLength={200}
											required
											className="font-mono text-xs"
										/>
									</div>
								</fieldset>
								{creationBusy && (
									<p
										role="status"
										className="m-0 text-xs text-[var(--muted-text)]"
									>
										A branch request is in progress. Refresh the page in two
										minutes if it does not finish.
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										type="submit"
										size="sm"
										disabled={
											Boolean(pending) || creationBusy || !branch || !baseBranch
										}
									>
										{pending === "create"
											? "Creating branch…"
											: "Create branch"}
									</Button>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={
											Boolean(pending) || creationBusy || !branch || !baseBranch
										}
										onClick={() => void request("link")}
									>
										{pending === "link" ? "Linking…" : "Link existing branch"}
									</Button>
								</div>
								<p className="m-0 text-xs text-[var(--muted-text)]">
									One branch per task. Creating or linking a branch starts work;
									pull requests update the task status.
								</p>
							</form>
						) : (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								{!connection.enabled
									? "The project’s GitHub connection is disabled."
									: completed
										? "Reopen this task before linking a branch."
										: archived
											? "Restore this task and project to use GitHub."
											: "A project member can create or link a branch here."}
							</p>
						)}
					</>
				)}
				{(error || link?.syncError) && (
					<p role="alert" className="m-0 text-sm text-[var(--danger)]">
						{error ?? link?.syncError}
					</p>
				)}
				{notice && (
					<p role="status" className="m-0 text-sm text-[var(--muted-text)]">
						{notice}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
