// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { getFunctionName } from "convex/server";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	PersonalNotesWorkspace,
	type PersonalNotesWorkspaceHandle,
} from "./PersonalNotesWorkspace";

const mocks = vi.hoisted(() => ({
	notes: [
		{ _id: "first", title: "First", body: "# First", updatedAt: 1 },
		{ _id: "second", title: "Second", body: "# Second", updatedAt: 1 },
	],
	update: vi.fn().mockResolvedValue(null),
	otherMutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useQuery: () => mocks.notes,
	useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(reference) === "userNotes:update"
			? mocks.update
			: mocks.otherMutation,
}));

afterEach(cleanup);

it("loads and switches notes without saving, but saves edits", async () => {
	const ref = createRef<PersonalNotesWorkspaceHandle>();
	const { container, rerender } = render(
		<PersonalNotesWorkspace ref={ref} mode="page" selectedNoteId="first" />,
	);
	let editor: Editor;
	await waitFor(() => {
		editor = (
			container.querySelector(".tiptap") as HTMLElement & { editor: Editor }
		)?.editor;
		expect(editor?.getText().trim()).toBe("First");
	});
	await act(async () => ref.current?.flushDraft());
	expect(mocks.update).not.toHaveBeenCalled();

	rerender(
		<PersonalNotesWorkspace ref={ref} mode="page" selectedNoteId="second" />,
	);
	await waitFor(() => expect(editor.getText().trim()).toBe("Second"));
	await act(async () => ref.current?.flushDraft());
	expect(mocks.update).not.toHaveBeenCalled();

	act(() => {
		editor.commands.setContent("<p>Edited</p>");
	});
	await act(async () => ref.current?.flushDraft());
	expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
		noteId: "second",
		title: "Second",
		body: "<p>Edited</p>",
	});
});
