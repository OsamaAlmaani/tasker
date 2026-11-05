import { useMutation } from "convex/react";
import {
	Eye,
	Layers,
	MoreHorizontal,
	Pencil,
	Play,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type {
	WorkflowRun,
	WorkflowSummary,
} from "#convex/lib/githubWorkflowsApi";
import { runVisualState } from "../workflowDisplay";
import { Checkbox, Modal } from "./WorkflowPrimitives";
import { canStart, type WorkflowGroup } from "./WorkflowTable";

export function GroupsPanel({
	groups,
	workflowsById,
	lastRunByWorkflow,
	selected,
	selectedGroupIds,
	onToggleGroup,
	onRunGroup,
	onShowGroup,
	onEdit,
	onNew,
	onDelete,
	canWrite,
	activeGroupFilter,
}: {
	groups: WorkflowGroup[];
	workflowsById: Map<number, WorkflowSummary>;
	lastRunByWorkflow: Map<number, WorkflowRun>;
	selected: Set<number>;
	selectedGroupIds: Set<string>;
	onToggleGroup: (group: WorkflowGroup, checked: boolean) => void;
	onRunGroup: (group: WorkflowGroup) => void;
	onShowGroup: (groupId: string) => void;
	onEdit: (group: WorkflowGroup) => void;
	onNew: () => void;
	onDelete: (group: WorkflowGroup) => void;
	canWrite: boolean;
	activeGroupFilter: string | null;
}) {
	return (
		<section
			aria-labelledby="workflow-groups-title"
			className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]"
		>
			<div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
				<h2
					id="workflow-groups-title"
					className="m-0 flex items-center gap-2 text-sm font-semibold"
				>
					<Layers className="h-4 w-4 text-[var(--muted-text)]" />
					Groups
				</h2>
				{canWrite ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-2"
						onClick={onNew}
					>
						<Plus className="mr-1 h-3.5 w-3.5" />
						New
					</Button>
				) : null}
			</div>
			{groups.length === 0 ? (
				<div className="space-y-3 px-4 py-5 text-sm">
					<p className="m-0 text-[var(--muted-text)]">
						Groups start several workflows in one go, like a release. Put any
						workflow in as many groups as you like.
					</p>
					{canWrite ? (
						<Button size="sm" variant="secondary" onClick={onNew}>
							<Plus className="mr-1.5 h-3.5 w-3.5" />
							Create a group
						</Button>
					) : null}
				</div>
			) : (
				<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
					{groups.map((group) => (
						<GroupRow
							key={group._id}
							group={group}
							workflowsById={workflowsById}
							lastRunByWorkflow={lastRunByWorkflow}
							selected={selected}
							explicitlySelected={selectedGroupIds.has(group._id)}
							onToggle={(checked) => onToggleGroup(group, checked)}
							onRun={() => onRunGroup(group)}
							onShow={() => onShowGroup(group._id)}
							onEdit={() => onEdit(group)}
							onDelete={() => onDelete(group)}
							canWrite={canWrite}
							active={activeGroupFilter === group._id}
						/>
					))}
				</ul>
			)}
			{groups.length && canWrite ? (
				<p className="m-0 border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-[11px] text-[var(--muted-text)]">
					Tick groups and workflows to mix them into one run.
				</p>
			) : null}
		</section>
	);
}

