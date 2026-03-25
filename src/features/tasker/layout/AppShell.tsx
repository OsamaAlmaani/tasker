import { UserButton } from "@clerk/clerk-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	CircleDot,
	Command,
	FolderKanban,
	Home,
	ListChecks,
	Menu,
	MoreHorizontal,
	Pencil,
	Settings,
	Shield,
	Trash2,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ThemeToggle from "#/components/ThemeToggle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import { globalRoleLabel } from "../model";

const navItems = [
	{ to: "/dashboard", label: "Dashboard", icon: Home },
	{ to: "/my-work", label: "My Work", icon: ListChecks },
	{ to: "/projects", label: "Projects", icon: FolderKanban },
	{ to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
	const navigate = useNavigate();
	const [commandOpen, setCommandOpen] = useState(false);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [commandSearch, setCommandSearch] = useState("");
	const [listModalProject, setListModalProject] = useState<{
		id: Id<"projects">;
		name: string;
	} | null>(null);
	const [newListName, setNewListName] = useState("");
	const [listError, setListError] = useState<string | null>(null);
	const [isCreatingList, setIsCreatingList] = useState(false);
	const [listActionMenu, setListActionMenu] = useState<{
		projectId: Id<"projects">;
		issueListId: Id<"issueLists">;
	} | null>(null);
	const [listToRename, setListToRename] = useState<{
		projectName: string;
		issueListId: Id<"issueLists">;
		issueListName: string;
	} | null>(null);
	const [renameListName, setRenameListName] = useState("");
	const [renameListError, setRenameListError] = useState<string | null>(null);
	const [isRenamingList, setIsRenamingList] = useState(false);
	const [listToDelete, setListToDelete] = useState<{
		projectId: Id<"projects">;
		projectName: string;
		issueListId: Id<"issueLists">;
		issueListName: string;
	} | null>(null);
	const [deleteListMode, setDeleteListMode] = useState<
		"delete_tasks" | "move_tasks"
	>("move_tasks");
	const [deleteListDestinationId, setDeleteListDestinationId] =
		useState("__none__");
	const [deleteListError, setDeleteListError] = useState<string | null>(null);
	const [isDeletingList, setIsDeletingList] = useState(false);
	const listActionMenuRef = useRef<HTMLDivElement | null>(null);

	const me = useQuery(api.users.me);
	const sidebarProjects = useQuery(api.projects.sidebar, {
		includeArchived: false,
	});
	const createIssueList = useMutation(api.issueLists.create);
	const updateIssueList = useMutation(api.issueLists.update);
	const deleteIssueList = useMutation(api.issueLists.remove);
	const canManageIssueLists =
		me?.globalRole === "admin" || me?.globalRole === "member";

	const quickCommands = useMemo(() => {
		const commandRows = [
			{ id: "go-dashboard", label: "Go to Dashboard", to: "/dashboard" },
			{ id: "go-my-work", label: "Open My Work", to: "/my-work" },
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
				error instanceof Error ? error.message : "Failed to create task list.",
			);
		} finally {
			setIsCreatingList(false);
		}
	}

	function closeRenameListModal() {
		setListToRename(null);
		setRenameListName("");
		setRenameListError(null);
	}

	async function submitRenameList(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!listToRename) {
			return;
		}

		const name = renameListName.trim();
		setRenameListError(null);
		if (!name) {
			setRenameListError("List name is required.");
			return;
		}

		setIsRenamingList(true);
		try {
			await updateIssueList({
				issueListId: listToRename.issueListId,
				name,
			});
			closeRenameListModal();
		} catch (error) {
			setRenameListError(
				getClientErrorMessage(error, "Failed to rename task list."),
			);
		} finally {
			setIsRenamingList(false);
		}
	}

	const deleteListDestinationOptions = useMemo(() => {
		if (!listToDelete || !sidebarProjects) {
			return [];
		}

		const projectRow = sidebarProjects.find(
			(row) => row.project._id === listToDelete.projectId,
		);
		return (projectRow?.issueLists ?? []).filter(
			(list) => list._id !== listToDelete.issueListId,
		);
	}, [listToDelete, sidebarProjects]);

	function closeDeleteListModal() {
		setListToDelete(null);
		setDeleteListMode("move_tasks");
		setDeleteListDestinationId("__none__");
		setDeleteListError(null);
	}

	async function confirmDeleteList() {
		if (!listToDelete) {
			return;
		}

		setDeleteListError(null);
		setIsDeletingList(true);
		try {
			await deleteIssueList({
				issueListId: listToDelete.issueListId,
				mode: deleteListMode,
				destinationListId:
					deleteListMode === "move_tasks"
						? deleteListDestinationId === "__none__"
							? null
							: (deleteListDestinationId as Id<"issueLists">)
						: undefined,
			});
			closeDeleteListModal();
		} catch (error) {
			setDeleteListError(
				getClientErrorMessage(error, "Failed to delete task list."),
			);
		} finally {
			setIsDeletingList(false);
		}
	}

	useEffect(() => {
		if (!listActionMenu) {
			return;
		}

		const onDocumentClick = (event: MouseEvent) => {
			if (
				listActionMenuRef.current &&
				!listActionMenuRef.current.contains(event.target as Node)
			) {
				setListActionMenu(null);
			}
		};

		const onDocumentKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setListActionMenu(null);
			}
		};

		document.addEventListener("mousedown", onDocumentClick);
		document.addEventListener("keydown", onDocumentKeydown);
		return () => {
			document.removeEventListener("mousedown", onDocumentClick);
			document.removeEventListener("keydown", onDocumentKeydown);
		};
	}, [listActionMenu]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setCommandOpen((value) => !value);
			}

			if (event.key === "Escape") {
				setCommandOpen(false);
				setMobileSidebarOpen(false);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(min-width: 1101px)");
		const onChange = (event: MediaQueryListEvent) => {
			if (event.matches) {
				setMobileSidebarOpen(false);
			}
		};

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, []);

	useEffect(() => {
		if (!mobileSidebarOpen) {
			return;
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [mobileSidebarOpen]);

	return (
		<div className="app-shell-grid min-h-dvh">
			{mobileSidebarOpen ? (
				<button
					type="button"
					className="app-sidebar-overlay"
					aria-label="Close navigation menu"
					onClick={() => setMobileSidebarOpen(false)}
				/>
			) : null}

			<aside
				className={`app-sidebar ${mobileSidebarOpen ? "app-sidebar-open" : ""}`}
			>
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
					<button
						type="button"
						className="app-sidebar-close ml-auto"
						aria-label="Close navigation menu"
						onClick={() => setMobileSidebarOpen(false)}
					>
						<X className="h-4 w-4" />
					</button>
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
								onClick={() => setMobileSidebarOpen(false)}
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
							onClick={() => setMobileSidebarOpen(false)}
						>
							<Shield className="h-4 w-4" />
							<span>Users</span>
						</Link>
					) : null}
				</nav>

				<div className="mt-8 flex min-h-0 flex-1 flex-col">
					<div className="mb-2 flex items-center justify-between">
						<p className="m-0 text-xs font-semibold tracking-wide text-[var(--muted-text)] uppercase">
							Projects
						</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setMobileSidebarOpen(false);
								navigate({ to: "/projects", search: { create: "1" } });
							}}
						>
							+
						</Button>
					</div>

					<div className="min-h-0 flex-1 space-y-2 overflow-auto pr-4 pb-4">
						{(sidebarProjects ?? []).map((row) => (
							<div key={row.project._id} className="space-y-1">
								<div className="flex items-center gap-1">
									<Link
										to="/projects/$projectId"
										params={{ projectId: row.project._id }}
										search={(previous) => {
											const { list: _ignored, ...rest } = previous;
											return rest;
										}}
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
										onClick={() => setMobileSidebarOpen(false)}
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
											<div key={list._id} className="flex items-center gap-1">
												<Link
													to="/projects/$projectId"
													params={{ projectId: row.project._id }}
													search={(previous) => ({
														...previous,
														list: list._id,
													})}
													className="project-subitem min-w-0 flex-1 truncate"
													activeOptions={{ exact: true, includeSearch: true }}
													activeProps={{
														className:
															"project-subitem project-subitem-active min-w-0 flex-1 truncate",
													}}
													title={list.name}
													onClick={() => setMobileSidebarOpen(false)}
												>
													• {list.name}
												</Link>
												{canManageIssueLists ? (
													<div
														className="relative"
														ref={
															listActionMenu?.issueListId === list._id
																? listActionMenuRef
																: undefined
														}
													>
														<Button
															type="button"
															size="sm"
															variant="ghost"
															className="h-7 w-7 shrink-0 px-0"
															aria-label={`Open actions for ${list.name} list`}
															title={`Open actions for ${list.name} list`}
															onClick={() =>
																setListActionMenu((current) =>
																	current?.issueListId === list._id
																		? null
																		: {
																				projectId: row.project._id,
																				issueListId: list._id,
																			},
																)
															}
														>
															<MoreHorizontal className="h-3.5 w-3.5" />
														</Button>
														{listActionMenu?.issueListId === list._id ? (
															<div
																role="menu"
																className="absolute right-0 z-20 mt-2 min-w-[150px] rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[0_20px_50px_rgba(8,12,26,0.2)]"
															>
																<button
																	type="button"
																	role="menuitem"
																	className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
																	onClick={() => {
																		setRenameListName(list.name);
																		setRenameListError(null);
																		setListToRename({
																			projectName: row.project.name,
																			issueListId: list._id,
																			issueListName: list.name,
																		});
																		setListActionMenu(null);
																	}}
																>
																	<Pencil className="h-4 w-4" />
																	Rename list
																</button>
																<button
																	type="button"
																	role="menuitem"
																	className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
																	onClick={() => {
																		setDeleteListMode("move_tasks");
																		setDeleteListDestinationId("__none__");
																		setDeleteListError(null);
																		setListToDelete({
																			projectId: row.project._id,
																			projectName: row.project.name,
																			issueListId: list._id,
																			issueListName: list.name,
																		});
																		setListActionMenu(null);
																	}}
																>
																	<Trash2 className="h-4 w-4" />
																	Delete list
																</button>
															</div>
														) : null}
													</div>
												) : null}
											</div>
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

				<div className="pt-6">
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
						className="app-sidebar-toggle"
						aria-label="Open navigation menu"
						onClick={() => setMobileSidebarOpen(true)}
					>
						<Menu className="h-4 w-4" />
					</button>

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
					aria-label="Create task list"
				>
					<div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-card p-4 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
						<div className="mb-3">
							<h2 className="m-0 text-base font-semibold text-[var(--text)]">
								New Task List
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

			{listToRename ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,12,26,0.42)] px-4"
					role="dialog"
					aria-modal="true"
					aria-label="Rename task list"
				>
					<div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
						<div className="mb-3">
							<h2 className="m-0 text-base font-semibold text-[var(--text)]">
								Rename Task List
							</h2>
							<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
								{listToRename.projectName}
							</p>
						</div>

						<form onSubmit={submitRenameList} className="space-y-3">
							<Input
								autoFocus
								value={renameListName}
								onChange={(event) => setRenameListName(event.target.value)}
								placeholder="List name"
							/>
							{renameListError ? (
								<p className="m-0 text-sm text-[var(--danger)]">
									{renameListError}
								</p>
							) : null}
							<div className="flex items-center justify-end gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={closeRenameListModal}
									disabled={isRenamingList}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="secondary"
									disabled={isRenamingList}
								>
									{isRenamingList ? "Saving..." : "Save name"}
								</Button>
							</div>
						</form>
					</div>
				</div>
			) : null}

			{listToDelete ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,12,26,0.42)] px-4"
					role="dialog"
					aria-modal="true"
					aria-label="Delete task list"
				>
					<div className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
						<div className="mb-3">
							<h2 className="m-0 text-base font-semibold text-[var(--text)]">
								Delete Task List
							</h2>
							<p className="m-0 mt-1 text-sm text-[var(--muted-text)]">
								Delete <strong>{listToDelete.issueListName}</strong> from{" "}
								{listToDelete.projectName}.
							</p>
						</div>

						<div className="space-y-3">
							<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
								<input
									type="radio"
									name="delete-list-mode"
									checked={deleteListMode === "move_tasks"}
									onChange={() => setDeleteListMode("move_tasks")}
									disabled={isDeletingList}
								/>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										Move tasks out of this list
									</p>
									<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
										Keep the tasks and move them to another list or to No list.
									</p>
								</div>
							</label>

							{deleteListMode === "move_tasks" ? (
								<div>
									<p className="m-0 mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted-text)]">
										Move tasks to
									</p>
									<Select
										value={deleteListDestinationId}
										onChange={(event) =>
											setDeleteListDestinationId(event.target.value)
										}
										disabled={isDeletingList}
									>
										<option value="__none__">No list</option>
										{deleteListDestinationOptions.map((list) => (
											<option key={list._id} value={list._id}>
												{list.name}
											</option>
										))}
									</Select>
								</div>
							) : null}

							<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
								<input
									type="radio"
									name="delete-list-mode"
									checked={deleteListMode === "delete_tasks"}
									onChange={() => setDeleteListMode("delete_tasks")}
									disabled={isDeletingList}
								/>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										Delete all tasks in this list
									</p>
									<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
										Delete every task assigned to this list. Sub-tasks under
										those tasks will be deleted too.
									</p>
								</div>
							</label>

							{deleteListError ? (
								<p className="m-0 text-sm text-[var(--danger)]">
									{deleteListError}
								</p>
							) : null}

							<div className="flex items-center justify-end gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={closeDeleteListModal}
									disabled={isDeletingList}
								>
									Cancel
								</Button>
								<Button
									type="button"
									variant="danger"
									onClick={() => {
										void confirmDeleteList();
									}}
									disabled={isDeletingList}
								>
									{isDeletingList ? "Deleting..." : "Delete list"}
								</Button>
							</div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
