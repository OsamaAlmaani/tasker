import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "#/features/tasker/auth/RequireAuth";
import { AppShell } from "#/features/tasker/layout/AppShell";

export const Route = createFileRoute("/_app")({ component: AppLayout });

function AppLayout() {
	return (
		<RequireAuth>
			<AppShell>
				<Outlet />
			</AppShell>
		</RequireAuth>
	);
}
