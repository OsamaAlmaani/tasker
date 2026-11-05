import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	GitHubSetupPrompt,
	ProjectGitHubPage,
} from "#/features/tasker/github/components/ProjectGitHubPage";
import { PullRequestList } from "#/features/tasker/github/components/PullRequestList";
import {
	type PullRequestStateFilter,
	parsePullRequestStateFilter,
} from "#/features/tasker/github/pullRequestDisplay";
import type { Id } from "#convex/_generated/dataModel";

type PullRequestListSearch = {
	state?: Exclude<PullRequestStateFilter, "open">;
};

export const Route = createFileRoute("/_app/projects/$projectId_/pulls/")({
	validateSearch: (search: Record<string, unknown>): PullRequestListSearch => {
		const state = parsePullRequestStateFilter(search.state);
		return state === "open" ? {} : { state };
	},
	component: ProjectPullRequestsPage,
});

function ProjectPullRequestsPage() {
	const projectId = Route.useParams().projectId as Id<"projects">;
	const stateFilter = Route.useSearch().state ?? "open";
	const navigate = useNavigate();

	return (
		<ProjectGitHubPage
			projectId={projectId}
			description="Pull requests from the repository linked to this project."
		>
			{(integration) =>
				integration.account && integration.repository ? (
					<PullRequestList
						projectId={projectId}
						repository={integration.repository}
						stateFilter={stateFilter}
						onStateFilterChange={(state) =>
							void navigate({
								to: "/projects/$projectId/pulls",
								params: { projectId },
								search: state === "open" ? {} : { state },
								replace: true,
							})
						}
					/>
				) : (
					<GitHubSetupPrompt projectId={projectId} integration={integration} />
				)
			}
		</ProjectGitHubPage>
	);
}
