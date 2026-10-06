const DAY_MS = 86_400_000;

export const DATE_FILTER_KEYS = ["startFrom", "startTo", "dueFrom", "dueTo"] as const;
export type IssueDateFilters = Partial<Record<(typeof DATE_FILTER_KEYS)[number], string>>;

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export function validateDateFilters(filters: IssueDateFilters) {
  for (const key of DATE_FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined && !isCalendarDate(value)) {
      throw new Error("Date filters must be valid calendar dates.");
    }
  }
  for (const [from, to] of [[filters.startFrom, filters.startTo], [filters.dueFrom, filters.dueTo]]) {
    if (from && to && from > to) {
      throw new Error("A date filter's From date cannot be after its To date.");
    }
  }
}

export function matchesDateRange(date: number | null | undefined, from?: string, to?: string) {
  if (!from && !to) return true;
  if (date == null || !Number.isFinite(date)) return false;
  const day = Math.floor(date / DAY_MS);
  return (!from || day >= Math.floor(Date.parse(from) / DAY_MS)) &&
    (!to || day <= Math.floor(Date.parse(to) / DAY_MS));
}

export function matchesIssueFilters(
  issue: { assigneeId?: string | null; startDate?: number | null; dueDate?: number | null },
  filters: IssueDateFilters & { assigneeId?: string | null },
) {
  if (filters.assigneeId === null && issue.assigneeId != null) return false;
  if (filters.assigneeId != null && issue.assigneeId !== filters.assigneeId) return false;
  return matchesDateRange(issue.startDate, filters.startFrom, filters.startTo) &&
    matchesDateRange(issue.dueDate, filters.dueFrom, filters.dueTo);
}
