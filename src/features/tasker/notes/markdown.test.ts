import { describe, expect, it } from "vitest";
import {
	normalizeNoteBody,
	parseMarkdownBlocks,
	stripNoteMarkup,
} from "#/features/tasker/notes/markdown";

describe("parseMarkdownBlocks", () => {
	it("parses headings, lists, task lists, quotes, and code blocks", () => {
		expect(
			parseMarkdownBlocks(
				[
					"# Title",
					"",
					"> quoted",
					"",
					"- one",
					"- two",
					"",
					"1. first",
					"2. second",
					"",
					"- [x] done",
					"- [ ] todo",
					"",
					"```",
					"const x = 1",
					"```",
				].join("\n"),
			),
		).toEqual([
			{ type: "heading", level: 1, text: "Title" },
			{ type: "blockquote", text: "quoted" },
			{ type: "unordered-list", items: ["one", "two"] },
			{ type: "ordered-list", items: ["first", "second"] },
			{
				type: "task-list",
				items: [
					{ checked: true, text: "done" },
					{ checked: false, text: "todo" },
				],
			},
			{ type: "code", text: "const x = 1" },
		]);
	});
});

describe("normalizeNoteBody", () => {
	it("converts markdown text into html for the rich editor", () => {
		expect(normalizeNoteBody("# Title\n\n- item")).toContain("<h1>Title</h1>");
		expect(normalizeNoteBody("# Title\n\n- item")).toContain(
			"<ul><li>item</li></ul>",
		);
	});

	it("keeps existing html note bodies unchanged", () => {
		expect(normalizeNoteBody("<h1>Hello</h1><p>Body</p>")).toBe(
			"<h1>Hello</h1><p>Body</p>",
		);
	});
});

describe("stripNoteMarkup", () => {
	it("removes html and markdown syntax when building excerpts/search text", () => {
		expect(stripNoteMarkup("<h1>Hello</h1><p>**Body**</p>")).toBe("Hello Body");
	});
});
