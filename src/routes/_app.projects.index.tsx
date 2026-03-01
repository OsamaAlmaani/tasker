import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
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

const searchSchema = z.object({
	create: z.string().optional(),
});

export const Route = createFileRoute("/_app/projects/")({
	validateSearch: searchSchema,
	component: ProjectsPage,
});

function ProjectsPage() {
	const search = Route.useSearch();
	const me = useQuery(api.users.me);
	const projects = useQuery(api.projects.list, { includeArchived: false });
	const createProject = useMutation(api.projects.create);

	const [isCreating, setIsCreating] = useState(Boolean(search.create));
	const [error, setError] = useState<string | null>(null);

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
		setError(null);

		const parsed = projectFormSchema.safeParse(form);
		if (!parsed.success) {
			setError(
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
			setError(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to create project.",
			);
		}
	}

	const canCreate = me?.globalRole === "admin" || me?.globalRole === "member";

	return (
		<div>
			<PageHeader
				title="Projects"
				description="Browse your accessible projects, create new ones, and jump into issue planning."
				actions={
					canCreate ? (
						<Button
							variant="secondary"
							onClick={() => setIsCreating((value) => !value)}
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

							{error ? (
								<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
							) : null}

							<div className="md:col-span-2">
								<Button type="submit">Create project</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			) : null}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{(projects ?? []).map((project) => (
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

			{projects && projects.length === 0 ? (
				<Card>
					<CardContent className="p-8 text-center text-sm text-[var(--muted-text)]">
						No accessible projects yet.
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
