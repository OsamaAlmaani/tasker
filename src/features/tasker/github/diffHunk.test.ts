import { describe, expect, it } from "vitest";
import { parseDiffHunk } from "./diffHunk";

describe("parseDiffHunk", () => {
	it("numbers old and new lines from the hunk header", () => {
		const lines = parseDiffHunk(
			"@@ -608,3 +555,4 @@ public async Task<byte[]> Get(\n                     return\n-                        old,\n+                        row.PlateNumber,\n+                        row.HierarchyPath,\n\\ No newline at end of file",
		);
		expect(
			lines.map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine]),
		).toEqual([
			["header", null, null],
			["context", 608, 555],
			["deletion", 609, null],
			["addition", null, 556],
			["addition", null, 557],
		]);
		expect(lines[4].text).toBe("                        row.HierarchyPath,");
	});

	it("ignores a trailing newline", () => {
		expect(parseDiffHunk("@@ -1 +1 @@\n a\n")).toHaveLength(2);
	});
});
