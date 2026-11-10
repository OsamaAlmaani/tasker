import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	GitPullRequest,
	ListTodo,
	MessageSquareText,
	Plug,
	Workflow,
} from "lucide-react";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

const tabClassName =
	"inline-flex items-center gap-2 border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-[var(--muted-text)] no-underline transition-colors hover:text-[var(--text)] data-[status=active]:border-[var(--accent)] data-[status=active]:text-[var(--text)]";

/** Header and section tabs shared by the project's GitHub pages. */
export function ProjectGitHubHeader({
	projectId,
	project,
	description,
	actions,
}: {
	projectId: string;
	project: { key: string; name: string } | null | undefined;
	description?: string;
	actions?: React.ReactNode;
}) {
	const badge = useQuery(api.githubReviewInbox.getInboxBadge, {
		projectId: projectId as Id<"projects">,
	});
	return (
		<>
			<PageHeader
				title={project ? `${project.key} · ${project.name}` : "Project"}
				description={description}
				actions={actions}
			/>
			<nav
				aria-label="Project sections"
				className="mb-5 flex flex-wrap gap-5 border-b border-[var(--line)]"
			>
				<Link
					to="/projects/$projectId"
					params={{ projectId }}
					className={tabClassName}
					activeOptions={{ exact: true }}
				>
					<ListTodo className="h-4 w-4" />
					Tasks
				</Link>
				<Link
					to="/projects/$projectId/pulls"
					params={{ projectId }}
					className={tabClassName}
				>
					<GitPullRequest className="h-4 w-4" />
					Pull requests
				</Link>
				<Link
					to="/projects/$projectId/reviews"
					params={{ projectId }}
					className={tabClassName}
				>
					<MessageSquareText className="h-4 w-4" />
					Reviews
					<ReviewsBadge badge={badge} />
				</Link>
				<Link
					to="/projects/$projectId/workflows"
					params={{ projectId }}
					className={tabClassName}
				>
					<Workflow className="h-4 w-4" />
					Workflows
				</Link>
				<Link
					to="/projects/$projectId/github"
					params={{ projectId }}
					className={tabClassName}
				>
					<Plug className="h-4 w-4" />
					GitHub
				</Link>
			</nav>
		</>
	);
}

/**
 * Conversations waiting on the viewer plus review requests, as the Reviews
 * page last counted them for this user.
 */
export function ReviewsBadge({
	badge,
}: {
	badge: { attention: number; reviewRequests: number } | null | undefined;
}) {
	const count = badge ? badge.attention + badge.reviewRequests : 0;
	if (!count) return null;
	return (
		<span
			className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold leading-4 text-white tabular-nums"
			title={`${badge?.attention ?? 0} conversation${badge?.attention === 1 ? "" : "s"} need you, ${badge?.reviewRequests ?? 0} review request${badge?.reviewRequests === 1 ? "" : "s"}`}
		>
			{count > 99 ? "99+" : count}
			<span className="sr-only"> waiting on you</span>
		</span>
	);
}
