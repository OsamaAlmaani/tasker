import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, GitBranch } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

type Props = {
	projectId: Id<"projects">;
	statuses: ProjectStatusDefinition[];
	archived: boolean;
};
type Settings = FunctionReturnType<typeof api.github.projectConnection>;

export function GithubProjectSettings(props: Props) {
	const settings = useQuery(api.github.projectConnection, {
		projectId: props.projectId,
	});
	return (
		<section
			className="mt-5 space-y-4 border-t border-[var(--line)] pt-5"
			aria-label="GitHub integration"
		>
			<div className="flex items-center gap-2">
				<GitBranch className="h-5 w-5" aria-hidden="true" />
				<h3 className="m-0 text-base font-semibold">GitHub</h3>
				{settings?.connection && (
					<span className="ml-auto text-xs text-[var(--muted-text)]">
						{settings.connection.enabled ? "Connected" : "Disconnected"}
					</span>
				)}
			</div>
			<p className="m-0 text-sm text-[var(--muted-text)]">
				Create branches from tasks and let pull requests move work through your
				project’s workflow.
			</p>
			{!settings ? (
				<p className="text-sm text-[var(--muted-text)]">
					Loading GitHub connection…
				</p>
			) : (
				<>
					{settings.connection && (
						<div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-sm">
							<a
								href={`https://github.com/${settings.connection.owner}/${settings.connection.repo}`}
								target="_blank"
								rel="noreferrer"
								className="font-medium text-[var(--text)] underline underline-offset-4"
							>
								{settings.connection.owner}/{settings.connection.repo}
							</a>
							<p className="mb-0 mt-2 text-[var(--muted-text)]">
								Default base:{" "}
								<span className="font-mono">
									{settings.connection.baseBranch}
								</span>
							</p>
						</div>
					)}
					{settings.canConfigure ? (
						<ConnectionForm
							key={settings.connection?.version ?? "new"}
							{...props}
							settings={settings}
						/>
					) : (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Ask a project admin to manage this connection.
						</p>
					)}
				</>
			)}
		</section>
	);
}

function ConnectionForm({
	projectId,
	statuses,
	archived,
	settings,
}: Props & { settings: Settings }) {
	const connect = useAction(api.githubActions.connectRepository);
	const disconnect = useMutation(api.github.disconnect);
	const id = useId();
	const options = statuses.filter(
		(status) => !["todo", "done"].includes(status.key),
	);
	const connection = settings.connection;
	const [repository, setRepository] = useState(
		connection ? `${connection.owner}/${connection.repo}` : "",
	);
	const [baseBranch, setBaseBranch] = useState(connection?.baseBranch ?? "");
	const [workStatus, setWorkStatus] = useState(
		connection?.workStatus ??
			options.find((status) => status.key === "in_progress")?.key ??
			options[0]?.key ??
			"",
	);
	const [reviewStatus, setReviewStatus] = useState(
		connection?.reviewStatus ??
			options.find((status) => status.key === "in_review")?.key ??
			options[1]?.key ??
			"",
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const locked = pending || archived || !settings.configured;

	async function save() {
		if (locked) return;
		setPending(true);
		setError(null);
		setNotice(null);
		try {
			await connect({
				projectId,
				repository: repository.trim(),
				baseBranch: baseBranch.trim() || undefined,
				workStatus,
				reviewStatus,
			});
			setNotice("GitHub connection saved.");
		} catch (cause) {
			setError(
				getClientErrorMessage(
					cause,
					"Could not connect the GitHub repository.",
				),
			);
		} finally {
			setPending(false);
		}
	}

	async function disable() {
		if (pending) return;
		setPending(true);
		setError(null);
		setNotice(null);
		try {
			await disconnect({ projectId });
			setNotice("GitHub connection disabled. Linked branches are preserved.");
		} catch (cause) {
			setError(
				getClientErrorMessage(
					cause,
					"Could not disable the GitHub connection.",
				),
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			{!settings.configured && (
				<p className="m-0 rounded-md bg-[var(--surface-muted)] p-3 text-sm">
					GitHub is not set up yet. Ask the deployment administrator to finish
					GitHub App setup.
				</p>
			)}
			{settings.installUrl && (
				<a
					href={settings.installUrl}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-2 text-sm text-[var(--accent)] underline underline-offset-4"
				>
					Install GitHub App{" "}
					<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
				</a>
			)}
			{settings.configured && (
				<p className="m-0 text-sm text-[var(--muted-text)]">
					Install the App on your repository, then save the connection. Project
					members will create branches using the App.
				</p>
			)}
			<fieldset
				disabled={locked}
				className="m-0 grid gap-3 border-0 p-0 md:grid-cols-2"
			>
				<div className="space-y-1">
					<label
						htmlFor={`${id}-repository`}
						className="text-xs font-semibold text-[var(--muted-text)]"
					>
						GitHub repository
					</label>
					<Input
						id={`${id}-repository`}
						value={repository}
						onChange={(event) => setRepository(event.target.value)}
						placeholder="owner/repository"
						required
						maxLength={140}
					/>
				</div>
				<div className="space-y-1">
					<label
						htmlFor={`${id}-base`}
						className="text-xs font-semibold text-[var(--muted-text)]"
					>
						Default base branch
					</label>
					<Input
						id={`${id}-base`}
						value={baseBranch}
						onChange={(event) => setBaseBranch(event.target.value)}
						placeholder="Repository default"
						maxLength={200}
					/>
				</div>
				<div className="space-y-1">
					<label
						htmlFor={`${id}-work`}
						className="text-xs font-semibold text-[var(--muted-text)]"
					>
						Branch created / draft PR
					</label>
					<Select
						id={`${id}-work`}
						value={workStatus}
						onChange={(event) => setWorkStatus(event.target.value)}
						required
					>
						<option value="" disabled>
							Choose work status
						</option>
						{options.map((status) => (
							<option key={status.key} value={status.key}>
								{status.name}
							</option>
						))}
					</Select>
				</div>
				<div className="space-y-1">
					<label
						htmlFor={`${id}-review`}
						className="text-xs font-semibold text-[var(--muted-text)]"
					>
						Pull request ready for review
					</label>
					<Select
						id={`${id}-review`}
						value={reviewStatus}
						onChange={(event) => setReviewStatus(event.target.value)}
						required
					>
						<option value="" disabled>
							Choose review status
						</option>
						{options.map((status) => (
							<option key={status.key} value={status.key}>
								{status.name}
							</option>
						))}
					</Select>
				</div>
			</fieldset>
			<p className="m-0 text-xs text-[var(--muted-text)]">
				Merged PR → Done. Closed without merge → work status. Manual task status
				changes pause automation. New workflow statuses must be saved to the
				project before selecting them here.
			</p>
			{error && (
				<p role="alert" className="m-0 text-sm text-[var(--danger)]">
					{error}
				</p>
			)}
			{notice && (
				<p role="status" className="m-0 text-sm text-[var(--muted-text)]">
					{notice}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					disabled={
						locked ||
						!workStatus ||
						!reviewStatus ||
						workStatus === reviewStatus
					}
				>
					{pending ? "Saving…" : "Save GitHub connection"}
				</Button>
				{connection?.enabled && (
					<Button
						type="button"
						variant="secondary"
						disabled={pending}
						onClick={() => void disable()}
					>
						Disconnect GitHub
					</Button>
				)}
			</div>
		</form>
	);
}
