import { useAction, useMutation, useQuery } from "convex/react";
import { AlertTriangle, KeyRound, Unplug } from "lucide-react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { formatRelative } from "#/features/tasker/format";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import { GitHubAvatar } from "./GitHubBadges";

const TOKEN_HELP_URL = "https://github.com/settings/personal-access-tokens/new";

/** The signed-in user's own GitHub personal access token. */
export function GitHubAccountCard({ className }: { className?: string }) {
	const state = useQuery(api.github.getAccount);
	const connectAccount = useAction(api.githubActions.connectAccount);
	const disconnectAccount = useMutation(api.github.disconnectAccount);
	const [token, setToken] = useState("");
	const [showTokenForm, setShowTokenForm] = useState(false);
	const [isWorking, setIsWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);

	if (state === undefined) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle>Your GitHub account</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="m-0 text-sm text-[var(--muted-text)]">Loading…</p>
				</CardContent>
			</Card>
		);
	}

	const { account, encryptionConfigured } = state;

	async function handleTokenSubmit(event: React.FormEvent) {
		event.preventDefault();
		setIsWorking(true);
		setError(null);
		try {
			await connectAccount({ token });
			setToken("");
			setShowTokenForm(false);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not connect GitHub."));
		} finally {
			setIsWorking(false);
		}
	}

	async function handleDisconnect() {
		setIsWorking(true);
		setError(null);
		try {
			await disconnectAccount({});
			setConfirmDisconnect(false);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not remove the token."));
		} finally {
			setIsWorking(false);
		}
	}

	const tokenForm = (
		<form className="space-y-2" onSubmit={handleTokenSubmit}>
			<Label htmlFor="github-token">Personal access token</Label>
			<Input
				id="github-token"
				type="password"
				autoComplete="off"
				spellCheck={false}
				placeholder="github_pat_… or ghp_…"
				value={token}
				onChange={(event) => setToken(event.target.value)}
			/>
			<p className="m-0 text-xs text-[var(--muted-text)]">
				Create a{" "}
				<a href={TOKEN_HELP_URL} target="_blank" rel="noreferrer">
					fine-grained token
				</a>{" "}
				for the repositories you work on, with read and write access to{" "}
				<em>Pull requests</em>, <em>Contents</em> and <em>Actions</em>, and read
				access to <em>Commit statuses</em>. A classic token needs the{" "}
				<code>repo</code> scope. Tasker encrypts the token and never shows it
				again.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					disabled={!token.trim() || isWorking || !encryptionConfigured}
				>
					{isWorking ? "Connecting…" : "Save token"}
				</Button>
				{account ? (
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setShowTokenForm(false);
							setToken("");
						}}
					>
						Cancel
					</Button>
				) : null}
			</div>
		</form>
	);

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Your GitHub account</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{!encryptionConfigured ? (
					<div className="flex items-start gap-3 rounded-md border border-[var(--line)] p-3">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Server setup required: set{" "}
							<code>GITHUB_TOKEN_ENCRYPTION_KEY</code> on the Convex deployment
							before adding a token.
						</p>
					</div>
				) : null}
				{account ? (
					<>
						<div className="flex items-center gap-3">
							<GitHubAvatar
								login={account.login}
								avatarUrl={account.avatarUrl}
								size={40}
							/>
							<div className="min-w-0">
								<p className="m-0 text-sm font-medium">
									{account.profileUrl ? (
										<a
											href={account.profileUrl}
											target="_blank"
											rel="noreferrer"
										>
											@{account.login}
										</a>
									) : (
										`@${account.login}`
									)}
								</p>
								<p className="m-0 text-xs text-[var(--muted-text)]">
									Personal access token · updated{" "}
									{formatRelative(account.updatedAt)}
								</p>
							</div>
						</div>
						{account.scopes.length ? (
							<div className="flex flex-wrap gap-1">
								{account.scopes.map((scope) => (
									<Badge key={scope}>{scope}</Badge>
								))}
							</div>
						) : null}
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Only you use this token, in every project. Pull requests show what
							it can access, and your merges, reviews and comments appear on
							GitHub as <strong>@{account.login}</strong>.
						</p>
						{showTokenForm ? (
							tokenForm
						) : (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="secondary"
									onClick={() => setShowTokenForm(true)}
									disabled={isWorking}
								>
									<KeyRound className="mr-2 h-4 w-4" />
									Replace token
								</Button>
								<Button
									variant="ghost"
									onClick={() => setConfirmDisconnect(true)}
									disabled={isWorking}
								>
									<Unplug className="mr-2 h-4 w-4" />
									Remove token
								</Button>
							</div>
						)}
					</>
				) : (
					<>
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Add your own GitHub personal access token to see and work on pull
							requests. It is used only for your requests, in every project.
						</p>
						{tokenForm}
					</>
				)}
				{error ? (
					<p className="m-0 text-sm text-[var(--danger)]" role="alert">
						{error}
					</p>
				) : null}
			</CardContent>
			<ConfirmDialog
				open={confirmDisconnect}
				title="Remove your GitHub token?"
				description="Tasker deletes your stored token. Pull request pages stop working for you until you add a token again. Other members are not affected. To fully revoke it, also delete the token on GitHub."
				confirmLabel="Remove"
				confirmingLabel="Removing…"
				isConfirming={isWorking}
				onConfirm={handleDisconnect}
				onCancel={() => setConfirmDisconnect(false)}
			/>
		</Card>
	);
}
