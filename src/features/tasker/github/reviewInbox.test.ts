import { describe, expect, it } from "vitest";
import type {
	InboxPullRequest,
	InboxThread,
} from "#convex/lib/githubReviewInbox";
import {
	applyOverrides,
	badgeCounts,
	buildInbox,
	classifyThread,
	DEFAULT_FILTERS,
	formatAge,
	isQuiet,
	isUnseen,
	moveSelection,
	oldestOpenAge,
	QUIET_AFTER_MS,
	reviewRequestsFor,
	shortcutFor,
	toReviewThread,
} from "./reviewInbox";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T12:00:00Z");

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
	return {
		id: "t1",
		pullNumber: 1,
		path: "src/a.ts",
		line: 3,
		startLine: null,
		isFileComment: false,
		isResolved: false,
		isOutdated: false,
		resolvedBy: null,
		startedBy: { login: "me", avatarUrl: null, url: null, isBot: false },
		startedAt: NOW - 5 * HOUR,
		url: null,
		preview: "Guard the null case",
		severity: null,
		replyCount: 0,
		lastCommentAt: NOW - 5 * HOUR,
		lastCommentBy: "me",
		...overrides,
	};
}

function pr(
	number: number,
	author: string,
	threads: InboxThread[],
	overrides: Partial<InboxPullRequest> = {},
): InboxPullRequest {
	return {
		number,
		title: `PR ${number}`,
		url: "",
		isDraft: false,
		createdAt: NOW - 48 * HOUR,
		updatedAt: NOW,
		reviewDecision: null,
		author: { login: author, avatarUrl: null, url: null, isBot: false },
		requestedReviewers: [],
		threads: threads.map((item) => ({ ...item, pullNumber: number })),
		...overrides,
	};
}

describe("whose turn a conversation is", () => {
	it("needs the reviewer when someone answered or the code changed", () => {
		expect(classifyThread(thread(), "dev", "me")).toEqual({
			state: "waiting",
			reason: "waiting_author",
			role: "reviewer",
		});
		expect(
			classifyThread(
				thread({ replyCount: 1, lastCommentBy: "dev" }),
				"dev",
				"ME",
			),
		).toMatchObject({ state: "attention", reason: "replied" });
		expect(
			classifyThread(thread({ isOutdated: true }), "dev", "me"),
		).toMatchObject({ state: "attention", reason: "code_changed" });
	});

	it("needs the pull request author when the last word is not theirs", () => {
		const fromReviewer = thread({
			startedBy: { login: "rev", avatarUrl: null, url: null, isBot: false },
			lastCommentBy: "rev",
		});
		expect(classifyThread(fromReviewer, "me", "me")).toEqual({
			state: "attention",
			reason: "new_comment",
			role: "author",
		});
		expect(
			classifyThread(
				{ ...fromReviewer, lastCommentBy: "me", replyCount: 1 },
				"me",
				"me",
			),
		).toMatchObject({ state: "waiting", reason: "waiting_reviewer" });
	});

	it("leaves other people's conversations waiting and resolved ones resolved", () => {
		const others = thread({
			startedBy: { login: "rev", avatarUrl: null, url: null, isBot: false },
			lastCommentBy: "dev",
		});
		expect(classifyThread(others, "dev", "me")).toEqual({
			state: "waiting",
			reason: null,
			role: "other",
		});
		expect(
			classifyThread(thread({ isResolved: true }), "dev", "me").state,
		).toBe("resolved");
	});
});

describe("unseen and quiet conversations", () => {
	const replied = thread({ lastCommentBy: "dev", lastCommentAt: NOW - HOUR });

	it("is new only after the baseline and the last time it was opened", () => {
		expect(isUnseen(replied, "me", undefined, null)).toBe(false);
		expect(isUnseen(replied, "me", undefined, NOW - 2 * HOUR)).toBe(true);
		expect(isUnseen(replied, "me", NOW - 30 * 60_000, NOW - 2 * HOUR)).toBe(
			false,
		);
		expect(isUnseen(replied, "me", undefined, NOW)).toBe(false);
		expect(isUnseen(thread({ lastCommentAt: NOW }), "me", undefined, 0)).toBe(
			false,
		);
	});

	it("is quiet after three days without activity unless resolved", () => {
		const old = thread({ lastCommentAt: NOW - QUIET_AFTER_MS - 1 });
		expect(isQuiet(old, NOW)).toBe(true);
		expect(isQuiet({ ...old, isResolved: true }, NOW)).toBe(false);
		expect(isQuiet(thread(), NOW)).toBe(false);
	});
});

