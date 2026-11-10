import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
	Check,
	Copy,
	ExternalLink,
	GitBranch,
	GitPullRequest,
	Link2,
	Plus,
	RefreshCw,
	Unlink,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import {
	checkoutCommands,
	describePullRequestChip,
	type PullRequestChipData,
} from "../linkDisplay";
import {
	checksDisplay,
	type PullRequestSummary,
	reviewDecisionDisplay,
} from "../pullRequestDisplay";
import { useGitHubData } from "../useGitHubData";
import { useRepositoryAccess } from "../useRepositoryAccess";
import {
	GitHubAvatar,
	PullRequestStateIcon,
	ToneBadge,
	toneTextClasses,
} from "./GitHubBadges";
import { Modal } from "./Modal";
import { ReviewFeedbackSection } from "./ReviewFeedbackSection";

type Dialog = "branch" | "pull" | "link" | null;

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			className="h-7 gap-1 px-2 text-xs"
			title={label}
			aria-label={label}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
				} catch {}
			}}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

/**
 * The task's "Development" block: linked branches and pull requests, with
 * actions to create a branch, open a pull request or link an existing one.
 * Pull request details are live when the viewer has a token, otherwise the
 * webhook snapshot is shown to viewers with repository access.
 */
export function IssueDevelopmentPanel({
	issueId,
	projectId,
}: {
	issueId: Id<"issues">;
	projectId: Id<"projects">;
}) {
	const links = useQuery(api.githubLinks.listForIssue, { issueId });
	const reviewFeedback = useQuery(api.githubReviewTasks.listForIssue, {
		issueId,
	});
	const getIssuePullRequests = useAction(
		api.githubLinkActions.getIssuePullRequests,
	);
	const unlinkPullRequest = useMutation(api.githubLinks.unlinkPullRequest);
	const [dialog, setDialog] = useState<Dialog>(null);
	const [error, setError] = useState<string | null>(null);
	useRepositoryAccess(projectId, links?.access);

	const pullNumbers = (links?.pullRequests ?? [])
		.map((link) => link.pullNumber)
		.join(",");
	const live = useGitHubData(
		links?.repository && links.viewerConnected && pullNumbers
			? `issue-prs:${issueId}:${pullNumbers}`
			: null,
		() => getIssuePullRequests({ issueId }),
		"Could not load pull requests from GitHub.",
	);
	const liveByNumber = useMemo(
		() => new Map((live.data?.items ?? []).map((item) => [item.number, item])),
		[live.data],
	);

	if (links === undefined) return null;
	if (links === null) return null;
	if (!links.repository) return null;

	const repository = links.repository;
	const canAct = links.canWrite && links.viewerConnected;

	async function handleUnlink(linkId: Id<"githubPullRequestLinks">) {
		setError(null);
		try {
			await unlinkPullRequest({ linkId });
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not unlink the pull request."),
			);
		}
	}

	return (
		<Card className="issue-development-panel">
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="flex items-center gap-2">
					<GitBranch className="h-4 w-4" />
					Development
				</CardTitle>
				{links.viewerConnected && links.pullRequests.length ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 w-7 p-0"
						aria-label="Refresh from GitHub"
						title="Refresh from GitHub"
						disabled={live.isLoading}
						onClick={() => void live.refetch()}
					>
						<RefreshCw
							className={cn(
								"h-3.5 w-3.5",
								live.isLoading ? "animate-spin" : "",
							)}
						/>
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="space-y-3">
				{!links.viewerConnected ? (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						<Link to="/settings" className="underline">
							Connect GitHub
						</Link>{" "}
						to see live details and create branches or pull requests.
					</p>
				) : null}

				{links.pullRequests.length ? (
					<ul className="m-0 list-none space-y-2 p-0">
						{links.pullRequests.map((link) => (
							<PullRequestRow
								key={link._id}
								projectId={projectId}
								link={link}
								live={liveByNumber.get(link.pullNumber)}
								canAct={links.canWrite}
								onUnlink={() => void handleUnlink(link._id)}
							/>
						))}
					</ul>
				) : null}

				{links.branches.length ? (
					<ul className="m-0 list-none space-y-1.5 p-0">
						{links.branches
							.filter(
								(branch) =>
									!links.pullRequests.some(
										(link) => link.snapshot?.headRefName === branch.branchName,
									),
							)
							.map((branch) => (
								<li
									key={branch._id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-2.5 py-1.5"
								>
									<a
										href={branch.url}
										target="_blank"
										rel="noreferrer"
										className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium no-underline"
										title={`Open ${branch.branchName} on GitHub`}
									>
										<GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--muted-text)]" />
										<code className="truncate">{branch.branchName}</code>
									</a>
									<div className="flex items-center gap-1">
										<CopyButton
											value={checkoutCommands(branch.branchName)[0].command}
											label="Copy checkout command"
										/>
										{canAct ? (
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-7 gap-1 px-2 text-xs"
												onClick={() => setDialog("pull")}
											>
												<GitPullRequest className="h-3.5 w-3.5" />
												Open PR
											</Button>
										) : null}
									</div>
								</li>
							))}
					</ul>
				) : null}

				{reviewFeedback?.items.length ? (
					<ReviewFeedbackSection
						issueId={issueId}
						projectId={projectId}
						items={reviewFeedback.items}
						canWrite={reviewFeedback.canWrite}
						viewerConnected={links.viewerConnected}
					/>
				) : null}

				{!links.pullRequests.length &&
				!links.branches.length &&
				!reviewFeedback?.items.length ? (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						No branches or pull requests yet. Branches named{" "}
						<code>
							{links.projectKey.toLowerCase()}-{"{number}"}
						</code>{" "}
						and pull requests mentioning{" "}
						<code>
							{links.projectKey}-{"{number}"}
						</code>{" "}
						link here automatically.
					</p>
				) : null}

				{live.error ? (
					<p className="m-0 text-xs text-[var(--danger)]">{live.error}</p>
				) : null}
				{error ? (
					<p className="m-0 text-xs text-[var(--danger)]">{error}</p>
				) : null}

				{canAct ? (
					<div className="flex flex-wrap gap-2 pt-1">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onClick={() => setDialog("branch")}
						>
							<GitBranch className="mr-1.5 h-3.5 w-3.5" />
							Create branch
						</Button>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onClick={() => setDialog("pull")}
						>
							<Plus className="mr-1.5 h-3.5 w-3.5" />
							Open pull request
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setDialog("link")}
						>
							<Link2 className="mr-1.5 h-3.5 w-3.5" />
							Link existing
						</Button>
					</div>
				) : null}
			</CardContent>

			{dialog === "branch" ? (
				<CreateBranchDialog issueId={issueId} onClose={() => setDialog(null)} />
			) : null}
			{dialog === "pull" ? (
				<CreatePullRequestDialog
					issueId={issueId}
					projectId={projectId}
					defaultBranch={repository.defaultBranch}
					branches={links.branches.map((branch) => branch.branchName)}
					onClose={() => setDialog(null)}
				/>
			) : null}
			{dialog === "link" ? (
				<LinkPullRequestDialog
					issueId={issueId}
					projectId={projectId}
					onClose={() => setDialog(null)}
				/>
			) : null}
		</Card>
	);
}

