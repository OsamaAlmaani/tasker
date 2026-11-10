import type { PullRequestReviewThread } from "#convex/lib/githubApi";
import type {
	InboxPullRequest,
	InboxThread,
	ReviewSeverity,
} from "#convex/lib/githubReviewInbox";

// Pure logic of the Reviews inbox: whose turn a conversation is, filters,
// grouping, unseen markers, counts and keyboard shortcuts.

export type InboxView = "gave" | "received" | "everyone" | "requests";
export type InboxState = "attention" | "waiting" | "resolved";
export type ThreadRole = "reviewer" | "author" | "other";
export type AttentionReason =
	| "replied"
	| "code_changed"
	| "new_comment"
	| "waiting_author"
	| "waiting_reviewer"
	| null;

/** A conversation with no activity for this long is marked quiet. */
export const QUIET_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const same = (a: string | null | undefined, b: string | null | undefined) =>
	Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** The viewer's part in a conversation: who started it, or whose pull request it is. */
export function threadRole(
	thread: InboxThread,
	pullRequestAuthor: string | null,
	viewer: string,
): ThreadRole {
	if (same(thread.startedBy?.login, viewer)) return "reviewer";
	if (same(pullRequestAuthor, viewer)) return "author";
	return "other";
}

/**
 * Whose turn a conversation is, from the viewer's side. As the reviewer it
 * needs attention when someone answered or the code changed under it; as the
 * pull request author when the last word is not theirs.
 */
export function classifyThread(
	thread: InboxThread,
	pullRequestAuthor: string | null,
	viewer: string,
): { state: InboxState; reason: AttentionReason; role: ThreadRole } {
	const role = threadRole(thread, pullRequestAuthor, viewer);
	if (thread.isResolved) return { state: "resolved", reason: null, role };
	const lastIsMine = same(thread.lastCommentBy, viewer);
	if (role === "reviewer") {
		if (!lastIsMine) return { state: "attention", reason: "replied", role };
		if (thread.isOutdated)
			return { state: "attention", reason: "code_changed", role };
		return { state: "waiting", reason: "waiting_author", role };
	}
	if (role === "author") {
		if (!lastIsMine) {
			return {
				state: "attention",
				reason: thread.replyCount ? "replied" : "new_comment",
				role,
			};
		}
		return { state: "waiting", reason: "waiting_reviewer", role };
	}
	return { state: "waiting", reason: null, role };
}

export const REASON_LABELS: Record<NonNullable<AttentionReason>, string> = {
	replied: "New reply",
	code_changed: "Code changed",
	new_comment: "New comment",
	waiting_author: "Waiting on author",
	waiting_reviewer: "Waiting on reviewer",
};

export const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
	critical: "Critical",
	major: "Major",
	minor: "Minor",
	nitpick: "Nitpick",
};

export function isQuiet(thread: InboxThread, now: number) {
	return !thread.isResolved && now - thread.lastCommentAt > QUIET_AFTER_MS;
}

/**
 * A conversation is new to the viewer when someone else wrote the last
 * comment after the viewer's baseline and after they last opened it. Before
 * the inbox has a baseline nothing is new.
 */
export function isUnseen(
	thread: InboxThread,
	viewer: string,
	seenAt: number | undefined,
	baseline: number | null,
) {
	if (baseline === null) return false;
	if (same(thread.lastCommentBy, viewer)) return false;
	return thread.lastCommentAt > Math.max(baseline, seenAt ?? 0);
}

export type InboxFilters = {
	search: string;
	reviewer: string | null;
	author: string | null;
	hideBots: boolean;
	untrackedOnly: boolean;
	outdatedOnly: boolean;
	unseenOnly: boolean;
};

export const DEFAULT_FILTERS: InboxFilters = {
	search: "",
	reviewer: null,
	author: null,
	hideBots: false,
	untrackedOnly: false,
	outdatedOnly: false,
	unseenOnly: false,
};

export type InboxEntry = {
	thread: InboxThread;
	pullRequest: InboxPullRequest;
	state: InboxState;
	reason: AttentionReason;
	role: ThreadRole;
	unseen: boolean;
	quiet: boolean;
	tracked: boolean;
};

export type InboxGroup = {
	pullRequest: InboxPullRequest;
	entries: InboxEntry[];
};

type BuildArgs = {
	pullRequests: ReadonlyArray<InboxPullRequest>;
	viewer: string;
	view: Exclude<InboxView, "requests">;
	filters: InboxFilters;
	isTracked: (threadId: string) => boolean;
	seen: ReadonlyMap<string, number>;
	baseline: number | null;
	now: number;
};

