import { cn } from "#/lib/utils";

type SwitchProps = {
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	className?: string;
};

export function Switch({
	checked,
	onChange,
	disabled,
	className,
}: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-6 w-10 items-center rounded-full border border-[var(--line)] transition disabled:opacity-40",
				checked ? "bg-[var(--accent)]" : "bg-[var(--surface-muted)]",
				className,
			)}
		>
			<span
				className={cn(
					"ml-0.5 h-4 w-4 rounded-full bg-white transition",
					checked ? "translate-x-4" : "translate-x-0",
				)}
			/>
		</button>
	);
}
