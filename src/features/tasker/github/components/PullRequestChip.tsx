import { GitPullRequest } from "lucide-react";
import { cn } from "#/lib/utils";
import {
	describePullRequestChip,
	type PullRequestChipData,
} from "../linkDisplay";
import { toneTextClasses } from "./GitHubBadges";

const toneBorderClasses: Record<string, string> = {
	success: "border-emerald-300/70 dark:border-emerald-800",
	danger: "border-rose-300/70 dark:border-rose-800",
	warning: "border-amber-300/70 dark:border-amber-800",
	info: "border-violet-300/70 dark:border-violet-800",
	muted: "border-[var(--line)]",
};

/**
 * Compact pull request indicators for task rows and cards. They sit inside the
 * row's own link, so they are plain text; the task page holds the full panel.
 */
export function PullRequestChips({
	chips,
	className,
	max = 3,
}: {
	chips: PullRequestChipData[] | undefined;
	className?: string;
	max?: number;
}) {
	if (!chips?.length) return null;
	const shown = chips.slice(0, max);
	const hidden = chips.length - shown.length;
	return (
		<span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
			{shown.map((chip) => {
				const { label, tone, title } = describePullRequestChip(chip);
				return (
					<span
						key={chip.pullNumber}
						title={title}
						className={cn(
							"inline-flex items-center gap-1 rounded-full border bg-[var(--surface)] px-1.5 py-0 text-[10px] font-medium leading-4",
							toneBorderClasses[tone],
							toneTextClasses[tone],
						)}
					>
						<GitPullRequest className="h-3 w-3" aria-hidden="true" />
						{label}
					</span>
				);
			})}
			{hidden > 0 ? (
				<span className="text-[10px] text-[var(--muted-text)]">+{hidden}</span>
			) : null}
		</span>
	);
}
