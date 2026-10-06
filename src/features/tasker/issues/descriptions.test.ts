import { describe, expect, it } from "vitest";
import {
	buildDescriptionFields,
	type DescriptionDoc,
	descriptionText,
	normalizeDescriptionDoc,
	plainDescriptionDoc,
} from "#convex/lib/issueDescriptions";

const richDoc: DescriptionDoc = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Plan" }],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Ship ", marks: [{ type: "bold" }] },
				{
					type: "text",
					text: "the feature",
					marks: [{ type: "link", attrs: { href: "https://example.com" } }],
				},
			],
		},
		{
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "Verify" }] },
					],
				},
			],
		},
	],
};

describe("task descriptions", () => {
	it("keeps literal markup and line breaks in legacy descriptions", () => {
		const text = "<b>literal</b> & **plain**\n\nlast line";
		expect(descriptionText(plainDescriptionDoc(text))).toBe(text);
	});
	it("derives plain text from rich content for search and previews", () => {
		expect(buildDescriptionFields("incorrect client text", richDoc)).toEqual({
			description: "Plan\nShip the feature\nVerify",
			descriptionDoc: richDoc,
		});
	});
	it("round-trips rich content through JSON export and import", () => {
		expect(
			normalizeDescriptionDoc(JSON.parse(JSON.stringify(richDoc))),
		).toEqual(richDoc);
	});
	it("handles empty descriptions and clears obsolete rich content for plain writes", () => {
		expect(buildDescriptionFields("replacement")).toEqual({
			description: "replacement",
			descriptionDoc: undefined,
		});
		expect(
			buildDescriptionFields("stale", plainDescriptionDoc("")),
		).toMatchObject({ description: "" });
	});
	it("rejects unsupported nodes, malformed structures, and unsafe links", () => {
		expect(() =>
			normalizeDescriptionDoc({
				type: "doc",
				content: [{ type: "image", attrs: { src: "https://example.com" } }],
			}),
		).toThrow("Unsupported");
		expect(() =>
			normalizeDescriptionDoc({
				type: "doc",
				content: [{ type: "text", text: "invalid" }],
			}),
		).toThrow("structure");
		for (const href of [
			"javascript:alert(1)",
			"data:text/html,test",
			"//example.com",
			"invalid",
		]) {
			expect(() =>
				normalizeDescriptionDoc({
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "link",
									marks: [{ type: "link", attrs: { href } }],
								},
							],
						},
					],
				}),
			).toThrow("link");
		}
	});
	it("drops arbitrary attributes and retains safe link destinations", () => {
		const doc = plainDescriptionDoc("safe");
		const text = doc.content[0].content?.[0];
		if (!text) throw new Error("Expected a text node");
		text.marks = [
			{
				type: "link",
				attrs: {
					href: "https://example.com",
					onclick: "bad",
					target: "injected",
				},
			},
		];
		expect(normalizeDescriptionDoc(doc).content[0].content?.[0].marks).toEqual([
			{ type: "link", attrs: { href: "https://example.com" } },
		]);
	});
	it("limits excessively large documents", () => {
		expect(() =>
			normalizeDescriptionDoc(plainDescriptionDoc("x".repeat(100_001))),
		).toThrow("too long");
	});
});
