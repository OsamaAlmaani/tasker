// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	normalizeDescriptionDoc,
	plainDescriptionDoc,
} from "#convex/lib/issueDescriptions";
import { DescriptionContent, DescriptionEditor } from "./DescriptionEditor";

afterEach(cleanup);

async function getEditor() {
	const textbox = await screen.findByRole("textbox", { name: "Description" });
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Bold" }).hasAttribute("disabled"),
		).toBe(false),
	);
	return (textbox as HTMLElement & { editor: Editor }).editor;
}

describe("description editor", () => {
	it("saves formatted text with inline line breaks", async () => {
		render(<DescriptionEditor value={{ description: "First" }} />);
		const editor = await getEditor();
		act(() => {
			editor
				.chain()
				.selectAll()
				.toggleBold()
				.setTextSelection(6)
				.setHardBreak()
				.insertContent("Second")
				.run();
		});
		expect(normalizeDescriptionDoc(editor.getJSON())).toEqual(editor.getJSON());
		act(() => {
			editor.commands.setContent("<p><strong>First<br>Second</strong></p>");
		});
		expect(normalizeDescriptionDoc(editor.getJSON())).toEqual(editor.getJSON());
	});
	it("shows the empty state for a cleared rich description", () => {
		render(
			<DescriptionContent
				description=""
				descriptionDoc={plainDescriptionDoc("")}
			/>,
		);
		expect(screen.getByText("No description provided.")).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
	});
	it("loads legacy text literally and preserves blank lines", async () => {
		render(
			<DescriptionEditor value={{ description: "<b>literal</b>\n\nlast" }} />,
		);
		const editor = await getEditor();
		expect(editor.getText({ blockSeparator: "\n" })).toBe(
			"<b>literal</b>\n\nlast",
		);
		expect(editor.getHTML()).toContain("&lt;b&gt;literal&lt;/b&gt;");
	});
	it("emits rich content and plain text without submitting its surrounding form", async () => {
		const onChange = vi.fn(),
			onSubmit = vi.fn();
		render(
			<form onSubmit={onSubmit}>
				<DescriptionEditor
					value={{ description: "Ship" }}
					onChange={onChange}
				/>
			</form>,
		);
		const editor = await getEditor();
		act(() => {
			editor.commands.selectAll();
		});
		fireEvent.click(screen.getByRole("button", { name: "Bold" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				description: "Ship",
				descriptionDoc: expect.objectContaining({ type: "doc" }),
			}),
		);
		expect(editor.getJSON().content?.[0].content?.[0].marks).toContainEqual({
			type: "bold",
		});
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
	});
	it("refreshes when switching descriptions and keeps read-only content uneditable", async () => {
		const view = render(<DescriptionEditor value={{ description: "First" }} />);
		const editor = await getEditor();
		view.rerender(<DescriptionEditor value={{ description: "Second" }} />);
		await waitFor(() => expect(editor.getText()).toBe("Second"));
		view.unmount();
		render(
			<DescriptionContent
				description="Second"
				descriptionDoc={plainDescriptionDoc("Second")}
			/>,
		);
		const reader = await screen.findByRole("textbox", { name: "Description" });
		expect(reader.getAttribute("contenteditable")).toBe("false");
		expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
	});
	it("rejects unsafe links before changing the document", async () => {
		render(<DescriptionEditor value={{ description: "Link" }} />);
		const editor = await getEditor();
		act(() => {
			editor.commands.selectAll();
		});
		fireEvent.click(screen.getByRole("button", { name: "Link" }));
		fireEvent.change(screen.getByLabelText("Link URL"), {
			target: { value: "javascript:alert(1)" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
		expect(screen.getByRole("alert").textContent).toContain("https");
		expect(editor.isActive("link")).toBe(false);
	});
});
