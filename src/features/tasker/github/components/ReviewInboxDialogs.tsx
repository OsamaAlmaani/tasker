import { useAction } from "convex/react";
import { ListPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type {
	InboxPullRequest,
	InboxThread,
} from "#convex/lib/githubReviewInbox";
import { SHORTCUTS, toReviewThread } from "../reviewInbox";
import { trackSummary } from "../reviewTaskDisplay";
import { Modal } from "./Modal";
import { SnippetMenu } from "./ReplySnippets";
import {
	type ReviewTaskKind,
	TrackThreadsDialog,
	useReviewTasks,
} from "./ReviewTasks";

type Notice = { message: string; failed: boolean };

/** The full tracking dialog for one conversation, with its pull request's options. */
export function TrackOneDialog({
	projectId,
	pullRequest,
	thread,
	kind,
	onClose,
	onTracked,
}: {
	projectId: Id<"projects">;
	pullRequest: InboxPullRequest;
	thread: InboxThread;
	kind: ReviewTaskKind;
	onClose: () => void;
	onTracked: (notice: Notice) => void;
}) {
	const reviewTasks = useReviewTasks(
		projectId,
		pullRequest.number,
		pullRequest.author?.login ?? null,
	);
	if (!reviewTasks.data) return null;
	return (
		<TrackThreadsDialog
			projectId={projectId}
			pullNumber={pullRequest.number}
			threads={[toReviewThread(thread)]}
			initialSelected={[thread.id]}
			initialKind={kind}
			data={reviewTasks.data}
			onClose={onClose}
			onTracked={onTracked}
		/>
	);
}

/** Tracks conversations from several pull requests in one go. */
export function BulkTrackDialog({
	projectId,
	threads,
	kind: initialKind,
	onClose,
	onTracked,
}: {
	projectId: Id<"projects">;
	threads: InboxThread[];
	kind: ReviewTaskKind;
	onClose: () => void;
	onTracked: (notice: Notice) => void;
}) {
	const track = useAction(api.githubReviewInboxActions.trackThreadsBulk);
	const [kind, setKind] = useState(initialKind);
	const [underPullRequestTask, setUnderPullRequestTask] = useState(true);
	const [assignToAuthor, setAssignToAuthor] = useState(true);
	const [priorityFromSeverity, setPriorityFromSeverity] = useState(true);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pullCount = new Set(threads.map((thread) => thread.pullNumber)).size;
	const resolved = threads.filter((thread) => thread.isResolved).length;
	const hasSeverity = threads.some((thread) => thread.severity);

	async function submit() {
		setWorking(true);
		setError(null);
		try {
			const result = await track({
				projectId,
				threadIds: threads.map((thread) => thread.id),
				kind,
				parent: underPullRequestTask ? "pull_request_task" : "none",
				assignToAuthor,
				priorityFromSeverity: hasSeverity && priorityFromSeverity,
			});
			onTracked(trackSummary(result.results, result.warnings));
			onClose();
		} catch (caught) {
			setError(
				getClientErrorMessage(caught, "Could not create the review tasks."),
			);
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal
			title={`Track ${threads.length} conversation${threads.length === 1 ? "" : "s"}`}
			onClose={onClose}
		>
			<div className="space-y-4 text-sm">
				<p className="m-0 text-xs text-[var(--muted-text)]">
					From {pullCount} pull request{pullCount === 1 ? "" : "s"}. One task
					per conversation; conversations already tracked are left as they are.
				</p>
				<fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2">
					<legend className="sr-only">Kind</legend>
					{(
						[
							[
								"fix",
								"Fix before merge",
								"Done when the conversation is resolved.",
							],
							[
								"follow_up",
								"Follow up later",
								"Replies with the task link and resolves the conversation.",
							],
						] as const
					).map(([value, label, description]) => (
						<label
							key={value}
							className={cn(
								"flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2",
								kind === value
									? "border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
									: "border-[var(--line)]",
							)}
						>
							<input
								type="radio"
								name="bulk-kind"
								className="mt-1 accent-[var(--accent)]"
								checked={kind === value}
								onChange={() => setKind(value)}
							/>
							<span>
								<span className="block font-medium">{label}</span>
								<span className="block text-xs text-[var(--muted-text)]">
									{description}
								</span>
							</span>
						</label>
					))}
				</fieldset>
				<div className="space-y-2">
					{kind === "fix" ? (
						<Checkbox
							checked={underPullRequestTask}
							onChange={setUnderPullRequestTask}
							label="Put each under its pull request's task"
							hint="Sub-task of the first open task linked to that pull request, when there is one."
						/>
					) : null}
					<Checkbox
						checked={assignToAuthor}
						onChange={setAssignToAuthor}
						label="Assign to each pull request's author"
						hint="Only when their GitHub login belongs to a project member."
					/>
					{hasSeverity ? (
						<Checkbox
							checked={priorityFromSeverity}
							onChange={setPriorityFromSeverity}
							label="Set priority from severity labels"
							hint="Critical → Urgent, Major → High, Minor → Medium, Nitpick → Low."
						/>
					) : null}
				</div>
				{kind === "fix" && resolved ? (
					<p className="m-0 text-xs text-amber-700 dark:text-amber-300">
						{resolved} resolved conversation{resolved === 1 ? " is" : "s are"}{" "}
						skipped for fixes.
					</p>
				) : null}
				{error ? (
					<p role="alert" className="m-0 text-xs text-[var(--danger)]">
						{error}
					</p>
				) : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={working}
						onClick={() => void submit()}
					>
						<ListPlus className="mr-1.5 h-4 w-4" />
						{working ? "Creating…" : "Create tasks"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function Checkbox({
	checked,
	onChange,
	label,
	hint,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	hint?: string;
}) {
	return (
		<label className="flex items-start gap-2 text-[var(--text)]">
			<input
				type="checkbox"
				className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>
				{label}
				{hint ? (
					<span className="block text-xs text-[var(--muted-text)]">{hint}</span>
				) : null}
			</span>
		</label>
	);
}

/** Posts the same reply on several conversations. */
export function BulkReplyDialog({
	projectId,
	threads,
	snippets,
	onEditSnippets,
	onClose,
	onReplied,
}: {
	projectId: Id<"projects">;
	threads: InboxThread[];
	snippets: string[];
	onEditSnippets: () => void;
	onClose: () => void;
	onReplied: (notice: Notice, repliedIds: string[]) => void;
}) {
	const reply = useAction(api.githubReviewInboxActions.replyToThreads);
	const [body, setBody] = useState("");
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setWorking(true);
		setError(null);
		try {
			const result = await reply({
				projectId,
				threadIds: threads.map((thread) => thread.id),
				body,
			});
			const failedIds = new Set(result.failed.map((item) => item.threadId));
			onReplied(
				{
					message: result.failed.length
						? `Replied on ${result.done}; ${result.failed.length} failed: ${result.failed[0].message}`
						: `Replied on ${result.done} conversation${result.done === 1 ? "" : "s"}.`,
					failed: result.failed.length > 0,
				},
				threads.map((thread) => thread.id).filter((id) => !failedIds.has(id)),
			);
			onClose();
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not post the replies."));
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal
			title={`Reply on ${threads.length} conversation${threads.length === 1 ? "" : "s"}`}
			onClose={onClose}
		>
			<div className="space-y-3 text-sm">
				<Textarea
					aria-label="Reply"
					placeholder="The same reply is posted on each conversation"
					value={body}
					onChange={(event) => setBody(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
							event.preventDefault();
							if (body.trim() && !working) void submit();
						}
					}}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<SnippetMenu
						snippets={snippets}
						onInsert={(snippet) =>
							setBody((current) =>
								current.trim() ? `${current.trimEnd()}\n\n${snippet}` : snippet,
							)
						}
						onEdit={onEditSnippets}
					/>
					<div className="ml-auto flex gap-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={working || !body.trim()}
							onClick={() => void submit()}
						>
							{working ? "Replying…" : "Reply"}
						</Button>
					</div>
				</div>
				{error ? (
					<p role="alert" className="m-0 text-xs text-[var(--danger)]">
						{error}
					</p>
				) : null}
			</div>
		</Modal>
	);
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
	return (
		<Modal title="Keyboard shortcuts" onClose={onClose}>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				{SHORTCUTS.map((shortcut) => (
					<div key={shortcut.action} className="contents">
						<dt>
							<kbd className="rounded border border-[var(--line)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-xs">
								{shortcut.keys}
							</kbd>
						</dt>
						<dd className="m-0 text-[var(--text)]">{shortcut.label}</dd>
					</div>
				))}
			</dl>
			<p className="m-0 mt-4 text-xs text-[var(--muted-text)]">
				Ctrl+Enter sends a reply. Shortcuts are off while you type.
			</p>
		</Modal>
	);
}
