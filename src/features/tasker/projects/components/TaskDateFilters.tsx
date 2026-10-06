import { CalendarDays, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	DATE_FILTER_KEYS,
	type IssueDateFilters,
	validateDateFilters,
} from "#convex/lib/issueFilters";

export function TaskDateFilters({
	value,
	onChange,
}: {
	value: IssueDateFilters;
	onChange: (value: IssueDateFilters) => void;
}) {
	const [draft, setDraft] = useState(value);
	const id = useId();
	const [error, setError] = useState("");
	const detailsRef = useRef<HTMLDetailsElement>(null);
	const { startFrom, startTo, dueFrom, dueTo } = value;
	useEffect(() => {
		setDraft({ startFrom, startTo, dueFrom, dueTo });
		setError("");
	}, [startFrom, startTo, dueFrom, dueTo]);
	useEffect(() => {
		const closeOutside = (event: MouseEvent) => {
			if (
				!detailsRef.current?.contains(event.target as Node) &&
				detailsRef.current
			) {
				detailsRef.current.open = false;
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && detailsRef.current)
				detailsRef.current.open = false;
		};
		document.addEventListener("mousedown", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOutside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, []);
	const count = DATE_FILTER_KEYS.filter((key) => value[key]).length;
	function apply() {
		const next = Object.fromEntries(
			DATE_FILTER_KEYS.map((key) => [key, draft[key] || undefined]),
		);
		try {
			validateDateFilters(next);
			onChange(next);
			setError("");
			if (detailsRef.current) detailsRef.current.open = false;
		} catch (error) {
			setError((error as Error).message);
		}
	}
	return (
		<details
			ref={detailsRef}
			className="task-date-filters relative min-w-0"
			onToggle={(event) => {
				if (event.currentTarget.open) {
					setDraft(value);
					setError("");
				}
			}}
		>
			<summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
				<CalendarDays className="h-4 w-4 shrink-0" />
				<span>Dates{count ? ` (${count})` : ""}</span>
			</summary>
			<div className="absolute left-0 z-30 mt-1 w-80 max-w-[calc(100vw-3rem)] rounded-md border border-[var(--line)] bg-[var(--popover)] p-3 text-[var(--popover-foreground)] shadow-lg backdrop-blur-xl md:left-auto md:right-0">
				{(
					[
						["Start date", "startFrom", "startTo"],
						["Due date", "dueFrom", "dueTo"],
					] as const
				).map(([label, from, to]) => (
					<fieldset key={label} className="mb-3 min-w-0">
						<legend className="mb-1 text-sm font-medium">{label}</legend>
						<div className="grid grid-cols-2 gap-2">
							{(
								[
									["From", from],
									["To", to],
								] as const
							).map(([bound, key]) => (
								<label
									key={key}
									htmlFor={`${id}-${key}`}
									className="min-w-0 text-xs text-[var(--muted-text)]"
								>
									{bound}
									<Input
										type="date"
										id={`${id}-${key}`}
										aria-label={`${label} ${bound.toLowerCase()}`}
										value={draft[key] ?? ""}
										min={key === to ? draft[from] : undefined}
										max={key === from ? draft[to] : undefined}
										onChange={(event) =>
											setDraft((previous) => ({
												...previous,
												[key]: event.target.value,
											}))
										}
										className="mt-1 min-w-0 px-2"
									/>
								</label>
							))}
						</div>
					</fieldset>
				))}
				{error ? (
					<p role="alert" className="mb-2 text-xs text-[var(--danger)]">
						{error}
					</p>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							const empty = Object.fromEntries(
								DATE_FILTER_KEYS.map((key) => [key, undefined]),
							);
							setDraft(empty);
							setError("");
							onChange(empty);
							if (detailsRef.current) detailsRef.current.open = false;
						}}
					>
						<X className="mr-1 h-4 w-4" />
						Clear
					</Button>
					<Button type="button" size="sm" onClick={apply}>
						Apply
					</Button>
				</div>
			</div>
		</details>
	);
}
