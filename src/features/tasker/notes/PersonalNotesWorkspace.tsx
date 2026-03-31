import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMutation, useQuery } from "convex/react";
import {
	Bold,
	Code2,
	FileText,
	Heading1,
	Heading2,
	List,
	ListChecks,
	ListOrdered,
	Pin,
	Plus,
	Quote,
	Trash2,
} from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Input } from "#/components/ui/input";
import { formatRelative } from "#/features/tasker/format";
import {
	normalizeNoteBody,
	stripNoteMarkup,
} from "#/features/tasker/notes/markdown";
import { cn } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

type UserNote = NonNullable<
	ReturnType<typeof useQuery<typeof api.userNotes.list>>
>[number];

type PersonalNotesWorkspaceProps = {
	mode: "modal" | "page";
	onSelectedNoteIdChange?: (noteId: string | null) => void;
	selectedNoteId?: string | null;
};

export type PersonalNotesWorkspaceHandle = {
	flushDraft: () => Promise<void>;
	getSelectedNoteId: () => string | null;
};

type EditorAction = {
	label: string;
	icon: typeof Heading1;
	isActive: (editor: Editor) => boolean;
	run: (editor: Editor) => void;
};

function notePreview(note: UserNote) {
	return note.excerpt || stripNoteMarkup(note.body) || "Empty note";
}

export const PersonalNotesWorkspace = forwardRef<
	PersonalNotesWorkspaceHandle,
	PersonalNotesWorkspaceProps
