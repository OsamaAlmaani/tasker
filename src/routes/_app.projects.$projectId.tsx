import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ProjectDetailContent } from "#/features/tasker/projects/components/ProjectDetailContent";
import {
	normalizeProjectSearch,
	type ProjectSearch,
	projectSearchSchema,
} from "#/features/tasker/projects/projectSearch";
import { useProjectDetailPage } from "#/features/tasker/projects/useProjectDetailPage";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/projects/$projectId")({
	validateSearch: projectSearchSchema,
	component: ProjectDetailPage,
});

function ProjectDetailPage() {
	const { projectId: projectIdParam } = Route.useParams();
	const routeSearch = Route.useSearch();
	const navigate = useNavigate();
	const projectId = projectIdParam as Id<"projects">;

	function updateProjectSearch(
		patch: Partial<ProjectSearch>,
		options?: { replace?: boolean },
	) {
		void navigate({
			to: "/projects/$projectId",
			params: { projectId },
			replace: options?.replace ?? false,
			search: (previous) =>
				normalizeProjectSearch({ ...previous, ...patch } as ProjectSearch),
		});
	}
	const page = useProjectDetailPage({
		projectId,
		routeSearch,
		updateProjectSearch,
	});
	const { projectData } = page;

	if (projectData === undefined) {
		return <div className="page-loading">Loading project…</div>;
	}

	if (projectData === null) {
		return (
			<div className="mx-auto max-w-xl">
				<Card>
					<CardHeader>
						<CardTitle>Project not found</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<p className="m-0 text-sm text-[var(--muted-text)]">
							This project may have been deleted or you no longer have access.
						</p>
						<Link to="/projects" className="no-underline">
							<Button>Back to projects</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<ProjectDetailContent
			page={page}
			projectData={projectData}
			projectId={projectId}
			updateProjectSearch={updateProjectSearch}
		/>
	);
}
