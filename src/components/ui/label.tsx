import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

type LabelProps = HTMLAttributes<HTMLParagraphElement> & {
	htmlFor?: string;
};

export function Label({ className, htmlFor: _htmlFor, ...props }: LabelProps) {
	return (
		<p
			className={cn(
				"text-xs font-semibold tracking-wide text-[var(--muted-text)]",
				className,
			)}
			{...props}
		/>
	);
}
