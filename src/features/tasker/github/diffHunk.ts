export type DiffLine = {
	kind: "context" | "addition" | "deletion" | "header";
	text: string;
	oldLine: number | null;
	newLine: number | null;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses a review comment's diff hunk. GitHub ends the hunk at the commented
 * line, so the last lines are the most relevant context.
 */
export function parseDiffHunk(hunk: string): DiffLine[] {
	const lines: DiffLine[] = [];
	let oldLine = 0;
	let newLine = 0;
	for (const raw of hunk.replace(/\r\n/g, "\n").split("\n")) {
		const header = raw.match(HUNK_HEADER);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
			lines.push({ kind: "header", text: raw, oldLine: null, newLine: null });
			continue;
		}
		if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
		const marker = raw[0];
		const text = raw.slice(1);
		if (marker === "+") {
			lines.push({ kind: "addition", text, oldLine: null, newLine });
			newLine += 1;
		} else if (marker === "-") {
			lines.push({ kind: "deletion", text, oldLine, newLine: null });
			oldLine += 1;
		} else {
			lines.push({ kind: "context", text, oldLine, newLine });
			oldLine += 1;
			newLine += 1;
		}
	}
	// A trailing newline in the hunk is not a line of code.
	const last = lines.at(-1);
	if (last?.kind === "context" && last.text === "" && hunk.endsWith("\n")) {
		lines.pop();
	}
	return lines;
}
