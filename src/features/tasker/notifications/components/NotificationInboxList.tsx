import { Button } from "#/components/ui/button";
import { formatRelative } from "#/features/tasker/format";
import { cn } from "#/lib/utils";
import type { Id } from "#convex/_generated/dataModel";

export type NotificationListItem = {
	_id: Id<"notifications">;
	body: string;
	createdAt: number;
	isUnread: boolean;
	link: string;
	readAt?: number;
	title: string;
};

export function NotificationInboxList({
	emptyMessage,
	notifications,
	onMarkRead,
	onOpen,
}: {
	emptyMessage: string;
	notifications: NotificationListItem[];
	onMarkRead: (notificationId: string) => void;
	onOpen: (notification: NotificationListItem) => void;
}) {
	return notifications.length ? (
		<div className="space-y-2">
			{notifications.map((notification) => (
				<div
					key={notification._id}
					className={cn(
						"issue-row items-start gap-3",
						notification.isUnread
							? "border-[var(--accent)]/30 bg-[color-mix(in_oklab,var(--accent)_8%,var(--surface))]"
							: "",
					)}
				>
					<button
						type="button"
						className="min-w-0 flex-1 text-left"
						onClick={() => onOpen(notification)}
					>
						<div className="flex items-center gap-2">
							<p className="m-0 text-sm font-medium text-[var(--text)]">
								{notification.title}
							</p>
							{notification.isUnread ? (
								<span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
							) : null}
						</div>
						<p className="m-0 mt-1 text-sm text-[var(--muted-text)]">
							{notification.body}
						</p>
						<p className="m-0 mt-2 text-xs text-[var(--muted-text)]">
							{formatRelative(notification.createdAt)}
						</p>
					</button>
					{notification.isUnread ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="shrink-0"
							onClick={() => onMarkRead(notification._id)}
						>
							Mark read
						</Button>
					) : null}
				</div>
			))}
		</div>
	) : (
		<p className="m-0 text-sm text-[var(--muted-text)]">{emptyMessage}</p>
	);
}
