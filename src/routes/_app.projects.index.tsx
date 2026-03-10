import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArchiveRestore, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { formatRelative } from "#/features/tasker/format";
import { projectFormSchema } from "#/features/tasker/validation";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

const searchSchema = z.object({
	create: z.string().optional(),
});

export const Route = createFileRoute("/_app/projects/")({
	validateSearch: searchSchema,
	component: ProjectsPage,
});

function parseConvexError(
	error: unknown,
): { code?: string; message?: string } | null {
	if (!(error instanceof Error)) {
		return null;
	}

	const marker = "Uncaught ConvexError:";
	const markerIndex = error.message.indexOf(marker);
	if (markerIndex === -1) {
		return null;
	}

	const payload = error.message.slice(markerIndex + marker.length).trim();
	try {
		const parsed = JSON.parse(payload) as {
			code?: unknown;
			message?: unknown;
		};
		return {
			code: typeof parsed.code === "string" ? parsed.code : undefined,
			message: typeof parsed.message === "string" ? parsed.message : undefined,
		};
	} catch {
		return null;
	}
}

function getProjectCreateErrorMessage(error: unknown): string {
	const convexError = parseConvexError(error);
	if (convexError?.code === "CONFLICT") {
		return "Project key is already used. It may belong to an archived project in the Archived section below.";
	}
	if (convexError?.message) {
		return convexError.message;
	}
	return "Failed to create project.";
}

function getArchiveActionErrorMessage(error: unknown): string {
	const convexError = parseConvexError(error);
	if (convexError?.message) {
		return convexError.message;
	}
	return "Failed to update project archive state.";
}