function matchesView(role: ThreadRole, view: BuildArgs["view"]) {
	if (view === "gave") return role === "reviewer";
	if (view === "received") return role === "author";
	return true;
}

function matchesSearch(entry: InboxEntry, search: string) {
	const needle = search.trim().toLowerCase();
	if (!needle) return true;
	const { thread, pullRequest } = entry;
	return [
		thread.path,
		thread.preview,
		thread.startedBy?.login ?? "",
		pullRequest.title,
		`#${pullRequest.number}`,
	].some((value) => value.toLowerCase().includes(needle));
}

/**
 * Entries of the chosen view after filters, grouped by state and pull
 * request. Groups are ordered by their latest activity and entries by their
 * last comment, newest first. Reviewer and author options come from the view
 * before filters so a selected one never disappears from its own list.
 */
export function buildInbox(args: BuildArgs) {
	const all: InboxEntry[] = [];
	for (const pullRequest of args.pullRequests) {
		for (const thread of pullRequest.threads) {
			const { state, reason, role } = classifyThread(
				thread,
				pullRequest.author?.login ?? null,
				args.viewer,
			);
			if (!matchesView(role, args.view)) continue;
			all.push({
				thread,
				pullRequest,
				state,
				reason,
				role,
				unseen: isUnseen(
					thread,
					args.viewer,
					args.seen.get(thread.id),
					args.baseline,
				),
				quiet: isQuiet(thread, args.now),
				tracked: args.isTracked(thread.id),
			});
		}
	}
	const reviewers = [
		...new Set(
			all
				.map((entry) => entry.thread.startedBy?.login)
				.filter(Boolean) as string[],
		),
	].sort((a, b) => a.localeCompare(b));
	const authors = [
		...new Set(
			all
				.map((entry) => entry.pullRequest.author?.login)
				.filter(Boolean) as string[],
		),
	].sort((a, b) => a.localeCompare(b));

	const { filters } = args;
	const entries = all.filter(
		(entry) =>
			(!filters.hideBots || !entry.thread.startedBy?.isBot) &&
			(!filters.untrackedOnly || !entry.tracked) &&
			(!filters.outdatedOnly || entry.thread.isOutdated) &&
			(!filters.unseenOnly || entry.unseen) &&
			(!filters.reviewer ||
				same(entry.thread.startedBy?.login, filters.reviewer)) &&
			(!filters.author ||
				same(entry.pullRequest.author?.login, filters.author)) &&
			matchesSearch(entry, filters.search),
	);

	const groups: Record<InboxState, InboxGroup[]> = {
		attention: [],
		waiting: [],
		resolved: [],
	};
	for (const state of ["attention", "waiting", "resolved"] as const) {
		const byPull = new Map<number, InboxGroup>();
		for (const entry of entries) {
			if (entry.state !== state) continue;
			const group = byPull.get(entry.pullRequest.number) ?? {
				pullRequest: entry.pullRequest,
				entries: [],
			};
			group.entries.push(entry);
			byPull.set(entry.pullRequest.number, group);
		}
		groups[state] = [...byPull.values()]
			.map((group) => ({
				...group,
				entries: group.entries.sort(
					(a, b) => b.thread.lastCommentAt - a.thread.lastCommentAt,
				),
			}))
			.sort(
				(a, b) =>
					b.entries[0].thread.lastCommentAt - a.entries[0].thread.lastCommentAt,
			);
	}
	const count = (state: InboxState) =>
		groups[state].reduce((sum, group) => sum + group.entries.length, 0);
	return {
		groups,
		counts: {
			attention: count("attention"),
			waiting: count("waiting"),
			resolved: count("resolved"),
		},
		reviewers,
		authors,
	};
}

