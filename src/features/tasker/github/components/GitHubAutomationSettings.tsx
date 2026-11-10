import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	AlertTriangle,
	Check,
	Copy,
	MessageSquareText,
	Webhook,
	Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { formatRelative } from "#/features/tasker/format";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

type Settings = NonNullable<
	FunctionReturnType<typeof api.githubLinks.getSettings>
>;
type Rule = Settings["rules"][number]["rule"];

const TRIGGER_LABELS: Record<Rule["trigger"], string> = {
	branch_pushed: "Branch named after the task is pushed",
	pr_opened: "Pull request opened or marked ready",
	pr_draft: "Pull request converted to draft",
	pr_merged: "Pull request merged",
	pr_closed: "Pull request closed without merging",
	review_approved: "Review approves the pull request",
	changes_requested: "Review requests changes",
};

function ErrorText({ message }: { message: string | null }) {
	return message ? (
		<p className="m-0 text-sm text-[var(--danger)]" role="alert">
			{message}
		</p>
	) : null;
}

/** Webhook, automation rules, templates and automation identity for a linked repository. */
export function GitHubAutomationSettings({
	projectId,
}: {
	projectId: Id<"projects">;
}) {
	const settings = useQuery(api.githubLinks.getSettings, { projectId });
	if (!settings) return null;
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<WebhookCard projectId={projectId} settings={settings} />
			<IdentityCard projectId={projectId} settings={settings} />
			<RulesCard projectId={projectId} settings={settings} />
			<ReviewTasksCard projectId={projectId} settings={settings} />
			<TemplatesCard projectId={projectId} settings={settings} />
		</div>
	);
}

/** Sync between review conversations tracked as tasks and those tasks. */
function ReviewTasksCard({
	projectId,
	settings,
}: {
	projectId: Id<"projects">;
	settings: Settings;
}) {
	const updateSettings = useMutation(api.githubLinks.updateAutomationSettings);
	const [error, setError] = useState<string | null>(null);
	const [working, setWorking] = useState(false);
	const current = settings.reviewTaskSettings;

	async function save(patch: Partial<typeof current>) {
		setWorking(true);
		setError(null);
		try {
			await updateSettings({
				projectId,
				reviewTaskSettings: { ...current, ...patch },
			});
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not save the setting."));
		} finally {
			setWorking(false);
		}
	}

	const options: Array<{
		key: keyof typeof current;
		label: string;
		description: string;
	}> = [
		{
			key: "completeTaskOnResolve",
			label: "Complete review tasks when their conversation is resolved",
			description:
				"Reopening the conversation moves the task back to the status it had.",
		},
		{
			key: "resolveThreadOnDone",
			label: "Resolve the conversation when its review task is done",
			description:
				"Uses the GitHub token of the person who finished the task. Reopening the task reopens the conversation.",
		},
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<MessageSquareText className="h-4 w-4" />
					Review tasks
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="m-0 text-sm text-[var(--muted-text)]">
					Review conversations tracked as "fix before merge" tasks stay in step
					with GitHub. Follow-up tasks are independent once created.
				</p>
				<ul className="m-0 list-none space-y-3 p-0">
					{options.map((option) => (
						<li key={option.key} className="flex items-start gap-3">
							<Switch
								checked={current[option.key]}
								disabled={!settings.canManage || working}
								onChange={(next) => void save({ [option.key]: next })}
							/>
							<span className="text-sm">
								<span className="block text-[var(--text)]">{option.label}</span>
								<span className="block text-xs text-[var(--muted-text)]">
									{option.description}
								</span>
							</span>
						</li>
					))}
				</ul>
				{settings.webhook?.missingEvents.some((event) =>
					event.startsWith("pull_request_review_"),
				) ? (
					<p className="m-0 text-xs text-amber-700 dark:text-amber-300">
						The webhook does not send every review conversation event yet, so
						resolved conversations and replies only reach Tasker when someone
						opens the pull request here. Update the webhook above.
					</p>
				) : !settings.webhook ? (
					<p className="m-0 text-xs text-[var(--muted-text)]">
						Without a webhook, tasks follow GitHub when someone opens the pull
						request in Tasker.
					</p>
				) : null}
				<ErrorText message={error} />
			</CardContent>
		</Card>
	);
}

