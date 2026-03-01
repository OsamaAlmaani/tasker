import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "#/components/ui/button";

type ConfirmDialogProps = {
	open: boolean;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	isConfirming?: boolean;
	onConfirm: () => void | Promise<void>;
	onCancel: () => void;
};

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	isConfirming = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	useEffect(() => {
		if (!open) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !isConfirming) {
				onCancel();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, isConfirming, onCancel]);

	if (!open) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,12,26,0.45)] px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<div className="mb-3 flex items-center gap-2">
					<div className="rounded-full border border-[color-mix(in_oklab,var(--danger)_45%,var(--line))] bg-[color-mix(in_oklab,var(--danger)_10%,var(--surface-muted))] p-2 text-[var(--danger)]">
						<AlertTriangle className="h-4 w-4" />
					</div>
					<h2 className="m-0 text-base font-semibold text-[var(--text)]">
						{title}
					</h2>
				</div>

				<p className="m-0 text-sm text-[var(--muted-text)]">{description}</p>

				<div className="mt-5 flex items-center justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={onCancel}
						disabled={isConfirming}
					>
						{cancelLabel}
					</Button>
					<Button
						type="button"
						variant="danger"
						onClick={() => {
							void onConfirm();
						}}
						disabled={isConfirming}
					>
						{isConfirming ? "Deleting..." : confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
