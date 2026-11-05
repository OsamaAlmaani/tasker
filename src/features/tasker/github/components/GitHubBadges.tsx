import {
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
} from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";
import {
	type DisplayTone,
	type PullRequestSummary,
	pullRequestStateDisplay,
} from "../pullRequestDisplay";

export const toneTextClasses: Record<DisplayTone, string> = {
	success: "text-emerald-600 dark:text-emerald-400",
	danger: "text-rose-600 dark:text-rose-400",
	warning: "text-amber-600 dark:text-amber-400",
	info: "text-violet-600 dark:text-violet-400",
	muted: "text-[var(--muted-text)]",
};

const toneBadgeClasses: Record<DisplayTone, string> = {
	success:
		"border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
	danger:
		"border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300",
	warning:
		"border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300",
	info: "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300",
	muted: "",
};

export function ToneBadge({
	tone,
	children,
	className,
	title,
}: {
	tone: DisplayTone;
	children: React.ReactNode;
	className?: string;
	title?: string;
}) {
	return (
		<Badge className={cn(toneBadgeClasses[tone], className)} title={title}>
			{children}
		</Badge>
	);
}

export function PullRequestStateIcon({
	pullRequest,
	className,
}: {
	pullRequest: Pick<PullRequestSummary, "state" | "isDraft">;
	className?: string;
}) {
	const { label, tone } = pullRequestStateDisplay(pullRequest);
	const Icon =
		pullRequest.state === "merged"
			? GitMerge
			: pullRequest.state === "closed"
				? GitPullRequestClosed
				: pullRequest.isDraft
					? GitPullRequestDraft
					: GitPullRequest;
	return (
		<Icon
			className={cn("h-4 w-4 shrink-0", toneTextClasses[tone], className)}
			aria-label={label}
		/>
	);
}

export function PullRequestStateBadge({
	pullRequest,
}: {
	pullRequest: Pick<PullRequestSummary, "state" | "isDraft">;
}) {
	const { label, tone } = pullRequestStateDisplay(pullRequest);
	return (
		<ToneBadge tone={tone} className="gap-1">
			<PullRequestStateIcon pullRequest={pullRequest} className="h-3.5 w-3.5" />
			{label}
		</ToneBadge>
	);
}

export function GitHubLabelChip({
	name,
	color,
}: {
	name: string;
	color: string;
}) {
	const hex = /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#6b7280";
	return (
		<span
			className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
			style={{
				backgroundColor: `${hex}1f`,
				borderColor: `${hex}66`,
				color: "var(--text)",
			}}
		>
			{name}
		</span>
	);
}

export function GitHubAvatar({
	login,
	avatarUrl,
	size = 20,
}: {
	login: string;
	avatarUrl: string | null;
	size?: number;
}) {
	if (!avatarUrl) {
		return (
			<span
				className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] font-semibold text-[var(--muted-text)]"
				style={{ width: size, height: size }}
				aria-hidden="true"
			>
				{login.slice(0, 1).toUpperCase()}
			</span>
		);
	}
	return (
		<img
			src={avatarUrl}
			alt=""
			width={size}
			height={size}
			className="shrink-0 rounded-full"
			loading="lazy"
		/>
	);
}
