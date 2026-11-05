import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	GitHubSetupPrompt,
	ProjectGitHubPage,
} from "#/features/tasker/github/components/ProjectGitHubPage";
import {
	type WorkflowsView,
	WorkflowsWorkspace,
} from "#/features/tasker/github/workflows/components/WorkflowsWorkspace";
import type { Id } from "#convex/_generated/dataModel";

type WorkflowsSearch = {
	view?: "workflows";
	group?: string;
	release?: string;
};

export const Route = createFileRoute("/_app/projects/$projectId_/workflows/")({
	validateSearch: (search: Record<string, unknown>): WorkflowsSearch => ({
		...(search.view === "workflows" ? { view: "workflows" as const } : {}),
		...(typeof search.group === "string" && search.group
			? { group: search.group }
			: {}),
		...(typeof search.release === "string" && search.release
			? { release: search.release }
			: {}),
	}),
	component: ProjectWorkflowsPage,
});

function ProjectWorkflowsPage() {
	const projectId = Route.useParams().projectId as Id<"projects">;
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const view: WorkflowsView = search.view ?? "releases";

	return (
		<ProjectGitHubPage
			projectId={projectId}
			description="GitHub Actions for the linked repository: start groups of workflows together and follow them as one release."
		>
			{(integration) =>
				integration.account && integration.repository ? (
					<WorkflowsWorkspace
						projectId={projectId}
						repository={integration.repository}
						view={view}
						onViewChange={(next) =>
							void navigate({
								search: (previous) => ({
									...previous,
									view: next === "workflows" ? "workflows" : undefined,
									release: undefined,
									...(next === "releases" ? { group: undefined } : {}),
								}),
								replace: true,
							})
						}
						groupFilter={search.group ?? null}
						onGroupFilterChange={(group) =>
							void navigate({
								search: (previous) => ({
									...previous,
									group: group ?? undefined,
								}),
								replace: true,
							})
						}
						highlightReleaseId={search.release ?? null}
					/>
				) : (
					<GitHubSetupPrompt projectId={projectId} integration={integration} />
				)
			}
		</ProjectGitHubPage>
	);
}
