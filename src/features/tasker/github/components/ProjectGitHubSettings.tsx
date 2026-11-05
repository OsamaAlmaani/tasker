import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, GitPullRequest, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { formatRelative } from "#/features/tasker/format";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import { useGitHubData } from "../useGitHubData";
import { GitHubAccountCard } from "./GitHubAccountCard";

export type ProjectGitHubIntegration = NonNullable<
	FunctionReturnType<typeof api.github.getIntegration>
>;

function ErrorMessage({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p className="m-0 text-sm text-[var(--danger)]" role="alert">
			{message}
		</p>
	);
}

export function ProjectGitHubSettings({
	projectId,
	integration,
}: {
	projectId: Id<"projects">;
	integration: ProjectGitHubIntegration;
}) {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<RepositoryCard
				projectId={projectId}
				canManage={integration.canManage}
				connected={Boolean(integration.account)}
				repository={integration.repository}
			/>
			<GitHubAccountCard />
		</div>
	);
}

function RepositoryCard({
	projectId,
	canManage,
	connected,
	repository,
}: {
	projectId: Id<"projects">;
	canManage: boolean;
	connected: boolean;
	repository: ProjectGitHubIntegration["repository"];
}) {
	const linkRepository = useAction(api.githubActions.linkRepository);
	const listRepositories = useAction(api.githubActions.listRepositories);
	const unlinkRepository = useMutation(api.github.unlinkRepository);
	const [isPicking, setIsPicking] = useState(false);
	const [search, setSearch] = useState("");
	const [isWorking, setIsWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmUnlink, setConfirmUnlink] = useState(false);
	const showPicker = canManage && connected && (isPicking || !repository);

	const repositories = useGitHubData(
		showPicker ? "repos" : null,
		() => listRepositories({}),
		"Could not load repositories from GitHub.",
	);

	const filteredRepositories = useMemo(() => {
		const query = search.trim().toLowerCase();
		const rows = repositories.data ?? [];
		return (
			query
				? rows.filter((row) => row.fullName.toLowerCase().includes(query))
				: rows
		).slice(0, 50);
	}, [repositories.data, search]);

	async function handleLink(reference: string) {
		setIsWorking(true);
		setError(null);
		try {
			await linkRepository({ projectId, repository: reference });
			setIsPicking(false);
			setSearch("");
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not link repository."));
		} finally {
			setIsWorking(false);
		}
	}

	async function handleUnlink() {
		setIsWorking(true);
		setError(null);
		try {
			await unlinkRepository({ projectId });
			setConfirmUnlink(false);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not unlink repository."));
		} finally {
			setIsWorking(false);
		}
	}

	const looksLikeReference = /^[\w.-]+\/[\w.-]+$|github\.com\//i.test(
		search.trim(),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Repository</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{!repository ? (
					<p className="m-0 text-sm text-[var(--muted-text)]">
						{!canManage
							? "No repository is linked yet. Ask a project member with write access to link one."
							: connected
								? "Choose the repository this project tracks. Each member sees it through their own GitHub token."
								: "Add your GitHub token, then choose the repository this project tracks."}
					</p>
				) : null}
				{repository ? (
					<div className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<a
								href={repository.htmlUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-sm font-medium"
							>
								{repository.fullName}
								<ExternalLink className="h-3.5 w-3.5" />
							</a>
							{repository.private ? (
								<Badge className="gap-1">
									<Lock className="h-3 w-3" />
									Private
								</Badge>
							) : null}
						</div>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Default branch <code>{repository.defaultBranch}</code> · linked{" "}
							{formatRelative(repository.linkedAt)}
							{repository.linkedByName ? ` by ${repository.linkedByName}` : ""}
						</p>
						<div className="flex flex-wrap gap-2">
							<Link
								to="/projects/$projectId/pulls"
								params={{ projectId }}
								className="no-underline"
							>
								<Button>
									<GitPullRequest className="mr-2 h-4 w-4" />
									View pull requests
								</Button>
							</Link>
							{canManage && connected && !isPicking ? (
								<Button variant="secondary" onClick={() => setIsPicking(true)}>
									Change repository
								</Button>
							) : null}
							{canManage ? (
								<Button
									variant="ghost"
									onClick={() => setConfirmUnlink(true)}
									disabled={isWorking}
								>
									Unlink
								</Button>
							) : null}
						</div>
					</div>
				) : null}

				{showPicker ? (
					<div className="space-y-2">
						<Label htmlFor="github-repo-search">
							{repository ? "Choose another repository" : "Choose a repository"}
						</Label>
						<div className="flex gap-2">
							<Input
								id="github-repo-search"
								placeholder="Search, or paste owner/name or a GitHub URL"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && looksLikeReference) {
										event.preventDefault();
										void handleLink(search);
									}
								}}
							/>
							{looksLikeReference ? (
								<Button
									onClick={() => void handleLink(search)}
									disabled={isWorking}
								>
									Link
								</Button>
							) : null}
						</div>
						<div className="max-h-72 overflow-auto rounded-md border border-[var(--line)]">
							{repositories.isLoading && !repositories.data ? (
								<p className="m-0 p-3 text-sm text-[var(--muted-text)]">
									Loading repositories…
								</p>
							) : repositories.error ? (
								<p className="m-0 p-3 text-sm text-[var(--danger)]">
									{repositories.error}
								</p>
							) : filteredRepositories.length ? (
								<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
									{filteredRepositories.map((row) => (
										<li key={row.fullName}>
											<button
												type="button"
												className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
												disabled={
													isWorking || row.fullName === repository?.fullName
												}
												onClick={() => void handleLink(row.fullName)}
											>
												<span className="min-w-0 flex-1 truncate">
													{row.fullName}
												</span>
												{row.private ? (
													<Lock className="h-3.5 w-3.5 shrink-0 text-[var(--muted-text)]" />
												) : null}
												{row.archived ? <Badge>Archived</Badge> : null}
											</button>
										</li>
									))}
								</ul>
							) : (
								<p className="m-0 p-3 text-sm text-[var(--muted-text)]">
									No matching repositories. Paste <code>owner/name</code> to
									link one directly.
								</p>
							)}
						</div>
						{repository ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setIsPicking(false);
									setSearch("");
								}}
							>
								Cancel
							</Button>
						) : null}
					</div>
				) : null}
				<ErrorMessage message={error} />
			</CardContent>
			<ConfirmDialog
				open={confirmUnlink}
				title="Unlink repository?"
				description="Pull request pages for this project stay empty until a repository is linked again. Members' GitHub tokens are not affected."
				confirmLabel="Unlink"
				confirmingLabel="Unlinking…"
				isConfirming={isWorking}
				onConfirm={handleUnlink}
				onCancel={() => setConfirmUnlink(false)}
			/>
		</Card>
	);
}
