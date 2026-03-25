import { UserPlus, Users } from "lucide-react";
import { Button } from "#/components/ui/button";

type ProjectMemberRow = {
	membership: {
		_id: string;
	};
	user: {
		_id: string;
		email: string;
		imageUrl?: string | null;
		name: string;
	};
};

type ProjectMembersDialogProps = {
	canManageMembers: boolean;
	createdBy: string;
	memberRows: ProjectMemberRow[];
	onClose: () => void;
	onInviteMembers: () => void;
	onRemoveMember: (member: { id: string; name: string }) => void;
	open: boolean;
};

export function ProjectMembersDialog({
	canManageMembers,
	createdBy,
	memberRows,
	onClose,
	onInviteMembers,
	onRemoveMember,
	open,
}: ProjectMembersDialogProps) {
	if (!open) {
		return null;
	}

	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Project members"
				className="w-full max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 className="m-0 flex items-center gap-2 text-base font-semibold text-[var(--text)]">
						<Users className="h-4 w-4" />
						Members ({memberRows.length})
					</h2>
					<div className="flex items-center gap-2">
						{canManageMembers ? (
							<Button size="sm" variant="secondary" onClick={onInviteMembers}>
								<UserPlus className="mr-1.5 h-3.5 w-3.5" />
								Invite members
							</Button>
						) : null}
						<Button size="sm" variant="ghost" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>

				<div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
					{memberRows.map((row) => (
						<div
							key={row.membership._id}
							className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2"
						>
							<div className="flex items-center gap-3">
								<div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-muted)] text-[11px] font-semibold text-[var(--muted-text)]">
									{row.user.imageUrl ? (
										<img
											src={row.user.imageUrl}
											alt={row.user.name}
											className="h-full w-full object-cover"
										/>
									) : (
										row.user.name.slice(0, 2).toUpperCase()
									)}
								</div>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{row.user.name}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										{row.user.email}
									</p>
								</div>
							</div>
							{canManageMembers && row.user._id !== createdBy ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										onRemoveMember({
											id: row.user._id,
											name: row.user.name,
										})
									}
								>
									Remove
								</Button>
							) : null}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
