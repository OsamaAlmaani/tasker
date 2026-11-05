import { useRouter } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Textarea } from "#/components/ui/textarea";
import { cn, getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type { GitHubReaction } from "#convex/lib/githubApi";
import { type GitHubHtmlContext, prepareGitHubHtml } from "../githubHtml";
import "./githubMarkdown.css";

const COLLAPSED_HEIGHT = 420;

function copyTextFor(button: Element) {
	const block = button.closest(".gh-code-block");
	if (!block) return "";
	const snippet = block.getAttribute("data-snippet-clipboard-copy-content");
	if (snippet !== null) return snippet;
	return [...block.childNodes]
		.filter((node) => node !== button)
		.map((node) => node.textContent ?? "")
		.join("");
}

/** GitHub-rendered markdown, sanitized and adapted to Tasker. */
export function GitHubHtml({
	html,
	context,
	collapsible = false,
	empty = null,
	className,
}: {
	html: string;
	context: GitHubHtmlContext;
	/** Fold very long bodies (bot reports, logs) behind "Show more". */
	collapsible?: boolean;
	empty?: React.ReactNode;
	className?: string;
}) {
	const router = useRouter();
	const prepared = useMemo(
		() =>
			prepareGitHubHtml(html, {
				repository: context.repository,
				projectId: context.projectId,
			}),
		[html, context.repository, context.projectId],
	);
	const contentRef = useRef<HTMLDivElement>(null);
	const [isLong, setIsLong] = useState(false);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		const content = contentRef.current;
		if (!collapsible || !content || !prepared) return;
		const measure = () =>
			// Leave a margin so a comment is never folded to hide a few lines.
			setIsLong(content.scrollHeight > COLLAPSED_HEIGHT + 160);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [collapsible, prepared]);

	if (!prepared) return <>{empty}</>;

	function onClick(event: MouseEvent<HTMLDivElement>) {
		const target = event.target as Element;
		const copyButton = target.closest("[data-gh-copy]");
		if (copyButton) {
			event.preventDefault();
			void navigator.clipboard
				?.writeText(copyTextFor(copyButton))
				.then(() => {
					copyButton.textContent = "Copied";
					window.setTimeout(() => {
						copyButton.textContent = "Copy";
					}, 1500);
				})
				.catch(() => {
					copyButton.textContent = "Copy failed";
				});
			return;
		}
		const link = target.closest("a[data-tasker-link]");
		if (
			link &&
			event.button === 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.shiftKey &&
			!event.altKey
		) {
			event.preventDefault();
			router.history.push(link.getAttribute("href") ?? "/");
		}
	}

	const folded = isLong && !expanded;
	return (
		<div className={cn("relative", className)}>
			<div
				className={cn(folded && "overflow-hidden")}
				style={folded ? { maxHeight: COLLAPSED_HEIGHT } : undefined}
			>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: delegates clicks to links and buttons inside rendered markdown, which handle the keyboard themselves */}
				<div
					ref={contentRef}
					className="github-markdown"
					onClick={onClick}
					// prepareGitHubHtml sanitizes with an allowlist before rendering.
					// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized GitHub HTML
					dangerouslySetInnerHTML={{ __html: prepared }}
				/>
			</div>
			{folded ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-9 h-24 bg-gradient-to-t from-[var(--surface)] to-transparent" />
			) : null}
			{isLong ? (
				<button
					type="button"
					className="mt-2 inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--surface-muted)]"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show less" : "Show full comment"}
				</button>
			) : null}
		</div>
	);
}

export function GitHubReactions({
	reactions,
	className,
}: {
	reactions: GitHubReaction[];
	className?: string;
}) {
	if (!reactions.length) return null;
	return (
		<ul
			className={cn("m-0 flex list-none flex-wrap gap-1.5 p-0", className)}
			aria-label="Reactions"
		>
			{reactions.map((reaction) => (
				<li
					key={reaction.label}
					title={`${reaction.label}: ${reaction.count}${reaction.viewerHasReacted ? " (including you)" : ""}`}
					className={cn(
						"inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums",
						reaction.viewerHasReacted
							? "border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--text)]"
							: "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted-text)]",
					)}
				>
					<span aria-hidden="true">{reaction.emoji}</span>
					<span>{reaction.count}</span>
				</li>
			))}
		</ul>
	);
}

