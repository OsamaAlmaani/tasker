import * as React from "react";
import { cn } from "#/lib/utils";

export const Input = React.forwardRef<
	HTMLInputElement,
	React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
	<input
		ref={ref}
		className={cn(
			"h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-text)] focus:border-[var(--accent)]",
			className,
		)}
		{...props}
	/>
));
Input.displayName = "Input";
