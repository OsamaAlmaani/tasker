import { UserButton } from "@clerk/clerk-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	CircleDot,
	Command,
	FolderKanban,
	Home,
	Settings,
	Shield,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "#/components/ThemeToggle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { api } from "#convex/_generated/api";
import { globalRoleLabel } from "../model";

const navItems = [
	{ to: "/dashboard", label: "Dashboard", icon: Home },
	{ to: "/projects", label: "Projects", icon: FolderKanban },
	{ to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
	const navigate = useNavigate();
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandSearch, setCommandSearch] = useState("");

	const me = useQuery(api.users.me);
	const projects = useQuery(api.projects.list, { includeArchived: false });

	const quickCommands = useMemo(() => {
		const commandRows = [
			{ id: "go-dashboard", label: "Go to Dashboard", to: "/dashboard" },
			{ id: "go-projects", label: "Go to Projects", to: "/projects" },
			{ id: "go-settings", label: "Open Settings", to: "/settings" },
		];

		if (me?.globalRole === "admin") {
			commandRows.push({
				id: "go-admin-users",
				label: "Open User Management",
				to: "/admin/users",
			});
		}

		if (projects) {
			for (const project of projects.slice(0, 10)) {
				commandRows.push({
					id: `project-${project._id}`,
					label: `Open ${project.key} · ${project.name}`,
					to: `/projects/${project._id}`,
				});
			}
		}

		const query = commandSearch.trim().toLowerCase();
		if (!query) {
			return commandRows;
		}

		return commandRows.filter((item) =>
			item.label.toLowerCase().includes(query),
		);
	}, [commandSearch, me?.globalRole, projects]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setCommandOpen((value) => !value);
			}

			if (event.key === "Escape") {
				setCommandOpen(false);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<div className="app-shell-grid min-h-dvh">
			<aside className="app-sidebar">
				<div className="mb-6 flex items-center gap-2">
					<div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
						<CircleDot className="h-4 w-4" />
					</div>
					<div>
						<p className="m-0 text-sm font-semibold">Tasker</p>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Linear-inspired
						</p>
					</div>
				</div>

				<nav className="space-y-1">
					{navItems.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.to}
								to={item.to}
								className="nav-item"
								activeProps={{ className: "nav-item nav-item-active" }}
							>
								<Icon className="h-4 w-4" />
								<span>{item.label}</span>
							</Link>
						);
					})}
					{me?.globalRole === "admin" ? (
						<Link
							to="/admin/users"
							className="nav-item"
							activeProps={{ className: "nav-item nav-item-active" }}
						>
							<Shield className="h-4 w-4" />
							<span>Users</span>
						</Link>
					) : null}
				</nav>

				<div className="mt-8">
					<div className="mb-2 flex items-center justify-between">
						<p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted-text)] uppercase">
							Projects
						</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								navigate({ to: "/projects", search: { create: "1" } })
							}
						>
							+
						</Button>
					</div>

					<div className="max-h-[34vh] space-y-1 overflow-auto pr-1">
						{(projects ?? []).map((project) => (
							<Link
								key={project._id}
								to="/projects/$projectId"
								params={{ projectId: project._id }}
								className="project-item"
								activeProps={{ className: "project-item project-item-active" }}
							>
								<span
									className="project-dot"
									style={{ backgroundColor: project.color ?? "#6b7280" }}
								/>
								<span className="truncate">{project.name}</span>
								<span className="ml-auto text-[10px] text-[var(--muted-text)]">
									{project.key}
								</span>
							</Link>
						))}
						{!projects?.length ? (
							<p className="m-0 rounded-md border border-dashed border-[var(--line)] px-3 py-4 text-xs text-[var(--muted-text)]">
								No projects yet.
							</p>
						) : null}
					</div>
				</div>

				<div className="mt-auto pt-6">
					<div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
						<p className="m-0 text-sm font-medium">
							{me?.name ?? "Loading..."}
						</p>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							{me?.email ?? ""}
						</p>
						{me ? (
							<Badge className="mt-2">{globalRoleLabel[me.globalRole]}</Badge>
						) : null}
					</div>
				</div>
			</aside>

			<main className="app-main">
				<header className="app-topbar">
					<button
						type="button"
						className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--muted-text)]"
						onClick={() => setCommandOpen(true)}
					>
						<Command className="h-4 w-4" />
						Command Bar
						<kbd className="ml-2 rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted-text)]">
							Ctrl K
						</kbd>
					</button>

					<div className="ml-auto flex items-center gap-2">
						<ThemeToggle />
						<UserButton />
					</div>
				</header>

				<section className="app-content">{children}</section>
			</main>

			{commandOpen ? (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(8,12,26,0.42)] px-4 pt-[12vh]"
					role="dialog"
					aria-modal="true"
					tabIndex={-1}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							setCommandOpen(false);
						}
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							setCommandOpen(false);
						}
					}}
				>
					<div className="w-full max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
						<div className="mb-2 flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setCommandOpen(false)}
							>
								Close
							</Button>
						</div>
						<Input
							autoFocus
							placeholder="Jump to…"
							value={commandSearch}
							onChange={(event) => setCommandSearch(event.target.value)}
						/>

						<div className="mt-3 max-h-72 space-y-1 overflow-auto">
							{quickCommands.map((item) => (
								<button
									key={item.id}
									type="button"
									className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
									onClick={() => {
										void navigate({ to: item.to as never });
										setCommandOpen(false);
										setCommandSearch("");
									}}
								>
									{item.label}
								</button>
							))}
							{!quickCommands.length ? (
								<p className="m-0 px-3 py-5 text-sm text-[var(--muted-text)]">
									No results.
								</p>
							) : null}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