function GroupRow({
	group,
	workflowsById,
	lastRunByWorkflow,
	selected,
	explicitlySelected,
	onToggle,
	onRun,
	onShow,
	onEdit,
	onDelete,
	canWrite,
	active,
}: {
	group: WorkflowGroup;
	workflowsById: Map<number, WorkflowSummary>;
	lastRunByWorkflow: Map<number, WorkflowRun>;
	selected: Set<number>;
	explicitlySelected: boolean;
	onToggle: (checked: boolean) => void;
	onRun: () => void;
	onShow: () => void;
	onEdit: () => void;
	onDelete: () => void;
	canWrite: boolean;
	active: boolean;
}) {
	const members = group.workflows.map((entry) => workflowsById.get(entry.id));
	const startable = members.filter(
		(workflow): workflow is WorkflowSummary =>
			workflow !== undefined && canStart(workflow),
	);
	const missing = members.filter((workflow) => workflow === undefined).length;
	const selectedCount = startable.filter((workflow) =>
		selected.has(workflow.id),
	).length;
	const checked =
		explicitlySelected ||
		(startable.length > 0 && selectedCount === startable.length);
	let failing = 0;
	let running = 0;
	for (const workflow of startable) {
		const last = lastRunByWorkflow.get(workflow.id);
		if (!last) continue;
		const state = runVisualState(last);
		if (state === "failure") failing++;
		if (state === "running" || state === "queued" || state === "waiting")
			running++;
	}

	return (
		<li
			className={cn(
				"group/row flex items-center gap-3 px-4 py-2.5",
				checked && "bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]",
				active && "shadow-[inset_3px_0_0_var(--accent)]",
			)}
		>
			{canWrite ? (
				<Checkbox
					checked={checked}
					indeterminate={!checked && selectedCount > 0}
					disabled={!startable.length}
					label={`Select group ${group.name}`}
					onChange={onToggle}
				/>
			) : null}
			<button
				type="button"
				className="min-w-0 flex-1 text-left"
				onClick={onShow}
				title="Show this group's workflows"
			>
				<span className="block truncate text-sm font-medium text-[var(--text)]">
					{group.name}
				</span>
				<span className="block truncate text-xs text-[var(--muted-text)]">
					{group.workflows.length}{" "}
					{group.workflows.length === 1 ? "workflow" : "workflows"}
					{running ? (
						<span className="text-amber-600 dark:text-amber-400">
							{" "}
							· {running} running
						</span>
					) : null}
					{failing ? (
						<span className="text-rose-600 dark:text-rose-400">
							{" "}
							· {failing} failing
						</span>
					) : null}
					{missing ? ` · ${missing} gone` : ""}
				</span>
			</button>
			{canWrite ? (
				<button
					type="button"
					className="rounded-md p-1.5 text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:opacity-30"
					onClick={onRun}
					disabled={!startable.length}
					title={`Run ${group.name}`}
					aria-label={`Run ${group.name}`}
				>
					<Play className="h-4 w-4" />
				</button>
			) : null}
			<GroupMenu
				canWrite={canWrite}
				onShow={onShow}
				onEdit={onEdit}
				onDelete={onDelete}
				name={group.name}
			/>
		</li>
	);
}

