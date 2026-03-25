import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import type { ProjectStatusDefinition } from "#/features/tasker/projectStatuses";

type ProjectStatusDeleteDialogProps = {
	description?: string | null;
	isDeleting?: boolean;
	onCancel: () => void;
	onConfirm: () => void | Promise<void>;
	onTransferStatusChange: (value: string) => void;
	open: boolean;
	status?: ProjectStatusDefinition | null;
	transferStatusKey: string;
	transferStatusOptions: ProjectStatusDefinition[];
};

export function ProjectStatusDeleteDialog({
	description,
	isDeleting = false,
	onCancel,
	onConfirm,
	onTransferStatusChange,
	open,
	status,
	transferStatusKey,
	transferStatusOptions,
}: ProjectStatusDeleteDialogProps) {
	if (!open || !status) {
		return null;
	}

	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Delete ${status.name} status`}
				className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<div className="space-y-2">
					<h2 className="m-0 text-base font-semibold text-[var(--text)]">
						Delete {status.name}
					</h2>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Choose where existing tasks in this status should move before the
						status is removed from the project workflow.
					</p>
				</div>

				<div className="mt-4 space-y-2">
					<Label htmlFor="project-status-transfer-target">Move tasks to</Label>
					<Select
						id="project-status-transfer-target"
						value={transferStatusKey}
						onChange={(event) => onTransferStatusChange(event.target.value)}
					>
						{transferStatusOptions.map((option) => (
							<option key={option.key} value={option.key}>
								{option.name}
							</option>
						))}
					</Select>
					{description ? (
						<p className="m-0 text-sm text-[var(--danger)]">{description}</p>
					) : null}
				</div>

				<div className="mt-5 flex items-center justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={onCancel}
						disabled={isDeleting}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant="danger"
						onClick={() => {
							void onConfirm();
						}}
						disabled={isDeleting}
					>
						{isDeleting ? "Deleting..." : "Transfer and delete"}
					</Button>
				</div>
			</div>
		</div>
	);
}
