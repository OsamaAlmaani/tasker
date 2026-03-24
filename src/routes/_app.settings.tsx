import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { globalRoleLabel } from "#/features/tasker/model";
import { api } from "#convex/_generated/api";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const me = useQuery(api.users.me);
	const seedDemoData = useMutation(api.dev.seedDemoData);
	const [seedResult, setSeedResult] = useState<string | null>(null);

	if (!me) {
		return <div className="page-loading">Loading settings…</div>;
	}

	return (
		<div>
			<PageHeader
				title="Settings"
				description="Profile basics and developer utilities."
			/>

			<Card className="mb-4">
				<CardHeader>
					<CardTitle>Profile</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2">
					<div>
						<Label>Name</Label>
						<Input value={me.name} readOnly />
					</div>
					<div>
						<Label>Email</Label>
						<Input value={me.email} readOnly />
					</div>
					<div>
						<Label>Role</Label>
						<div className="pt-2">
							<Badge>{globalRoleLabel[me.globalRole]}</Badge>
						</div>
					</div>
					<div>
						<Label>Account</Label>
						<p className="m-0 pt-2 text-sm text-[var(--muted-text)]">
							{me.isActive ? "Active account" : "Inactive account"}
						</p>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Developer Helpers</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="mt-0 mb-3 text-sm text-[var(--muted-text)]">
						Seed a sample project/tasks dataset for local testing.
					</p>
					<Button
						variant="secondary"
						onClick={async () => {
							const result = await seedDemoData({});
							setSeedResult(
								result.seeded ? "Demo data seeded." : (result.reason ?? null),
							);
						}}
					>
						Seed demo data
					</Button>
					{seedResult ? (
						<p className="mb-0 mt-2 text-sm text-[var(--muted-text)]">
							{seedResult}
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