function WebhookCard({
	projectId,
	settings,
}: {
	projectId: Id<"projects">;
	settings: Settings;
}) {
	const registerWebhook = useAction(api.githubLinkActions.registerWebhook);
	const createManualWebhook = useAction(
		api.githubLinkActions.createManualWebhook,
	);
	const removeWebhook = useAction(api.githubLinkActions.removeWebhook);
	const updateWebhookEvents = useAction(
		api.githubLinkActions.updateWebhookEvents,
	);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [manual, setManual] = useState<{
		url: string;
		secret: string;
		events: string[];
	} | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const canManage = settings.canManage && settings.viewerConnected;

	async function run(task: () => Promise<unknown>, failure: string) {
		setWorking(true);
		setError(null);
		try {
			await task();
		} catch (caught) {
			setError(getClientErrorMessage(caught, failure));
		} finally {
			setWorking(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Webhook className="h-4 w-4" />
					Webhook
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{!settings.webhookEndpoint ? (
					<p className="m-0 flex items-start gap-2 text-sm text-[var(--muted-text)]">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
						The Convex deployment has no public site URL configured, so GitHub
						cannot reach Tasker. Set <code>CONVEX_SITE_URL</code> or{" "}
						<code>GITHUB_WEBHOOK_URL</code> first.
					</p>
				) : settings.webhook ? (
					<div className="space-y-2 text-sm">
						<p className="m-0 flex flex-wrap items-center gap-2">
							<Badge className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
								<Check className="h-3 w-3" />
								{settings.webhook.hookId
									? "Registered on GitHub"
									: "Manual webhook"}
							</Badge>
							<span className="text-xs text-[var(--muted-text)]">
								{formatRelative(settings.webhook.registeredAt)}
								{settings.webhook.registeredByName
									? ` by ${settings.webhook.registeredByName}`
									: ""}
							</span>
						</p>
						<p className="m-0 text-xs text-[var(--muted-text)]">
							{settings.webhook.lastDeliveryAt
								? `Last delivery ${formatRelative(settings.webhook.lastDeliveryAt)} (${settings.webhook.lastDeliveryEvent ?? "event"}).`
								: "No deliveries yet. GitHub sends a ping right after registration; push a branch or open a pull request to see events."}
						</p>
						{settings.webhook.lastError ? (
							<p className="m-0 text-xs text-[var(--danger)]">
								Last error: {settings.webhook.lastError}
							</p>
						) : null}
						{settings.webhook.missingEvents.length ? (
							<div className="space-y-2 rounded-md border border-amber-300 px-3 py-2 dark:border-amber-800">
								<p className="m-0 flex items-start gap-2 text-xs text-[var(--text)]">
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
									<span>
										This webhook was set up before Tasker handled{" "}
										{settings.webhook.missingEvents
											.map((event) => event.replaceAll("_", " "))
											.join(", ")}{" "}
										events.{" "}
										{settings.webhook.hookId
											? "Update it so resolved review conversations reach Tasker right away."
											: "Tick them in the repository's webhook settings on GitHub, then confirm here."}
									</span>
								</p>
								{canManage ? (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={working}
										onClick={() =>
											void run(
												() => updateWebhookEvents({ projectId }),
												"Could not update the webhook.",
											)
										}
									>
										{settings.webhook.hookId
											? "Update webhook events"
											: "I've added the events"}
									</Button>
								) : null}
							</div>
						) : null}
						{manual ? <ManualSetup manual={manual} /> : null}
						{canManage ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={working}
								onClick={() => setConfirmRemove(true)}
							>
								Remove webhook
							</Button>
						) : null}
					</div>
				) : (
					<div className="space-y-3 text-sm">
						<p className="m-0 text-[var(--muted-text)]">
							With a webhook, pull request pages update live, tasks move
							automatically and review requests, failing checks and merges reach
							the Tasker inbox.
						</p>
						{canManage ? (
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									disabled={working}
									onClick={() =>
										void run(
											() => registerWebhook({ projectId }),
											"Could not register the webhook.",
										)
									}
								>
									Register with my token
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={working}
									onClick={() =>
										void run(
											async () =>
												setManual(await createManualWebhook({ projectId })),
											"Could not prepare manual setup.",
										)
									}
								>
									Set up manually
								</Button>
							</div>
						) : (
							<p className="m-0 text-xs text-[var(--muted-text)]">
								A project member with write access and a GitHub token can
								register the webhook.
							</p>
						)}
						<p className="m-0 text-xs text-[var(--muted-text)]">
							Registering needs the "Webhooks" repository permission on your
							token. Manual setup works with any token: Tasker gives you the URL
							and secret to paste into the repository settings.
						</p>
					</div>
				)}
				<ErrorText message={error} />
			</CardContent>
			<ConfirmDialog
				open={confirmRemove}
				title="Remove webhook?"
				description="Live updates, automations and GitHub inbox notifications stop for this project until a webhook is set up again."
				confirmLabel="Remove"
				confirmingLabel="Removing…"
				isConfirming={working}
				onCancel={() => setConfirmRemove(false)}
				onConfirm={async () => {
					await run(
						() => removeWebhook({ projectId }),
						"Could not remove the webhook.",
					);
					setConfirmRemove(false);
					setManual(null);
				}}
			/>
		</Card>
	);
}

function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<div className="space-y-1">
			<Label>{label}</Label>
			<div className="flex gap-2">
				<Input
					readOnly
					value={value}
					onFocus={(event) => event.target.select()}
				/>
				<Button
					type="button"
					variant="secondary"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(value);
							setCopied(true);
						} catch {}
					}}
				>
					{copied ? (
						<Check className="h-4 w-4" />
					) : (
						<Copy className="h-4 w-4" />
					)}
				</Button>
			</div>
		</div>
	);
}

