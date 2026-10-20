// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("@clerk/clerk-react", () => ({ UserButton: () => null }));
vi.mock("#/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("#/features/tasker/notes/PersonalNotesWorkspace", () => ({
	PersonalNotesWorkspace: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({
		to,
		children,
		onClick,
		...props
	}: {
		to: string;
		children: ReactNode;
		onClick: () => void;
		"aria-label"?: string;
		title?: string;
	}) => (
		<a
			href={to}
			aria-label={props["aria-label"]}
			title={props.title}
			onClick={(event) => {
				event.preventDefault();
				onClick();
			}}
		>
			{children}
		</a>
	),
}));
vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
	useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
		switch (getFunctionName(reference)) {
			case "users:me":
				return {
					name: "Test User",
					email: "test@example.com",
					globalRole: "owner",
				};
			case "projects:sidebar":
				return [
					{
						project: { _id: "project", key: "TEST", name: "Test project" },
						issueLists: [{ _id: "list", name: "General" }],
					},
				];
			case "notifications:unreadCount":
				return 0;
			default:
				return [];
		}
	},
}));

beforeEach(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("collapses and expands navigation while retaining named links and page content", () => {
	const { container } = render(
		<AppShell>
			<div>Task workspace</div>
		</AppShell>,
	);
	const workspace = screen.getByText("Task workspace");
	const shell = container.querySelector(".app-shell-grid");
	fireEvent.click(
		screen.getByRole("button", { name: "Collapse navigation menu" }),
	);
	expect(shell?.classList.contains("app-shell-collapsed")).toBe(true);
	const expand = screen.getByRole("button", { name: "Expand navigation menu" });
	expect(expand.getAttribute("aria-expanded")).toBe("false");
	expect(expand.getAttribute("aria-controls")).toBe("app-navigation");
	for (const name of ["Projects", "Users", "Test project"]) {
		expect(screen.getByRole("link", { name }).getAttribute("title")).toBe(name);
	}
	fireEvent.click(expand);
	expect(shell?.classList.contains("app-shell-collapsed")).toBe(false);
	expect(workspace.isConnected).toBe(true);
});

it("keeps the mobile drawer independent of desktop collapse and closes it on navigation", () => {
	const { container } = render(
		<AppShell>
			<div>Task workspace</div>
		</AppShell>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Collapse navigation menu" }),
	);
	const mobileToggle = screen.getByRole("button", {
		name: "Open navigation menu",
	});
	fireEvent.click(mobileToggle);
	expect(mobileToggle.getAttribute("aria-expanded")).toBe("true");
	expect(container.querySelector(".app-sidebar-open")).toBeTruthy();
	expect(document.body.style.overflow).toBe("hidden");
	fireEvent.click(screen.getByRole("link", { name: "Projects" }));
	expect(container.querySelector(".app-sidebar-open")).toBeNull();
	expect(document.body.style.overflow).toBe("");
	expect(container.querySelector(".app-shell-collapsed")).toBeTruthy();
});
