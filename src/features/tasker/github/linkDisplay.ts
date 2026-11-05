import type { DisplayTone } from "./pullRequestDisplay";

// Pure display helpers for task <-> pull request links: chip labels, checkout
// commands and activity wording. No React, no I/O.

export type PullRequestChipData = {
	pullNumber: number;
	url: string;
	state: "open" | "closed" | "merged" | null;
	isDraft: boolean;
	checks: "success" | "failure" | "pending" | null;
	reviewDecision: "approved" | "changes_requested" | "review_required" | null;
	mergeable: "mergeable" | "conflicting" | "unknown" | null;
	title: string | null;
};

export type ChipDescription = {
	label: string;
	tone: DisplayTone;
	title: string;
};

/**
 * One short label per pull request, most urgent signal first: conflicts and
 * failing checks beat review state, which beats the plain open/draft state.
 */
export function describePullRequestChip(
	chip: PullRequestChipData,
): ChipDescription {
	const number = `#${chip.pullNumber}`;
	const titleSuffix = chip.title ? ` ${chip.title}` : "";
	if (chip.state === null) {
		return {
			label: number,
			tone: "muted",
			title: `Pull request ${number} (details hidden)`,
		};
	}
	if (chip.state === "merged") {
		return {
			label: `${number} merged`,
			tone: "info",
			title: `${number}${titleSuffix} · merged`,
		};
	}
	if (chip.state === "closed") {
		return {
			label: `${number} closed`,
			tone: "muted",
			title: `${number}${titleSuffix} · closed without merging`,
		};
	}
	if (chip.mergeable === "conflicting") {
		return {
			label: `${number} conflicts`,
			tone: "danger",
			title: `${number}${titleSuffix} · merge conflicts`,
		};
	}
	if (chip.checks === "failure") {
		return {
			label: `${number} CI failing`,
			tone: "danger",
			title: `${number}${titleSuffix} · checks failed`,
		};
	}
	if (chip.reviewDecision === "changes_requested") {
		return {
			label: `${number} changes requested`,
			tone: "warning",
			title: `${number}${titleSuffix} · changes requested`,
		};
	}
	if (chip.isDraft) {
		return {
			label: `${number} draft`,
			tone: "muted",
			title: `${number}${titleSuffix} · draft`,
		};
	}
	if (chip.reviewDecision === "approved") {
		return {
			label: `${number} approved`,
			tone: "success",
			title: `${number}${titleSuffix} · approved`,
		};
	}
	if (chip.checks === "pending") {
		return {
			label: `${number} checks running`,
			tone: "warning",
			title: `${number}${titleSuffix} · checks running`,
		};
	}
	return {
		label: `${number} in review`,
		tone: "info",
		title: `${number}${titleSuffix} · open`,
	};
}

/** Commands a developer pastes to work on a branch locally. */
export function checkoutCommands(
	branchName: string,
	pullNumber?: number | null,
) {
	const quoted = /[^\w./-]/.test(branchName)
		? `'${branchName.replaceAll("'", "'\\''")}'`
		: branchName;
	const commands = [
		{ label: "git", command: `git fetch origin && git checkout ${quoted}` },
	];
	if (pullNumber) {
		commands.push({ label: "gh", command: `gh pr checkout ${pullNumber}` });
	}
	return commands;
}

const PULL_REQUEST_EVENT_LABELS: Record<string, string> = {
	opened: "Pull request opened",
	reopened: "Pull request reopened",
	ready_for_review: "Pull request marked ready for review",
	converted_to_draft: "Pull request converted to draft",
	review_requested: "Review requested",
	merged: "Pull request merged",
	closed: "Pull request closed without merging",
	approved: "Pull request approved",
	changes_requested: "Changes requested on pull request",
	checks_failed: "Checks failed on pull request",
	branch_pushed: "Branch pushed",
};

const TRIGGER_LABELS: Record<string, string> = {
	branch_pushed: "branch pushed",
	pr_opened: "pull request opened",
	pr_draft: "pull request converted to draft",
	pr_merged: "pull request merged",
	pr_closed: "pull request closed",
	review_approved: "review approved",
	changes_requested: "changes requested",
};

export const GITHUB_ACTIVITY_LABELS: Record<string, string> = {
	"github.repo_linked": "Linked GitHub repository",
	"github.repo_unlinked": "Unlinked GitHub repository",
	"github.pr_merged": "Merged pull request",
	"github.pr_closed": "Closed pull request",
	"github.pr_reopened": "Reopened pull request",
	"github.workflows_started": "Started workflows",
	"github.pr_linked": "Linked pull request",
	"github.pr_unlinked": "Unlinked pull request",
	"github.branch_created": "Created branch",
	"github.pr_created": "Opened pull request",
	"github.pr_event": "Pull request updated",
	"github.automation_applied": "Status changed by GitHub automation",
	"github.automation_skipped": "GitHub automation skipped",
	"github.webhook_registered": "Registered GitHub webhook",
	"github.webhook_removed": "Removed GitHub webhook",
	"github.automation_settings_changed": "Changed GitHub automation settings",
};

type GitHubActivityMetadata = {
	event?: string;
	pullNumber?: number;
	number?: number;
	title?: string;
	repository?: string;
	branchName?: string;
	actorLogin?: string | null;
	reviewerLogin?: string | null;
	trigger?: string;
	from?: string;
	to?: string;
	reason?: string;
	manual?: boolean;
};

/** Human wording for a GitHub activity entry, or null for other actions. */
export function describeGitHubActivity(
	action: string,
	metadata: unknown,
): { label: string; detail: string | null } | null {
	if (!action.startsWith("github.")) return null;
	const meta = (metadata ?? {}) as GitHubActivityMetadata;
	const number = meta.pullNumber ?? meta.number;
	const prRef = number
		? `#${number}${meta.title ? ` ${meta.title}` : ""}`
		: (meta.title ?? null);
	const by = meta.actorLogin ? ` by ${meta.actorLogin}` : "";

	switch (action) {
		case "github.pr_event": {
			const base =
				PULL_REQUEST_EVENT_LABELS[meta.event ?? ""] ?? "Pull request updated";
			if (meta.event === "branch_pushed") {
				return {
					label: base,
					detail: `${meta.branchName ?? ""}${by}`.trim() || null,
				};
			}
			if (meta.event === "review_requested" && meta.reviewerLogin) {
				return {
					label: base,
					detail: `${prRef ?? ""} · ${meta.reviewerLogin}${by}`.trim(),
				};
			}
			return {
				label: base,
				detail: prRef ? `${prRef}${by}` : by.trim() || null,
			};
		}
		case "github.automation_applied":
			return {
				label: "Status changed by GitHub automation",
				detail: `${meta.from ?? "?"} → ${meta.to ?? "?"} (${TRIGGER_LABELS[meta.trigger ?? ""] ?? meta.trigger ?? "rule"}${prRef ? `, ${prRef}` : ""})`,
			};
		case "github.automation_skipped":
			return {
				label: "GitHub automation skipped",
				detail: `${TRIGGER_LABELS[meta.trigger ?? ""] ?? meta.trigger ?? "rule"}: ${meta.reason ?? "blocked"}`,
			};
		case "github.branch_created":
			return { label: "Created branch", detail: meta.branchName ?? null };
		case "github.webhook_registered":
			return {
				label: meta.manual
					? "Set up GitHub webhook manually"
					: "Registered GitHub webhook",
				detail: meta.repository ?? null,
			};
		default:
			return {
				label: GITHUB_ACTIVITY_LABELS[action] ?? action,
				detail: prRef ?? meta.repository ?? null,
			};
	}
}