function GroupMenu({
	canWrite,
	onShow,
	onEdit,
	onDelete,
	name,
}: {
	canWrite: boolean;
	onShow: () => void;
	onEdit: () => void;
	onDelete: () => void;
	name: string;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	const item =
		"flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]";
	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				className="rounded-md p-1.5 text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
				aria-label={`More for ${name}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<MoreHorizontal className="h-4 w-4" />
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] py-1 shadow-lg"
				>
					<button
						type="button"
						role="menuitem"
						className={item}
						onClick={() => {
							setOpen(false);
							onShow();
						}}
					>
						<Eye className="h-3.5 w-3.5" />
						Show workflows
					</button>
					{canWrite ? (
						<>
							<button
								type="button"
								role="menuitem"
								className={item}
								onClick={() => {
									setOpen(false);
									onEdit();
								}}
							>
								<Pencil className="h-3.5 w-3.5" />
								Edit group
							</button>
							<button
								type="button"
								role="menuitem"
								className={cn(item, "text-[var(--danger)]")}
								onClick={() => {
									setOpen(false);
									onDelete();
								}}
							>
								<Trash2 className="h-3.5 w-3.5" />
								Delete group
							</button>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export type GroupDraft = {
	groupId: string | null;
	name: string;
	workflowIds: number[];
};

export function GroupEditorDialog({
	projectId,
	draft,
	workflows,
	onClose,
	onSaved,
}: {
	projectId: Id<"projects">;
	draft: GroupDraft | null;
	workflows: WorkflowSummary[];
	onClose: () => void;
	onSaved: (groupId: string) => void;
}) {
	const saveGroup = useMutation(api.githubWorkflowGroups.saveGroup);
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<Set<number>>(new Set());
	const [search, setSearch] = useState("");
	const [onlyPicked, setOnlyPicked] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const fieldId = useId();

	useEffect(() => {
		if (!draft) return;
		setName(draft.name);
		setPicked(new Set(draft.workflowIds));
		setSearch("");
		setOnlyPicked(false);
		setError(null);
	}, [draft]);

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return workflows.filter(
			(workflow) =>
				(!onlyPicked || picked.has(workflow.id)) &&
				(!needle ||
					workflow.name.toLowerCase().includes(needle) ||
					workflow.path.toLowerCase().includes(needle)),
		);
	}, [workflows, search, onlyPicked, picked]);
	const allVisiblePicked =
		visible.length > 0 && visible.every((workflow) => picked.has(workflow.id));

	async function save() {
		if (!draft) return;
		setSaving(true);
		setError(null);
		try {
			const byId = new Map(
				workflows.map((workflow) => [workflow.id, workflow]),
			);
			const groupId = await saveGroup({
				projectId,
				groupId: (draft.groupId ?? undefined) as
					| Id<"githubWorkflowGroups">
					| undefined,
				name,
				workflows: [...picked].map((id) => ({
					id,
					path: byId.get(id)?.path ?? "",
				})),
			});
			onSaved(groupId);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not save the group."));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal
			open={draft !== null}
			onClose={onClose}
			closeDisabled={saving}
			size="lg"
			initialFocusRef={nameRef}
			title={draft?.groupId ? "Edit group" : "New group"}
			description="Pick any workflows. One workflow can belong to several groups."
			footer={
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-xs text-[var(--muted-text)]">
						{picked.size} {picked.size === 1 ? "workflow" : "workflows"} in this
						group
					</span>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={onClose} disabled={saving}>
							Cancel
						</Button>
						<Button
							onClick={() => void save()}
							disabled={saving || !name.trim() || !picked.size}
						>
							{saving
								? "Saving…"
								: draft?.groupId
									? "Save group"
									: "Create group"}
						</Button>
					</div>
				</div>
			}
		>
			<form
				className="space-y-4 px-5 py-4"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div className="space-y-1.5">
					<label
						htmlFor={`${fieldId}-name`}
						className="block text-sm font-medium"
					>
						Name
					</label>
					<Input
						id={`${fieldId}-name`}
						ref={nameRef}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Backend, Frontends, Nightly…"
						maxLength={80}
					/>
				</div>
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-[200px] flex-1">
							<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-text)]" />
							<Input
								className="pl-9"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Find workflows"
								aria-label="Find workflows"
							/>
						</div>
						<span className="inline-flex items-center gap-2 text-xs text-[var(--muted-text)]">
							<Checkbox
								id={`${fieldId}-only`}
								checked={onlyPicked}
								onChange={setOnlyPicked}
								label="Only show picked workflows"
							/>
							<label htmlFor={`${fieldId}-only`}>Only picked</label>
						</span>
					</div>
					<div className="overflow-hidden rounded-lg border border-[var(--line)]">
						<div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted-text)]">
							<Checkbox
								id={`${fieldId}-all`}
								checked={allVisiblePicked}
								indeterminate={
									!allVisiblePicked &&
									visible.some((workflow) => picked.has(workflow.id))
								}
								disabled={!visible.length}
								label="Pick all shown"
								onChange={(checked) =>
									setPicked((current) => {
										const next = new Set(current);
										for (const workflow of visible) {
											if (checked) next.add(workflow.id);
											else next.delete(workflow.id);
										}
										return next;
									})
								}
							/>
							<label htmlFor={`${fieldId}-all`}>
								{search
									? `All ${visible.length} matching`
									: `All ${visible.length}`}
							</label>
						</div>
						<ul className="m-0 max-h-[46dvh] list-none divide-y divide-[var(--line)] overflow-y-auto p-0">
							{visible.map((workflow) => (
								<li key={workflow.id}>
									<label
										htmlFor={`${fieldId}-${workflow.id}`}
										className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--surface-muted)]"
									>
										<Checkbox
											id={`${fieldId}-${workflow.id}`}
											checked={picked.has(workflow.id)}
											label={workflow.name}
											onChange={(checked) =>
												setPicked((current) => {
													const next = new Set(current);
													if (checked) next.add(workflow.id);
													else next.delete(workflow.id);
													return next;
												})
											}
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm">
												{workflow.name}
											</span>
											<span className="block truncate font-mono text-[11px] text-[var(--muted-text)]">
												{workflow.path.replace(/^\.github\/workflows\//, "")}
												{!canStart(workflow)
													? " · cannot be started by hand"
													: ""}
											</span>
										</span>
									</label>
								</li>
							))}
							{!visible.length ? (
								<li className="px-3 py-6 text-center text-sm text-[var(--muted-text)]">
									No workflows match.
								</li>
							) : null}
						</ul>
					</div>
				</div>
				{error ? (
					<p className="m-0 text-sm text-[var(--danger)]" role="alert">
						{error}
					</p>
				) : null}
				<button
					type="submit"
					className="hidden"
					aria-hidden="true"
					tabIndex={-1}
				/>
			</form>
		</Modal>
	);
}

export function DeleteGroupDialog({
	projectId,
	group,
	onClose,
}: {
	projectId: Id<"projects">;
	group: WorkflowGroup | null;
	onClose: () => void;
}) {
	const deleteGroup = useMutation(api.githubWorkflowGroups.deleteGroup);
	const [busy, setBusy] = useState(false);
	return (
		<ConfirmDialog
			open={group !== null}
			title={`Delete ${group?.name ?? "group"}?`}
			description="The group is removed for everyone on this project. Workflows and past releases are not affected."
			confirmLabel="Delete group"
			confirmingLabel="Deleting…"
			isConfirming={busy}
			onCancel={onClose}
			onConfirm={async () => {
				if (!group) return;
				setBusy(true);
				try {
					await deleteGroup({
						projectId,
						groupId: group._id as Id<"githubWorkflowGroups">,
					});
					onClose();
				} finally {
					setBusy(false);
				}
			}}
		/>
	);
}