/** Open pull requests waiting on the viewer's review, longest waiting first. */
export function reviewRequestsFor(
	pullRequests: ReadonlyArray<InboxPullRequest>,
	viewer: string,
) {
	return pullRequests
		.filter((pr) => pr.requestedReviewers.some((login) => same(login, viewer)))
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** What the tab badge counts: conversations waiting on the viewer, plus review requests. */
export function badgeCounts(
	pullRequests: ReadonlyArray<InboxPullRequest>,
	viewer: string,
) {
	let attention = 0;
	for (const pr of pullRequests) {
		for (const thread of pr.threads) {
			const { state, role } = classifyThread(
				thread,
				pr.author?.login ?? null,
				viewer,
			);
			if (state === "attention" && role !== "other") attention++;
		}
	}
	return {
		attention,
		reviewRequests: reviewRequestsFor(pullRequests, viewer).length,
	};
}

/** How long the oldest open conversation of a pull request has been open. */
export function oldestOpenAge(pullRequest: InboxPullRequest, now: number) {
	const open = pullRequest.threads.filter((thread) => !thread.isResolved);
	if (!open.length) return null;
	return now - Math.min(...open.map((thread) => thread.startedAt));
}

/** Short duration such as "3d", "5h" or "12m". */
export function formatAge(ms: number) {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

/** The shape the tracking dialog expects, built from the inbox's lean data. */
export function toReviewThread(thread: InboxThread): PullRequestReviewThread {
	const escaped = thread.preview
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return {
		id: thread.id,
		path: thread.path,
		line: thread.line,
		startLine: thread.startLine,
		isFileComment: thread.isFileComment,
		isResolved: thread.isResolved,
		isOutdated: thread.isOutdated,
		resolvedBy: thread.resolvedBy,
		diffHunk: null,
		viewerCanReply: false,
		viewerCanResolve: false,
		viewerCanUnresolve: false,
		createdAt: thread.startedAt,
		comments: [
			{
				id: `${thread.id}:first`,
				author: thread.startedBy,
				bodyHtml: escaped ? `<p>${escaped}</p>` : "",
				createdAt: thread.startedAt,
				url: thread.url,
				reactions: [],
			},
		],
		totalComments: thread.replyCount + 1,
	};
}

/** Changes made on the page, applied over loaded data until the next refresh. */
export type ThreadOverride = Partial<
	Pick<
		InboxThread,
		"isResolved" | "lastCommentAt" | "lastCommentBy" | "replyCount"
	>
>;

export function applyOverrides(
	pullRequests: ReadonlyArray<InboxPullRequest>,
	overrides: ReadonlyMap<string, ThreadOverride>,
): InboxPullRequest[] {
	if (!overrides.size) return [...pullRequests];
	return pullRequests.map((pr) => ({
		...pr,
		threads: pr.threads.map((thread) => {
			const override = overrides.get(thread.id);
			return override ? { ...thread, ...override } : thread;
		}),
	}));
}

/** The id `delta` steps away from `current`, staying within the list. */
export function moveSelection(
	ids: ReadonlyArray<string>,
	current: string | null,
	delta: number,
) {
	if (!ids.length) return null;
	const index = current ? ids.indexOf(current) : -1;
	if (index === -1) return delta >= 0 ? ids[0] : ids[ids.length - 1];
	return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}

export type ShortcutAction =
	| "next"
	| "previous"
	| "toggleSelect"
	| "trackFix"
	| "trackFollowUp"
	| "reply"
	| "toggleResolved"
	| "open"
	| "help"
	| "clear";

export const SHORTCUTS: Array<{
	keys: string;
	action: ShortcutAction;
	label: string;
}> = [
	{ keys: "j / ↓", action: "next", label: "Next conversation" },
	{ keys: "k / ↑", action: "previous", label: "Previous conversation" },
	{ keys: "x", action: "toggleSelect", label: "Select for bulk actions" },
	{ keys: "t", action: "trackFix", label: "Track as fix before merge" },
	{ keys: "f", action: "trackFollowUp", label: "Track as follow-up" },
	{ keys: "r", action: "reply", label: "Reply" },
	{ keys: "e", action: "toggleResolved", label: "Resolve or reopen" },
	{ keys: "o", action: "open", label: "Open in the pull request" },
	{ keys: "Esc", action: "clear", label: "Clear the selection" },
	{ keys: "?", action: "help", label: "Show shortcuts" },
];

/**
 * The inbox action for a key press, or null. Keys typed into fields, or
 * pressed with Ctrl, Alt or Meta, are left alone.
 */
export function shortcutFor(event: {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	targetIsEditable?: boolean;
}): ShortcutAction | null {
	if (event.targetIsEditable || event.ctrlKey || event.metaKey || event.altKey)
		return null;
	switch (event.key) {
		case "j":
		case "ArrowDown":
			return "next";
		case "k":
		case "ArrowUp":
			return "previous";
		case "x":
			return "toggleSelect";
		case "t":
			return "trackFix";
		case "f":
			return "trackFollowUp";
		case "r":
			return "reply";
		case "e":
			return "toggleResolved";
		case "o":
			return "open";
		case "?":
			return "help";
		case "Escape":
			return "clear";
		default:
			return null;
	}
}
