const DAY_MS = 86_400_000;

export type TaskDates = {
	startDate?: number | null;
	dueDate?: number | null;
};

export function calendarDate(timestamp: number) {
	return new Date(timestamp).toISOString().slice(0, 10);
}

export function calendarTimestamp(date: string) {
	return Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
}

export function getTaskCalendarRange(task: TaskDates) {
	const firstDate = task.startDate ?? task.dueDate;
	if (firstDate == null || !Number.isFinite(new Date(firstDate).getTime())) {
		return null;
	}
	const start = calendarDate(firstDate);
	const lastDate = task.dueDate ?? firstDate;
	if (!Number.isFinite(new Date(lastDate).getTime())) return null;
	// Task end dates are inclusive; FullCalendar expects an exclusive end.
	const end = calendarDate(calendarTimestamp(calendarDate(lastDate)) + DAY_MS);
	return { start, end };
}

export function getTaskCalendarDateChanges(
	task: TaskDates,
	start: string,
	end: string,
	resize = false,
): { startDate?: number; dueDate?: number } {
	// Resizing a single date creates its missing boundary. Moving preserves
	// which dates were set, so a start-only task stays start-only.
	return {
		...(resize || task.startDate != null
			? { startDate: calendarTimestamp(start) }
			: {}),
		...(resize || task.dueDate != null
			? { dueDate: calendarTimestamp(end) - DAY_MS }
			: {}),
	};
}