>(function PersonalNotesWorkspace(
	{ mode, onSelectedNoteIdChange, selectedNoteId },
	ref,
) {
	const [search, setSearch] = useState("");
	const [internalSelectedNoteId, setInternalSelectedNoteId] = useState<
		string | null
	>(selectedNoteId ?? null);
	const [draftTitle, setDraftTitle] = useState("");
	const [draftBody, setDraftBody] = useState("");
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
		"idle",
	);
	const saveTimeoutRef = useRef<number | null>(null);
	const loadedNoteIdRef = useRef<string | null>(null);
	const flushDraftRef = useRef<() => Promise<void>>(async () => {});

	const notes =
		useQuery(api.userNotes.list, {
			search: search.trim() || undefined,
		}) ?? [];
	const createNote = useMutation(api.userNotes.create);
	const updateNote = useMutation(api.userNotes.update);
	const deleteNote = useMutation(api.userNotes.remove);

	const activeNoteId = selectedNoteId ?? internalSelectedNoteId;
	const selectedNote = notes.find((note) => note._id === activeNoteId) ?? null;

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: {
					levels: [1, 2, 3],
				},
			}),
			TaskList,
			TaskItem.configure({
				nested: true,
			}),
			Placeholder.configure({
				placeholder:
					"Start typing. Markdown-style shortcuts work here: #, ##, -, 1., >, and [] for tasks.",
			}),
		],
		content: "<p></p>",
		editorProps: {
			attributes: {
				class: "notes-tiptap",
			},
		},
		onBlur() {
			void flushDraftRef.current();
		},
		onUpdate({ editor: currentEditor }) {
			const nextBody = currentEditor.getHTML();
			setDraftBody((currentValue) =>
				currentValue === nextBody ? currentValue : nextBody,
			);
			setSaveState("idle");
		},
	});

	const editorActions = useMemo<EditorAction[]>(
		() => [
			{
				label: "H1",
				icon: Heading1,
				isActive: (currentEditor) =>
					currentEditor.isActive("heading", { level: 1 }),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleHeading({ level: 1 }).run();
				},
			},
			{
				label: "H2",
				icon: Heading2,
				isActive: (currentEditor) =>
					currentEditor.isActive("heading", { level: 2 }),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleHeading({ level: 2 }).run();
				},
			},
			{
				label: "Bold",
				icon: Bold,
				isActive: (currentEditor) => currentEditor.isActive("bold"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleBold().run();
				},
			},
			{
				label: "Bullet List",
				icon: List,
				isActive: (currentEditor) => currentEditor.isActive("bulletList"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleBulletList().run();
				},
			},
			{
				label: "Numbered List",
				icon: ListOrdered,
				isActive: (currentEditor) => currentEditor.isActive("orderedList"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleOrderedList().run();
				},
			},
			{
				label: "Checklist",
				icon: ListChecks,
				isActive: (currentEditor) => currentEditor.isActive("taskList"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleTaskList().run();
				},
			},
			{
				label: "Quote",
				icon: Quote,
				isActive: (currentEditor) => currentEditor.isActive("blockquote"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleBlockquote().run();
				},
			},
			{
				label: "Code",
				icon: Code2,
				isActive: (currentEditor) => currentEditor.isActive("codeBlock"),
				run: (currentEditor) => {
					currentEditor.chain().focus().toggleCodeBlock().run();
				},
			},
		],
		[],
	);

	const setActiveNoteId = useCallback(
		(noteId: string | null) => {
			setInternalSelectedNoteId(noteId);
			onSelectedNoteIdChange?.(noteId);
		},
		[onSelectedNoteIdChange],
	);

	useEffect(() => {
		if (selectedNoteId !== undefined) {
			setInternalSelectedNoteId(selectedNoteId);
		}
	}, [selectedNoteId]);

	useEffect(() => {
		if (!notes.length) {
			if (activeNoteId !== null) {
				setActiveNoteId(null);
			}
			return;
		}

		if (!activeNoteId || !notes.some((note) => note._id === activeNoteId)) {
			setActiveNoteId(notes[0]?._id ?? null);
		}
	}, [activeNoteId, notes, setActiveNoteId]);

	const isDirty = Boolean(
		selectedNote &&
			(draftTitle !== selectedNote.title || draftBody !== selectedNote.body),
	);

	const persistNoteDraft = useCallback(
		async (note: UserNote, nextTitle: string, nextBody: string) => {
			setIsSaving(true);
			setSaveState("saving");
			try {
				const updatedNote = await updateNote({
					noteId: note._id,
					title: nextTitle,
					body: nextBody,
				});
				if (updatedNote) {
					setDraftTitle(updatedNote.title);
					setDraftBody(updatedNote.body);
				}
				setSaveState("saved");
			} finally {
				setIsSaving(false);
			}
		},
		[updateNote],
	);

	const flushDraft = useCallback(async () => {
		if (saveTimeoutRef.current) {
			window.clearTimeout(saveTimeoutRef.current);
			saveTimeoutRef.current = null;
		}

		if (!selectedNote || !isDirty) {
			return;
		}

		await persistNoteDraft(selectedNote, draftTitle, draftBody);
	}, [draftBody, draftTitle, isDirty, persistNoteDraft, selectedNote]);

	flushDraftRef.current = flushDraft;

	useImperativeHandle(
		ref,
		() => ({
			flushDraft,
			getSelectedNoteId: () => activeNoteId ?? null,
		}),
		[activeNoteId, flushDraft],
	);

	useEffect(() => {
		if (!selectedNote || !isDirty) {
			return;
		}

		saveTimeoutRef.current = window.setTimeout(() => {
			void persistNoteDraft(selectedNote, draftTitle, draftBody);
			saveTimeoutRef.current = null;
		}, 500);

		return () => {
			if (saveTimeoutRef.current) {
				window.clearTimeout(saveTimeoutRef.current);
				saveTimeoutRef.current = null;
			}
		};
	}, [draftBody, draftTitle, isDirty, persistNoteDraft, selectedNote]);

	useEffect(() => {
		if (!editor) {
			return;
		}

		if (!selectedNote) {
			loadedNoteIdRef.current = null;
			setDraftTitle("");
			setDraftBody("");
			setSaveState("idle");
			editor.setEditable(false);
			editor.commands.setContent("<p></p>", false);
			return;
		}

		editor.setEditable(true);

		const nextBody = selectedNote.body;
		const nextEditorBody = normalizeNoteBody(nextBody);
		const noteChanged = loadedNoteIdRef.current !== selectedNote._id;

		if (noteChanged) {
			loadedNoteIdRef.current = selectedNote._id;
			setDraftTitle(selectedNote.title);
			setDraftBody(nextBody);
			setSaveState("idle");
			editor.commands.setContent(nextEditorBody, false);
			return;
		}

		if (!isDirty && draftTitle !== selectedNote.title) {
			setDraftTitle(selectedNote.title);
		}

		if (!isDirty && draftBody !== nextBody) {
			setDraftBody(nextBody);
			editor.commands.setContent(nextEditorBody, false);
			setSaveState("idle");
		}
	}, [draftBody, draftTitle, editor, isDirty, selectedNote]);

	async function handleCreateNote() {
		setIsCreating(true);
		try {
			await flushDraft();
			setSearch("");
			const createdNote = await createNote({
				title: "Untitled note",
				body: "",
			});
			setActiveNoteId(createdNote?._id ?? null);
		} finally {
			setIsCreating(false);
		}
	}

	async function handleSelectNote(noteId: string) {
		if (noteId === activeNoteId) {
			return;
		}

		await flushDraft();
		setActiveNoteId(noteId);
	}

	async function handleTogglePinned() {
		if (!selectedNote) {
			return;
		}

		await flushDraft();
		await updateNote({
			noteId: selectedNote._id,
			pinned: !selectedNote.pinned,
		});
	}

	async function handleDeleteNote() {
		if (!selectedNote) {
			return;
		}

		setIsDeleting(true);
		try {
			const selectedIndex = notes.findIndex(
				(note) => note._id === selectedNote._id,
			);
			const fallbackNoteId =
				notes[selectedIndex + 1]?._id ?? notes[selectedIndex - 1]?._id ?? null;
			await deleteNote({
				noteId: selectedNote._id as Id<"userNotes">,
			});
			setActiveNoteId(fallbackNoteId);
			setDeleteConfirmOpen(false);
		} finally {
			setIsDeleting(false);
		}
	}

	return (
		<>
			<div
				className={cn(
					"notes-workspace",
					mode === "modal" ? "notes-workspace-modal" : "notes-workspace-page",
				)}
			>
				<section className="notes-list-pane">
					<div className="notes-list-toolbar">
						<div className="min-w-0 flex-1">
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search notes"
							/>
						</div>
						<Button
							type="button"
							variant="secondary"
							className="whitespace-nowrap"
							disabled={isCreating}
							onClick={() => void handleCreateNote()}
						>
							<Plus className="mr-2 h-4 w-4" />
							New note
						</Button>
					</div>

					<div className="notes-card-list">
						{notes.length ? (
							notes.map((note) => (
								<button
									key={note._id}
									type="button"
									className={cn(
										"notes-card",
										note._id === activeNoteId ? "notes-card-active" : "",
									)}
									onClick={() => void handleSelectNote(note._id)}
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="notes-card-title">{note.title}</p>
											<p className="notes-card-meta">
												Updated {formatRelative(note.updatedAt)}
											</p>
										</div>
										{note.pinned ? (
											<Badge className="notes-pin-badge">Pinned</Badge>
										) : null}
									</div>
									<p className="notes-card-body">{notePreview(note)}</p>
								</button>
							))
						) : (
							<div className="notes-empty">
								<FileText className="h-5 w-5" />
								<p className="m-0 text-sm">
									{search.trim()
										? "No notes match this search."
										: "No notes yet. Create the first one."}
								</p>
							</div>
						)}
					</div>
				</section>

				<section className="notes-editor-pane">
					{selectedNote ? (
						<>
							<div className="notes-editor-header">
								<div className="min-w-0 flex-1">
									<Input
										className="notes-title-input"
										value={draftTitle}
										onBlur={() => void flushDraft()}
										onChange={(event) => {
											setDraftTitle(event.target.value);
											setSaveState("idle");
										}}
										placeholder="Untitled note"
									/>
									<p className="notes-editor-status">
										{isSaving
											? "Saving..."
											: saveState === "saved"
												? "Saved"
												: `Updated ${formatRelative(selectedNote.updatedAt)}`}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => void handleTogglePinned()}
									>
										<Pin className="mr-1.5 h-4 w-4" />
										{selectedNote.pinned ? "Unpin" : "Pin"}
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => setDeleteConfirmOpen(true)}
									>
										<Trash2 className="mr-1.5 h-4 w-4" />
										Delete
									</Button>
								</div>
							</div>

							<div className="notes-editor-body">
								<div className="notes-editor-toolbar">
									{editorActions.map((action) => {
										const Icon = action.icon;
										const isActive = editor ? action.isActive(editor) : false;

										return (
											<Button
												key={action.label}
												type="button"
												size="sm"
												variant="ghost"
												className={cn(
													"notes-toolbar-button",
													isActive ? "notes-toolbar-button-active" : "",
												)}
												title={action.label}
												disabled={!editor}
												onClick={() => {
													if (!editor) {
														return;
													}
													action.run(editor);
												}}
											>
												<Icon className="h-3.5 w-3.5" />
												<span>{action.label}</span>
											</Button>
										);
									})}
								</div>

								<div className="notes-editor-surface">
									<div className="notes-editor-scroll">
										<EditorContent
											editor={editor}
											className="notes-rich-editor"
										/>
									</div>
								</div>
							</div>
						</>
					) : (
						<div className="notes-empty notes-editor-empty">
							<FileText className="h-6 w-6" />
							<p className="m-0 text-sm">
								Create a note or pick one from the list to start writing.
							</p>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void handleCreateNote()}
							>
								<Plus className="mr-2 h-4 w-4" />
								Create note
							</Button>
						</div>
					)}
				</section>
			</div>

			<ConfirmDialog
				open={deleteConfirmOpen}
				title="Delete note"
				description="This note is private to you. Deleting it removes it permanently."
				confirmLabel="Delete note"
				confirmingLabel="Deleting..."
				isConfirming={isDeleting}
				onCancel={() => setDeleteConfirmOpen(false)}
				onConfirm={() => void handleDeleteNote()}
			/>
		</>
	);
});
