import {
	Archive,
	ArchiveRestore,
	ChevronDown,
	Flag,
	ListChecks,
	UserRound,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";
import { cn } from "#/lib/utils";

type AssignableUserOption = {
	_id: string;
	name: string;
};

type IssueBulkActionsBarProps = {
	assignableUsers?: AssignableUserOption[];
	isApplying?: boolean;
	onArchiveChange: (archived: boolean) => void;
	onAssigneeChange?: (assigneeId: string | null) => void;
	onClearSelection: () => void;
	onPriorityChange: (priority: (typeof ISSUE_PRIORITIES)[number]) => void;
	onStatusChange: (status: (typeof ISSUE_STATUSES)[number]) => void;
	selectedCount: number;
};

type BulkMenuOption = {
	description?: string;
	label: string;
	value: string | null;
};

function BulkActionMenu({
	icon,
	isApplying,
	isOpen,
	label,
	onSelect,
	onToggle,
	options,
}: {
	icon: ReactNode;
	isApplying: boolean;
	isOpen: boolean;
	label: string;
	onSelect: (value: string | null) => void;
	onToggle: () => void;
	options: BulkMenuOption[];
}) {
	return (
		<div className="relative">
			<Button
				type="button"
				size="sm"
				variant="secondary"
				disabled={isApplying}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				onClick={onToggle}
				className="h-8 gap-2 rounded-full px-3"
			>
				{icon}
				<span>{label}</span>
				<ChevronDown className="h-3.5 w-3.5 text-[var(--muted-text)]" />
			</Button>

			{isOpen ? (
				<div
					role="menu"
					className="absolute left-0 z-30 mt-2 min-w-[220px] rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_20px_50px_rgba(8,12,26,0.2)] backdrop-blur"
				>
					{options.map((option) => (
						<button
							key={option.value ?? "none"}
							type="button"
							role="menuitem"
							onClick={() => onSelect(option.value)}
							className={cn(
								"flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
								"text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
							)}
						>
							<span className="mt-0.5 h-2 w-2 rounded-full bg-[var(--accent)] opacity-70" />
							<span className="min-w-0">
								<span className="block text-sm font-medium text-[var(--text)]">
									{option.label}
								</span>
								{option.description ? (
									<span className="block text-xs text-[var(--muted-text)]">
										{option.description}
									</span>
								) : null}
							</span>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

export function IssueBulkActionsBar({
	assignableUsers,
	isApplying = false,
	onArchiveChange,
	onAssigneeChange,
	onClearSelection,
	onPriorityChange,
	onStatusChange,
	selectedCount,
}: IssueBulkActionsBarProps) {
	const [openMenu, setOpenMenu] = useState<
		"assignee" | "priority" | "status" | null
	>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!openMenu) {
			return;
		}

		const onDocumentClick = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setOpenMenu(null);
			}
		};

		const onDocumentKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenMenu(null);
			}
		};

		document.addEventListener("mousedown", onDocumentClick);
		document.addEventListener("keydown", onDocumentKeydown);
		return () => {
			document.removeEventListener("mousedown", onDocumentClick);
			document.removeEventListener("keydown", onDocumentKeydown);
		};
	}, [openMenu]);

	function handleAction(action: () => void) {
		action();
		setOpenMenu(null);
	}

	return (
		<div
			ref={menuRef}
			className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-muted)_88%,transparent_12%)] px-3 py-2"
		>
			<div className="mr-1 inline-flex h-8 items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)]">
				{selectedCount} selected
			</div>

			<BulkActionMenu
				icon={<ListChecks className="h-4 w-4" />}
				isApplying={isApplying}
				isOpen={openMenu === "status"}
				label="Status"
				onToggle={() =>
					setOpenMenu((current) => (current === "status" ? null : "status"))
				}
				onSelect={(value) =>
					handleAction(() =>
						onStatusChange(value as (typeof ISSUE_STATUSES)[number]),
					)
				}
				options={ISSUE_STATUSES.map((value) => ({
					value,
					label: issueStatusLabel[value],
				}))}
			/>

			<BulkActionMenu
				icon={<Flag className="h-4 w-4" />}
				isApplying={isApplying}
				isOpen={openMenu === "priority"}
				label="Priority"
				onToggle={() =>
					setOpenMenu((current) => (current === "priority" ? null : "priority"))
				}
				onSelect={(value) =>
					handleAction(() =>
						onPriorityChange(value as (typeof ISSUE_PRIORITIES)[number]),
					)
				}
				options={ISSUE_PRIORITIES.map((value) => ({
					value,
					label: issuePriorityLabel[value],
				}))}
			/>

			{onAssigneeChange ? (
				<BulkActionMenu
					icon={<UserRound className="h-4 w-4" />}
					isApplying={isApplying}
					isOpen={openMenu === "assignee"}
					label="Assignee"
					onToggle={() =>
						setOpenMenu((current) =>
							current === "assignee" ? null : "assignee",
						)
					}
					onSelect={(value) => handleAction(() => onAssigneeChange(value))}
					options={[
						{
							value: null,
							label: "Unassigned",
						},
						...(assignableUsers ?? []).map((user) => ({
							value: user._id,
							label: user.name,
						})),
					]}
				/>
			) : null}

			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={isApplying}
				onClick={() => onArchiveChange(true)}
				className="h-8 gap-2 rounded-full px-3 text-[var(--muted-text)] hover:text-[var(--text)]"
			>
				<Archive className="h-4 w-4" />
				<span>Archive</span>
			</Button>

			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={isApplying}
				onClick={() => onArchiveChange(false)}
				className="h-8 gap-2 rounded-full px-3 text-[var(--muted-text)] hover:text-[var(--text)]"
			>
				<ArchiveRestore className="h-4 w-4" />
				<span>Unarchive</span>
			</Button>

			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={isApplying}
				className="ml-auto h-8 gap-2 rounded-full px-3 text-[var(--muted-text)] hover:text-[var(--text)]"
				onClick={onClearSelection}
			>
				<X className="h-4 w-4" />
				<span>Unselect</span>
			</Button>
		</div>
	);
}
