import * as React from "react";
import { cn } from "#/lib/utils";

export const Select = React.forwardRef<
	HTMLSelectElement,
	React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
	<select
		ref={ref}
		className={cn(
			"h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]",
			className,
		)}
		{...props}
	>
		{children}
	</select>
));
Select.displayName = "Select";
