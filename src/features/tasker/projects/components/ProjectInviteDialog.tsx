import { RefreshCw, UserPlus } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { formatRelative } from "#/features/tasker/format";

type InviteCandidate = {
	_id: string;
	email: string;
	name: string;
};

type ProjectInviteRow = {
	invite: {
		_id: string;
		createdAt: number;
		email: string;
		status: string;
	};
};

type ProjectInviteDialogProps = {
	inviteCandidates: InviteCandidate[] | undefined;
	inviteEmail: string;
	inviteError?: string | null;
	inviteMessage?: string | null;
	inviteSearch: string;
	isSendingInvite: boolean;
	onAddMember: (userId: string) => void;
	onClose: () => void;
	onInviteEmailChange: (value: string) => void;
	onInviteSearchChange: (value: string) => void;
	onRevokeInvite: (invite: { id: string; email: string }) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	open: boolean;
	projectInvites: ProjectInviteRow[] | undefined;
};

export function ProjectInviteDialog({
	inviteCandidates,
	inviteEmail,
	inviteError,
	inviteMessage,
	inviteSearch,
	isSendingInvite,
	onAddMember,
	onClose,
	onInviteEmailChange,
	onInviteSearchChange,
	onRevokeInvite,
	onSubmit,
	open,
	projectInvites,
}: ProjectInviteDialogProps) {
	if (!open) {
		return null;
	}

	const pendingInvites = (projectInvites ?? []).filter(
		(row) => row.invite.status === "pending",
	);

	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Invite members"
				className="w-full max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="m-0 flex items-center gap-2 text-base font-semibold text-[var(--text)]">
						<UserPlus className="h-4 w-4" />
						Invite members
					</h2>
					<Button size="sm" variant="ghost" onClick={onClose}>
						Close
					</Button>
				</div>

				<div className="space-y-3">
					<form onSubmit={onSubmit} className="space-y-2">
						<Label>Invite by email</Label>
						<div className="flex gap-2">
							<Input
								type="email"
								value={inviteEmail}
								onChange={(event) => onInviteEmailChange(event.target.value)}
								placeholder="teammate@company.com"
							/>
							<Button
								type="submit"
								size="md"
								variant="secondary"
								className="whitespace-nowrap"
								disabled={isSendingInvite}
							>
								{isSendingInvite ? "Sending..." : "Send invite"}
							</Button>
						</div>
						{inviteError ? (
							<p className="m-0 text-sm text-[var(--danger)]">{inviteError}</p>
						) : null}
						{inviteMessage ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								{inviteMessage}
							</p>
						) : null}
					</form>

					<div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
						<p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)]">
							Pending invites
						</p>
						<div className="space-y-2">
							{pendingInvites.map((row) => (
								<div
									key={row.invite._id}
									className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
								>
									<div>
										<p className="m-0 text-sm font-medium text-[var(--text)]">
											{row.invite.email}
										</p>
										<p className="m-0 text-xs text-[var(--muted-text)]">
											Sent {formatRelative(row.invite.createdAt)}
										</p>
									</div>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() =>
											onRevokeInvite({
												id: row.invite._id,
												email: row.invite.email,
											})
										}
									>
										Revoke
									</Button>
								</div>
							))}
							{!pendingInvites.length ? (
								<p className="m-0 text-sm text-[var(--muted-text)]">
									No pending invites.
								</p>
							) : null}
						</div>
					</div>

					<Label>Add existing users</Label>
					<Input
						value={inviteSearch}
						onChange={(event) => onInviteSearchChange(event.target.value)}
						placeholder="Search users"
					/>
					{(inviteCandidates ?? []).map((user) => (
						<div
							key={user._id}
							className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2"
						>
							<div>
								<p className="m-0 text-sm font-medium text-[var(--text)]">
									{user.name}
								</p>
								<p className="m-0 text-xs text-[var(--muted-text)]">
									{user.email}
								</p>
							</div>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => onAddMember(user._id)}
							>
								<RefreshCw className="mr-1 h-3.5 w-3.5" />
								Add
							</Button>
						</div>
					))}
					{!inviteCandidates?.length ? (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							No invite candidates.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
