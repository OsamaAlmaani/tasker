import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_24px_rgba(4,10,24,0.08)]",
				className,
			)}
			{...props}
		/>
	);
}

export function CardHeader({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("p-4 pb-2", className)} {...props} />;
}

export function CardTitle({
	className,
	...props
}: HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h3
			className={cn(
				"text-sm font-semibold tracking-tight text-[var(--text)]",
				className,
			)}
			{...props}
		/>
	);
}

export function CardContent({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("p-4 pt-2", className)} {...props} />;
}
