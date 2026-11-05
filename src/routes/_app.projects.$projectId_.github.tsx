import { createFileRoute } from "@tanstack/react-router";
import { ProjectGitHubPage } from "#/features/tasker/github/components/ProjectGitHubPage";
import { ProjectGitHubSettings } from "#/features/tasker/github/components/ProjectGitHubSettings";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/projects/$projectId_/github")({
	component: ProjectGitHubSettingsPage,
});

function ProjectGitHubSettingsPage() {
	const projectId = Route.useParams().projectId as Id<"projects">;
	return (
		<ProjectGitHubPage
			projectId={projectId}
			description="Choose the repository for this project and manage your own GitHub token."
		>
			{(integration) => (
				<ProjectGitHubSettings
					projectId={projectId}
					integration={integration}
				/>
			)}
		</ProjectGitHubPage>
	);
}
