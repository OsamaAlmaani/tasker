import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "#/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
	{
		variants: {
			variant: {
				primary:
					"bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90",
				secondary:
					"border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text)] hover:bg-[var(--surface)]",
				ghost:
					"text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
				danger:
					"bg-[color-mix(in_oklab,var(--danger)_88%,black_12%)] text-white hover:opacity-90",
			},
			size: {
				sm: "h-8 px-3",
				md: "h-9 px-4",
				lg: "h-10 px-5",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "md",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, ...props }, ref) => {
		return (
			<button
				ref={ref}
				className={cn(buttonVariants({ variant, size }), className)}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";
