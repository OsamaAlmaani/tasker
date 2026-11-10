import { useEffect } from "react";

/** Centered dialog used by the GitHub panels. Escape closes it. */
export function Modal({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);
	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<h2 className="m-0 mb-3 text-base font-semibold">{title}</h2>
				{children}
			</div>
		</div>
	);
}
