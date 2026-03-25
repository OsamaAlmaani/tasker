import { Archive, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { IssueStatusBadge } from "#/features/tasker/components/IssueBadges";
import {
	appendProjectStatus,
	isLockedProjectStatusKey,
	moveProjectStatus,
	type ProjectStatusDefinition,
	removeProjectStatus,
} from "#/features/tasker/projectStatuses";

export type ProjectSettingsForm = {
	name: string;
	description: string;
	color: string;
	icon: string;
	statuses: ProjectStatusDefinition[];
	allowMemberInvites: boolean;
	allowIssueDelete: boolean;
};

type ProjectSettingsCardProps = {
	archived: boolean;
	form: ProjectSettingsForm;
	onArchiveClick: () => void;
	onRequestDeleteStatus: (statusKey: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	open: boolean;
	persistedStatusKeys: Set<string>;
	setForm: Dispatch<SetStateAction<ProjectSettingsForm>>;
};

export function ProjectSettingsCard({
	archived,
	form,
	onArchiveClick,
	onRequestDeleteStatus,
	onSubmit,
	open,
	persistedStatusKeys,
	setForm,
}: ProjectSettingsCardProps) {
	if (!open) {
		return null;
	}

	function updateStatusName(key: ProjectStatusDefinition["key"], name: string) {
		setForm((previous) => ({
			...previous,
			statuses: previous.statuses.map((status) =>
				status.key === key ? { ...status, name } : status,
			),
		}));
	}

	function moveStatus(
		key: ProjectStatusDefinition["key"],
		direction: "up" | "down",
	) {
		setForm((previous) => ({
			...previous,
			statuses: moveProjectStatus(previous.statuses, key, direction),
		}));
	}

	function addStatus() {
		setForm((previous) => ({
			...previous,
			statuses: appendProjectStatus(previous.statuses),
		}));
	}

	function updateStatusColor(
		key: ProjectStatusDefinition["key"],
		color: string,
	) {
		setForm((previous) => ({
			...previous,
			statuses: previous.statuses.map((status) =>
				status.key === key ? { ...status, color } : status,
			),
		}));
	}

	function deleteStatus(key: string) {
		if (persistedStatusKeys.has(key)) {
			onRequestDeleteStatus(key);
			return;
		}

		setForm((previous) => ({
			...previous,
			statuses: removeProjectStatus(previous.statuses, key),
		}));
	}

	return (
		<Card className="mb-4">
			<CardHeader>
				<CardTitle>Project Settings</CardTitle>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
					<div>
						<Label>Name</Label>
						<Input
							value={form.name}
							onChange={(event) =>
								setForm((previous) => ({
									...previous,
									name: event.target.value,
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
								setForm((previous) => ({
									...previous,
									color: event.target.value,
								}))
							}
						/>
					</div>
					<div className="md:col-span-2">
						<Label>Description</Label>
						<Textarea
							value={form.description}
							onChange={(event) =>
								setForm((previous) => ({
									...previous,
									description: event.target.value,
								}))
							}
						/>
					</div>
					<div className="md:col-span-2 space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
						<div className="space-y-1">
							<Label>Workflow</Label>
							<p className="m-0 text-sm text-[var(--muted-text)]">
								Keep `Todo` and `Done` fixed. Add, rename, reorder, and delete
								other statuses as your project workflow evolves.
							</p>
						</div>
						<div className="space-y-2">
							{form.statuses.map((status, index) =>
								(() => {
									const locked = isLockedProjectStatusKey(status.key);
									return (
										<div
											key={status.key}
											className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[120px_1fr_72px_auto]"
										>
											<div>
												<p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
													{locked ? "Fixed" : "Custom"}
												</p>
												<div className="mt-2">
													<IssueStatusBadge
														color={status.color}
														label={status.name}
														status={status.key}
													/>
												</div>
											</div>
											<Input
												value={status.name}
												disabled={locked}
												onChange={(event) =>
													updateStatusName(status.key, event.target.value)
												}
											/>
											<Input
												type="color"
												value={status.color}
												disabled={locked}
												className="h-10 rounded-lg p-1"
												aria-label={`Set ${status.name} color`}
												onChange={(event) =>
													updateStatusColor(status.key, event.target.value)
												}
											/>
											<div className="flex items-center gap-1">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													className="h-8 w-8 p-0"
													disabled={locked || index <= 1}
													onClick={() => moveStatus(status.key, "up")}
													aria-label={`Move ${status.name} up`}
												>
													<ArrowUp className="h-4 w-4" />
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													className="h-8 w-8 p-0"
													disabled={locked || index >= form.statuses.length - 2}
													onClick={() => moveStatus(status.key, "down")}
													aria-label={`Move ${status.name} down`}
												>
													<ArrowDown className="h-4 w-4" />
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													className="h-8 w-8 p-0 text-[var(--danger)]"
													disabled={locked}
													onClick={() => deleteStatus(status.key)}
													aria-label={`Delete ${status.name}`}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</div>
									);
								})(),
							)}
						</div>
						<div>
							<Button type="button" variant="secondary" onClick={addStatus}>
								<Plus className="mr-2 h-4 w-4" />
								Add status
							</Button>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							checked={form.allowMemberInvites}
							onChange={(next) =>
								setForm((previous) => ({
									...previous,
									allowMemberInvites: next,
								}))
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
								setForm((previous) => ({
									...previous,
									allowIssueDelete: next,
								}))
							}
						/>
						<span className="text-sm text-[var(--muted-text)]">
							Allow task deletion
						</span>
					</div>
					<div className="md:col-span-2">
						<Button type="submit">Save project</Button>
					</div>
					<div className="md:col-span-2">
						<div className="flex justify-end border-t border-[var(--line)] pt-3">
							<Button
								type="button"
								variant={archived ? "secondary" : "danger"}
								onClick={onArchiveClick}
							>
								<Archive className="mr-2 h-4 w-4" />
								{archived ? "Unarchive project" : "Archive project"}
							</Button>
						</div>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
