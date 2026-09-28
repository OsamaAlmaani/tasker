import {
	getTaskCalendarDateChanges,
	getTaskCalendarRange,
	type TaskDates,
} from "./taskCalendarDates";

// SVAR renders local Date objects. Copy UTC date-only components into local
// wall dates, never interpreting the persisted timestamp as a local instant.
export function ganttDate(date: string) {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(0);
	value.setFullYear(year, month - 1, day);
	value.setHours(0, 0, 0, 0);
	return value;
}

export function ganttDateString(date: Date) {
	return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getTaskGanttRange(task: TaskDates) {
	const range = getTaskCalendarRange(task);
	return range
		? { start: ganttDate(range.start), end: ganttDate(range.end) }
		: null;
}

export function getTaskGanttDateChanges(
	task: TaskDates,
	start: Date,
	end: Date,
	resize: boolean,
) {
	return getTaskCalendarDateChanges(
		task,
		ganttDateString(start),
		ganttDateString(end),
		resize,
	);
}
