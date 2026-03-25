import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCheck,
	Clock3,
	ListTodo,
	Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import { api } from "#convex/_generated/api";

export const Route = createFileRoute("/_app/my-work")({
	component: MyWorkPage,
});

type MyWorkIssue = NonNullable<
	ReturnType<typeof useQuery<typeof api.myWork.overview>>
>["focusIssues"][number];

function MyWorkSection({
	description,
	emptyMessage,
	issues,
	title,
}: {
	description: string;
	emptyMessage: string;
	issues: MyWorkIssue[];
	title: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<p className="m-0 text-sm text-[var(--muted-text)]">{description}</p>
			</CardHeader>
			<CardContent className="space-y-2">
				{issues.map((issue) => (
					<Link
						key={issue._id}
						to="/issues/$issueId"
						params={{ issueId: issue._id }}
						className="issue-row"
					>
						<div className="min-w-0">
							<p className="m-0 truncate text-sm font-medium text-[var(--text)]">
								{issue.title}
							</p>
							<p className="m-0 text-xs text-[var(--muted-text)]">
								{issue.project ? `${issue.project.key} · ` : ""}#
								{issue.issueNumber}
								{issue.dueDate ? ` · Due ${formatDate(issue.dueDate)}` : ""}
								{!issue.dueDate
									? ` · Updated ${formatRelative(issue.updatedAt)}`
									: ""}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<IssueStatusBadge status={issue.status} />
							<IssuePriorityBadge priority={issue.priority} />
						</div>
					</Link>
				))}
				{!issues.length ? (
					<p className="m-0 text-sm text-[var(--muted-text)]">{emptyMessage}</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function MyWorkPage() {
	const overview = useQuery(api.myWork.overview);

	if (!overview) {
		return <div className="page-loading">Loading my work…</div>;
	}

	const stats = [
		{ label: "Active", value: overview.quickStats.active, icon: ListTodo },
		{ label: "Focus", value: overview.quickStats.focus, icon: Target },
		{ label: "Due Soon", value: overview.quickStats.dueSoon, icon: Clock3 },
		{
			label: "Overdue",
			value: overview.quickStats.overdue,
			icon: AlertTriangle,
		},
		{
			label: "Completed",
			value: overview.quickStats.completedRecently,
			icon: CheckCheck,
		},
	];

	return (
		<div>
			<PageHeader
				title="My Work"
				description="Opinionated personal queue: focus work, due soon tasks, overdue tasks, and recently completed follow-through."
			/>

			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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

			<section className="mt-5 grid gap-4 xl:grid-cols-2">
				<MyWorkSection
					title="Focus"
					description="Assigned tasks already in progress or review."
					issues={overview.focusIssues}
					emptyMessage="No focus tasks right now."
				/>
				<MyWorkSection
					title="Overdue"
					description="Assigned tasks with past due dates that still need attention."
					issues={overview.overdueIssues}
					emptyMessage="Nothing overdue."
				/>
			</section>

			<section className="mt-5 grid gap-4 xl:grid-cols-2">
				<MyWorkSection
					title="Due Soon"
					description="Assigned tasks due within the next seven days."
					issues={overview.dueSoonIssues}
					emptyMessage="Nothing due soon."
				/>
				<MyWorkSection
					title="Backlog & Todo"
					description="Assigned tasks not started yet."
					issues={overview.backlogIssues}
					emptyMessage="No backlog items assigned to you."
				/>
			</section>

			<section className="mt-5">
				<MyWorkSection
					title="Recently Completed"
					description="Assigned work you recently finished."
					issues={overview.recentlyCompletedIssues}
					emptyMessage="No recently completed assigned tasks."
				/>
			</section>
		</div>
	);
}
