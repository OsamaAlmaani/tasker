import { describe, expect, it } from "vitest";
import {
	checkoutCommands,
	describeGitHubActivity,
	describePullRequestChip,
	type PullRequestChipData,
} from "./linkDisplay";

const base: PullRequestChipData = {
	pullNumber: 12,
	url: "https://github.com/acme/app/pull/12",
	state: "open",
	isDraft: false,
	checks: null,
	reviewDecision: null,
	mergeable: "unknown",
	title: "Fix tax",
};

describe("pull request chips", () => {
	it("ranks signals from most to least urgent", () => {
		expect(describePullRequestChip({ ...base, state: null })).toMatchObject({
			label: "#12",
			tone: "muted",
		});
		expect(describePullRequestChip({ ...base, state: "merged" })).toMatchObject(
			{ label: "#12 merged", tone: "info" },
		);
		expect(
			describePullRequestChip({
				...base,
				mergeable: "conflicting",
				checks: "failure",
			}).label,
		).toBe("#12 conflicts");
		expect(
			describePullRequestChip({
				...base,
				checks: "failure",
				reviewDecision: "approved",
			}).tone,
		).toBe("danger");
		expect(
			describePullRequestChip({ ...base, reviewDecision: "changes_requested" })
				.tone,
		).toBe("warning");
		expect(describePullRequestChip({ ...base, isDraft: true }).label).toBe(
			"#12 draft",
		);
		expect(
			describePullRequestChip({ ...base, reviewDecision: "approved" }).tone,
		).toBe("success");
		expect(describePullRequestChip({ ...base, checks: "pending" }).label).toBe(
			"#12 checks running",
		);
		expect(describePullRequestChip(base)).toMatchObject({
			label: "#12 in review",
			title: "#12 Fix tax · open",
		});
	});
});

describe("checkout commands", () => {
	it("quotes unusual branch names and adds gh when a PR exists", () => {
		expect(checkoutCommands("feat/x", 12).map((c) => c.command)).toEqual([
			"git fetch origin && git checkout feat/x",
			"gh pr checkout 12",
		]);
		expect(checkoutCommands("odd name's")[0].command).toBe(
			"git fetch origin && git checkout 'odd name'\\''s'",
		);
	});
});

describe("GitHub activity wording", () => {
	it("describes webhook events, automation and links", () => {
		expect(describeGitHubActivity("issue.updated", {})).toBeNull();
		expect(
			describeGitHubActivity("github.pr_event", {
				event: "merged",
				pullNumber: 12,
				title: "Fix",
				actorLogin: "dev",
			}),
		).toEqual({ label: "Pull request merged", detail: "#12 Fix by dev" });
		expect(
			describeGitHubActivity("github.pr_event", {
				event: "branch_pushed",
				branchName: "feat/x",
			}),
		).toEqual({
			label: "Branch pushed",
			detail: "feat/x",
		});
		expect(
			describeGitHubActivity("github.automation_applied", {
				trigger: "pr_merged",
				from: "in_review",
				to: "done",
				pullNumber: 3,
			}),
		).toEqual({
			label: "Status changed by GitHub automation",
			detail: "in_review → done (pull request merged, #3)",
		});
		expect(
			describeGitHubActivity("github.automation_skipped", {
				trigger: "pr_merged",
				reason: "Sub-tasks open",
			})?.detail,
		).toBe("pull request merged: Sub-tasks open");
		expect(
			describeGitHubActivity("github.pr_linked", { pullNumber: 7, title: "T" }),
		).toEqual({
			label: "Linked pull request",
			detail: "#7 T",
		});
		expect(
			describeGitHubActivity("github.repo_linked", { repository: "acme/app" })
				?.detail,
		).toBe("acme/app");
	});

	it("describes review conversation activity", () => {
		expect(
			describeGitHubActivity("github.review_thread_linked", {
				pullNumber: 12,
				path: "src/tax.ts",
				line: 42,
				kind: "follow_up",
			}),
		).toEqual({
			label: "Created from a review conversation",
			detail: "#12 · tax.ts:42 · follow-up",
		});
		expect(
			describeGitHubActivity("github.review_thread_event", {
				event: "resolved",
				path: "src/tax.ts",
				line: 42,
				from: "in_review",
				to: "done",
				actorLogin: "dev",
			}),
		).toEqual({
			label: "Review conversation resolved on GitHub",
			detail: "tax.ts:42 · in_review → done by dev",
		});
		expect(
			describeGitHubActivity("github.review_thread_event", {
				event: "replied",
				path: "src/tax.ts",
				line: 42,
				actorLogin: "reviewer",
			}),
		).toEqual({
			label: "New reply on the review conversation",
			detail: "tax.ts:42 by reviewer",
		});
		expect(
			describeGitHubActivity("github.review_thread_event", {
				event: "sync_failed",
				path: "a.ts",
				reason: "Forbidden",
			}),
		).toEqual({
			label: "Could not update the review conversation on GitHub",
			detail: "a.ts · Forbidden",
		});
	});
});
