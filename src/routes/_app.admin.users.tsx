import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

export const Route = createFileRoute("/_app/admin/users")({
	component: AdminUsersPage,
});

function AdminUsersPage() {
	const me = useQuery(api.users.me);

	const [search, setSearch] = useState("");
	const [role, setRole] = useState("");
	const [isActive, setIsActive] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | null>(
		null,
	);

	const users = useQuery(api.users.list, {
		search: search || undefined,
		role: (role || undefined) as "admin" | "member" | "viewer" | undefined,
		isActive: isActive === "" ? undefined : isActive === "true",
	});

	const memberships = useQuery(
		api.users.memberships,
		selectedUserId ? { userId: selectedUserId } : "skip",
	);

	const updateRole = useMutation(api.users.updateRole);
	const setActive = useMutation(api.users.setActive);

	if (me && me.globalRole !== "admin") {
		return <Navigate to="/unauthorized" />;
	}

	return (
		<div>
			<PageHeader
				title="User Management"
				description="Admin-only controls for global roles, account state, and project memberships."
			/>

			<Card className="mb-4">
				<CardContent className="grid gap-2 p-4 md:grid-cols-4">
					<Input
						placeholder="Search users"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<Select
						value={role}
						onChange={(event) => setRole(event.target.value)}
					>
						<option value="">All roles</option>
						<option value="admin">Admin</option>
						<option value="member">Member</option>
						<option value="viewer">Viewer</option>
					</Select>
					<Select
						value={isActive}
						onChange={(event) => setIsActive(event.target.value)}
					>
						<option value="">All status</option>
						<option value="true">Active</option>
						<option value="false">Inactive</option>
					</Select>
					<div className="flex items-center text-xs text-[var(--muted-text)]">
						{users ? `${users.length} users` : "Loading..."}
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>Users</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{(users ?? []).map((user) => (
							<div
								key={user._id}
								className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3"
							>
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="m-0 text-sm font-medium text-[var(--text)]">
											{user.name}
										</p>
										<p className="m-0 text-xs text-[var(--muted-text)]">
											{user.email}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Badge>{user.isActive ? "Active" : "Inactive"}</Badge>
										<Select
											className="w-32"
											value={user.globalRole}
											onChange={(event) =>
												updateRole({
													userId: user._id,
													role: event.target.value as
														| "admin"
														| "member"
														| "viewer",
												})
											}
										>
											<option value="admin">Admin</option>
											<option value="member">Member</option>
											<option value="viewer">Viewer</option>
										</Select>
										<Button
											size="sm"
											variant="secondary"
											onClick={() =>
												setActive({
													userId: user._id,
													isActive: !user.isActive,
												})
											}
										>
											{user.isActive ? "Deactivate" : "Activate"}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => setSelectedUserId(user._id)}
										>
											Inspect
										</Button>
									</div>
								</div>
							</div>
						))}
						{!users?.length ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No users found.
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Memberships</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{!selectedUserId ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								Select a user to inspect memberships.
							</p>
						) : null}

						{selectedUserId && !memberships ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								Loading memberships…
							</p>
						) : null}

						{(memberships ?? []).map((row) => (
							<Link
								key={row.membership._id}
								to="/projects/$projectId"
								params={{ projectId: row.project._id }}
								className="issue-row"
							>
								<div>
									<p className="m-0 text-sm font-medium text-[var(--text)]">
										{row.project.name}
									</p>
									<p className="m-0 text-xs text-[var(--muted-text)]">
										{row.project.key}
									</p>
								</div>
								<Badge>{row.project.archived ? "Archived" : "Active"}</Badge>
							</Link>
						))}
						{selectedUserId && memberships?.length === 0 ? (
							<p className="m-0 text-sm text-[var(--muted-text)]">
								No memberships.
							</p>
						) : null}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
