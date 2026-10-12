import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

export function AgentConnectionCard() {
	const tokens = useQuery(api.agentTokens.list);
	const createToken = useMutation(api.agentTokens.create);
	const revokeToken = useMutation(api.agentTokens.revoke);
	const id = useId();
	const [name, setName] = useState("");
	const [expiryDays, setExpiryDays] = useState("90");
	const [newToken, setNewToken] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [revokingId, setRevokingId] = useState<Id<"agentTokens"> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [endpoint, setEndpoint] = useState("");
	useEffect(() => {
		setEndpoint(new URL("/mcp", window.location.origin).href);
	}, []);
	const config = JSON.stringify(
		{
			mcpServers: {
				tasker: {
					url: endpoint,
					headers: {
						Authorization: `Bearer ${newToken ?? "YOUR_AGENT_TOKEN"}`,
					},
				},
			},
		},
		null,
		2,
	);

	async function create() {
		if (pending) return;
		setPending(true);
		setError(null);
		setNewToken(null);
		setNotice(null);
		try {
			const bytes = crypto.getRandomValues(new Uint8Array(32));
			const token = `tsk_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
			await createToken({
				name: name.trim(),
				token,
				expiresAt: Date.now() + Number(expiryDays) * 86400000,
			});
			setNewToken(token);
			setName("");
		} catch (cause) {
			setError(
				getClientErrorMessage(cause, "Could not create an agent token."),
			);
		} finally {
			setPending(false);
		}
	}

	async function revoke(tokenId: Id<"agentTokens">) {
		setRevokingId(tokenId);
		setError(null);
		try {
			await revokeToken({ tokenId });
			// Clear any displayed secret; the revoked row may be the newly created token.
			setNewToken(null);
			setNotice("Token revoked. Agents using it can no longer access Tasker.");
		} catch (cause) {
			setError(getClientErrorMessage(cause, "Could not revoke the token."));
		} finally {
			setRevokingId(null);
		}
	}

	return (
		<Card className="mb-4">
			<CardHeader>
				<CardTitle>Agent connection</CardTitle>
			</CardHeader>
			<CardContent className="space-y-5">
				<div>
					<p className="mt-0 mb-2 text-sm">
						Let your agent pick up tasks and send its finished work for review.
					</p>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Agents can read tasks assigned to you, other people, or nobody in
						projects you can access. Your current role controls what they can
						change. Task assignees stay the same.
					</p>
				</div>
				<form
					className="grid items-end gap-3 md:grid-cols-[1fr_auto_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<div className="space-y-1">
						<label
							className="text-xs font-semibold text-[var(--muted-text)]"
							htmlFor={`${id}-name`}
						>
							Token name
						</label>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="My coding agent"
							maxLength={100}
							required
							disabled={pending}
						/>
					</div>
					<div className="space-y-1">
						<label
							className="text-xs font-semibold text-[var(--muted-text)]"
							htmlFor={`${id}-expiry`}
						>
							Expires after
						</label>
						<Select
							id={`${id}-expiry`}
							value={expiryDays}
							onChange={(event) => setExpiryDays(event.target.value)}
							disabled={pending}
						>
							<option value="30">30 days</option>
							<option value="90">90 days</option>
							<option value="365">1 year</option>
						</Select>
					</div>
					<Button type="submit" disabled={pending || !name.trim()}>
						{pending ? "Creating…" : "Create token"}
					</Button>
				</form>
				{error ? (
					<p role="alert" className="m-0 text-sm text-[var(--danger)]">
						{error}
					</p>
				) : null}
				{notice ? (
					<p role="status" className="m-0 text-sm text-[var(--muted-text)]">
						{notice}
					</p>
				) : null}
				{newToken ? (
					<div className="space-y-2 rounded-md border border-[var(--accent)] bg-[var(--surface-muted)] p-4">
						<label
							className="text-xs font-semibold text-[var(--muted-text)]"
							htmlFor={`${id}-token`}
						>
							New agent token
						</label>
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Copy this token now. It cannot be shown again.
						</p>
						<Input
							id={`${id}-token`}
							value={newToken}
							readOnly
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
						/>
						<div className="flex gap-2">
							<Button
								variant="secondary"
								type="button"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(newToken);
										setNotice("Token copied.");
										setError(null);
									} catch {
										setError(
											"Could not copy. Select and copy the token manually.",
										);
									}
								}}
							>
								Copy token
							</Button>
							<Button
								variant="ghost"
								type="button"
								onClick={() => {
									setNewToken(null);
									setNotice(null);
								}}
							>
								Hide token
							</Button>
						</div>
					</div>
				) : null}
				<div className="space-y-2">
					<label
						className="text-xs font-semibold text-[var(--muted-text)]"
						htmlFor={`${id}-config`}
					>
						MCP client configuration
					</label>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Connect your agent to this Tasker server using the configuration
						below. No local installation or command-line tools are needed. Your
						agent must support remote MCP with an Authorization header.
					</p>
					<Textarea
						id={`${id}-config`}
						value={config}
						readOnly
						rows={15}
						className="font-mono text-xs"
						spellCheck={false}
					/>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Ask your agent to list tasks, read a task, claim it, do the work,
						then submit a result summary for review. Claims expire after one
						hour and can be renewed. Your agent uses its own tools to perform
						the work.
					</p>
				</div>
				<div>
					<h3 className="mt-0 mb-2 text-sm font-semibold">Your tokens</h3>
					{tokens === undefined ? (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Loading tokens…
						</p>
					) : tokens.length === 0 ? (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							No agent tokens yet.
						</p>
					) : (
						<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
							{tokens.map((token) => {
								const state =
									token.revokedAt !== undefined
										? "Revoked"
										: token.expiresAt !== undefined &&
												token.expiresAt <= Date.now()
											? "Expired"
											: "Active";
								return (
									<li
										key={token._id}
										className="flex flex-wrap items-center justify-between gap-3 py-3"
									>
										<div>
											<p className="m-0 text-sm font-medium">
												{token.name} <Badge>{state}</Badge>
											</p>
											<p className="m-0 mt-1 text-xs text-[var(--muted-text)]">
												{token.tokenPrefix}…
												{token.expiresAt
													? ` · Expires ${new Date(token.expiresAt).toLocaleDateString()}`
													: ""}
											</p>
										</div>
										{state === "Active" ? (
											<Button
												type="button"
												variant="secondary"
												size="sm"
												aria-label={`Revoke ${token.name}`}
												disabled={revokingId !== null}
												onClick={() => void revoke(token._id)}
											>
												{revokingId === token._id ? "Revoking…" : "Revoke"}
											</Button>
										) : null}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