function ProjectsPage() {
	const search = Route.useSearch();
	const me = useQuery(api.users.me);
	const projects = useQuery(api.projects.list, { includeArchived: true });
	const createProject = useMutation(api.projects.create);
	const toggleProjectArchive = useMutation(api.projects.archive);

	const [isCreating, setIsCreating] = useState(Boolean(search.create));
	const [createError, setCreateError] = useState<string | null>(null);
	const [archiveError, setArchiveError] = useState<string | null>(null);
	const [updatingProjectId, setUpdatingProjectId] =
		useState<Id<"projects"> | null>(null);

	const [form, setForm] = useState({
		name: "",
		key: "",
		description: "",
		color: "#4f46e5",
		icon: "FolderKanban",
		allowMemberInvites: true,
		allowIssueDelete: true,
	});

	async function onCreateProject(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCreateError(null);

		const parsed = projectFormSchema.safeParse(form);
		if (!parsed.success) {
			setCreateError(
				parsed.error.issues[0]?.message ?? "Please check project details.",
			);
			return;
		}

		try {
			await createProject(parsed.data);
			setForm({
				name: "",
				key: "",
				description: "",
				color: "#4f46e5",
				icon: "FolderKanban",
				allowMemberInvites: true,
				allowIssueDelete: true,
			});
			setIsCreating(false);
		} catch (mutationError) {
			setCreateError(getProjectCreateErrorMessage(mutationError));
		}
	}

	const canCreate = me?.globalRole === "admin" || me?.globalRole === "member";
	const activeProjects = (projects ?? []).filter(
		(project) => !project.archived,
	);
	const archivedProjects = (projects ?? []).filter(
		(project) => project.archived,
	);

	async function onUnarchiveProject(projectId: Id<"projects">) {
		setArchiveError(null);
		setUpdatingProjectId(projectId);
		try {
			await toggleProjectArchive({
				projectId,
				archived: false,
			});
		} catch (mutationError) {
			setArchiveError(getArchiveActionErrorMessage(mutationError));
		} finally {
			setUpdatingProjectId(null);
		}
	}

	return (
		<div>
			<PageHeader
				title="Projects"
				description="Browse your accessible projects, create new ones, and jump into issue planning."
				actions={
					canCreate ? (
						<Button
							variant="secondary"
							onClick={() => {
								setCreateError(null);
								setIsCreating((value) => !value);
							}}
						>
							<Plus className="mr-2 h-4 w-4" />
							{isCreating ? "Close" : "New Project"}
						</Button>
					) : null
				}
			/>

			{isCreating && canCreate ? (
				<Card className="mb-4">
					<CardHeader>
						<CardTitle>Create Project</CardTitle>
					</CardHeader>
					<CardContent>
						<form
							className="grid gap-3 md:grid-cols-2"
							onSubmit={onCreateProject}
						>
							<div>
								<Label>Name</Label>
								<Input
									value={form.name}
									onChange={(event) =>
										setForm((prev) => ({ ...prev, name: event.target.value }))
									}
									required
								/>
							</div>

							<div>
								<Label>Key</Label>
								<Input
									value={form.key}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											key: event.target.value.toUpperCase(),
										}))
									}
									required
								/>
							</div>

							<div className="md:col-span-2">
								<Label>Description</Label>
								<Textarea
									value={form.description}
									onChange={(event) =>
										setForm((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
								/>
							</div>

							<div>
								<Label>Color</Label>
								<Input
									type="color"
									value={form.color}
									onChange={(event) =>
										setForm((prev) => ({ ...prev, color: event.target.value }))
									}
								/>
							</div>

							<div>
								<Label>Icon</Label>
								<Input
									value={form.icon}
									onChange={(event) =>
										setForm((prev) => ({ ...prev, icon: event.target.value }))
									}
								/>
							</div>

							<div className="flex items-center gap-2">
								<Switch
									checked={form.allowMemberInvites}
									onChange={(next) =>
										setForm((prev) => ({ ...prev, allowMemberInvites: next }))
									}
								/>
								<span className="text-sm text-[var(--muted-text)]">
									Allow member invites
								</span>
							</div>

							<div className="flex items-center gap-2">
								<Switch
									checked={form.allowIssueDelete}
									onChange={(next) =>
										setForm((prev) => ({ ...prev, allowIssueDelete: next }))
									}
								/>
								<span className="text-sm text-[var(--muted-text)]">
									Allow issue deletion
								</span>
							</div>

							{createError ? (
								<p className="m-0 text-sm text-[var(--danger)]">
									{createError}
								</p>
							) : null}

							<div className="md:col-span-2">
								<Button type="submit">Create project</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			) : null}

			<div className="space-y-6">
				<div>
					<h2 className="mb-3 text-sm font-semibold text-[var(--muted-text)]">
						Active Projects
					</h2>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						{activeProjects.map((project) => (
							<Link
								to="/projects/$projectId"
								params={{ projectId: project._id }}
								key={project._id}
								className="no-underline"
							>
								<Card className="h-full transition hover:-translate-y-0.5">
									<CardHeader>
										<CardTitle className="flex items-center gap-2">
											<span
												className="inline-block h-2.5 w-2.5 rounded-full"
												style={{ backgroundColor: project.color ?? "#6b7280" }}
											/>
											{project.name}
										</CardTitle>
									</CardHeader>
									<CardContent>
										<p className="m-0 text-sm text-[var(--muted-text)]">
											{project.description}
										</p>
										<div className="mt-3 flex items-center justify-between text-xs text-[var(--muted-text)]">
											<span>{project.key}</span>
											<span>{formatRelative(project.updatedAt)}</span>
										</div>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
					{projects && activeProjects.length === 0 ? (
						<Card>
							<CardContent className="p-8 text-center text-sm text-[var(--muted-text)]">
								No active projects yet.
							</CardContent>
						</Card>
					) : null}
				</div>

				<div>
					<div className="mb-3 flex items-center gap-2">
						<h2 className="text-sm font-semibold text-[var(--muted-text)]">
							Archived Projects
						</h2>
						<Badge>{archivedProjects.length}</Badge>
					</div>
					{archiveError ? (
						<p className="mb-3 text-sm text-[var(--danger)]">{archiveError}</p>
					) : null}
					{projects && archivedProjects.length === 0 ? (
						<Card>
							<CardContent className="p-8 text-center text-sm text-[var(--muted-text)]">
								No archived projects.
							</CardContent>
						</Card>
					) : (
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{archivedProjects.map((project) => (
								<Card key={project._id} className="h-full">
									<CardHeader>
										<CardTitle className="flex items-center justify-between gap-2">
											<span className="flex items-center gap-2">
												<span
													className="inline-block h-2.5 w-2.5 rounded-full"
													style={{
														backgroundColor: project.color ?? "#6b7280",
													}}
												/>
												{project.name}
											</span>
											<Badge>Archived</Badge>
										</CardTitle>
									</CardHeader>
									<CardContent>
										<p className="m-0 text-sm text-[var(--muted-text)]">
											{project.description}
										</p>
										<div className="mt-3 flex items-center justify-between text-xs text-[var(--muted-text)]">
											<span>{project.key}</span>
											<span>{formatRelative(project.updatedAt)}</span>
										</div>
										<div className="mt-4 flex items-center justify-between gap-2">
											<Link
												to="/projects/$projectId"
												params={{ projectId: project._id }}
												className="text-xs text-[var(--muted-text)] no-underline hover:text-[var(--text)]"
											>
												Open project
											</Link>
											{canCreate ? (
												<Button
													size="sm"
													variant="secondary"
													onClick={() => void onUnarchiveProject(project._id)}
													disabled={updatingProjectId === project._id}
												>
													<ArchiveRestore className="mr-2 h-4 w-4" />
													{updatingProjectId === project._id
														? "Unarchiving..."
														: "Unarchive"}
												</Button>
											) : null}
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
