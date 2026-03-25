import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCheck,
	Clock3,
	ListTodo,
	Target,
} from "lucide-react";
import { z } from "zod";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import { api } from "#convex/_generated/api";

const MY_WORK_VIEW_OPTIONS = [
	"overview",
	"focus",
	"due_soon",
	"overdue",
	"backlog",
	"completed",
] as const;

const myWorkSearchSchema = z.object({
	view: z.enum(MY_WORK_VIEW_OPTIONS).optional(),
});

export const Route = createFileRoute("/_app/my-work")({
	validateSearch: myWorkSearchSchema,
	component: MyWorkPage,
});

type MyWorkView = z.infer<typeof myWorkSearchSchema>["view"];
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

const viewOptions: Array<{
	description: string;
	label: string;
	value: NonNullable<MyWorkView>;
}> = [
	{
		value: "overview",
		label: "Overview",
		description: "See the full personal queue.",
	},
	{
		value: "focus",
		label: "Focus",
		description: "Only in-progress and in-review work.",
	},
	{
		value: "due_soon",
		label: "Due Soon",
		description: "Assigned work due within seven days.",
	},
	{
		value: "overdue",
		label: "Overdue",
		description: "Assigned work that is already late.",
	},
	{
		value: "backlog",
		label: "Backlog",
		description: "Assigned work not started yet.",
	},
	{
		value: "completed",
		label: "Completed",
		description: "Recently completed assigned work.",
	},
];

function MyWorkPage() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	const overview = useQuery(api.myWork.overview);
	const selectedView = search.view ?? "overview";

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

	function updateView(view: NonNullable<MyWorkView>) {
		void navigate({
			to: "/my-work",
			search: view === "overview" ? {} : { view },
			replace: true,
		});
	}

	const selectedSection =
		selectedView === "focus"
			? {
					title: "Focus",
					description: "Assigned tasks already in progress or review.",
					issues: overview.focusIssues,
					emptyMessage: "No focus tasks right now.",
				}
			: selectedView === "due_soon"
				? {
						title: "Due Soon",
						description: "Assigned tasks due within the next seven days.",
						issues: overview.dueSoonIssues,
						emptyMessage: "Nothing due soon.",
					}
				: selectedView === "overdue"
					? {
							title: "Overdue",
							description:
								"Assigned tasks with past due dates that still need attention.",
							issues: overview.overdueIssues,
							emptyMessage: "Nothing overdue.",
						}
					: selectedView === "backlog"
						? {
								title: "Backlog & Todo",
								description: "Assigned tasks not started yet.",
								issues: overview.backlogIssues,
								emptyMessage: "No backlog items assigned to you.",
							}
						: selectedView === "completed"
							? {
									title: "Recently Completed",
									description: "Assigned work you recently finished.",
									issues: overview.recentlyCompletedIssues,
									emptyMessage: "No recently completed assigned tasks.",
								}
							: null;

	return (
		<div>
			<PageHeader
				title="My Work"
				description="Opinionated personal queue: focus work, due soon tasks, overdue tasks, and recently completed follow-through."
			/>

			<section className="mt-5 flex flex-wrap gap-3">
				{stats.map((item) => {
					const Icon = item.icon;
					return (
						<Card key={item.label} className="min-w-[180px] flex-1">
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

			<section className="mt-5">
				<Card>
					<CardHeader>
						<CardTitle>Saved Views</CardTitle>
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Switch between opinionated personal queues without rebuilding
							filters each time.
						</p>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						{viewOptions.map((option) => (
							<Button
								key={option.value}
								type="button"
								variant={
									selectedView === option.value ? "primary" : "secondary"
								}
								onClick={() => updateView(option.value)}
								title={option.description}
							>
								{option.label}
							</Button>
						))}
					</CardContent>
				</Card>
			</section>

			{selectedSection ? (
				<section className="mt-5">
					<MyWorkSection
						title={selectedSection.title}
						description={selectedSection.description}
						issues={selectedSection.issues}
						emptyMessage={selectedSection.emptyMessage}
					/>
				</section>
			) : (
				<>
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
				</>
			)}
		</div>
	);
}
