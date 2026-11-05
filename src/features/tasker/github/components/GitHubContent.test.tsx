// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "#convex/_generated/dataModel";
import { MarkdownEditor } from "./GitHubContent";

const previewMarkdown = vi.fn();

vi.mock("convex/react", () => ({
	useAction: () => previewMarkdown,
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ history: { push: vi.fn() } }),
}));

const projectId = "project1" as Id<"projects">;

function Editor() {
	const [value, setValue] = useState("**hi**");
	return (
		<MarkdownEditor
			value={value}
			onChange={setValue}
			projectId={projectId}
			context={{ repository: "acme/app", projectId }}
			placeholder="Write"
			label="Comment"
		/>
	);
}

afterEach(() => {
	cleanup();
	previewMarkdown.mockReset();
});

describe("MarkdownEditor", () => {
	it("shows GitHub's rendered preview and reuses it until the text changes", async () => {
		previewMarkdown.mockResolvedValue({ html: "<p><strong>hi</strong></p>" });
		render(<Editor />);

		await act(async () => {
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
		});
		expect(await screen.findByText("hi", { selector: "strong" })).toBeTruthy();
		expect(previewMarkdown).toHaveBeenCalledTimes(1);
		expect(previewMarkdown).toHaveBeenCalledWith({ projectId, body: "**hi**" });

		await act(async () => {
			fireEvent.click(screen.getByRole("tab", { name: "Write" }));
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
		});
		expect(screen.getByText("hi", { selector: "strong" })).toBeTruthy();
		expect(previewMarkdown).toHaveBeenCalledTimes(1);
	});

	it("explains preview failures", async () => {
		previewMarkdown.mockRejectedValue(new Error("GitHub is down"));
		render(<Editor />);
		await act(async () => {
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
		});
		expect(await screen.findByText("GitHub is down")).toBeTruthy();
	});
});
