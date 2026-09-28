import {
	Gantt,
	type IApi,
	type IColumnConfig,
	type IScaleConfig,
	type ITask,
	Willow,
} from "@svar-ui/react-gantt";
import { CalendarDays, Maximize2, PanelLeft } from "lucide-react";
import {
	type ComponentProps,
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#/components/ui/button";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";
import { calendarTimestamp } from "#/features/tasker/projects/taskCalendarDates";
import {
	ganttDateString,
	getTaskGanttDateChanges,
	getTaskGanttRange,
} from "#/features/tasker/projects/taskGanttDates";
import { getClientErrorMessage } from "#/lib/utils";
import "@svar-ui/react-gantt/all.css";
import "./projectTaskGantt.css";

type GanttIssue = {
	_id: string;
	title: string;
	issueNumber: number;
	status: string;
	startDate?: number | null;
	dueDate?: number | null;
	parentIssueId?: string | null;
	hasChildren?: boolean;
	childCompletionRate?: number;
	hasChecklist?: boolean;
	checklistCompletionRate?: number;
};

type ProjectTaskGanttProps = {
	canWrite: boolean;
	issues: GanttIssue[];
	onDatesChange: (
		issueId: string,
		dates: { startDate?: number; dueDate?: number },
	) => Promise<unknown>;
	onOpenIssue: (issueId: string) => void;
	projectKey: string;
	statuses: ProjectStatusDefinition[];
};

type TaskRow = ITask & {
	issueKey: string;
	statusName: string;
	statusColor: string;
	startLabel: string;
	endLabel: string;
	isSubtask: boolean;
	onOpen: () => void;
};

const scales: Record<string, IScaleConfig[]> = {
	days: [
		{ unit: "month", step: 1, format: "%F %Y" },
		{ unit: "day", step: 1, format: "%j" },
	],
	weeks: [
		{ unit: "month", step: 1, format: "%F %Y" },
		{ unit: "week", step: 1, format: "%M %j" },
	],
	months: [
		{ unit: "year", step: 1, format: "%Y" },
		{ unit: "month", step: 1, format: "%M" },
	],
};
// Native cellWidth is per smallest displayed scale unit, while drag snapping
// stays in days through lengthUnit. Weeks and months therefore need wider cells.
const cellWidths = { days: 44, weeks: 168, months: 240 };
const scaleDays = { days: 1, weeks: 7, months: 30 };

type GridCellProps = ComponentProps<NonNullable<IColumnConfig["cell"]>>;

function TaskCell({ row: gridRow }: GridCellProps) {
	const row = gridRow as TaskRow;
	return (
		<button
			type="button"
			className="task-gantt-task-link"
			onClick={row.onOpen}
			title={`${row.issueKey}: ${row.text}`}
		>
			<span className="task-gantt-key">
				{row.issueKey}
				{row.isSubtask ? " · Subtask" : ""}
			</span>
			<span className="task-gantt-title">{row.text}</span>
		</button>
	);
}

function StatusCell({ row: gridRow }: GridCellProps) {
	const row = gridRow as TaskRow;
	return (
		<span className="task-gantt-status" title={row.statusName}>
			<span style={{ background: row.statusColor }} aria-hidden="true" />
			{row.statusName}
		</span>
	);
}

function TaskBar({ data }: { data: ITask }) {
	const task = data as TaskRow;
	return (
		<button
			type="button"
			className="task-gantt-bar"
			style={{ "--task-color": task.statusColor } as CSSProperties}
			title={`${task.issueKey}: ${task.text} · ${task.statusName} · ${task.startLabel} – ${task.endLabel}`}
			onDoubleClick={(event) => {
				event.stopPropagation();
				task.onOpen();
			}}
			onClick={(event) => {
				if (event.detail === 0) {
					event.stopPropagation();
					task.onOpen();
				}
			}}
		>
			<span
				className="task-gantt-fill"
				style={{ width: `${task.progress ?? 0}%` }}
			/>
			<span className="task-gantt-bar-label">{task.text}</span>
			<span
				className="task-gantt-edge task-gantt-edge-start"
				aria-hidden="true"
			/>
			<span
				className="task-gantt-edge task-gantt-edge-end"
				aria-hidden="true"
			/>
		</button>
	);
}

const columns: IColumnConfig[] = [
	{ id: "text", header: "Task", width: 240, cell: TaskCell, resize: true },
	{ id: "statusName", header: "Status", width: 130, cell: StatusCell },
	{ id: "startLabel", header: "Start", width: 110 },
	{ id: "endLabel", header: "Due", width: 110 },
];

function highlightTime(date: Date, unit: string) {
	if (unit !== "day") return "";
	if (ganttDateString(date) === ganttDateString(new Date()))
		return "task-gantt-today";
	return date.getDay() === 0 || date.getDay() === 6 ? "task-gantt-weekend" : "";
}

export default function ProjectTaskGantt({
	canWrite,
	issues,
	onDatesChange,
	onOpenIssue,
	projectKey,
	statuses,
}: ProjectTaskGanttProps) {
	const apiRef = useRef<IApi | null>(null);
	const [ganttApi, setGanttApi] = useState<IApi | null>(null);
	const [nativeCellWidth, setNativeCellWidth] = useState(168);
	const containerRef = useRef<HTMLDivElement>(null);
	const saving = useRef(false);
	const [savingId, setSavingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [zoom, setZoom] = useState<keyof typeof cellWidths>("weeks");
	const [fitWidth, setFitWidth] = useState<number | null>(null);
	const [showGrid, setShowGrid] = useState(
		() => window.matchMedia("(min-width: 900px)").matches,
	);
	const [includeToday, setIncludeToday] = useState(false);
	const showGridRef = useRef(showGrid);
	showGridRef.current = showGrid;
	const today = useMemo(() => {
		const value = new Date();
		value.setHours(0, 0, 0, 0);
		return value;
	}, []);
	const { tasks, undated, bounds } = useMemo(() => {
		const statusMap = new Map(statuses.map((status) => [status.key, status]));
		const datedIds = new Set(
			issues
				.filter((issue) => getTaskGanttRange(issue))
				.map((issue) => issue._id),
		);
		const tasks: TaskRow[] = [];
		const undated: GanttIssue[] = [];
		for (const issue of issues) {
			const range = getTaskGanttRange(issue);
			if (!range) {
				undated.push(issue);
				continue;
			}
			const status = statusMap.get(issue.status);
			tasks.push({
				id: issue._id,
				text: issue.title,
				...range,
				// Parent dates remain independent of their children; never make real
				// tasks into automatically calculated summary tasks.
				type: "task",
				parent:
					issue.parentIssueId && datedIds.has(issue.parentIssueId)
						? issue.parentIssueId
						: 0,
				open: issues.some(
					(child) =>
						child.parentIssueId === issue._id && datedIds.has(child._id),
				),
				progress:
					issue.status === "done"
						? 100
						: issue.hasChildren
							? (issue.childCompletionRate ?? 0)
							: issue.hasChecklist
								? (issue.checklistCompletionRate ?? 0)
								: 0,
				issueKey: `${projectKey}-${issue.issueNumber}`,
				isSubtask: Boolean(issue.parentIssueId),
				statusName: status?.name ?? issue.status,
				statusColor: status?.color ?? "#64748b",
				startLabel:
					issue.startDate != null ? ganttDateString(range.start) : "—",
				endLabel:
					issue.dueDate != null
						? new Date(issue.dueDate).toISOString().slice(0, 10)
						: "—",
				onOpen: () => onOpenIssue(issue._id),
			});
		}
		const starts = tasks.map(
			(task) => task.start?.getTime() ?? today.getTime(),
		);
		const ends = tasks.map((task) => task.end?.getTime() ?? today.getTime());
		if (includeToday || !tasks.length) {
			starts.push(today.getTime());
			ends.push(today.getTime());
		}
		const start = new Date(Math.min(...starts));
		const end = new Date(Math.max(...ends));
		start.setDate(start.getDate() - 7);
		end.setDate(end.getDate() + 14);
		return { tasks, undated, bounds: { start, end } };
	}, [issues, statuses, projectKey, onOpenIssue, today, includeToday]);
	const latest = useRef({ canWrite, issues, onDatesChange, onOpenIssue });
	latest.current = { canWrite, issues, onDatesChange, onOpenIssue };
	const pending = useRef<{ issue: GanttIssue; resize: boolean } | null>(null);

	const init = useCallback((api: IApi) => {
		apiRef.current = api;
		setGanttApi(api);
		// Tasker owns creation, status, hierarchy and progress. Expose only
		// persisted date changes here, including keyboard date movement.
		for (const action of [
			"add-task",
			"delete-task",
			"copy-task",
			"move-task",
			"indent-task",
			"add-link",
			"update-link",
			"delete-link",
		])
			api.intercept(action, () => false);
		api.intercept("show-editor", ({ id }) => {
			if (id) latest.current.onOpenIssue(String(id));
			return false;
		});
		api.intercept(
			"drag-task",
			(event) =>
				event.top == null && latest.current.canWrite && !saving.current,
		);
		api.intercept("update-task", (event) => {
			if (event.eventSource === "tasker-revert") return true;
			const issue = latest.current.issues.find(
				(issue) => issue._id === event.id,
			);
			if (
				!latest.current.canWrite ||
				saving.current ||
				!issue ||
				event.inProgress ||
				(!event.task.start && !event.task.end)
			)
				return false;
			pending.current = {
				issue,
				resize: !(event.task.start && event.task.end),
			};
		});
		api.on("update-task", (event) => {
			if (event.eventSource === "tasker-revert" || !pending.current) return;
			const { issue, resize } = pending.current;
			pending.current = null;
			const updated = api.getTask(event.id);
			if (!updated.start || !updated.end) return;
			const dates = getTaskGanttDateChanges(
				issue,
				updated.start,
				updated.end,
				resize,
			);
			saving.current = true;
			setSavingId(issue._id);
			setError(null);
			setAnnouncement("");
			void (async () => {
				try {
					await latest.current.onDatesChange(issue._id, dates);
					setAnnouncement(`Dates saved for ${issue.title}.`);
				} catch (cause) {
					const original = getTaskGanttRange(
						latest.current.issues.find((value) => value._id === issue._id) ??
							issue,
					);
					if (original && api.getTask(issue._id)) {
						const duration =
							(calendarTimestamp(ganttDateString(original.end)) -
								calendarTimestamp(ganttDateString(original.start))) /
							86_400_000;
						await api.exec("update-task", {
							id: issue._id,
							task: { ...original, duration },
							eventSource: "tasker-revert",
						});
					}
					setError(
						getClientErrorMessage(cause, "Could not update task dates."),
					);
				} finally {
					saving.current = false;
					setSavingId(null);
				}
			})();
		});
	}, []);

	useEffect(() => {
		return ganttApi?.getReactiveState().cellWidth?.subscribe((width) => {
			if (width != null) setNativeCellWidth(width);
		});
	}, [ganttApi]);

	useEffect(() => {
		if (!ganttApi) return;
		let previousCompact: boolean | undefined;
		return ganttApi.getReactiveState()._compactMode.subscribe((compact) => {
			if (compact === previousCompact) return;
			previousCompact = compact;
			if (compact) {
				setShowGrid(false);
				void ganttApi.exec("set-display-mode", { mode: "chart" });
			} else if (!showGridRef.current)
				void ganttApi.exec("set-display-mode", { mode: "chart" });
		});
	}, [ganttApi]);

	useEffect(() => {
		if (!ganttApi) return;
		const compact = ganttApi.getState()._compactMode;
		void ganttApi.exec("set-display-mode", {
			mode: showGrid ? (compact ? "grid" : "all") : "chart",
		});
	}, [ganttApi, showGrid]);

	function scrollToToday() {
		setIncludeToday(true);
		// React commits the expanded bounds before scrolling the native chart.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const api = apiRef.current;
				const state = api?.getState();
				if (api && state?._scales)
					void api.exec("scroll-chart", {
						left:
							state._scales.diff(today, state._scales.start, "day") *
								(state.cellWidth ?? 24) -
							100,
					});
			}),
		);
	}

	function fitTasks() {
		const state = apiRef.current?.getState();
		const width =
			(containerRef.current?.clientWidth ?? 900) -
			(showGrid ? (state?.gridWidth ?? 330) : 0) -
			20;
		const days =
			(calendarTimestamp(ganttDateString(bounds.end)) -
				calendarTimestamp(ganttDateString(bounds.start))) /
			86_400_000;
		const fitZoom = days > 100 ? "months" : "weeks";
		setFitWidth(Math.max(1, Math.min(44, width / days)) * scaleDays[fitZoom]);
		setZoom(fitZoom);
		void apiRef.current?.exec("scroll-chart", { left: 0 });
	}

	return (
		<section className="task-gantt" aria-label="Task Gantt chart">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" variant="secondary" onClick={scrollToToday}>
						<CalendarDays className="mr-1.5 h-4 w-4" />
						Today
					</Button>
					<Button size="sm" variant="ghost" onClick={fitTasks}>
						<Maximize2 className="mr-1.5 h-4 w-4" />
						Fit tasks
					</Button>
					<Button
						size="sm"
						variant="ghost"
						aria-pressed={showGrid}
						onClick={() => setShowGrid((value) => !value)}
					>
						<PanelLeft className="mr-1.5 h-4 w-4" />
						Task grid
					</Button>
				</div>
				<div className="inline-flex gap-1 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1">
					{(["days", "weeks", "months"] as const).map((value) => (
						<Button
							key={value}
							size="sm"
							variant={
								zoom === value && fitWidth == null ? "secondary" : "ghost"
							}
							aria-pressed={zoom === value && fitWidth == null}
							onClick={() => {
								setZoom(value);
								setFitWidth(null);
							}}
						>
							{value[0].toUpperCase() + value.slice(1)}
						</Button>
					))}
				</div>
			</div>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-text)]">
				<span>
					{tasks.length} scheduled · {undated.length} without dates
				</span>
				<span>
					{savingId
						? "Saving dates…"
						: canWrite
							? "Drag to reschedule · Resize either edge · Double-click to open"
							: "Read-only · Double-click to open"}
				</span>
			</div>
			{error ? (
				<p role="alert" className="mb-3 text-sm text-[var(--danger)]">
					{error}
				</p>
			) : null}
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>
			{tasks.length ? (
				<div
					ref={containerRef}
					className="task-gantt-chart"
					data-editable={canWrite && !savingId}
					style={
						{
							"--gantt-cell-width": `${nativeCellWidth}px`,
							"--gantt-cell-height": "44px",
						} as CSSProperties
					}
				>
					<Willow fonts={false}>
						<Gantt
							init={init}
							tasks={tasks}
							columns={columns}
							taskTemplate={TaskBar}
							readonly={!canWrite || Boolean(savingId)}
							scales={scales[zoom]}
							cellWidth={fitWidth ?? cellWidths[zoom]}
							lengthUnit="day"
							durationUnit="day"
							cellHeight={44}
							scaleHeight={32}
							gridWidth={380}
							start={bounds.start}
							end={bounds.end}
							autoScale={false}
							highlightTime={highlightTime}
							displayMode={showGrid ? "all" : "chart"}
						/>
					</Willow>
				</div>
			) : (
				<div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-muted)] px-4 py-10 text-center">
					<p className="m-0 font-semibold">No scheduled tasks</p>
					<p className="m-0 mt-2 text-sm text-[var(--muted-text)]">
						Add a start or due date to show tasks on the timeline.
					</p>
				</div>
			)}
			{undated.length ? (
				<details className="task-gantt-undated mt-3 rounded-lg border border-[var(--line)] px-3 py-2">
					<summary className="cursor-pointer text-sm font-medium">
						Without dates ({undated.length})
					</summary>
					<div className="mt-2 max-h-48 space-y-1 overflow-auto">
						{undated.map((issue) => (
							<button
								key={issue._id}
								type="button"
								className="task-gantt-undated-link"
								onClick={() => onOpenIssue(issue._id)}
							>
								<span className="task-gantt-key">
									{projectKey}-{issue.issueNumber}
								</span>
								<span className="truncate">{issue.title}</span>
							</button>
						))}
					</div>
				</details>
			) : null}
		</section>
	);
}