describe("building the inbox", () => {
	const mine = thread({ id: "mine-waiting" });
	const mineReplied = thread({
		id: "mine-replied",
		lastCommentBy: "dev",
		replyCount: 1,
		lastCommentAt: NOW - HOUR,
	});
	const bot = thread({
		id: "bot",
		startedBy: {
			login: "coderabbitai",
			avatarUrl: null,
			url: null,
			isBot: true,
		},
		lastCommentBy: "coderabbitai",
		severity: "major",
		path: "src/routes.ts",
	});
	const resolved = thread({ id: "done", isResolved: true });
	const onMyPr = thread({
		id: "on-my-pr",
		startedBy: { login: "rev", avatarUrl: null, url: null, isBot: false },
		lastCommentBy: "rev",
	});
	const pullRequests = [
		pr(1, "dev", [mine, mineReplied, resolved]),
		pr(2, "me", [bot, onMyPr]),
	];
	const base = {
		pullRequests,
		viewer: "me",
		filters: DEFAULT_FILTERS,
		isTracked: (id: string) => id === "mine-replied",
		seen: new Map<string, number>(),
		baseline: NOW - 2 * HOUR,
		now: NOW,
	};

	it("splits the feedback I gave by state, newest activity first", () => {
		const inbox = buildInbox({ ...base, view: "gave" });
		expect(inbox.counts).toEqual({ attention: 1, waiting: 1, resolved: 1 });
		expect(inbox.groups.attention[0].entries[0]).toMatchObject({
			thread: { id: "mine-replied" },
			reason: "replied",
			unseen: true,
			tracked: true,
		});
	});

	it("shows the feedback I received, and filters bots", () => {
		const inbox = buildInbox({ ...base, view: "received" });
		expect(
			inbox.groups.attention[0].entries.map((entry) => entry.thread.id).sort(),
		).toEqual(["bot", "on-my-pr"]);
		const noBots = buildInbox({
			...base,
			view: "received",
			filters: { ...DEFAULT_FILTERS, hideBots: true },
		});
		expect(noBots.counts.attention).toBe(1);
		expect(noBots.reviewers).toEqual(["coderabbitai", "rev"]);
	});

	it("applies search, untracked, reviewer and author filters", () => {
		const everyone = (filters: Partial<typeof DEFAULT_FILTERS>) =>
			buildInbox({
				...base,
				view: "everyone",
				filters: { ...DEFAULT_FILTERS, ...filters },
			}).groups;
		const ids = (groups: ReturnType<typeof everyone>) =>
			Object.values(groups)
				.flat()
				.flatMap((group) => group.entries.map((entry) => entry.thread.id))
				.sort();
		expect(ids(everyone({ search: "routes" }))).toEqual(["bot"]);
		expect(ids(everyone({ untrackedOnly: true }))).not.toContain(
			"mine-replied",
		);
		expect(ids(everyone({ reviewer: "REV" }))).toEqual(["on-my-pr"]);
		expect(ids(everyone({ author: "dev" }))).toEqual([
			"done",
			"mine-replied",
			"mine-waiting",
		]);
		expect(ids(everyone({ unseenOnly: true }))).toEqual(["mine-replied"]);
	});

	it("counts what the tab badge shows and lists review requests", () => {
		const withRequest = [
			...pullRequests,
			pr(3, "dev", [], {
				requestedReviewers: ["Me"],
				createdAt: NOW - 72 * HOUR,
			}),
			pr(4, "dev", [], { requestedReviewers: ["me"], createdAt: NOW - HOUR }),
		];
		expect(badgeCounts(withRequest, "me")).toEqual({
			attention: 3,
			reviewRequests: 2,
		});
		expect(
			reviewRequestsFor(withRequest, "me").map((item) => item.number),
		).toEqual([3, 4]);
	});

	it("applies changes made on the page over loaded data", () => {
		const changed = applyOverrides(
			pullRequests,
			new Map([["mine-replied", { isResolved: true }]]),
		);
		expect(
			changed[0].threads.find((item) => item.id === "mine-replied")?.isResolved,
		).toBe(true);
		expect(pullRequests[0].threads[1].isResolved).toBe(false);
	});
});

describe("small helpers", () => {
	it("measures the oldest open conversation and formats ages", () => {
		expect(
			oldestOpenAge(pr(1, "dev", [thread({ startedAt: NOW - 3 * HOUR })]), NOW),
		).toBe(3 * HOUR);
		expect(
			oldestOpenAge(pr(1, "dev", [thread({ isResolved: true })]), NOW),
		).toBeNull();
		expect([
			formatAge(5 * 60_000),
			formatAge(5 * HOUR),
			formatAge(72 * HOUR),
		]).toEqual(["5m", "5h", "3d"]);
	});

	it("moves the selection within the list", () => {
		expect(moveSelection(["a", "b", "c"], null, 1)).toBe("a");
		expect(moveSelection(["a", "b", "c"], null, -1)).toBe("c");
		expect(moveSelection(["a", "b", "c"], "b", 1)).toBe("c");
		expect(moveSelection(["a", "b", "c"], "c", 1)).toBe("c");
		expect(moveSelection(["a", "b", "c"], "a", -1)).toBe("a");
		expect(moveSelection([], "a", 1)).toBeNull();
	});

	it("maps keys to shortcuts but never while typing or with modifiers", () => {
		expect(shortcutFor({ key: "j" })).toBe("next");
		expect(shortcutFor({ key: "ArrowUp" })).toBe("previous");
		expect(shortcutFor({ key: "t" })).toBe("trackFix");
		expect(shortcutFor({ key: "e" })).toBe("toggleResolved");
		expect(shortcutFor({ key: "?" })).toBe("help");
		expect(shortcutFor({ key: "j", targetIsEditable: true })).toBeNull();
		expect(shortcutFor({ key: "r", ctrlKey: true })).toBeNull();
		expect(shortcutFor({ key: "q" })).toBeNull();
	});

	it("turns an inbox conversation into the dialog's shape with escaped text", () => {
		const converted = toReviewThread(
			thread({ preview: "a <b> & c", replyCount: 2 }),
		);
		expect(converted.comments[0].bodyHtml).toBe("<p>a &lt;b&gt; &amp; c</p>");
		expect(converted.totalComments).toBe(3);
	});
});
