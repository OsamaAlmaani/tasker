import { useMutation } from "convex/react";
import { MessageSquareQuote, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { getClientErrorMessage } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import { Modal } from "./Modal";

/** A button that inserts one of the user's saved replies. */
export function SnippetMenu({
	snippets,
	onInsert,
	onEdit,
	disabled,
}: {
	snippets: string[];
	onInsert: (snippet: string) => void;
	onEdit: () => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div className="relative" ref={ref}>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-8 gap-1 px-2 text-xs"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen((value) => !value)}
			>
				<MessageSquareQuote className="h-3.5 w-3.5" aria-hidden="true" />
				Snippets
			</Button>
			{open ? (
				<div
					role="menu"
					className="absolute bottom-full left-0 z-30 mb-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_32px_rgba(8,12,26,0.18)]"
				>
					<ul className="m-0 max-h-64 list-none overflow-auto p-1">
						{snippets.map((snippet) => (
							<li key={snippet}>
								<button
									type="button"
									role="menuitem"
									className="w-full rounded px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
									onClick={() => {
										onInsert(snippet);
										setOpen(false);
									}}
								>
									<span className="line-clamp-2">{snippet}</span>
								</button>
							</li>
						))}
					</ul>
					<button
						type="button"
						role="menuitem"
						className="w-full border-t border-[var(--line)] px-3 py-2 text-left text-xs text-[var(--accent)] hover:bg-[var(--surface-muted)]"
						onClick={() => {
							setOpen(false);
							onEdit();
						}}
					>
						Edit snippets…
					</button>
				</div>
			) : null}
		</div>
	);
}

/** Edits the user's saved replies. Saving an empty list restores the defaults. */
export function SnippetEditor({
	snippets,
	customized,
	onClose,
}: {
	snippets: string[];
	customized: boolean;
	onClose: () => void;
}) {
	const save = useMutation(api.githubReviewInbox.saveReplySnippets);
	const [drafts, setDrafts] = useState(() => [...snippets]);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(next: string[]) {
		setWorking(true);
		setError(null);
		try {
			await save({ snippets: next });
			onClose();
		} catch (caught) {
			setError(getClientErrorMessage(caught, "Could not save the snippets."));
		} finally {
			setWorking(false);
		}
	}

	return (
		<Modal title="Reply snippets" onClose={onClose}>
			<div className="space-y-3 text-sm">
				<p className="m-0 text-xs text-[var(--muted-text)]">
					Saved replies for review conversations. Only you see them.
				</p>
				<ul className="m-0 list-none space-y-2 p-0">
					{drafts.map((draft, index) => (
						// Positions are the identity while editing; text changes as you type.
						// biome-ignore lint/suspicious/noArrayIndexKey: editable list rows
						<li key={index} className="flex items-start gap-2">
							<Textarea
								aria-label={`Snippet ${index + 1}`}
								className="min-h-14 flex-1 text-sm"
								value={draft}
								onChange={(event) =>
									setDrafts((previous) =>
										previous.map((value, position) =>
											position === index ? event.target.value : value,
										),
									)
								}
							/>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-8 w-8 p-0"
								aria-label={`Remove snippet ${index + 1}`}
								onClick={() =>
									setDrafts((previous) =>
										previous.filter((_, position) => position !== index),
									)
								}
							>
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</li>
					))}
				</ul>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					disabled={drafts.length >= 12}
					onClick={() => setDrafts((previous) => [...previous, ""])}
				>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add snippet
				</Button>
				{error ? (
					<p role="alert" className="m-0 text-xs text-[var(--danger)]">
						{error}
					</p>
				) : null}
				<div className="flex flex-wrap justify-between gap-2">
					{customized ? (
						<Button
							type="button"
							variant="ghost"
							disabled={working}
							onClick={() => void submit([])}
						>
							Restore defaults
						</Button>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={working}
							onClick={() => void submit(drafts)}
						>
							{working ? "Saving…" : "Save"}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
