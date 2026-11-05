import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "#/components/ui/card";
import {
	GitHubSetupPrompt,
	ProjectGitHubPage,
} from "#/features/tasker/github/components/ProjectGitHubPage";
import { PullRequestDetail } from "#/features/tasker/github/components/PullRequestDetail";
import { useGitHubData } from "#/features/tasker/github/useGitHubData";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute(
	"/_app/projects/$projectId_/pulls/$pullNumber",
)({
	component: ProjectPullRequestPage,
});

function ProjectPullRequestPage() {
	const params = Route.useParams();
	const projectId = params.projectId as Id<"projects">;
	const pullNumber = Number(params.pullNumber);

	return (
		<ProjectGitHubPage projectId={projectId}>
			{(integration) => (
				<div className="space-y-4">
					<Link
						to="/projects/$projectId/pulls"
						params={{ projectId }}
						className="inline-flex items-center gap-1 text-sm text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
					>
						<ArrowLeft className="h-4 w-4" />
						All pull requests
					</Link>
					{integration.account && integration.repository ? (
						<PullRequestLoader
							projectId={projectId}
							repository={integration.repository.fullName}
							pullNumber={pullNumber}
							canWrite={integration.canManage}
							liveVersion={integration.repository.liveVersion}
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

function PullRequestLoader({
	projectId,
	repository,
	pullNumber,
	canWrite,
	liveVersion,
}: {
	projectId: Id<"projects">;
	repository: string;
	pullNumber: number;
	canWrite: boolean;
	liveVersion?: number;
}) {
	const getPullRequest = useAction(api.githubActions.getPullRequest);
	const isValidNumber = Number.isInteger(pullNumber) && pullNumber > 0;
	const detail = useGitHubData(
		isValidNumber ? `pull:${projectId}:${repository}:${pullNumber}` : null,
		() => getPullRequest({ projectId, number: pullNumber }),
		"Could not load the pull request from GitHub.",
		liveVersion,
	);

	if (!isValidNumber) {
		return <ErrorCard message="That is not a valid pull request number." />;
	}
	if (detail.data) {
		return (
			<>
				{detail.error ? <ErrorCard message={detail.error} /> : null}
				<PullRequestDetail
					projectId={projectId}
					repository={detail.data.repository}
					pullRequest={detail.data.pullRequest}
					canWrite={canWrite}
					isRefreshing={detail.isLoading}
					onRefresh={detail.refetch}
				/>
			</>
		);
	}
	if (detail.error) {
		return <ErrorCard message={detail.error} />;
	}
	return <div className="page-loading">Loading pull request…</div>;
}

function ErrorCard({ message }: { message: string }) {
	return (
		<Card>
			<CardContent className="p-4">
				<p className="m-0 text-sm text-[var(--danger)]" role="alert">
					{message}
				</p>
			</CardContent>
		</Card>
	);
}
