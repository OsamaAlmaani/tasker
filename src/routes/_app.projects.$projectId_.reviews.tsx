import { createFileRoute } from "@tanstack/react-router";
import {
	GitHubSetupPrompt,
	ProjectGitHubPage,
} from "#/features/tasker/github/components/ProjectGitHubPage";
import { ReviewInbox } from "#/features/tasker/github/components/ReviewInbox";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/projects/$projectId_/reviews")({
	component: ProjectReviewsPage,
});

function ProjectReviewsPage() {
	const projectId = Route.useParams().projectId as Id<"projects">;

	return (
		<ProjectGitHubPage
			projectId={projectId}
			description="Open review conversations across pull requests. Track the ones that need work as tasks."
		>
			{(integration) =>
				integration.account && integration.repository ? (
					<ReviewInbox
						projectId={projectId}
						repository={integration.repository.fullName}
						canWrite={integration.canManage}
						liveVersion={integration.repository.liveVersion}
					/>
				) : (
					<GitHubSetupPrompt projectId={projectId} integration={integration} />
				)
			}
		</ProjectGitHubPage>
	);
}