type PreviewState = {
	text: string;
	html: string | null;
	error: string | null;
	loading: boolean;
};

/** Markdown input with a preview that GitHub renders. */
export function MarkdownEditor({
	value,
	onChange,
	onSubmit,
	projectId,
	context,
	placeholder,
	label,
	autoFocus,
	disabled,
	compact = false,
}: {
	value: string;
	onChange: (value: string) => void;
	/** Called on Cmd/Ctrl + Enter. */
	onSubmit?: () => void;
	projectId: Id<"projects">;
	context: GitHubHtmlContext;
	placeholder: string;
	label: string;
	autoFocus?: boolean;
	disabled?: boolean;
	compact?: boolean;
}) {
	const renderPreview = useAction(api.githubActions.previewMarkdown);
	const [tab, setTab] = useState<"write" | "preview">("write");
	const [preview, setPreview] = useState<PreviewState>({
		text: "",
		html: null,
		error: null,
		loading: false,
	});
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Text of the last finished preview, so switching tabs does not re-render it.
	const renderedTextRef = useRef<string | null>(null);

	useEffect(() => {
		if (tab !== "preview" || renderedTextRef.current === value) return;
		let cancelled = false;
		setPreview({ text: value, html: null, error: null, loading: true });
		renderPreview({ projectId, body: value })
			.then(({ html }) => {
				if (cancelled) return;
				renderedTextRef.current = value;
				setPreview({ text: value, html, error: null, loading: false });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setPreview({
					text: value,
					html: null,
					error: getClientErrorMessage(error, "Could not render a preview."),
					loading: false,
				});
			});
		return () => {
			cancelled = true;
		};
	}, [tab, value, projectId, renderPreview]);

	useEffect(() => {
		if (autoFocus) textareaRef.current?.focus();
	}, [autoFocus]);

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmit) {
			event.preventDefault();
			onSubmit();
		}
	}

	const tabClass = (active: boolean) =>
		cn(
			"rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
			active
				? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
				: "text-[var(--muted-text)] hover:text-[var(--text)]",
		);
	const minHeight = compact ? "min-h-20" : "min-h-28";

	return (
		<div className="space-y-2">
			<div
				role="tablist"
				aria-label={`${label} mode`}
				className="inline-flex gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-0.5"
			>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "write"}
					className={tabClass(tab === "write")}
					onClick={() => {
						setTab("write");
						window.requestAnimationFrame(() => textareaRef.current?.focus());
					}}
				>
					Write
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "preview"}
					className={tabClass(tab === "preview")}
					onClick={() => setTab("preview")}
				>
					Preview
				</button>
			</div>
			{tab === "write" ? (
				<Textarea
					ref={textareaRef}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					aria-label={label}
					disabled={disabled}
					className={cn(minHeight, "resize-y font-[inherit] leading-relaxed")}
				/>
			) : (
				<div
					className={cn(
						minHeight,
						"rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2",
					)}
					aria-live="polite"
				>
					{!value.trim() ? (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Nothing to preview yet.
						</p>
					) : preview.loading ? (
						<p className="m-0 text-sm text-[var(--muted-text)]">
							Rendering preview…
						</p>
					) : preview.error ? (
						<p className="m-0 text-sm text-[var(--danger)]">{preview.error}</p>
					) : (
						<GitHubHtml html={preview.html ?? ""} context={context} />
					)}
				</div>
			)}
			<p className="m-0 text-xs text-[var(--muted-text)]">
				Markdown supported.{onSubmit ? " ⌘ or Ctrl + Enter to send." : ""}
			</p>
		</div>
	);
}
