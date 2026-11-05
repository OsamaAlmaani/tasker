import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Clock,
	Copy,
	Download,
	FoldVertical,
	Search,
	TriangleAlert,
	UnfoldVertical,
	WrapText,
	X,
} from "lucide-react";
import {
	Fragment,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";
import type { RunStep } from "#convex/lib/githubWorkflowsApi";
import {
	assignLinesToSteps,
	type LogLine,
	type LogSegment,
	type ParsedLog,
	paletteColor,
} from "../logModel";
import { formatDuration, runVisualState } from "../workflowDisplay";
import { RunStatusIcon } from "./WorkflowPrimitives";

const MAX_LINES_PER_SECTION = 2500;

type Match = { line: number; start: number };

function segmentStyle(segment: LogSegment): React.CSSProperties | undefined {
	const style = segment.style;
	if (!style) return undefined;
	return {
		color: style.fg !== null ? paletteColor(style.fg) : undefined,
		backgroundColor: style.bg !== null ? paletteColor(style.bg) : undefined,
		fontWeight: style.bold ? 600 : undefined,
		opacity: style.dim ? 0.7 : undefined,
		fontStyle: style.italic ? "italic" : undefined,
		textDecoration: style.underline ? "underline" : undefined,
	};
}

/** Renders segments, wrapping search matches in <mark>. */
function renderSegments(
	segments: LogSegment[],
	needle: string,
	currentStart: number | null,
) {
	if (!needle) {
		return segments.map((segment, index) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: segments never reorder
			<span key={index} style={segmentStyle(segment)}>
				{segment.text}
			</span>
		));
	}
	const lower = needle.toLowerCase();
	const output: React.ReactNode[] = [];
	let offset = 0;
	segments.forEach((segment, segmentIndex) => {
		const text = segment.text;
		const haystack = text.toLowerCase();
		let cursor = 0;
		const parts: React.ReactNode[] = [];
		let found = haystack.indexOf(lower, cursor);
		while (found !== -1) {
			if (found > cursor) parts.push(text.slice(cursor, found));
			parts.push(
				<mark
					key={`m${found}`}
					data-current={currentStart === offset + found ? "true" : undefined}
				>
					{text.slice(found, found + needle.length)}
				</mark>,
			);
			cursor = found + needle.length;
			found = haystack.indexOf(lower, cursor);
		}
		if (cursor < text.length) parts.push(text.slice(cursor));
		output.push(
			// biome-ignore lint/suspicious/noArrayIndexKey: segments never reorder
			<span key={segmentIndex} style={segmentStyle(segment)}>
				{parts}
			</span>,
		);
		offset += text.length;
	});
	return output;
}

const LogLineRow = memo(function LogLineRow({
	line,
	needle,
	currentStart,
	selected,
	showTimestamps,
	onSelect,
	indent,
}: {
	line: LogLine;
	needle: string;
	currentStart: number | null;
	selected: boolean;
	showTimestamps: boolean;
	onSelect: (line: number) => void;
	indent: boolean;
}) {
	return (
		<div
			id={`L${line.number}`}
			className="workflow-log-line"
			data-kind={line.kind}
			data-selected={selected ? "true" : undefined}
		>
			<a
				className="log-number"
				href={`#L${line.number}`}
				onClick={(event) => {
					event.preventDefault();
					onSelect(line.number);
				}}
			>
				{line.number}
			</a>
			<span
				className={cn(
					"workflow-log-text",
					indent && "pl-4",
					line.kind === "error" && "text-rose-700 dark:text-rose-300",
					line.kind === "warning" && "text-amber-700 dark:text-amber-300",
					line.kind === "command" && "text-sky-700 dark:text-sky-300",
					line.kind === "debug" &&
						"text-violet-700 opacity-80 dark:text-violet-300",
				)}
			>
				{showTimestamps && line.timestamp ? (
					<span className="mr-3 text-[var(--muted-text)] opacity-70 select-none">
						{line.timestamp.slice(11, 23)}
					</span>
				) : null}
				{line.kind === "error" ? (
					<span className="mr-1 font-semibold select-none">Error:</span>
				) : line.kind === "warning" ? (
					<span className="mr-1 font-semibold select-none">Warning:</span>
				) : null}
				{renderSegments(line.segments, needle, currentStart)}
			</span>
		</div>
	);
});

