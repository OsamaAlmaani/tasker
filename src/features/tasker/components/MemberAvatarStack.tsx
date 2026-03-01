type MemberAvatar = {
	_id: string;
	name: string;
	imageUrl?: string;
};

function initials(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
	}
	return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function MemberAvatarStack({
	members,
	maxVisible = 5,
}: {
	members: MemberAvatar[];
	maxVisible?: number;
}) {
	const visible = members.slice(0, maxVisible);
	const extra = Math.max(0, members.length - visible.length);

	return (
		<div className="flex items-center">
			<div className="flex -space-x-2">
				{visible.map((member) => (
					<div
						key={member._id}
						title={member.name}
						className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-muted)] text-[10px] font-semibold text-[var(--muted-text)]"
					>
						{member.imageUrl ? (
							<img
								src={member.imageUrl}
								alt={member.name}
								className="h-full w-full object-cover"
							/>
						) : (
							initials(member.name)
						)}
					</div>
				))}
				{extra > 0 ? (
					<div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[10px] font-semibold text-[var(--muted-text)]">
						+{extra}
					</div>
				) : null}
			</div>
		</div>
	);
}
