import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/unauthorized")({
	component: UnauthorizedPage,
});

function UnauthorizedPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
			<ShieldAlert className="h-12 w-12 text-[var(--muted-text)]" />
			<h1 className="m-0 text-2xl font-semibold">Access denied</h1>
			<p className="m-0 text-sm text-[var(--muted-text)]">
				You do not have permission to access this area.
			</p>
			<Link to="/dashboard" className="no-underline">
				<Button>Back to dashboard</Button>
			</Link>
		</main>
	);
}
