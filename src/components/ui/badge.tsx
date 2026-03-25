import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

export function Badge({
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn(
				"inline-flex items-center whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--muted-text)]",
				className,
			)}
			{...props}
		/>
	);
}
