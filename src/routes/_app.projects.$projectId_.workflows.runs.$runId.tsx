import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
	GitHubSetupPrompt,
	ProjectGitHubPage,
} from "#/features/tasker/github/components/ProjectGitHubPage";
import { RunDetail } from "#/features/tasker/github/workflows/components/RunDetail";
import type { Id } from "#convex/_generated/dataModel";

type RunSearch = { job?: number; line?: number };

function positiveInteger(value: unknown) {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isInteger(number) && number > 0
		? number
		: undefined;
}

export const Route = createFileRoute(
	"/_app/projects/$projectId_/workflows/runs/$runId",
)({
	validateSearch: (search: Record<string, unknown>): RunSearch => {
		const job = positiveInteger(search.job);
		const line = positiveInteger(search.line);
		return {
			...(job ? { job } : {}),
			...(line ? { line } : {}),
		};
	},
	component: WorkflowRunPage,
});

function WorkflowRunPage() {
	const params = Route.useParams();
	const projectId = params.projectId as Id<"projects">;
	const runId = Number(params.runId);
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const isValid = Number.isInteger(runId) && runId > 0;

	return (
		<ProjectGitHubPage projectId={projectId}>
			{(integration) => (
				<div className="space-y-4">
					<Link
						to="/projects/$projectId/workflows"
						params={{ projectId }}
						className="inline-flex items-center gap-1 text-sm text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
					>
						<ArrowLeft className="h-4 w-4" />
						All workflows
					</Link>
					{!isValid ? (
						<p className="m-0 text-sm text-[var(--danger)]">
							That is not a valid run.
						</p>
					) : integration.account && integration.repository ? (
						<RunDetail
							key={runId}
							projectId={projectId}
							runId={runId}
							repositoryUrl={integration.repository.htmlUrl}
							canWrite={integration.canManage}
							jobId={search.job ?? null}
							line={search.line ?? null}
							onSelect={(selection) =>
								void navigate({
									search: (previous) => ({
										...previous,
										...("job" in selection
											? { job: selection.job ?? undefined }
											: {}),
										...("line" in selection
											? { line: selection.line ?? undefined }
											: {}),
									}),
									replace: true,
									resetScroll: false,
								})
							}
						/>
					) : (
						<GitHubSetupPrompt
							projectId={projectId}
							integration={integration}
						/>
					)}
				</div>
			)}
		</ProjectGitHubPage>
	);
}
