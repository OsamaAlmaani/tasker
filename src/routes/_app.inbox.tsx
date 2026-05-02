import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import {
	NotificationInboxList,
	type NotificationListItem,
} from "#/features/tasker/notifications/components/NotificationInboxList";
import { api } from "#convex/_generated/api";

export const Route = createFileRoute("/_app/inbox")({
	component: InboxPage,
});

function InboxPage() {
	const navigate = useNavigate();
	const notifications =
		useQuery(api.notifications.list, {
			limit: 100,
		}) ?? [];
	const markRead = useMutation(api.notifications.markRead);
	const markAllRead = useMutation(api.notifications.markAllRead);
	const unreadCount = notifications.filter(
		(notification) => notification.isUnread,
	).length;

	function openNotification(notification: NotificationListItem) {
		if (notification.isUnread) {
			void markRead({ notificationId: notification._id });
		}
		void navigate({ to: notification.link as never });
	}

	return (
		<div>
			<PageHeader
				title="Inbox"
				description="Keep track of task assignments and unread notifications."
				actions={
					unreadCount ? (
						<Button
							type="button"
							variant="secondary"
							onClick={() => void markAllRead({})}
						>
							Mark all read
						</Button>
					) : null
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Notifications</CardTitle>
				</CardHeader>
				<CardContent>
					<NotificationInboxList
						emptyMessage="No notifications yet."
						notifications={notifications}
						onMarkRead={(notificationId) => void markRead({ notificationId })}
						onOpen={openNotification}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