export function LogViewer({
	log,
	rawText,
	steps,
	truncated,
	selectedLine,
	onSelectLine,
	fileName,
}: {
	log: ParsedLog;
	rawText: string;
	steps: RunStep[];
	truncated: boolean;
	selectedLine: number | null;
	onSelectLine: (line: number | null) => void;
	fileName: string;
}) {
	const byStep = useMemo(
		() => assignLinesToSteps(log.lines, steps),
		[log, steps],
	);
	const sections = useMemo(
		() =>
			steps
				.map((step) => ({ step, lines: byStep.get(step.number) ?? [] }))
				.filter(
					(section) =>
						section.lines.length || section.step.conclusion === "failure",
				),
		[steps, byStep],
	);

	const failedStep =
		steps.find((step) => step.conclusion === "failure")?.number ?? null;
	const sectionOfLine = useMemo(() => {
		const result = new Map<number, number>();
		for (const section of sections) {
			for (const line of section.lines)
				result.set(line.number, section.step.number);
		}
		return result;
	}, [sections]);

	const [openSteps, setOpenSteps] = useState<Set<number>>(() => {
		const initial = new Set<number>();
		if (failedStep !== null) initial.add(failedStep);
		if (selectedLine !== null) {
			const step = sectionOfLine.get(selectedLine);
			if (step !== undefined) initial.add(step);
		}
		return initial;
	});
	const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
	const [query, setQuery] = useState("");
	const [currentMatch, setCurrentMatch] = useState(0);
	const [showTimestamps, setShowTimestamps] = useState(false);
	const [wrap, setWrap] = useState(false);
	const [showAllLines, setShowAllLines] = useState<Set<number>>(new Set());
	const [copied, setCopied] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const needle = query.trim().length >= 2 ? query.trim() : "";

	const matches = useMemo(() => {
		if (!needle) return [] as Match[];
		const lower = needle.toLowerCase();
		const result: Match[] = [];
		for (const line of log.lines) {
			const haystack = line.text.toLowerCase();
			let index = haystack.indexOf(lower);
			while (index !== -1 && result.length < 5000) {
				result.push({ line: line.number, start: index });
				index = haystack.indexOf(lower, index + lower.length);
			}
		}
		return result;
	}, [log, needle]);

	const matchedLines = useMemo(
		() => new Set(matches.map((match) => match.line)),
		[matches],
	);
	const errorGroups = useMemo(() => {
		const result = new Set<number>();
		for (const line of log.lines) {
			if (
				(line.kind === "error" ||
					matchedLines.has(line.number) ||
					line.number === selectedLine) &&
				line.parentGroup !== null
			) {
				result.add(line.parentGroup);
			}
		}
		return result;
	}, [log, matchedLines, selectedLine]);

	const current =
		matches[Math.min(currentMatch, Math.max(matches.length - 1, 0))] ?? null;

	const scrollToLine = useCallback((lineNumber: number) => {
		window.requestAnimationFrame(() => {
			const element = containerRef.current?.querySelector(`#L${lineNumber}`);
			element?.scrollIntoView({ block: "center" });
		});
	}, []);

	// Opening a step or group that holds the line, then scrolling to it.
	const revealLine = useCallback(
		(lineNumber: number) => {
			const step = sectionOfLine.get(lineNumber);
			if (step !== undefined) {
				setOpenSteps((value) =>
					value.has(step) ? value : new Set(value).add(step),
				);
				setShowAllLines((value) =>
					value.has(step) ? value : new Set(value).add(step),
				);
			}
			const line = log.lines.find(
				(candidate) => candidate.number === lineNumber,
			);
			if (line?.parentGroup !== null && line?.parentGroup !== undefined) {
				const group = line.parentGroup;
				setOpenGroups((value) =>
					value.has(group) ? value : new Set(value).add(group),
				);
			}
			scrollToLine(lineNumber);
		},
		[sectionOfLine, log, scrollToLine],
	);

	useEffect(() => {
		if (current) revealLine(current.line);
	}, [current, revealLine]);

	// Scroll to a linked line, or the first error, once the log loads.
	const initialScroll = useRef(false);
	useEffect(() => {
		if (initialScroll.current) return;
		initialScroll.current = true;
		const target =
			selectedLine ??
			log.lines.find((line) => line.kind === "error")?.number ??
			null;
		if (target !== null) revealLine(target);
	}, [selectedLine, log, revealLine]);

	function step(direction: 1 | -1) {
		if (!matches.length) return;
		setCurrentMatch(
			(value) => (value + direction + matches.length) % matches.length,
		);
	}

	const firstError = log.lines.find((line) => line.kind === "error") ?? null;
	const allOpen = sections.every((section) =>
		openSteps.has(section.step.number),
	);

	return (
		<div className="workflow-surface overflow-hidden rounded-xl border border-[var(--line)]">
			<div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-3 py-2">
				<div className="relative min-w-[180px] flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-text)]" />
					<Input
						ref={searchRef}
						className="h-8 pr-28 pl-8 text-xs"
						placeholder="Search the log"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setCurrentMatch(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								step(event.shiftKey ? -1 : 1);
							}
							if (event.key === "Escape") setQuery("");
						}}
						aria-label="Search the log"
					/>
					<div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
						{needle ? (
							<span
								className="px-1 text-[11px] text-[var(--muted-text)] tabular-nums"
								aria-live="polite"
							>
								{matches.length
									? `${Math.min(currentMatch + 1, matches.length)} of ${matches.length}${matches.length >= 5000 ? "+" : ""}`
									: "No matches"}
							</span>
						) : null}
						<button
							type="button"
							className="rounded p-1 text-[var(--muted-text)] hover:text-[var(--text)] disabled:opacity-30"
							onClick={() => step(-1)}
							disabled={!matches.length}
							aria-label="Previous match"
						>
							<ChevronUp className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							className="rounded p-1 text-[var(--muted-text)] hover:text-[var(--text)] disabled:opacity-30"
							onClick={() => step(1)}
							disabled={!matches.length}
							aria-label="Next match"
						>
							<ChevronDown className="h-3.5 w-3.5" />
						</button>
						{query ? (
							<button
								type="button"
								className="rounded p-1 text-[var(--muted-text)] hover:text-[var(--text)]"
								onClick={() => setQuery("")}
								aria-label="Clear search"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						) : null}
					</div>
				</div>
				{firstError ? (
					<ToolbarButton
						onClick={() => revealLine(firstError.number)}
						label="Jump to the first error"
					>
						<TriangleAlert className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
						<span className="hidden sm:inline">First error</span>
					</ToolbarButton>
				) : null}
				<ToolbarButton
					onClick={() =>
						setOpenSteps(
							allOpen
								? new Set()
								: new Set(sections.map((section) => section.step.number)),
						)
					}
					label={allOpen ? "Collapse all steps" : "Expand all steps"}
				>
					{allOpen ? (
						<FoldVertical className="h-3.5 w-3.5" />
					) : (
						<UnfoldVertical className="h-3.5 w-3.5" />
					)}
				</ToolbarButton>
				<ToolbarButton
					onClick={() => setShowTimestamps((value) => !value)}
					label="Show timestamps"
					pressed={showTimestamps}
				>
					<Clock className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => setWrap((value) => !value)}
					label="Wrap long lines"
					pressed={wrap}
				>
					<WrapText className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => {
						void navigator.clipboard?.writeText(rawText).then(() => {
							setCopied(true);
							window.setTimeout(() => setCopied(false), 1500);
						});
					}}
					label={copied ? "Copied" : "Copy the whole log"}
				>
					<Copy className="h-3.5 w-3.5" />
					{copied ? <span className="text-[11px]">Copied</span> : null}
				</ToolbarButton>
				<ToolbarButton
					onClick={() => {
						const url = URL.createObjectURL(
							new Blob([rawText], { type: "text/plain" }),
						);
						const link = document.createElement("a");
						link.href = url;
						link.download = fileName;
						link.click();
						window.setTimeout(() => URL.revokeObjectURL(url), 1000);
					}}
					label="Download the log"
				>
					<Download className="h-3.5 w-3.5" />
				</ToolbarButton>
			</div>
			{truncated ? (
				<p className="m-0 border-b border-[var(--line)] bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
					This log is very long, so only its last part is shown. Download it
					from GitHub for the whole log.
				</p>
			) : null}
			<div
				ref={containerRef}
				className="workflow-log max-h-[75dvh] overflow-auto"
				data-wrap={wrap ? "true" : "false"}
				style={
					{
						"--log-gutter": `${String(log.lines.at(-1)?.number ?? 1).length + 1}ch`,
					} as React.CSSProperties
				}
			>
				{sections.map(({ step: logStep, lines }) => {
					const open =
						openSteps.has(logStep.number) ||
						(needle !== "" &&
							lines.some((line) => matchedLines.has(line.number)));
					const state = runVisualState(logStep);
					const duration =
						logStep.startedAt !== null && logStep.completedAt !== null
							? logStep.completedAt - logStep.startedAt
							: null;
					const errors = lines.filter((line) => line.kind === "error").length;
					const limit = showAllLines.has(logStep.number)
						? Number.POSITIVE_INFINITY
						: MAX_LINES_PER_SECTION;
					const hidden = Math.max(lines.length - limit, 0);
					const shown = hidden ? lines.slice(-limit) : lines;
					return (
						<section key={logStep.number} aria-label={logStep.name}>
							<button
								type="button"
								className={cn(
									"sticky top-0 z-10 flex w-full items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-left font-sans text-[13px] hover:bg-[var(--surface-muted)]",
									state === "failure" && "text-rose-700 dark:text-rose-300",
								)}
								onClick={() =>
									setOpenSteps((value) => {
										const next = new Set(value);
										if (next.has(logStep.number)) next.delete(logStep.number);
										else next.add(logStep.number);
										return next;
									})
								}
								aria-expanded={open}
							>
								{open ? (
									<ChevronDown className="h-3.5 w-3.5 shrink-0" />
								) : (
									<ChevronRight className="h-3.5 w-3.5 shrink-0" />
								)}
								<RunStatusIcon state={state} className="h-3.5 w-3.5" />
								<span className="min-w-0 flex-1 truncate font-medium">
									{logStep.name}
								</span>
								{errors ? (
									<span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 text-[11px] text-rose-700 dark:text-rose-300">
										{errors} {errors === 1 ? "error" : "errors"}
									</span>
								) : null}
								<span className="shrink-0 text-[11px] text-[var(--muted-text)] tabular-nums">
									{lines.length} lines · {formatDuration(duration)}
								</span>
							</button>
							{open ? (
								<div className="py-1">
									{hidden ? (
										<button
											type="button"
											className="w-full px-3 py-1 text-left font-sans text-xs text-[var(--accent)] hover:underline"
											onClick={() =>
												setShowAllLines((value) =>
													new Set(value).add(logStep.number),
												)
											}
										>
											Show {hidden} earlier lines
										</button>
									) : null}
									{shown.map((line) => {
										if (line.kind === "group") {
											const groupIndex = line.groupIndex ?? -1;
											const groupOpen =
												openGroups.has(groupIndex) ||
												errorGroups.has(groupIndex);
											return (
												<Fragment key={line.number}>
													<button
														type="button"
														id={`L${line.number}`}
														className="workflow-log-line w-full text-left"
														onClick={() =>
															setOpenGroups((value) => {
																const next = new Set(value);
																if (next.has(groupIndex))
																	next.delete(groupIndex);
																else next.add(groupIndex);
																return next;
															})
														}
														aria-expanded={groupOpen}
													>
														<span className="log-number">{line.number}</span>
														<span className="workflow-log-text flex items-center gap-1 font-medium">
															{groupOpen ? (
																<ChevronDown className="h-3 w-3 shrink-0" />
															) : (
																<ChevronRight className="h-3 w-3 shrink-0" />
															)}
															{renderSegments(
																line.segments,
																needle,
																current?.line === line.number
																	? current.start
																	: null,
															)}
														</span>
													</button>
												</Fragment>
											);
										}
										if (
											line.parentGroup !== null &&
											!(
												openGroups.has(line.parentGroup) ||
												errorGroups.has(line.parentGroup)
											)
										) {
											return null;
										}
										return (
											<LogLineRow
												key={line.number}
												line={line}
												needle={needle}
												currentStart={
													current?.line === line.number ? current.start : null
												}
												selected={selectedLine === line.number}
												showTimestamps={showTimestamps}
												onSelect={(number) =>
													onSelectLine(selectedLine === number ? null : number)
												}
												indent={line.parentGroup !== null}
											/>
										);
									})}
									{!lines.length ? (
										<p className="m-0 px-3 py-1 font-sans text-xs text-[var(--muted-text)]">
											No output for this step.
										</p>
									) : null}
								</div>
							) : null}
						</section>
					);
				})}
				{!sections.length ? (
					<p className="m-0 px-3 py-4 font-sans text-sm text-[var(--muted-text)]">
						This job wrote no log output.
					</p>
				) : null}
			</div>
		</div>
	);
}

function ToolbarButton({
	children,
	onClick,
	label,
	pressed,
}: {
	children: React.ReactNode;
	onClick: () => void;
	label: string;
	pressed?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				"inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
				pressed
					? "border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--text)]"
					: "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted-text)] hover:text-[var(--text)]",
			)}
			onClick={onClick}
			title={label}
			aria-label={label}
			aria-pressed={pressed}
		>
			{children}
		</button>
	);
}
