// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDiscussionPanel } from "./IssueDiscussionPanel";

afterEach(cleanup);

type PanelProps = ComponentProps<typeof IssueDiscussionPanel>;

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
	return {
		canWrite: true,
		comment: "Draft comment",
		commentDraft: "Edited comment",
		currentUserId: "me",
		editingCommentId: null,
		onCancelEditComment: vi.fn(),
		onCommentChange: vi.fn(),
		onCommentDraftChange: vi.fn(),
		onCommentSubmit: vi.fn((event) => event.preventDefault()),
		onSaveComment: vi.fn(),
		onStartEditComment: vi.fn(),
		timelineItems: [
			{
				type: "activity",
				key: "created",
				activity: { action: "issue.created", createdAt: 1 },
			},
			{
				type: "comment",
				key: "comment",
				comment: {
					_id: "comment",
					authorId: "me",
					body: "Please review the release.",
					updatedAt: 2,
				},
				author: { name: "Sam" },
			},
			{
				type: "activity",
				key: "comment-created",
				activity: { action: "comment.created", createdAt: 2 },
			},
		],
		...overrides,
	};
}

describe("task discussion tabs", () => {
	it("defaults to comments with the input form and no audit entries", () => {
		const props = panelProps();
		render(<IssueDiscussionPanel {...props} />);
		expect(
			screen
				.getByRole("tab", { name: "Comments" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("tabpanel", { name: "Comments" })).toBeTruthy();
		expect(screen.getByText("Please review the release.")).toBeTruthy();
		expect(screen.queryByText("Created task")).toBeNull();
		expect(
			screen
				.getByRole("textbox", { name: "Add a comment" })
				.getAttribute("aria-label"),
		).toBe("Add a comment");
		fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
		expect(props.onCommentSubmit).toHaveBeenCalledOnce();
	});

	it("shows only read-only audit entries under Activities with no input or edit controls", () => {
		const view = render(<IssueDiscussionPanel {...panelProps()} />);
		fireEvent.click(screen.getByRole("tab", { name: "Activities" }));
		expect(screen.getByRole("tabpanel", { name: "Activities" })).toBeTruthy();
		expect(screen.getByText("Created task")).toBeTruthy();
		expect(screen.getByText("Added comment")).toBeTruthy();
		expect(screen.queryByText("Please review the release.")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
		expect(view.container.querySelector("form")).toBeNull();
	});

	it("preserves new and edited comment drafts when switching tabs", () => {
		function DraftPanel() {
			const [comment, setComment] = useState("");
			const [draft, setDraft] = useState("Original draft");
			return (
				<IssueDiscussionPanel
					{...panelProps({
						comment,
						commentDraft: draft,
						editingCommentId: "comment",
						onCommentChange: setComment,
						onCommentDraftChange: setDraft,
					})}
				/>
			);
		}
		render(<DraftPanel />);
		fireEvent.change(screen.getByRole("textbox", { name: "Add a comment" }), {
			target: { value: "New draft" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
			target: { value: "Updated draft" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Activities" }));
		expect(screen.queryByRole("textbox")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Comments" }));
		expect(
			(
				screen.getByRole("textbox", {
					name: "Add a comment",
				}) as HTMLTextAreaElement
			).value,
		).toBe("New draft");
		expect(
			(
				screen.getByRole("textbox", {
					name: "Edit comment",
				}) as HTMLTextAreaElement
			).value,
		).toBe("Updated draft");
	});

	it("retains comment editing and viewer permissions", () => {
		const props = panelProps();
		const view = render(<IssueDiscussionPanel {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
		expect(props.onStartEditComment).toHaveBeenCalledWith(
			"comment",
			"Please review the release.",
		);
		view.rerender(
			<IssueDiscussionPanel {...props} editingCommentId="comment" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
		expect(props.onSaveComment).toHaveBeenCalledWith("comment");
		view.rerender(<IssueDiscussionPanel {...props} canWrite={false} />);
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button", { name: "Edit comment" })).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Activities" }));
		expect(screen.queryByText("Viewers cannot add comments.")).toBeNull();
	});

	it("supports arrow, Home and End keys with roving focus and linked panels", () => {
		render(<IssueDiscussionPanel {...panelProps()} />);
		const comments = screen.getByRole("tab", { name: "Comments" });
		const activities = screen.getByRole("tab", { name: "Activities" });
		comments.focus();
		fireEvent.keyDown(comments, { key: "ArrowRight" });
		expect(document.activeElement).toBe(activities);
		expect(activities.tabIndex).toBe(0);
		expect(comments.tabIndex).toBe(-1);
		const panel = screen.getByRole("tabpanel", { name: "Activities" });
		expect(activities.getAttribute("aria-controls")).toBe(panel.id);
		expect(panel.getAttribute("aria-labelledby")).toBe(activities.id);
		fireEvent.keyDown(activities, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(comments);
		fireEvent.keyDown(comments, { key: "End" });
		expect(document.activeElement).toBe(activities);
		fireEvent.keyDown(activities, { key: "Home" });
		expect(document.activeElement).toBe(comments);
	});

	it("shows independent empty states and resets to comments for a different task", () => {
		const props = panelProps({ timelineItems: [] });
		const view = render(<IssueDiscussionPanel key="first" {...props} />);
		expect(screen.getByText("No comments yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Activities" }));
		expect(screen.getByText("No activities yet.")).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
		view.rerender(<IssueDiscussionPanel key="second" {...props} />);
		expect(
			screen
				.getByRole("tab", { name: "Comments" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("textbox", { name: "Add a comment" })).toBeTruthy();
	});
});
