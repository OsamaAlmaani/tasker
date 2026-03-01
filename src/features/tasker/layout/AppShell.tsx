import { UserButton } from "@clerk/clerk-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	CircleDot,
	Command,
	FolderKanban,
	Home,
	Settings,
	Shield,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import ThemeToggle from "#/components/ThemeToggle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
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
	const [listModalProject, setListModalProject] = useState<{
		id: Id<"projects">;
		name: string;
	} | null>(null);
	const [newListName, setNewListName] = useState("");
	const [listError, setListError] = useState<string | null>(null);
	const [isCreatingList, setIsCreatingList] = useState(false);

	const me = useQuery(api.users.me);
	const sidebarProjects = useQuery(api.projects.sidebar, {
		includeArchived: false,
	});
	const createIssueList = useMutation(api.issueLists.create);
	const canManageIssueLists =
		me?.globalRole === "admin" || me?.globalRole === "member";

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

		if (sidebarProjects) {
			for (const row of sidebarProjects.slice(0, 10)) {
				commandRows.push({
					id: `project-${row.project._id}`,
					label: `Open ${row.project.key} · ${row.project.name}`,
					to: `/projects/${row.project._id}`,
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
	}, [commandSearch, me?.globalRole, sidebarProjects]);

	async function submitCreateList(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!listModalProject) {
			return;
		}

		const name = newListName.trim();
		setListError(null);
		if (!name) {
			setListError("List name is required.");
			return;
		}

		setIsCreatingList(true);
		try {
			await createIssueList({
				projectId: listModalProject.id,
				name,
			});
			setListModalProject(null);
			setNewListName("");
		} catch (error) {
			setListError(
				error instanceof Error ? error.message : "Failed to create issue list.",
			);
		} finally {
			setIsCreatingList(false);
		}
	}

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
							Focused team workspace
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

					<div className="max-h-[34vh] space-y-2 overflow-auto pr-1">
						{(sidebarProjects ?? []).map((row) => (
							<div key={row.project._id} className="space-y-1">
								<div className="flex items-center gap-1">
									<Link
										to="/projects/$projectId"
										params={{ projectId: row.project._id }}
										search={{}}
										className="project-item min-w-0 flex-1"
										activeOptions={{
											exact: true,
											includeSearch: true,
											explicitUndefined: true,
										}}
										activeProps={{
											className:
												"project-item project-item-active min-w-0 flex-1",
										}}
									>
										<span
											className="project-dot"
											style={{
												backgroundColor: row.project.color ?? "#6b7280",
											}}
										/>
										<span className="truncate">{row.project.name}</span>
									</Link>
									{canManageIssueLists ? (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											className="h-7 w-7 px-0"
											onClick={() => {
												setNewListName("");
												setListError(null);
												setListModalProject({
													id: row.project._id,
													name: row.project.name,
												});
											}}
										>
											+
										</Button>
									) : null}
								</div>
								{row.issueLists.length ? (
									<div className="ml-6 space-y-0.5">
										{row.issueLists.map((list) => (
											<Link
												key={list._id}
												to="/projects/$projectId"
												params={{ projectId: row.project._id }}
												search={{ list: list._id }}
												className="project-subitem truncate"
												activeOptions={{ exact: true, includeSearch: true }}
												activeProps={{
													className:
														"project-subitem project-subitem-active truncate",
												}}
												title={list.name}
											>
												• {list.name}
											</Link>
										))}
									</div>
								) : null}
							</div>
						))}
						{!sidebarProjects?.length ? (
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

			{listModalProject ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,12,26,0.42)] px-4"
					role="dialog"
					aria-modal="true"
					aria-label="Create issue list"
				>
					<div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-card p-4 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
						<div className="mb-3">
							<h2 className="m-0 text-base font-semibold text-[var(--text)]">
								New Issue List
							</h2>
							<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
								{listModalProject.name}
							</p>
						</div>

						<form onSubmit={submitCreateList} className="space-y-3">
							<Input
								autoFocus
								value={newListName}
								onChange={(event) => setNewListName(event.target.value)}
								placeholder="List name"
							/>
							{listError ? (
								<p className="m-0 text-sm text-[var(--danger)]">{listError}</p>
							) : null}
							<div className="flex items-center justify-end gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={() => setListModalProject(null)}
									disabled={isCreatingList}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="secondary"
									className="whitespace-nowrap"
									disabled={isCreatingList}
								>
									{isCreatingList ? "Creating..." : "Create list"}
								</Button>
							</div>
						</form>
					</div>
				</div>
			) : null}
		</div>
	);
}
