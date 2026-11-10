import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Plug } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import { ProjectGitHubHeader } from "./ProjectGitHubHeader";
import type { ProjectGitHubIntegration } from "./ProjectGitHubSettings";

type LoadedIntegration = ProjectGitHubIntegration;

/**
 * Loads the project's GitHub integration and renders the shared header,
 * loading and not-found states for the project's GitHub pages.
 */
export function ProjectGitHubPage({
	projectId,
	description,
	actions,
	workspace = false,
	children,
}: {
	projectId: Id<"projects">;
	description?: string;
	/**
	 * Fill the window below the top bar with a one-row header; the page does
	 * not scroll and the content manages its own scrolling.
	 */
	workspace?: boolean;
	actions?: (integration: LoadedIntegration) => React.ReactNode;
	children: (integration: LoadedIntegration) => React.ReactNode;
}) {
	const integration = useQuery(api.github.getIntegration, { projectId });

	if (integration === undefined) {
		return <div className="page-loading">Loading project…</div>;
	}

	if (integration === null) {
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
		<div className={workspace ? "github-workspace" : undefined}>
			<ProjectGitHubHeader
				projectId={projectId}
				project={integration.project}
				description={description}
				actions={actions?.(integration)}
				compact={workspace}
			/>
			{children(integration)}
		</div>
	);
}

/** Shown on PR pages until a repository is linked and the viewer has added their own token. */
export function GitHubSetupPrompt({
	projectId,
	integration,
}: {
	projectId: Id<"projects">;
	integration: LoadedIntegration;
}) {
	const needsRepository = !integration.repository;
	const canFix = !needsRepository || integration.canManage;
	return (
		<Card>
			<CardContent className="flex flex-col items-center gap-3 p-8 text-center">
				<Plug className="h-8 w-8 text-[var(--muted-text)]" />
				<div className="space-y-1">
					<p className="m-0 font-medium">
						{needsRepository
							? "Link a repository to see pull requests"
							: "Add your GitHub token to see pull requests"}
					</p>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						{needsRepository
							? integration.canManage
								? "Choose the repository on this project's GitHub tab."
								: "Ask a project member with write access to link one."
							: `This project tracks ${integration.repository?.fullName}. Everyone uses their own personal access token, so you only see what your token can access.`}
					</p>
				</div>
				{canFix ? (
					<Link
						to="/projects/$projectId/github"
						params={{ projectId }}
						className="no-underline"
					>
						<Button>Open GitHub settings</Button>
					</Link>
				) : null}
			</CardContent>
		</Card>
	);
}
