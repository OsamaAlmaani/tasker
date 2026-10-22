// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "#convex/_generated/dataModel";
import { GithubIssuePanel } from "./GithubIssuePanel";
import { GithubProjectSettings } from "./GithubProjectSettings";

const mocks = vi.hoisted(() => ({
	settings: undefined as unknown,
	issue: undefined as unknown,
	connect: vi.fn(),
	create: vi.fn(),
	refresh: vi.fn(),
	toggle: vi.fn(),
	disconnect: vi.fn(),
}));
vi.mock("convex/react", () => ({
	useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(ref).endsWith(":projectConnection")
			? mocks.settings
			: mocks.issue,
	useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(ref);
		return name.endsWith(":connectRepository")
			? mocks.connect
			: name.endsWith(":createBranch")
				? mocks.create
				: mocks.refresh;
	},
	useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(ref).endsWith(":disconnect")
			? mocks.disconnect
			: mocks.toggle,
}));
const projectId = "project" as Id<"projects">;
const issueId = "issue" as Id<"issues">;
const statuses = [
	{ key: "todo", name: "Todo", position: 0, color: "#000000" },
	{ key: "building", name: "Building", position: 1, color: "#000000" },
	{ key: "approval", name: "Approval", position: 2, color: "#000000" },
	{ key: "done", name: "Done", position: 3, color: "#000000" },
];
const connection = {
	enabled: true,
	owner: "owner",
	repo: "repo",
	baseBranch: "main",
	workStatus: "building",
	reviewStatus: "approval",
	version: 1,
};
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.settings = undefined;
	mocks.issue = undefined;
});

describe("GitHub project settings", () => {
	it("explains setup when the deployment has no App credentials", () => {
		mocks.settings = {
			configured: false,
			canConfigure: true,
			connection: null,
			installUrl: null,
		};
		render(
			<GithubProjectSettings
				projectId={projectId}
				statuses={statuses}
				archived={false}
			/>,
		);
		expect(screen.getByText(/GitHub is not set up yet/)).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Save GitHub connection",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
	it("sends persisted custom status mappings with the selected repository", async () => {
		mocks.settings = {
			configured: true,
			canConfigure: true,
			connection: null,
			installUrl: "https://github.com/apps/tasker/installations/new",
		};
		mocks.connect.mockResolvedValue("connection");
		render(
			<GithubProjectSettings
				projectId={projectId}
				statuses={statuses}
				archived={false}
			/>,
		);
		fireEvent.change(screen.getByLabelText("GitHub repository"), {
			target: { value: "owner/repo" },
		});
		fireEvent.change(screen.getByLabelText("Default base branch"), {
			target: { value: "develop" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Save GitHub connection" }),
		);
		await waitFor(() =>
			expect(mocks.connect).toHaveBeenCalledWith({
				projectId,
				repository: "owner/repo",
				baseBranch: "develop",
				workStatus: "building",
				reviewStatus: "approval",
			}),
		);
		expect(
			screen
				.getByRole("link", { name: /Install GitHub App/ })
				.getAttribute("href"),
		).toBe("https://github.com/apps/tasker/installations/new");
	});
	it("shows connected repository details to members without configuration controls", () => {
		mocks.settings = { configured: true, canConfigure: false, connection };
		render(
			<GithubProjectSettings
				projectId={projectId}
				statuses={statuses}
				archived={false}
			/>,
		);
		expect(screen.getByRole("link", { name: "owner/repo" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Save GitHub connection" }),
		).toBeNull();
		expect(screen.queryByLabelText("GitHub repository")).toBeNull();
	});
});

describe("GitHub issue panel", () => {
	it("creates the suggested branch and exposes a failed request for retry", async () => {
		mocks.issue = {
			connection,
			link: null,
			suggestedBranch: "feature/TASK-1-fix-login",
		};
		mocks.create.mockRejectedValue(new Error("GitHub is unavailable"));
		render(
			<GithubIssuePanel
				issueId={issueId}
				canWrite
				archived={false}
				completed={false}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"GitHub is unavailable",
			),
		);
		expect(mocks.create).toHaveBeenCalledWith({
			issueId,
			branch: "feature/TASK-1-fix-login",
			baseBranch: "main",
			mode: "create",
		});
		expect(
			(
				screen.getByRole("button", {
					name: "Create branch",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
	it("prevents double submission while branch creation is pending", async () => {
		mocks.issue = {
			connection,
			link: null,
			suggestedBranch: "feature/TASK-1-fix-login",
		};
		let finish!: () => void;
		mocks.create.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		render(
			<GithubIssuePanel
				issueId={issueId}
				canWrite
				archived={false}
				completed={false}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
		expect(
			(
				screen.getByRole("button", {
					name: "Creating branch…",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Creating branch…" }));
		expect(mocks.create).toHaveBeenCalledTimes(1);
		finish();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Create branch" }),
			).toBeTruthy(),
		);
	});
	it("allows explicit linking and resuming a paused task with a tracked PR", async () => {
		mocks.issue = {
			connection,
			suggestedBranch: "feature/TASK-1",
			link: {
				creationState: "ready",
				branch: "feature/TASK-1",
				baseBranch: "main",
				syncEnabled: false,
				pauseReason: "Paused after a task status change.",
				pullNumber: 42,
				pullState: "open",
				lastSyncedAt: Date.now(),
			},
		};
		mocks.toggle.mockResolvedValue(null);
		render(
			<GithubIssuePanel
				issueId={issueId}
				canWrite
				archived={false}
				completed={false}
			/>,
		);
		expect(
			screen.getByRole("link", { name: /PR #42/ }).getAttribute("href"),
		).toBe("https://github.com/owner/repo/pull/42");
		fireEvent.click(screen.getByRole("button", { name: "Resume status sync" }));
		await waitFor(() =>
			expect(mocks.toggle).toHaveBeenCalledWith({ issueId, enabled: true }),
		);
	});
	it("keeps viewer access read-only and preserves visible remote links", () => {
		mocks.issue = {
			connection,
			suggestedBranch: "feature/TASK-1",
			link: {
				creationState: "ready",
				branch: "feature/TASK-1",
				baseBranch: "main",
				syncEnabled: true,
				branchExists: true,
			},
		};
		render(
			<GithubIssuePanel
				issueId={issueId}
				canWrite={false}
				archived={false}
				completed={false}
			/>,
		);
		expect(screen.getByRole("link", { name: "feature/TASK-1" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Refresh GitHub" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Pause status sync" }),
		).toBeNull();
	});
});
