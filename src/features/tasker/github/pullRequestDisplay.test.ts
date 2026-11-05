import { describe, expect, it } from "vitest";
import {
	allowedMergeMethods,
	filterPullRequests,
	mergeReadiness,
	type PullRequestSummary,
	parsePullRequestStateFilter,
	pullRequestStateDisplay,
} from "./pullRequestDisplay";

function pullRequest(
	overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
	return {
		number: 42,
		title: "Fix login redirect",
		url: "https://github.com/acme/app/pull/42",
		state: "open",
		isDraft: false,
		author: { login: "octocat", avatarUrl: null, url: null, isBot: false },
		headRefName: "fix/login",
		baseRefName: "main",
		createdAt: 1,
		updatedAt: 2,
		closedAt: null,
		mergedAt: null,
		reviewDecision: null,
		mergeable: "mergeable",
		checks: "success",
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		commentCount: 0,
		labels: [{ name: "bug", color: "ff0000" }],
		reviewRequests: [],
		assignees: [],
		...overrides,
	};
}

describe("pull request display helpers", () => {
	it("parses unknown state filters as open", () => {
		expect(parsePullRequestStateFilter("merged")).toBe("merged");
		expect(parsePullRequestStateFilter("bogus")).toBe("open");
		expect(parsePullRequestStateFilter(undefined)).toBe("open");
	});

	it("labels drafts, merged and closed pull requests", () => {
		expect(
			pullRequestStateDisplay({ state: "open", isDraft: true }).label,
		).toBe("Draft");
		expect(
			pullRequestStateDisplay({ state: "merged", isDraft: false }).label,
		).toBe("Merged");
		expect(
			pullRequestStateDisplay({ state: "closed", isDraft: false }).tone,
		).toBe("danger");
	});

	it("filters by number, title, branch, author and label", () => {
		const rows = [
			pullRequest(),
			pullRequest({
				number: 7,
				title: "Docs",
				headRefName: "docs",
				labels: [],
			}),
		];
		expect(filterPullRequests(rows, "#7").map((row) => row.number)).toEqual([
			7,
		]);
		expect(filterPullRequests(rows, "LOGIN")).toHaveLength(1);
		expect(filterPullRequests(rows, "octocat")).toHaveLength(2);
		expect(filterPullRequests(rows, "bug").map((row) => row.number)).toEqual([
			42,
		]);
		expect(filterPullRequests(rows, "  ")).toHaveLength(2);
	});

	it("explains merge readiness from GitHub merge state", () => {
		const base = {
			state: "open" as const,
			isDraft: false,
			mergeable: "mergeable" as const,
		};
		expect(
			mergeReadiness({ ...base, mergeStateStatus: "CLEAN" }),
		).toMatchObject({ canMerge: true, tone: "success" });
		expect(
			mergeReadiness({
				...base,
				mergeable: "conflicting",
				mergeStateStatus: "DIRTY",
			}).canMerge,
		).toBe(false);
		expect(
			mergeReadiness({ ...base, isDraft: true, mergeStateStatus: "DRAFT" })
				.canMerge,
		).toBe(false);
		expect(
			mergeReadiness({ ...base, mergeStateStatus: "BLOCKED" }),
		).toMatchObject({ canMerge: true, tone: "warning" });
		expect(
			mergeReadiness({ ...base, state: "merged", mergeStateStatus: "CLEAN" })
				.canMerge,
		).toBe(false);
	});

	it("lists only merge methods the repository allows", () => {
		expect(
			allowedMergeMethods({
				mergeCommitAllowed: false,
				squashMergeAllowed: true,
				rebaseMergeAllowed: true,
				deleteBranchOnMerge: false,
				defaultMergeMethod: "squash",
				viewerPermission: null,
			}),
		).toEqual(["squash", "rebase"]);
	});
});
