// Parses a GitHub Actions job log into lines with colors, collapsible groups
// and the step each line belongs to.

export type LogStyle = {
	/** 0-15 for the terminal palette, or a CSS color for 256/true colors. */
	fg: number | string | null;
	bg: number | string | null;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
};

export type LogSegment = { text: string; style: LogStyle | null };

export type LogLineKind =
	| "normal"
	| "group"
	| "error"
	| "warning"
	| "notice"
	| "command"
	| "debug";

export type LogLine = {
	/** 1-based line number in the log. */
	number: number;
	timestamp: string | null;
	time: number | null;
	text: string;
	segments: LogSegment[];
	kind: LogLineKind;
	/** Index of the group this line opens, for `group` lines. */
	groupIndex: number | null;
	/** Group this line sits inside, if any. */
	parentGroup: number | null;
};

export type LogGroup = {
	index: number;
	title: string;
	startLine: number;
	/** Line numbers inside the group. */
	lineNumbers: number[];
};

export type ParsedLog = {
	lines: LogLine[];
	groups: LogGroup[];
};

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
const ANSI = /\u001b\[([0-9;]*)m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: other escape sequences are dropped
const OTHER_ESCAPES = /\u001b\[[0-9;?]*[A-Za-ln-z]/g;

const PALETTE_256_BASE = [
	"#000000",
	"#800000",
	"#008000",
	"#808000",
	"#000080",
	"#800080",
	"#008080",
	"#c0c0c0",
	"#808080",
	"#ff0000",
	"#00ff00",
	"#ffff00",
	"#0000ff",
	"#ff00ff",
	"#00ffff",
	"#ffffff",
];

function color256(code: number): number | string {
	if (code < 16) return code;
	if (code < 232) {
		const value = code - 16;
		const levels = [0, 95, 135, 175, 215, 255];
		const r = levels[Math.floor(value / 36)];
		const g = levels[Math.floor((value % 36) / 6)];
		const b = levels[value % 6];
		return `rgb(${r}, ${g}, ${b})`;
	}
	const gray = 8 + (code - 232) * 10;
	return `rgb(${gray}, ${gray}, ${gray})`;
}

function emptyStyle(): LogStyle {
	return {
		fg: null,
		bg: null,
		bold: false,
		dim: false,
		italic: false,
		underline: false,
	};
}

function isPlain(style: LogStyle) {
	return (
		style.fg === null &&
		style.bg === null &&
		!style.bold &&
		!style.dim &&
		!style.italic &&
		!style.underline
	);
}

function applySgr(style: LogStyle, params: string) {
	const codes = params === "" ? [0] : params.split(";").map(Number);
	for (let index = 0; index < codes.length; index++) {
		const code = codes[index];
		if (code === 0) Object.assign(style, emptyStyle());
		else if (code === 1) style.bold = true;
		else if (code === 2) style.dim = true;
		else if (code === 3) style.italic = true;
		else if (code === 4) style.underline = true;
		else if (code === 22) {
			style.bold = false;
			style.dim = false;
		} else if (code === 23) style.italic = false;
		else if (code === 24) style.underline = false;
		else if (code >= 30 && code <= 37) style.fg = code - 30;
		else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
		else if (code === 39) style.fg = null;
		else if (code >= 40 && code <= 47) style.bg = code - 40;
		else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
		else if (code === 49) style.bg = null;
		else if (code === 38 || code === 48) {
			const target = code === 38 ? "fg" : "bg";
			if (codes[index + 1] === 5 && codes[index + 2] !== undefined) {
				style[target] = color256(codes[index + 2]);
				index += 2;
			} else if (codes[index + 1] === 2 && codes[index + 4] !== undefined) {
				style[target] =
					`rgb(${codes[index + 2]}, ${codes[index + 3]}, ${codes[index + 4]})`;
				index += 4;
			}
		}
	}
}

/** Splits text with ANSI color codes into styled segments. `state` carries over between lines. */
export function parseAnsi(text: string, state: LogStyle): LogSegment[] {
	const clean = text.replace(OTHER_ESCAPES, "");
	const segments: LogSegment[] = [];
	let last = 0;
	for (const match of clean.matchAll(ANSI)) {
		const index = match.index ?? 0;
		if (index > last) {
			segments.push({
				text: clean.slice(last, index),
				style: isPlain(state) ? null : { ...state },
			});
		}
		applySgr(state, match[1]);
		last = index + match[0].length;
	}
	if (last < clean.length) {
		segments.push({
			text: clean.slice(last),
			style: isPlain(state) ? null : { ...state },
		});
	}
	return segments;
}

export function paletteColor(value: number | string) {
	return typeof value === "string"
		? value
		: `var(--ansi-${value}, ${PALETTE_256_BASE[value]})`;
}

const MARKERS: Array<[string, LogLineKind]> = [
	["##[error]", "error"],
	["##[warning]", "warning"],
	["##[notice]", "notice"],
	["##[command]", "command"],
	["##[debug]", "debug"],
];

export function parseLog(text: string): ParsedLog {
	const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
	if (rawLines.at(-1) === "") rawLines.pop();
	const lines: LogLine[] = [];
	const groups: LogGroup[] = [];
	const style = emptyStyle();
	let openGroup: LogGroup | null = null;

	rawLines.forEach((raw, index) => {
		const number = index + 1;
		const timestampMatch = raw.match(TIMESTAMP);
		const timestamp = timestampMatch?.[1] ?? null;
		let body = timestampMatch ? raw.slice(timestampMatch[0].length) : raw;
		// GitHub prefixes some lines with a byte-order mark.
		body = body.replace(/^﻿/, "");
		const time = timestamp ? Date.parse(timestamp) : null;

		if (body.startsWith("##[endgroup]")) {
			openGroup = null;
			return;
		}
		if (body.startsWith("##[group]")) {
			const title = body.slice("##[group]".length);
			const group: LogGroup = {
				index: groups.length,
				title,
				startLine: number,
				lineNumbers: [],
			};
			groups.push(group);
			openGroup = group;
			lines.push({
				number,
				timestamp,
				time,
				text: title,
				segments: parseAnsi(title, style),
				kind: "group",
				groupIndex: group.index,
				parentGroup: null,
			});
			return;
		}

		let kind: LogLineKind = "normal";
		for (const [marker, markerKind] of MARKERS) {
			if (body.startsWith(marker)) {
				kind = markerKind;
				body = body.slice(marker.length);
				break;
			}
		}
		if (kind === "normal" && body.startsWith("[command]")) {
			kind = "command";
			body = body.slice("[command]".length);
		}
		const current = openGroup as LogGroup | null;
		current?.lineNumbers.push(number);
		lines.push({
			number,
			timestamp,
			time,
			text: body.replace(ANSI, "").replace(OTHER_ESCAPES, ""),
			segments: parseAnsi(body, style),
			kind,
			groupIndex: null,
			parentGroup: current?.index ?? null,
		});
	});

	return { lines, groups };
}

export type StepLike = {
	number: number;
	name: string;
	startedAt: number | null;
	completedAt: number | null;
};

/**
 * Assigns each line to a step. GitHub only gives step times to the second, so
 * a `##[group]Run …` header that names a step moves to that step directly;
 * other lines follow the timestamps and never move back to an earlier step.
 */
export function assignLinesToSteps(
	lines: LogLine[],
	steps: StepLike[],
): Map<number, LogLine[]> {
	const result = new Map<number, LogLine[]>();
	for (const step of steps) result.set(step.number, []);
	const timed = steps.filter((step) => step.startedAt !== null);
	if (!timed.length) {
		if (steps[0]) result.set(steps[0].number, [...lines]);
		return result;
	}
	let current = 0;
	for (const line of lines) {
		if (line.kind === "group") {
			const title = line.text.trim();
			const second =
				line.time === null ? null : Math.floor(line.time / 1000) * 1000;
			// Each action or script step's output opens with "Run …".
			const next = timed.findIndex(
				(step, index) =>
					index > current &&
					(step.name === title ||
						step.name === title.replace(/^Run /, "") ||
						(title.startsWith("Run ") &&
							second !== null &&
							Math.abs((step.startedAt ?? 0) - second) <= 1000)),
			);
			if (next !== -1) current = next;
		}
		if (line.time !== null) {
			const second = Math.floor(line.time / 1000) * 1000;
			while (
				current + 1 < timed.length &&
				(timed[current + 1].startedAt ?? 0) <= second &&
				// Stay on a step that is still running at this second.
				(timed[current].completedAt ?? 0) < second
			) {
				current++;
			}
		}
		result.get(timed[current].number)?.push(line);
	}
	return result;
}

export function firstErrorLine(lines: LogLine[]) {
	return lines.find((line) => line.kind === "error") ?? null;
}
