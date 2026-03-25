import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCheck,
	Clock3,
	ListTodo,
	Pin,
	Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	IssuePriorityBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatDate, formatRelative } from "#/features/tasker/format";
import { IssueBulkActionsBar } from "#/features/tasker/issues/components/IssueBulkActionsBar";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

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
type MyWorkOverview = NonNullable<
	ReturnType<typeof useQuery<typeof api.myWork.overview>>
>;
type MyWorkIssue = NonNullable<
	ReturnType<typeof useQuery<typeof api.myWork.overview>>
>["focusIssues"][number];

function MyWorkSection({
	description,
	emptyMessage,
	issues,
	onToggleSelection,
	selectionEnabled,
	selectedIssueIds,
	title,
}: {
	description: string;
	emptyMessage: string;
	issues: MyWorkIssue[];
	onToggleSelection: (issueId: string) => void;
	selectionEnabled: boolean;
	selectedIssueIds: Set<string>;
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
					<div
						key={issue._id}
						className={cn(
							"issue-row",
							selectionEnabled && selectedIssueIds.has(issue._id)
								? "ring-1 ring-[var(--accent)]"
								: "",
						)}
					>
						{selectionEnabled ? (
							<input
								type="checkbox"
								aria-label={`Select task ${issue.title}`}
								checked={selectedIssueIds.has(issue._id)}
								onChange={() => onToggleSelection(issue._id)}
								className="h-4 w-4 rounded border border-[var(--line)] bg-[var(--surface-muted)] accent-[var(--accent)]"
							/>
						) : null}
						<Link
							to="/issues/$issueId"
							params={{ issueId: issue._id }}
							className="issue-row-main no-underline"
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
						</Link>
						<div className="flex items-center gap-2">
							<IssueStatusBadge status={issue.status} />
							<IssuePriorityBadge priority={issue.priority} />
						</div>
					</div>
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
	const me = useQuery(api.users.me);
	const overview = useQuery(api.myWork.overview);
	const updateMyWorkPreferences = useMutation(
		api.users.updateMyWorkPreferences,
	);
	const bulkUpdateIssues = useMutation(api.issues.bulkUpdate);
	const defaultView = me?.myWorkDefaultView ?? "overview";
	const selectedView =
		search.view ?? me?.myWorkDefaultView ?? me?.myWorkLastView ?? "overview";
	const canWrite = me?.globalRole === "admin" || me?.globalRole === "member";
	const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [bulkActionError, setBulkActionError] = useState<string | null>(null);
	const [isApplyingBulkAction, setIsApplyingBulkAction] = useState(false);
	const overviewData: MyWorkOverview = overview ?? {
		quickStats: {
			active: 0,
			focus: 0,
			dueSoon: 0,
			overdue: 0,
			completedRecently: 0,
		},
		focusIssues: [],
		dueSoonIssues: [],
		overdueIssues: [],
		backlogIssues: [],
		recentlyCompletedIssues: [],
	};

	const stats = [
		{ label: "Active", value: overviewData.quickStats.active, icon: ListTodo },
		{ label: "Focus", value: overviewData.quickStats.focus, icon: Target },
		{ label: "Due Soon", value: overviewData.quickStats.dueSoon, icon: Clock3 },
		{
			label: "Overdue",
			value: overviewData.quickStats.overdue,
			icon: AlertTriangle,
		},
		{
			label: "Completed",
			value: overviewData.quickStats.completedRecently,
			icon: CheckCheck,
		},
	];

	function updateView(view: NonNullable<MyWorkView>) {
		void updateMyWorkPreferences({
			lastView: view,
		});
		void navigate({
			to: "/my-work",
			search: { view },
			replace: true,
		});
	}

	function setDefaultView(view: NonNullable<MyWorkView>) {
		void updateMyWorkPreferences({
			lastView: selectedView,
			defaultView: view,
		});
	}

	function clearDefaultView() {
		void updateMyWorkPreferences({
			lastView: selectedView,
			defaultView: null,
		});
	}

	function toggleDefaultView(view: NonNullable<MyWorkView>) {
		if (defaultView === view && view !== "overview") {
			clearDefaultView();
			return;
		}
		if (defaultView !== view) {
			setDefaultView(view);
		}
	}

	const selectedSection =
		selectedView === "focus"
			? {
					title: "Focus",
					description: "Assigned tasks already in progress or review.",
					issues: overviewData.focusIssues,
					emptyMessage: "No focus tasks right now.",
				}
			: selectedView === "due_soon"
				? {
						title: "Due Soon",
						description: "Assigned tasks due within the next seven days.",
						issues: overviewData.dueSoonIssues,
						emptyMessage: "Nothing due soon.",
					}
				: selectedView === "overdue"
					? {
							title: "Overdue",
							description:
								"Assigned tasks with past due dates that still need attention.",
							issues: overviewData.overdueIssues,
							emptyMessage: "Nothing overdue.",
						}
					: selectedView === "backlog"
						? {
								title: "Backlog & Todo",
								description: "Assigned tasks not started yet.",
								issues: overviewData.backlogIssues,
								emptyMessage: "No backlog items assigned to you.",
							}
						: selectedView === "completed"
							? {
									title: "Recently Completed",
									description: "Assigned work you recently finished.",
									issues: overviewData.recentlyCompletedIssues,
									emptyMessage: "No recently completed assigned tasks.",
								}
							: null;
	const visibleIssues = useMemo(() => {
		if (selectedSection) {
			return selectedSection.issues;
		}

		return [
			...overviewData.focusIssues,
			...overviewData.overdueIssues,
			...overviewData.dueSoonIssues,
			...overviewData.backlogIssues,
			...overviewData.recentlyCompletedIssues,
		];
	}, [overviewData, selectedSection]);
	const visibleIssueIds = useMemo(
		() => new Set(visibleIssues.map((issue) => issue._id)),
		[visibleIssues],
	);

	useEffect(() => {
		setSelectedIssueIds((current) => {
			const next = new Set(
				[...current].filter((issueId) => visibleIssueIds.has(issueId)),
			);
			return next.size === current.size ? current : next;
		});
	}, [visibleIssueIds]);

	function toggleIssueSelection(issueId: string) {
		setSelectedIssueIds((current) => {
			const next = new Set(current);
			if (next.has(issueId)) {
				next.delete(issueId);
			} else {
				next.add(issueId);
			}
			return next;
		});
	}

	async function applyBulkAction(changes: {
		status?: MyWorkIssue["status"];
		priority?: MyWorkIssue["priority"];
		archived?: boolean;
	}) {
		if (!selectedIssueIds.size) {
			return;
		}

		setBulkActionError(null);
		setIsApplyingBulkAction(true);
		try {
			await bulkUpdateIssues({
				issueIds: [...selectedIssueIds] as Id<"issues">[],
				...changes,
				cascadeDescendantsToDone: changes.status === "done" ? true : undefined,
			});
		} catch (error) {
			setBulkActionError(
				getClientErrorMessage(error, "Failed to update selected tasks."),
			);
		} finally {
			setIsApplyingBulkAction(false);
		}
	}

	if (!overview || !me) {
		return <div className="page-loading">Loading my work…</div>;
	}

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
					<CardContent className="space-y-3">
						<div className="flex flex-wrap gap-2">
							{viewOptions.map((option) => {
								const isSelected = selectedView === option.value;
								const isPinnedDefault = defaultView === option.value;
								const showPinToggle =
									isSelected &&
									(defaultView !== option.value || option.value !== "overview");

								return (
									<div key={option.value} className="relative">
										<Button
											type="button"
											variant={isSelected ? "primary" : "secondary"}
											onClick={() => updateView(option.value)}
											title={option.description}
											className={showPinToggle ? "pr-10" : undefined}
										>
											{option.label}
											{isPinnedDefault ? " · Default" : ""}
										</Button>
										{showPinToggle ? (
											<button
												type="button"
												className="absolute inset-y-0 right-2 inline-flex items-center justify-center text-current opacity-80 transition hover:opacity-100 focus-visible:outline-none"
												title={
													isPinnedDefault
														? "Clear default view"
														: "Set this view as default"
												}
												aria-label={
													isPinnedDefault
														? "Clear default view"
														: "Set this view as default"
												}
												onClick={(event) => {
													event.stopPropagation();
													toggleDefaultView(option.value);
												}}
											>
												<Pin
													className={`h-3.5 w-3.5 ${isPinnedDefault ? "fill-current" : ""}`}
												/>
											</button>
										) : null}
									</div>
								);
							})}
						</div>
					</CardContent>
				</Card>
			</section>

			{canWrite && selectedIssueIds.size ? (
				<section className="mt-5">
					<IssueBulkActionsBar
						selectedCount={selectedIssueIds.size}
						isApplying={isApplyingBulkAction}
						onClearSelection={() => setSelectedIssueIds(new Set())}
						onStatusChange={(status) => void applyBulkAction({ status })}
						onPriorityChange={(priority) => void applyBulkAction({ priority })}
						onArchiveChange={(archived) => void applyBulkAction({ archived })}
					/>
				</section>
			) : null}
			{bulkActionError ? (
				<p className="mt-4 text-sm text-[var(--danger)]">{bulkActionError}</p>
			) : null}

			{selectedSection ? (
				<section className="mt-5">
					<MyWorkSection
						title={selectedSection.title}
						description={selectedSection.description}
						issues={selectedSection.issues}
						emptyMessage={selectedSection.emptyMessage}
						onToggleSelection={toggleIssueSelection}
						selectionEnabled={canWrite}
						selectedIssueIds={selectedIssueIds}
					/>
				</section>
			) : (
				<>
					<section className="mt-5 grid gap-4 xl:grid-cols-2">
						<MyWorkSection
							title="Focus"
							description="Assigned tasks already in progress or review."
							issues={overviewData.focusIssues}
							emptyMessage="No focus tasks right now."
							onToggleSelection={toggleIssueSelection}
							selectionEnabled={canWrite}
							selectedIssueIds={selectedIssueIds}
						/>
						<MyWorkSection
							title="Overdue"
							description="Assigned tasks with past due dates that still need attention."
							issues={overviewData.overdueIssues}
							emptyMessage="Nothing overdue."
							onToggleSelection={toggleIssueSelection}
							selectionEnabled={canWrite}
							selectedIssueIds={selectedIssueIds}
						/>
					</section>

					<section className="mt-5 grid gap-4 xl:grid-cols-2">
						<MyWorkSection
							title="Due Soon"
							description="Assigned tasks due within the next seven days."
							issues={overviewData.dueSoonIssues}
							emptyMessage="Nothing due soon."
							onToggleSelection={toggleIssueSelection}
							selectionEnabled={canWrite}
							selectedIssueIds={selectedIssueIds}
						/>
						<MyWorkSection
							title="Backlog & Todo"
							description="Assigned tasks not started yet."
							issues={overviewData.backlogIssues}
							emptyMessage="No backlog items assigned to you."
							onToggleSelection={toggleIssueSelection}
							selectionEnabled={canWrite}
							selectedIssueIds={selectedIssueIds}
						/>
					</section>

					<section className="mt-5">
						<MyWorkSection
							title="Recently Completed"
							description="Assigned work you recently finished."
							issues={overviewData.recentlyCompletedIssues}
							emptyMessage="No recently completed assigned tasks."
							onToggleSelection={toggleIssueSelection}
							selectionEnabled={canWrite}
							selectedIssueIds={selectedIssueIds}
						/>
					</section>
				</>
			)}
		</div>
	);
}
