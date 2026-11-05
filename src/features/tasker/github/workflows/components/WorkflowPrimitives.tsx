import {
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleMinus,
	CirclePause,
	CircleSlash,
	CircleX,
	LoaderCircle,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#/lib/utils";
import { RUN_STATE_LABELS, type RunVisualState } from "../workflowDisplay";
import "./workflows.css";

export const RUN_STATE_TEXT: Record<RunVisualState, string> = {
	success: "text-emerald-600 dark:text-emerald-400",
	failure: "text-rose-600 dark:text-rose-400",
	running: "text-amber-600 dark:text-amber-400",
	queued: "text-[var(--muted-text)]",
	waiting: "text-violet-600 dark:text-violet-400",
	cancelled: "text-[var(--muted-text)]",
	skipped: "text-[var(--muted-text)]",
	neutral: "text-[var(--muted-text)]",
};

/** Solid fills for tiles, bars and dots. */
export const RUN_STATE_FILL: Record<RunVisualState, string> = {
	success: "bg-emerald-500 dark:bg-emerald-500/90",
	failure: "bg-rose-500 dark:bg-rose-500/90",
	running: "bg-amber-400 dark:bg-amber-400/90",
	queued:
		"bg-[color-mix(in_oklab,var(--muted-text)_35%,transparent)] dark:bg-[color-mix(in_oklab,var(--muted-text)_40%,transparent)]",
	waiting: "bg-violet-500",
	cancelled: "bg-[color-mix(in_oklab,var(--muted-text)_60%,transparent)]",
	skipped: "bg-[color-mix(in_oklab,var(--muted-text)_25%,transparent)]",
	neutral: "bg-[color-mix(in_oklab,var(--muted-text)_50%,transparent)]",
};

const ICONS: Record<RunVisualState, typeof CircleCheck> = {
	success: CircleCheck,
	failure: CircleX,
	running: LoaderCircle,
	queued: CircleDashed,
	waiting: CirclePause,
	cancelled: CircleSlash,
	skipped: CircleMinus,
	neutral: CircleDot,
};

export function RunStatusIcon({
	state,
	className,
	label = true,
}: {
	state: RunVisualState;
	className?: string;
	/** Announce the state to screen readers. */
	label?: boolean;
}) {
	const Icon = ICONS[state];
	return (
		<Icon
			className={cn(
				"h-4 w-4 shrink-0",
				RUN_STATE_TEXT[state],
				state === "running" && "animate-spin [animation-duration:1.6s]",
				className,
			)}
			aria-label={label ? RUN_STATE_LABELS[state] : undefined}
			aria-hidden={label ? undefined : true}
			role={label ? "img" : undefined}
		/>
	);
}

/** Ticks every `intervalMs` while `active`, for live durations. */
export function useNow(active: boolean, intervalMs = 1000) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [active, intervalMs]);
	return now;
}

export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--line)] bg-[var(--surface)] px-1 font-mono text-[10px] font-medium text-[var(--muted-text)] shadow-[inset_0_-1px_0_var(--line)]">
			{children}
		</kbd>
	);
}

export function Checkbox({
	checked,
	indeterminate = false,
	onChange,
	disabled,
	label,
	className,
	title,
	id,
}: {
	checked: boolean;
	indeterminate?: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	/** Accessible name. */
	label: string;
	className?: string;
	title?: string;
	id?: string;
}) {
	const ref = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);
	return (
		<input
			ref={ref}
			id={id}
			type="checkbox"
			className={cn(
				"h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--line)] accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40",
				className,
			)}
			checked={checked}
			disabled={disabled}
			aria-label={label}
			title={title}
			onChange={(event) => onChange(event.target.checked)}
			onClick={(event) => event.stopPropagation()}
		/>
	);
}

/**
 * Dialog shell: closes on Escape and backdrop click, keeps focus inside, and
 * becomes a full-height sheet on small screens.
 */
export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	size = "md",
	closeDisabled = false,
	initialFocusRef,
}: {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	size?: "md" | "lg" | "xl";
	closeDisabled?: boolean;
	initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		const focusTarget =
			initialFocusRef?.current ??
			panelRef.current?.querySelector<HTMLElement>(
				"[data-autofocus], input, textarea, select, button",
			);
		window.requestAnimationFrame(() => focusTarget?.focus());
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = overflow;
			previous?.focus?.();
		};
	}, [open, initialFocusRef]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !closeDisabled) {
				event.stopPropagation();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab" || !panelRef.current) return;
			const focusable = [
				...panelRef.current.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			].filter((element) => element.offsetParent !== null);
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open, closeDisabled]);

	if (!open) return null;

	const width =
		size === "xl"
			? "sm:max-w-4xl"
			: size === "lg"
				? "sm:max-w-2xl"
				: "sm:max-w-lg";

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes the dialog; Escape does the same from the keyboard
		<div
			className="modal-overlay fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-4 sm:py-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !closeDisabled) onClose();
			}}
		>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className={cn(
					"workflow-modal flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_70px_rgba(8,12,26,0.35)] sm:max-h-[min(88dvh,900px)] sm:rounded-xl",
					width,
				)}
			>
				<div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
					<div className="min-w-0 space-y-1">
						<h2
							id={titleId}
							className="m-0 text-base font-semibold text-[var(--text)]"
						>
							{title}
						</h2>
						{description ? (
							<div className="text-sm text-[var(--muted-text)]">
								{description}
							</div>
						) : null}
					</div>
					<button
						type="button"
						className="-mt-1 -mr-2 rounded-md p-1.5 text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)] disabled:opacity-40"
						onClick={onClose}
						disabled={closeDisabled}
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{children}
				</div>
				{footer ? (
					<div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3">
						{footer}
					</div>
				) : null}
			</div>
		</div>
	);
}

/** A segmented bar of run states, sized by count. */
export function StateBar({
	counts,
	total,
	className,
}: {
	counts: Partial<Record<RunVisualState, number>>;
	total: number;
	className?: string;
}) {
	const order: RunVisualState[] = [
		"success",
		"failure",
		"cancelled",
		"running",
		"waiting",
		"queued",
		"skipped",
		"neutral",
	];
	return (
		<div
			className={cn(
				"flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]",
				className,
			)}
			aria-hidden="true"
		>
			{order.map((state) => {
				const count = counts[state] ?? 0;
				if (!count || !total) return null;
				return (
					<span
						key={state}
						className={cn(
							RUN_STATE_FILL[state],
							state === "running" && "workflow-stripes",
						)}
						style={{ width: `${(count / total) * 100}%` }}
					/>
				);
			})}
		</div>
	);
}
