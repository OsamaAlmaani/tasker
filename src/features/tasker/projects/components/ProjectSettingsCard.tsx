import { Archive, ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import {
	IssueLabelBadge,
	IssueStatusBadge,
} from "#/features/tasker/components/IssueBadges";
import {
	appendProjectCustomField,
	moveProjectCustomField,
	type ProjectCustomFieldDefinition,
	type ProjectCustomFieldType,
	removeProjectCustomField,
} from "#/features/tasker/projectCustomFields";
import {
	appendProjectLabel,
	type ProjectLabelDefinition,
	removeProjectLabel,
} from "#/features/tasker/projectLabels";
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
	customFields: ProjectCustomFieldDefinition[];
	labels: ProjectLabelDefinition[];
	statuses: ProjectStatusDefinition[];
	allowMemberInvites: boolean;
	allowIssueDelete: boolean;
};

type ProjectSettingsCardProps = {
	archived: boolean;
	error?: string | null;
	form: ProjectSettingsForm;
	onClose: () => void;
	onArchiveClick: () => void;
	onRequestDeleteStatus: (statusKey: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	open: boolean;
	persistedStatusKeys: Set<string>;
	setForm: Dispatch<SetStateAction<ProjectSettingsForm>>;
};

export function ProjectSettingsCard({
	archived,
	error,
	form,
	onClose,
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

	function updateLabelName(key: ProjectLabelDefinition["key"], name: string) {
		setForm((previous) => ({
			...previous,
			labels: previous.labels.map((label) =>
				label.key === key ? { ...label, name } : label,
			),
		}));
	}

	function updateLabelColor(key: ProjectLabelDefinition["key"], color: string) {
		setForm((previous) => ({
			...previous,
			labels: previous.labels.map((label) =>
				label.key === key ? { ...label, color } : label,
			),
		}));
	}

	function addLabel() {
		setForm((previous) => ({
			...previous,
			labels: appendProjectLabel(previous.labels),
		}));
	}

	function deleteLabel(key: string) {
		setForm((previous) => ({
			...previous,
			labels: removeProjectLabel(previous.labels, key),
		}));
	}

	function updateCustomFieldName(
		key: ProjectCustomFieldDefinition["key"],
		name: string,
	) {
		setForm((previous) => ({
			...previous,
			customFields: previous.customFields.map((field) =>
				field.key === key ? { ...field, name } : field,
			),
		}));
	}

	function updateCustomFieldType(
		key: ProjectCustomFieldDefinition["key"],
		type: ProjectCustomFieldType,
	) {
		setForm((previous) => ({
			...previous,
			customFields: previous.customFields.map((field) =>
				field.key === key
					? {
							...field,
							type,
							options:
								type === "select"
									? field.options?.length
										? field.options
										: ["Option 1", "Option 2"]
									: undefined,
						}
					: field,
			),
		}));
	}

	function updateCustomFieldOptions(
		key: ProjectCustomFieldDefinition["key"],
		optionsValue: string,
	) {
		setForm((previous) => ({
			...previous,
			customFields: previous.customFields.map((field) =>
				field.key === key
					? {
							...field,
							options: optionsValue
								.split(",")
								.map((option) => option.trim())
								.filter(Boolean),
						}
					: field,
			),
		}));
	}

	function moveCustomField(
		key: ProjectCustomFieldDefinition["key"],
		direction: "up" | "down",
	) {
		setForm((previous) => ({
			...previous,
			customFields: moveProjectCustomField(
				previous.customFields,
				key,
				direction,
			),
		}));
	}

	function addCustomField(type: ProjectCustomFieldType = "text") {
		setForm((previous) => ({
			...previous,
			customFields: appendProjectCustomField(previous.customFields, type),
		}));
	}

	function deleteCustomField(key: string) {
		setForm((previous) => ({
			...previous,
			customFields: removeProjectCustomField(previous.customFields, key),
		}));
	}

	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
			<Card className="w-full max-w-5xl">
				<CardHeader className="border-b border-[var(--line)]">
					<div className="flex items-center justify-between gap-3">
						<div>
							<CardTitle>Project Settings</CardTitle>
							<p className="m-0 mt-1 text-sm text-[var(--muted-text)]">
								Manage project details, workflow, labels, and permissions
								without leaving the task view.
							</p>
						</div>
						<Button type="button" size="sm" variant="ghost" onClick={onClose}>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={onSubmit}
						className="grid max-h-[80vh] gap-4 overflow-y-auto pb-2 pr-2 md:grid-cols-2"
					>
						{error ? (
							<p className="m-0 text-sm text-[var(--danger)] md:col-span-2">
								{error}
							</p>
						) : null}
						<div className="md:col-span-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
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
								<Label>Accent</Label>
								<div className="flex items-center gap-3">
									<span
										className="h-5 w-5 rounded-full border border-[var(--line)]"
										style={{ backgroundColor: form.color }}
										aria-hidden="true"
									/>
									<Input
										type="color"
										value={form.color}
										className="h-10 w-16 rounded-full p-1"
										onChange={(event) =>
											setForm((previous) => ({
												...previous,
												color: event.target.value,
											}))
										}
									/>
								</div>
							</div>
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
									Keep `Todo` and `Done` fixed. Add, rename, recolor, reorder,
									and delete other statuses as your project workflow evolves.
								</p>
							</div>
							<div className="space-y-2">
								{form.statuses.map((status, index) =>
									(() => {
										const locked = isLockedProjectStatusKey(status.key);
										return (
											<div
												key={status.key}
												className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[1fr_72px_auto]"
											>
												<div className="flex items-center gap-3">
													<Input
														value={status.name}
														disabled={locked}
														onChange={(event) =>
															updateStatusName(status.key, event.target.value)
														}
													/>
													<IssueStatusBadge
														color={status.color}
														label={status.name}
														status={status.key}
													/>
												</div>
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
														disabled={
															locked || index >= form.statuses.length - 2
														}
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
						<div className="md:col-span-2 space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
							<div className="space-y-1">
								<Label>Labels</Label>
								<p className="m-0 text-sm text-[var(--muted-text)]">
									Create project-scoped labels once, then reuse them across
									tasks. Deleting a label removes it from tasks on save.
								</p>
							</div>
							<div className="space-y-2">
								{form.labels.map((label) => (
									<div
										key={label.key}
										className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[1fr_72px_auto]"
									>
										<div className="flex items-center gap-3">
											<Input
												value={label.name}
												onChange={(event) =>
													updateLabelName(label.key, event.target.value)
												}
											/>
											<IssueLabelBadge color={label.color} label={label.name} />
										</div>
										<Input
											type="color"
											value={label.color}
											className="h-10 rounded-lg p-1"
											aria-label={`Set ${label.name} color`}
											onChange={(event) =>
												updateLabelColor(label.key, event.target.value)
											}
										/>
										<div className="flex items-center justify-end">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-8 w-8 p-0 text-[var(--danger)]"
												onClick={() => deleteLabel(label.key)}
												aria-label={`Delete ${label.name}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
							</div>
							<div>
								<Button type="button" variant="secondary" onClick={addLabel}>
									<Plus className="mr-2 h-4 w-4" />
									Add label
								</Button>
							</div>
						</div>
						<div className="md:col-span-2 space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
							<div className="space-y-1">
								<Label>Custom Fields</Label>
								<p className="m-0 text-sm text-[var(--muted-text)]">
									Define reusable project-specific task fields such as
									environment, QA owner, severity, or sprint.
								</p>
							</div>
							<div className="space-y-2">
								{form.customFields.map((field, index) => (
									<div
										key={field.key}
										className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]"
									>
										<div className="space-y-2">
											<Input
												value={field.name}
												onChange={(event) =>
													updateCustomFieldName(field.key, event.target.value)
												}
											/>
											{field.type === "select" ? (
												<Input
													value={(field.options ?? []).join(", ")}
													placeholder="Option 1, Option 2"
													onChange={(event) =>
														updateCustomFieldOptions(
															field.key,
															event.target.value,
														)
													}
												/>
											) : null}
										</div>
										<Select
											value={field.type}
											onChange={(event) =>
												updateCustomFieldType(
													field.key,
													event.target.value as ProjectCustomFieldType,
												)
											}
										>
											<option value="text">Text</option>
											<option value="number">Number</option>
											<option value="date">Date</option>
											<option value="checkbox">Checkbox</option>
											<option value="select">Select</option>
										</Select>
										<div className="flex items-center gap-1">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-8 w-8 p-0"
												disabled={index === 0}
												onClick={() => moveCustomField(field.key, "up")}
												aria-label={`Move ${field.name} up`}
											>
												<ArrowUp className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-8 w-8 p-0"
												disabled={index >= form.customFields.length - 1}
												onClick={() => moveCustomField(field.key, "down")}
												aria-label={`Move ${field.name} down`}
											>
												<ArrowDown className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-8 w-8 p-0 text-[var(--danger)]"
												onClick={() => deleteCustomField(field.key)}
												aria-label={`Delete ${field.name}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
							</div>
							<div>
								<Button
									type="button"
									variant="secondary"
									onClick={() => addCustomField()}
								>
									<Plus className="mr-2 h-4 w-4" />
									Add custom field
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
						<div className="md:col-span-2 flex items-center justify-between border-t border-[var(--line)] pt-4">
							<Button
								type="button"
								variant={archived ? "secondary" : "danger"}
								onClick={onArchiveClick}
							>
								<Archive className="mr-2 h-4 w-4" />
								{archived ? "Unarchive project" : "Archive project"}
							</Button>
							<div className="flex items-center gap-2">
								<Button type="button" variant="ghost" onClick={onClose}>
									Cancel
								</Button>
								<Button type="submit">Save project</Button>
							</div>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
