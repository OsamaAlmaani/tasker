import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCheck,
	FolderKanban,
	ListChecks,
	User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import { api } from "#convex/_generated/api";

export const Route = createFileRoute("/_app/dashboard")({
	component: DashboardPage,
});

function DashboardPage() {
	const overview = useQuery(api.dashboard.overview);

	if (!overview) {
		return <div className="page-loading">Loading dashboard…</div>;
	}

	const stats = [
		{
			label: "Projects",
			value: overview.quickStats.projects,
			icon: FolderKanban,
		},
		{
			label: "Open Tasks",
			value: overview.quickStats.openIssues,
			icon: ListChecks,
		},
		{
			label: "Completed",
			value: overview.quickStats.completedIssues,
			icon: CheckCheck,
		},
		{
			label: "Overdue",
			value: overview.quickStats.overdue,
			icon: AlertTriangle,
		},
	];

	return (
		<div>
			<PageHeader
				title="Dashboard"
				description="Your projects, assigned work, and activity in one place."
			/>

			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{stats.map((item) => {
					const Icon = item.icon;
					return (
						<Card key={item.label}>
							<CardContent className="flex items-center justify-between p-4">
								<div>
									<p className="m-0 text-xs uppercase tracking-wide text-[var(--muted-text)]">
										{item.label}
									</p>
									<p className="m-0 mt-1 text-2xl font-semibold text-[var(--text)]">
										{item.value}
									</p>
								</div>
								<Icon className="h-4 w-4 text-[var(--muted-text)]" />
							</CardContent>
						</Card>
					);
				})}
			</section>

			<section className="mt-5 grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>My Assigned Tasks</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{overview.myAssignedIssues.map((issue) => (
							<Link
								key={issue._id}
								to="/issues/$issueId"
								params={{ issueId: issue._id }}
								className="issue-row"
							>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{issue.title}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										Updated {formatRelative(issue.updatedAt)}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<IssueStatusBadge status={issue.status} />
									<IssuePriorityBadge priority={issue.priority} />
								</div>
							</Link>
						))}
						{!overview.myAssignedIssues.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No assigned tasks.
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Overdue</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{overview.overdueIssues.map((issue) => (
							<Link
								key={issue._id}
								to="/issues/$issueId"
								params={{ issueId: issue._id }}
								className="issue-row"
							>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{issue.title}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										Due {formatDate(issue.dueDate)}
									</p>
								</div>
								<IssueStatusBadge status={issue.status} />
							</Link>
						))}
						{!overview.overdueIssues.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No overdue tasks.
							</p>
						) : null}
					</CardContent>
				</Card>
			</section>

			<section className="mt-5 grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Recent Projects</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{overview.recentProjects.map((project) => (
							<Link
								key={project._id}
								to="/projects/$projectId"
								params={{ projectId: project._id }}
								className="issue-row"
							>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{project.name}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										{project.key}
									</p>
								</div>
								<span className="text-xs text-[var(--muted-text)]">
									{formatRelative(project.updatedAt)}
								</span>
							</Link>
						))}
						{!overview.recentProjects.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No projects yet.
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Recent Activity</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{overview.recentActivity.map((activity) => (
							<div key={activity._id} className="issue-row">
								<div>
									<p className="m-0 text-sm text-[var(--text)]">
										{activity.action}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										{activity.entityType}
									</p>
								</div>
								<span className="text-xs text-[var(--muted-text)]">
									{formatRelative(activity.createdAt)}
								</span>
							</div>
						))}
						{!overview.recentActivity.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No activity yet.
							</p>
						) : null}
					</CardContent>
				</Card>
			</section>

			<section className="mt-5">
				<Card>
					<CardHeader>
						<CardTitle>
							<User className="mr-2 inline h-4 w-4" />
							Created by Me
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{overview.createdByMe.map((issue) => (
							<Link
								key={issue._id}
								to="/issues/$issueId"
								params={{ issueId: issue._id }}
								className="issue-row"
							>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{issue.title}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										#{issue.issueNumber}
									</p>
								</div>
								<IssueStatusBadge status={issue.status} />
							</Link>
						))}
						{!overview.createdByMe.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No created tasks yet.
							</p>
						) : null}
					</CardContent>
				</Card>
			</section>
		</div>
	);
}