function PullRequestRow({
	projectId,
	link,
	live,
	canAct,
	onUnlink,
}: {
	projectId: Id<"projects">;
	link: {
		_id: Id<"githubPullRequestLinks">;
		pullNumber: number;
		url: string;
		linkedAt: number;
		source: string;
		snapshot: {
			title: string;
			state: "open" | "closed" | "merged";
			isDraft: boolean;
			headRefName: string;
			authorLogin: string | null;
			checks: "success" | "failure" | "pending" | null;
			reviewDecision:
				| "approved"
				| "changes_requested"
				| "review_required"
				| null;
			mergeable: "mergeable" | "conflicting" | "unknown";
		} | null;
	};
	live: PullRequestSummary | undefined;
	canAct: boolean;
	onUnlink: () => void;
}) {
	const chip: PullRequestChipData = live
		? {
				pullNumber: live.number,
				url: live.url,
				state: live.state,
				isDraft: live.isDraft,
				checks: live.checks,
				reviewDecision: live.reviewDecision,
				mergeable: live.mergeable,
				title: live.title,
			}
		: {
				pullNumber: link.pullNumber,
				url: link.url,
				state: link.snapshot?.state ?? null,
				isDraft: link.snapshot?.isDraft ?? false,
				checks: link.snapshot?.checks ?? null,
				reviewDecision: link.snapshot?.reviewDecision ?? null,
				mergeable: link.snapshot?.mergeable ?? null,
				title: link.snapshot?.title ?? null,
			};
	const { label, tone } = describePullRequestChip(chip);
	const title = live?.title ?? link.snapshot?.title ?? null;
	const branch = live?.headRefName ?? link.snapshot?.headRefName ?? null;
	const author =
		live?.author ??
		(link.snapshot?.authorLogin
			? { login: link.snapshot.authorLogin, avatarUrl: null }
			: null);
	const checks = live ? checksDisplay(live.checks) : null;
	const review = live ? reviewDecisionDisplay(live.reviewDecision) : null;

	return (
		<li className="rounded-md border border-[var(--line)] px-2.5 py-2">
			<div className="flex items-start justify-between gap-2">
				<Link
					to="/projects/$projectId/pulls/$pullNumber"
					params={{ projectId, pullNumber: String(link.pullNumber) }}
					className="min-w-0 flex-1 no-underline"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						{chip.state ? (
							<PullRequestStateIcon
								pullRequest={{ state: chip.state, isDraft: chip.isDraft }}
								className="h-3.5 w-3.5"
							/>
						) : (
							<GitPullRequest className="h-3.5 w-3.5 text-[var(--muted-text)]" />
						)}
						<span className="truncate text-sm font-medium text-[var(--text)]">
							{title
								? `#${link.pullNumber} ${title}`
								: `Pull request #${link.pullNumber}`}
						</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-text)]">
						<ToneBadge tone={tone} className="px-1.5 py-0 text-[10px]">
							{label}
						</ToneBadge>
						{checks && live?.checks ? (
							<span className={toneTextClasses[checks.tone]}>
								{checks.label}
							</span>
						) : null}
						{review && live?.reviewDecision ? (
							<span className={toneTextClasses[review.tone]}>
								{review.label}
							</span>
						) : null}
						{author ? (
							<span className="inline-flex items-center gap-1">
								<GitHubAvatar
									login={author.login}
									avatarUrl={author.avatarUrl}
									size={14}
								/>
								{author.login}
							</span>
						) : null}
						{!title && !chip.state ? (
							<span>Details require repository access</span>
						) : null}
					</div>
				</Link>
				<div className="flex shrink-0 items-center gap-0.5">
					<a
						href={link.url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-text)] hover:text-[var(--text)]"
						title="Open on GitHub"
						aria-label="Open on GitHub"
					>
						<ExternalLink className="h-3.5 w-3.5" />
					</a>
					{canAct ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 w-7 p-0"
							title="Unlink from this task"
							aria-label="Unlink from this task"
							onClick={onUnlink}
						>
							<Unlink className="h-3.5 w-3.5" />
						</Button>
					) : null}
				</div>
			</div>
			{branch ? (
				<div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
					<code className="truncate text-[11px] text-[var(--muted-text)]">
						{branch}
					</code>
					<div className="flex items-center">
						{checkoutCommands(branch, link.pullNumber).map((command) => (
							<CopyButton
								key={command.label}
								value={command.command}
								label={`Copy ${command.label} command`}
							/>
						))}
					</div>
				</div>
			) : null}
			<p className="m-0 mt-1 text-[10px] text-[var(--muted-text)]">
				Linked {formatRelative(link.linkedAt)}
				{link.source === "manual"
					? " manually"
					: link.source === "created_from_task"
						? " when created here"
						: ""}
			</p>
		</li>
	);
}

