import * as React from "react";
import { cn } from "#/lib/utils";

export const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
	<textarea
		ref={ref}
		className={cn(
			"min-h-28 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-text)] focus:border-[var(--accent)]",
			className,
		)}
		{...props}
	/>
));
Textarea.displayName = "Textarea";
