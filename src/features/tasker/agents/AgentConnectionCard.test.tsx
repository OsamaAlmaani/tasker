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
import { AgentConnectionCard } from "./AgentConnectionCard";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	revoke: vi.fn(),
	list: [] as object[],
}));
vi.mock("convex/react", () => ({
	useQuery: () => mocks.list,
	useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(reference).endsWith(":create")
			? mocks.create
			: mocks.revoke,
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.list = [];
});

describe("agent connection settings", () => {
	it("creates a random token and displays it only after successful storage", async () => {
		mocks.create.mockResolvedValue("credential");
		render(<AgentConnectionCard />);
		fireEvent.change(screen.getByLabelText("Token name"), {
			target: { value: "My coding agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create token" }));
		await waitFor(() =>
			expect(screen.getByLabelText("New agent token")).toBeTruthy(),
		);
		const args = mocks.create.mock.calls[0][0];
		expect(args).toMatchObject({
			name: "My coding agent",
			token: expect.stringMatching(/^tsk_[a-f0-9]{64}$/),
		});
		expect(args.expiresAt).toBeGreaterThan(Date.now());
		const config = JSON.parse(
			(screen.getByLabelText("MCP client configuration") as HTMLTextAreaElement)
				.value,
		);
		expect(config.mcpServers.tasker.url).toBe(`${window.location.origin}/mcp`);
		expect(config.mcpServers.tasker.headers.Authorization).toBe(
			`Bearer ${args.token}`,
		);
		expect(config.mcpServers.tasker.command).toBeUndefined();
		fireEvent.click(screen.getByRole("button", { name: "Hide token" }));
		expect(screen.queryByLabelText("New agent token")).toBeNull();
		expect(
			(screen.getByLabelText("MCP client configuration") as HTMLTextAreaElement)
				.value,
		).not.toContain(args.token);
	});
	it("reports creation failures without revealing an unusable token", async () => {
		mocks.create.mockRejectedValue(new Error("Unable to save token"));
		render(<AgentConnectionCard />);
		fireEvent.change(screen.getByLabelText("Token name"), {
			target: { value: "Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create token" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"Unable to save token",
			),
		);
		expect(screen.queryByLabelText("New agent token")).toBeNull();
	});
	it("revokes a credential and reports failures", async () => {
		mocks.list = [
			{
				_id: "credential",
				name: "My agent",
				tokenPrefix: "tsk_abcdef",
				createdAt: 1,
			},
		];
		mocks.revoke.mockRejectedValue(new Error("Unable to revoke"));
		render(<AgentConnectionCard />);
		fireEvent.click(screen.getByRole("button", { name: "Revoke My agent" }));
		await waitFor(() =>
			expect(mocks.revoke).toHaveBeenCalledWith({ tokenId: "credential" }),
		);
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"Unable to revoke",
			),
		);
	});
});