function CreateBranchDialog({
	issueId,
	onClose,
}: {
	issueId: Id<"issues">;
	onClose: () => void;
}) {
	const renderTemplates = useAction(api.githubLinkActions.renderTemplates);
	const createBranch = useAction(api.githubLinkActions.createBranch);
	const [name, setName] = useState("");
	const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{
		branchName: string;
		url: string;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		renderTemplates({ issueId })
			.then((templates) => {
				if (cancelled) return;
				setName(templates.branchName);
				setDefaultBranch(templates.defaultBranch);
			})
			.catch((caught) => {
				if (!cancelled)
					setError(
						getClientErrorMessage(caught, "Could not prepare the branch name."),
					);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [issueId, renderTemplates]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setWorking(true);
		setError(null);
		try {
			setResult(await createBranch({ issueId, branchName: name }));
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not create the branch."));
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal title="Create branch" onClose={onClose}>
			{result ? (
				<div className="space-y-3">
					<p className="m-0 text-sm">
						Created <code>{result.branchName}</code> from{" "}
						<code>{defaultBranch}</code>.
					</p>
					{checkoutCommands(result.branchName).map((command) => (
						<div
							key={command.label}
							className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] px-2.5 py-1.5"
						>
							<code className="truncate text-xs">{command.command}</code>
							<CopyButton value={command.command} label="Copy command" />
						</div>
					))}
					<div className="flex justify-end">
						<Button type="button" onClick={onClose}>
							Done
						</Button>
					</div>
				</div>
			) : (
				<form onSubmit={submit} className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="github-branch-name">Branch name</Label>
						<Input
							id="github-branch-name"
							value={name}
							disabled={loading}
							onChange={(event) => setName(event.target.value)}
							placeholder={loading ? "Preparing…" : "feat/key-123-title"}
						/>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Created from <code>{defaultBranch ?? "the default branch"}</code>.
							The name follows the project's branch template; edit it freely.
						</p>
					</div>
					{error ? (
						<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={onClose}
							disabled={working}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={working || loading || !name.trim()}>
							{working ? "Creating…" : "Create branch"}
						</Button>
					</div>
				</form>
			)}
		</Modal>
	);
}

function CreatePullRequestDialog({
	issueId,
	projectId,
	defaultBranch,
	branches,
	onClose,
}: {
	issueId: Id<"issues">;
	projectId: Id<"projects">;
	defaultBranch: string;
	branches: string[];
	onClose: () => void;
}) {
	const renderTemplates = useAction(api.githubLinkActions.renderTemplates);
	const createPullRequest = useAction(api.githubLinkActions.createPullRequest);
	const listBranches = useAction(api.githubWorkflows.listBranches);
	const [head, setHead] = useState(branches[0] ?? "");
	const [base, setBase] = useState(defaultBranch);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [draft, setDraft] = useState(false);
	const [loading, setLoading] = useState(true);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{ number: number; url: string } | null>(
		null,
	);
	const repoBranches = useGitHubData(
		`branches:${projectId}`,
		() => listBranches({ projectId }),
		"Could not load branches.",
	);
	const branchOptions = useMemo(() => {
		const all = new Set<string>([
			...branches,
			...(repoBranches.data?.branches ?? []),
		]);
		all.delete(base);
		return [...all].sort((a, b) => {
			const aLinked = branches.includes(a) ? 0 : 1;
			const bLinked = branches.includes(b) ? 0 : 1;
			return aLinked - bLinked || a.localeCompare(b);
		});
	}, [branches, repoBranches.data, base]);

	useEffect(() => {
		let cancelled = false;
		renderTemplates({ issueId })
			.then((templates) => {
				if (cancelled) return;
				setTitle(templates.title);
				setBody(templates.body);
			})
			.catch((caught) => {
				if (!cancelled)
					setError(
						getClientErrorMessage(
							caught,
							"Could not prepare the pull request.",
						),
					);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [issueId, renderTemplates]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setWorking(true);
		setError(null);
		try {
			setResult(
				await createPullRequest({ issueId, head, base, title, body, draft }),
			);
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not open the pull request."),
			);
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal title="Open pull request" onClose={onClose}>
			{result ? (
				<div className="space-y-3">
					<p className="m-0 text-sm">
						Opened pull request #{result.number} and linked it to this task.
					</p>
					<div className="flex justify-end gap-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Close
						</Button>
						<Link
							to="/projects/$projectId/pulls/$pullNumber"
							params={{ projectId, pullNumber: String(result.number) }}
							className="no-underline"
						>
							<Button type="button">View in Tasker</Button>
						</Link>
					</div>
				</div>
			) : (
				<form onSubmit={submit} className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="github-pr-head">Branch with changes</Label>
							{branchOptions.length ? (
								<Select
									id="github-pr-head"
									value={head}
									onChange={(event) => setHead(event.target.value)}
								>
									<option value="">Choose a branch…</option>
									{branchOptions.map((branch) => (
										<option key={branch} value={branch}>
											{branch}
										</option>
									))}
								</Select>
							) : (
								<Input
									id="github-pr-head"
									value={head}
									onChange={(event) => setHead(event.target.value)}
									placeholder={
										repoBranches.isLoading
											? "Loading branches…"
											: "feature-branch"
									}
								/>
							)}
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="github-pr-base">Merge into</Label>
							<Input
								id="github-pr-base"
								value={base}
								onChange={(event) => setBase(event.target.value)}
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="github-pr-title">Title</Label>
						<Input
							id="github-pr-title"
							value={title}
							disabled={loading}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="github-pr-body">Description (Markdown)</Label>
						<Textarea
							id="github-pr-body"
							value={body}
							disabled={loading}
							rows={8}
							onChange={(event) => setBody(event.target.value)}
						/>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={draft}
							onChange={(event) => setDraft(event.target.checked)}
							className="h-4 w-4 rounded border border-[var(--line)] accent-[var(--accent)]"
						/>
						Open as draft
					</label>
					{error ? (
						<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={onClose}
							disabled={working}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={working || loading || !head.trim() || !title.trim()}
						>
							{working ? "Opening…" : "Open pull request"}
						</Button>
					</div>
				</form>
			)}
		</Modal>
	);
}

function LinkPullRequestDialog({
	issueId,
	projectId,
	onClose,
}: {
	issueId: Id<"issues">;
	projectId: Id<"projects">;
	onClose: () => void;
}) {
	const listPullRequests = useAction(api.githubActions.listPullRequests);
	const linkPullRequest = useAction(api.githubLinkActions.linkPullRequest);
	const [query, setQuery] = useState("");
	const [working, setWorking] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const open = useGitHubData(
		`link-prs:${projectId}`,
		() => listPullRequests({ projectId, state: "open" }),
		"Could not load open pull requests.",
	);
	const trimmed = query.trim();
	const typedNumber = /^#?\d+$/.test(trimmed)
		? Number(trimmed.replace("#", ""))
		: null;
	const matches = (open.data?.items ?? []).filter((item) => {
		if (!trimmed) return true;
		if (typedNumber && item.number === typedNumber) return true;
		return item.title.toLowerCase().includes(trimmed.toLowerCase());
	});

	async function link(pullNumber: number) {
		setWorking(pullNumber);
		setError(null);
		try {
			await linkPullRequest({ issueId, pullNumber });
			onClose();
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not link the pull request."),
			);
		} finally {
			setWorking(null);
		}
	}

	return (
		<Modal title="Link a pull request" onClose={onClose}>
			<div className="space-y-3">
				<div className="flex gap-2">
					<Input
						autoFocus
						placeholder="Search open pull requests or type a number"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && typedNumber) {
								event.preventDefault();
								void link(typedNumber);
							}
						}}
					/>
					{typedNumber ? (
						<Button
							type="button"
							disabled={working !== null}
							onClick={() => void link(typedNumber)}
						>
							Link #{typedNumber}
						</Button>
					) : null}
				</div>
				<div className="max-h-72 overflow-auto rounded-md border border-[var(--line)]">
					{open.isLoading && !open.data ? (
						<p className="m-0 p-3 text-sm text-[var(--muted-text)]">
							Loading open pull requests…
						</p>
					) : open.error ? (
						<p className="m-0 p-3 text-sm text-[var(--danger)]">{open.error}</p>
					) : matches.length ? (
						<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
							{matches.map((item) => (
								<li key={item.number}>
									<button
										type="button"
										className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
										disabled={working !== null}
										onClick={() => void link(item.number)}
									>
										<PullRequestStateIcon
											pullRequest={item}
											className="h-3.5 w-3.5"
										/>
										<span className="min-w-0 flex-1 truncate">
											#{item.number} {item.title}
										</span>
										<code className="hidden truncate text-[11px] text-[var(--muted-text)] sm:inline">
											{item.headRefName}
										</code>
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="m-0 p-3 text-sm text-[var(--muted-text)]">
							No matching open pull requests. Type a number to link a closed or
							merged one.
						</p>
					)}
				</div>
				{error ? (
					<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
				) : null}
				<div className="flex justify-end">
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
				</div>
			</div>
		</Modal>
	);
}
