import FullCalendar, {
	type CalendarRef,
	type DatesSetInfo,
	type EventDropInfo,
	type EventInput,
	type EventResizeDoneInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/classic";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";
import {
	calendarDate,
	calendarTimestamp,
	getTaskCalendarDateChanges,
	getTaskCalendarRange,
} from "#/features/tasker/projects/taskCalendarDates";
import { getClientErrorMessage } from "#/lib/utils";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "./projectTaskCalendar.css";

type CalendarIssue = {
	_id: string;
	title: string;
	issueNumber: number;
	status: string;
	startDate?: number | null;
	dueDate?: number | null;
	parentIssueId?: string | null;
};

type ProjectTaskCalendarProps = {
	canWrite: boolean;
	issues: CalendarIssue[];
	onDatesChange: (
		issueId: string,
		dates: { startDate?: number; dueDate?: number },
	) => Promise<unknown>;
	onOpenIssue: (issueId: string) => void;
	projectKey: string;
	statuses: ProjectStatusDefinition[];
};

const plugins = [themePlugin, dayGridPlugin, interactionPlugin];

function getCalendarWeek(date: string) {
	const start = new Date(`${date}T00:00:00.000Z`);
	start.setUTCDate(start.getUTCDate() - start.getUTCDay());
	return start.toISOString().slice(0, 10);
}

export default function ProjectTaskCalendar({
	canWrite,
	issues,
	onDatesChange,
	onOpenIssue,
	projectKey,
	statuses,
}: ProjectTaskCalendarProps) {
	const calendarRef = useRef<CalendarRef>(null);
	const saving = useRef(false);
	const [savingIssueId, setSavingIssueId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [view, setView] = useState("dayGridMonth");
	const [range, setRange] = useState<DatesSetInfo | null>(null);
	const statusByKey = useMemo(
		() => new Map(statuses.map((status) => [status.key, status])),
		[statuses],
	);
	const { events, compactWeeks } = useMemo(() => {
		const events: EventInput[] = [];
		const countByDate = new Map<string, number>();
		const compactWeeks = new Set<string>();
		const compactThreshold = range?.view.type === "dayGridWeek" ? 3 : 1;
		for (const issue of issues) {
			const dates = getTaskCalendarRange(issue);
			if (!dates) {
				continue;
			}
			// Task forms persist date-only values at UTC midnight. Keep that date
			// instead of converting the timestamp into the browser's time zone.
			const status = statusByKey.get(issue.status);
			const visibleStart = range?.startStr.slice(0, 10);
			const visibleEnd = range?.endStr.slice(0, 10);
			// Count each occupied day, bounded to the visible grid for long ranges.
			for (
				let day = calendarTimestamp(
					visibleStart && visibleStart > dates.start
						? visibleStart
						: dates.start,
				);
				visibleEnd &&
				day <
					calendarTimestamp(dates.end < visibleEnd ? dates.end : visibleEnd);
				day += 86_400_000
			) {
				const date = calendarDate(day);
				countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
				if ((countByDate.get(date) ?? 0) > compactThreshold) {
					// DayGrid aligns event rows across a week. Compact that week so
					// taller cards on other days cannot waste a crowded day's space.
					compactWeeks.add(getCalendarWeek(date));
				}
			}
			events.push({
				id: issue._id,
				title: issue.title,
				start: dates.start,
				end: dates.end,
				allDay: true,
				url: `/issues/${issue._id}`,
				color: status?.color ?? "#64748b",
				extendedProps: {
					startDate: issue.startDate,
					dueDate: issue.dueDate,
					issueKey: `${projectKey}-${issue.issueNumber}`,
					statusName: status?.name ?? issue.status,
					isSubtask: Boolean(issue.parentIssueId),
				},
			});
		}
		return { events, compactWeeks };
	}, [issues, projectKey, statusByKey, range]);
	const undatedCount = issues.length - events.length;
	const rangeCount = range
		? events.filter((event) => {
				return (
					(event.end as string) > range.startStr.slice(0, 10) &&
					(event.start as string) < range.endStr.slice(0, 10)
				);
			}).length
		: 0;

	async function handleDateChange(
		info: EventDropInfo | EventResizeDoneInfo,
		resize = false,
	) {
		if (!canWrite || saving.current || !info.event.start || !info.event.end) {
			info.revert();
			return;
		}
		saving.current = true;
		setSavingIssueId(info.event.id);
		setError(null);
		setAnnouncement("");
		try {
			const dates = getTaskCalendarDateChanges(
				info.oldEvent.extendedProps,
				info.event.startStr,
				info.event.endStr,
				resize,
			);
			await onDatesChange(info.event.id, dates);
			setAnnouncement(`${info.event.title} dates updated.`);
		} catch (error) {
			info.revert();
			setError(
				`${getClientErrorMessage(error, "Could not change task dates.")} Task returned to its original dates.`,
			);
		} finally {
			saving.current = false;
			setSavingIssueId(null);
		}
	}

	return (
		<section
			className="task-calendar"
			aria-label="Task calendar"
			aria-busy={Boolean(savingIssueId)}
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--accent)]">
						<CalendarDays className="h-5 w-5" />
					</div>
					<div>
						<h3 className="m-0 text-base font-semibold text-[var(--text)]">
							{range?.view.title ?? "Calendar"}
						</h3>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							{rangeCount} {rangeCount === 1 ? "task" : "tasks"} in view
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1">
						{[
							{ key: "dayGridMonth", label: "Month" },
							{ key: "dayGridWeek", label: "Week" },
						].map((option) => (
							<Button
								key={option.key}
								type="button"
								size="sm"
								className="h-7 px-3"
								variant={view === option.key ? "secondary" : "ghost"}
								aria-pressed={view === option.key}
								onClick={() =>
									calendarRef.current?.getApi().changeView(option.key)
								}
							>
								{option.label}
							</Button>
						))}
					</div>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => calendarRef.current?.getApi().today()}
					>
						Today
					</Button>
					<div className="inline-flex gap-1">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="px-2"
							aria-label="Previous period"
							onClick={() => calendarRef.current?.getApi().prev()}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="px-2"
							aria-label="Next period"
							onClick={() => calendarRef.current?.getApi().next()}
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-text)]">
				<p className="m-0">
					{canWrite
						? "Drag to move dates. Drag either edge to resize or add a date range. Click to open."
						: "Click a task to open it."}
				</p>
				<p className="m-0">
					{events.length} scheduled
					{undatedCount ? ` · ${undatedCount} without dates` : ""}
				</p>
			</div>
			{error ? (
				<p
					role="alert"
					className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--danger)]"
				>
					{error}
				</p>
			) : null}
			<p
				role="status"
				className={
					savingIssueId ? "mb-3 text-xs text-[var(--muted-text)]" : "sr-only"
				}
			>
				{savingIssueId ? "Saving task dates…" : announcement}
			</p>
			{events.length === 0 ? (
				<p className="mb-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted-text)]">
					No scheduled tasks. Tasks matching your filters appear here once they
					have a start or due date.
				</p>
			) : null}
			<FullCalendar
				ref={calendarRef}
				plugins={plugins}
				initialView="dayGridMonth"
				views={{
					dayGridWeek: {
						titleFormat: { year: "numeric", month: "short", day: "numeric" },
					},
				}}
				headerToolbar={false}
				height="clamp(620px, 70vh, 840px)"
				events={events}
				fixedWeekCount={false}
				firstDay={0}
				displayEventTime={false}
				eventDisplay="block"
				eventStartEditable={canWrite && !savingIssueId}
				eventDurationEditable={canWrite && !savingIssueId}
				eventResizableFromStart={true}
				eventDragMinDistance={5}
				longPressDelay={350}
				dayMaxEvents={true}
				eventOrder="title"
				moreLinkClick="popover"
				moreLinkContent={(info) => (
					<span>
						… +{info.num}
						<span className="task-calendar-more-label"> more</span>
					</span>
				)}
				moreLinkClass="task-calendar-more"
				popoverClass="task-calendar-popover"
				dayCellClass="task-calendar-day"
				dayHeaderClass="task-calendar-day-header"
				eventInnerClass="task-calendar-event-inner"
				eventBeforeClass={(info) =>
					info.isStartResizable
						? "task-calendar-resize-handle task-calendar-resize-handle-start"
						: ""
				}
				eventAfterClass={(info) =>
					info.isEndResizable
						? "task-calendar-resize-handle task-calendar-resize-handle-end"
						: ""
				}
				eventClass={(info) => {
					const firstWeek = getCalendarWeek(info.event.startStr.slice(0, 10));
					const lastWeek = getCalendarWeek(
						calendarDate(calendarTimestamp(info.event.endStr) - 86_400_000),
					);
					const compact = [...compactWeeks].some(
						(week) => week >= firstWeek && week <= lastWeek,
					);
					return `task-calendar-event${compact ? " task-calendar-event-compact" : ""}`;
				}}
				datesSet={(info) => {
					setRange(info);
					setView(info.view.type);
				}}
				eventDrop={(info) => {
					void handleDateChange(info);
				}}
				eventResize={(info) => {
					void handleDateChange(info, true);
				}}
				eventClick={(info) => {
					if (
						info.jsEvent.ctrlKey ||
						info.jsEvent.metaKey ||
						info.jsEvent.shiftKey ||
						info.jsEvent.altKey
					) {
						return;
					}
					info.jsEvent.preventDefault();
					onOpenIssue(info.event.id);
				}}
				eventDidMount={(info) => {
					const label = `${info.event.extendedProps.issueKey}: ${info.event.title} · ${info.event.extendedProps.statusName}`;
					info.el.title = label;
					info.el.setAttribute("aria-label", label);
				}}
				eventContent={(info) => (
					<div className="task-calendar-task">
						{info.isStartResizable ? (
							<span
								aria-hidden="true"
								className="task-calendar-resize-marker task-calendar-resize-start"
							/>
						) : null}
						{info.isEndResizable ? (
							<span
								aria-hidden="true"
								className="task-calendar-resize-marker task-calendar-resize-end"
							/>
						) : null}
						<span className="task-calendar-task-title">{info.event.title}</span>
						<span className="task-calendar-task-meta">
							{info.event.extendedProps.issueKey}
							{info.event.extendedProps.isSubtask ? " · Subtask" : ""} ·{" "}
							{info.event.extendedProps.statusName}
						</span>
					</div>
				)}
			/>
		</section>
	);
}