function ManualSetup({
	manual,
}: {
	manual: { url: string; secret: string; events: string[] };
}) {
	return (
		<div className="space-y-2 rounded-md border border-amber-300/70 bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))] p-3 dark:border-amber-800">
			<p className="m-0 text-xs">
				In the repository go to Settings → Webhooks → Add webhook. Use content
				type <code>application/json</code>, select the events below and paste
				this URL and secret. The secret is shown only now.
			</p>
			<CopyField label="Payload URL" value={manual.url} />
			<CopyField label="Secret" value={manual.secret} />
			<p className="m-0 text-xs text-[var(--muted-text)]">
				Events:{" "}
				{manual.events.map((event) => event.replaceAll("_", " ")).join(", ")}.
			</p>
		</div>
	);
}

function IdentityCard({
	projectId,
	settings,
}: {
	projectId: Id<"projects">;
	settings: Settings;
}) {
	const setAutomationIdentity = useMutation(
		api.githubLinks.setAutomationIdentity,
	);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function toggle(enabled: boolean) {
		setWorking(true);
		setError(null);
		try {
			await setAutomationIdentity({ projectId, enabled });
		} catch (caught) {
			setError(
				getClientErrorMessage(
					caught,
					"Could not change the automation identity.",
				),
			);
		} finally {
			setWorking(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Zap className="h-4 w-4" />
					Automation identity
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<p className="m-0 text-[var(--muted-text)]">
					Automations act as the GitHub user who triggered them when that person
					is a project writer. Otherwise they act as the member who opts in
					here, and failing that as the person who linked the repository. Future
					automations that write to GitHub will use this identity too.
				</p>
				{settings.automationUser ? (
					<p className="m-0">
						Acting as <strong>{settings.automationUser.name}</strong>{" "}
						<span className="text-[var(--muted-text)]">
							({settings.automationUser.login})
						</span>
					</p>
				) : (
					<p className="m-0 text-[var(--muted-text)]">
						Nobody has opted in yet.
					</p>
				)}
				{settings.canManage ? (
					settings.viewerIsAutomationUser ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={working}
							onClick={() => void toggle(false)}
						>
							Stop acting for automations
						</Button>
					) : (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={working || !settings.viewerConnected}
							onClick={() => void toggle(true)}
							title={
								settings.viewerConnected
									? undefined
									: "Add your GitHub token first"
							}
						>
							{settings.automationUser
								? "Act for automations instead"
								: "Act for automations"}
						</Button>
					)
				) : null}
				<ErrorText message={error} />
			</CardContent>
		</Card>
	);
}

function RulesCard({
	projectId,
	settings,
}: {
	projectId: Id<"projects">;
	settings: Settings;
}) {
	const updateSettings = useMutation(api.githubLinks.updateAutomationSettings);
	const [rules, setRules] = useState<Rule[]>(() =>
		settings.rules.map((state) => state.rule),
	);
	const [dirty, setDirty] = useState(false);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!dirty) setRules(settings.rules.map((state) => state.rule));
	}, [settings.rules, dirty]);

	function update(trigger: Rule["trigger"], patch: Partial<Rule>) {
		setDirty(true);
		setRules((previous) =>
			previous.map((rule) =>
				rule.trigger === trigger ? { ...rule, ...patch } : rule,
			),
		);
	}

	async function save() {
		setWorking(true);
		setError(null);
		try {
			await updateSettings({ projectId, rules });
			setDirty(false);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not save the rules."));
		} finally {
			setWorking(false);
		}
	}

	const statusKeys = new Set(settings.statuses.map((status) => status.key));

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle>Status automation</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="m-0 text-sm text-[var(--muted-text)]">
					When GitHub reports one of these events for a pull request or branch
					linked to a task, the task moves to the chosen status. Tasks in{" "}
					<em>Done</em> are never moved, and parents with unfinished sub-tasks
					are skipped with a note in the activity.
				</p>
				<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
					{rules.map((rule) => {
						const restoresPrevious = rule.trigger === "pr_closed";
						const missing =
							!restoresPrevious &&
							rule.enabled &&
							(!rule.targetStatus || !statusKeys.has(rule.targetStatus));
						return (
							<li
								key={rule.trigger}
								className="flex flex-wrap items-center gap-3 py-2.5"
							>
								<Switch
									id={`rule-${rule.trigger}`}
									checked={rule.enabled}
									disabled={!settings.canManage}
									onChange={(enabled) => update(rule.trigger, { enabled })}
								/>
								<label
									htmlFor={`rule-${rule.trigger}`}
									className="min-w-0 flex-1 text-sm"
								>
									{TRIGGER_LABELS[rule.trigger]}
								</label>
								{restoresPrevious ? (
									<span className="text-xs text-[var(--muted-text)]">
										Restores the status before automation
									</span>
								) : (
									<div className="flex items-center gap-2">
										<span className="text-xs text-[var(--muted-text)]">
											move to
										</span>
										<Select
											aria-label={`Target status for: ${TRIGGER_LABELS[rule.trigger]}`}
											className="h-8 w-44"
											value={
												rule.targetStatus && statusKeys.has(rule.targetStatus)
													? rule.targetStatus
													: ""
											}
											disabled={!settings.canManage}
											onChange={(event) =>
												update(rule.trigger, {
													targetStatus: event.target.value || undefined,
												})
											}
										>
											<option value="">Choose a status…</option>
											{settings.statuses.map((status) => (
												<option key={status.key} value={status.key}>
													{status.name}
												</option>
											))}
										</Select>
									</div>
								)}
								{missing ? (
									<span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
										<AlertTriangle className="h-3.5 w-3.5" />
										Status missing; rule is inactive
									</span>
								) : null}
							</li>
						);
					})}
				</ul>
				<ErrorText message={error} />
				{settings.canManage ? (
					<div className="flex justify-end gap-2">
						{dirty ? (
							<Button
								type="button"
								variant="ghost"
								disabled={working}
								onClick={() => {
									setDirty(false);
									setRules(settings.rules.map((state) => state.rule));
								}}
							>
								Discard
							</Button>
						) : null}
						<Button
							type="button"
							disabled={!dirty || working}
							onClick={() => void save()}
						>
							{working ? "Saving…" : "Save rules"}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function TemplatesCard({
	projectId,
	settings,
}: {
	projectId: Id<"projects">;
	settings: Settings;
}) {
	const updateSettings = useMutation(api.githubLinks.updateAutomationSettings);
	const [templates, setTemplates] = useState(settings.templates);
	const [dirty, setDirty] = useState(false);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!dirty) setTemplates(settings.templates);
	}, [settings.templates, dirty]);

	function update(patch: Partial<typeof templates>) {
		setDirty(true);
		setTemplates((previous) => ({ ...previous, ...patch }));
	}

	async function save() {
		setWorking(true);
		setError(null);
		try {
			await updateSettings({ projectId, templates });
			setDirty(false);
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not save the templates."));
		} finally {
			setWorking(false);
		}
	}

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle>Branch and pull request templates</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="m-0 text-sm text-[var(--muted-text)]">
					Used when creating a branch or pull request from a task. Placeholders:{" "}
					<code>{"{key}"}</code>, <code>{"{key.lower}"}</code>,{" "}
					<code>{"{number}"}</code>, <code>{"{slug}"}</code>,{" "}
					<code>{"{title}"}</code>, <code>{"{description}"}</code>,{" "}
					<code>{"{checklist}"}</code>, <code>{"{url}"}</code>,{" "}
					<code>{"{login}"}</code>.
				</p>
				<div className="grid gap-3 md:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="template-branch">Branch name</Label>
						<Input
							id="template-branch"
							value={templates.branch}
							disabled={!settings.canManage}
							onChange={(event) => update({ branch: event.target.value })}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="template-title">Pull request title</Label>
						<Input
							id="template-title"
							value={templates.pullRequestTitle}
							disabled={!settings.canManage}
							onChange={(event) =>
								update({ pullRequestTitle: event.target.value })
							}
						/>
					</div>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="template-body">Pull request description</Label>
					<Textarea
						id="template-body"
						rows={6}
						value={templates.pullRequestBody}
						disabled={!settings.canManage}
						onChange={(event) =>
							update({ pullRequestBody: event.target.value })
						}
					/>
				</div>
				<ErrorText message={error} />
				{settings.canManage ? (
					<div className="flex justify-end gap-2">
						{dirty ? (
							<Button
								type="button"
								variant="ghost"
								disabled={working}
								onClick={() => {
									setDirty(false);
									setTemplates(settings.templates);
								}}
							>
								Discard
							</Button>
						) : null}
						<Button
							type="button"
							disabled={!dirty || working}
							onClick={() => void save()}
						>
							{working ? "Saving…" : "Save templates"}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
