import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	Bold,
	Check,
	Code2,
	Heading1,
	Heading2,
	Italic,
	Link,
	List,
	ListOrdered,
	Quote,
	Redo2,
	Strikethrough,
	Undo2,
	Unlink,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	type DescriptionDoc,
	type DescriptionValue,
	descriptionText,
	isDescriptionLink,
	plainDescriptionDoc,
} from "#convex/lib/issueDescriptions";
import "./descriptionEditor.css";

export function DescriptionEditor({
	value,
	onChange,
	readOnly = false,
	disabled = false,
}: {
	value: DescriptionValue;
	onChange?: (value: DescriptionValue) => void;
	readOnly?: boolean;
	disabled?: boolean;
}) {
	const [linkOpen, setLinkOpen] = useState(false);
	const [href, setHref] = useState("");
	const [linkError, setLinkError] = useState("");
	const lastContentRef = useRef("");
	const content = useMemo(
		() => value.descriptionDoc ?? plainDescriptionDoc(value.description),
		[value.descriptionDoc, value.description],
	);
	const extensions = useMemo(
		() => [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
				link: { openOnClick: readOnly, isAllowedUri: isDescriptionLink },
			}),
			Placeholder.configure({ placeholder: "Description" }),
		],
		[readOnly],
	);
	const editor = useEditor({
		immediatelyRender: false,
		extensions,
		content,
		editable: !readOnly && !disabled,
		editorProps: {
			attributes: {
				class: "task-description-content",
				"aria-label": "Description",
				role: "textbox",
				"aria-multiline": "true",
			},
		},
		onUpdate({ editor }) {
			const doc = editor.getJSON() as DescriptionDoc;
			lastContentRef.current = JSON.stringify(doc);
			onChange?.({ description: descriptionText(doc), descriptionDoc: doc });
		},
	});
	useEffect(() => {
		editor?.setEditable(!readOnly && !disabled);
	}, [editor, readOnly, disabled]);
	useEffect(() => {
		const serialized = JSON.stringify(content);
		if (editor && lastContentRef.current !== serialized) {
			editor.commands.setContent(content, { emitUpdate: false });
			lastContentRef.current = serialized;
		}
	}, [content, editor]);
	const state = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor
				? {
						bold: editor.isActive("bold"),
						italic: editor.isActive("italic"),
						strike: editor.isActive("strike"),
						h1: editor.isActive("heading", { level: 1 }),
						h2: editor.isActive("heading", { level: 2 }),
						bullet: editor.isActive("bulletList"),
						ordered: editor.isActive("orderedList"),
						quote: editor.isActive("blockquote"),
						code: editor.isActive("codeBlock"),
						link: editor.isActive("link"),
						canUndo: editor.can().undo(),
						canRedo: editor.can().redo(),
					}
				: null,
	});
	const actions = [
		{
			label: "Bold",
			icon: Bold,
			active: state?.bold,
			run: () => editor?.chain().focus().toggleBold().run(),
		},
		{
			label: "Italic",
			icon: Italic,
			active: state?.italic,
			run: () => editor?.chain().focus().toggleItalic().run(),
		},
		{
			label: "Strikethrough",
			icon: Strikethrough,
			active: state?.strike,
			run: () => editor?.chain().focus().toggleStrike().run(),
		},
		{
			label: "Heading 1",
			icon: Heading1,
			active: state?.h1,
			run: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
		},
		{
			label: "Heading 2",
			icon: Heading2,
			active: state?.h2,
			run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
		},
		{
			label: "Bullet list",
			icon: List,
			active: state?.bullet,
			run: () => editor?.chain().focus().toggleBulletList().run(),
		},
		{
			label: "Numbered list",
			icon: ListOrdered,
			active: state?.ordered,
			run: () => editor?.chain().focus().toggleOrderedList().run(),
		},
		{
			label: "Quote",
			icon: Quote,
			active: state?.quote,
			run: () => editor?.chain().focus().toggleBlockquote().run(),
		},
		{
			label: "Code block",
			icon: Code2,
			active: state?.code,
			run: () => editor?.chain().focus().toggleCodeBlock().run(),
		},
	];
	function applyLink() {
		const link = href.trim();
		if (!isDescriptionLink(link)) {
			setLinkError("Use an http, https, mailto, or tel link.");
			return;
		}
		editor
			?.chain()
			.focus()
			.extendMarkRange("link")
			.setLink({ href: link })
			.run();
		setLinkOpen(false);
		setLinkError("");
	}
	return (
		<div
			className={
				readOnly ? "task-description-reader" : "task-description-editor"
			}
		>
			{!readOnly ? (
				<>
					<fieldset
						disabled={disabled}
						className="task-description-toolbar"
						aria-label="Description formatting"
					>
						{actions.map(({ label, icon: Icon, active, run }) => (
							<Button
								key={label}
								type="button"
								variant={active ? "secondary" : "ghost"}
								size="sm"
								className="h-8 w-8 shrink-0 p-0"
								title={label}
								aria-label={label}
								aria-pressed={Boolean(active)}
								disabled={!editor}
								onClick={run}
							>
								<Icon className="h-4 w-4" />
							</Button>
						))}
						<Button
							type="button"
							variant={state?.link ? "secondary" : "ghost"}
							size="sm"
							className="h-8 w-8 p-0"
							title="Link"
							aria-label="Link"
							aria-pressed={Boolean(state?.link)}
							disabled={!editor}
							onClick={() => {
								setHref(editor?.getAttributes("link").href ?? "");
								setLinkError("");
								setLinkOpen((open) => !open);
							}}
						>
							<Link className="h-4 w-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							title="Undo"
							aria-label="Undo"
							disabled={!state?.canUndo}
							onClick={() => editor?.chain().focus().undo().run()}
						>
							<Undo2 className="h-4 w-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							title="Redo"
							aria-label="Redo"
							disabled={!state?.canRedo}
							onClick={() => editor?.chain().focus().redo().run()}
						>
							<Redo2 className="h-4 w-4" />
						</Button>
					</fieldset>
					{linkOpen ? (
						<fieldset
							disabled={disabled}
							className="min-w-0 border-b border-[var(--line)] p-2"
						>
							<div className="flex items-center gap-1">
								<Input
									aria-label="Link URL"
									placeholder="https://"
									value={href}
									onChange={(event) => setHref(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											applyLink();
										}
										if (event.key === "Escape") {
											event.preventDefault();
											setLinkOpen(false);
											editor?.commands.focus();
										}
									}}
								/>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-8 w-8 shrink-0 p-0"
									title="Apply link"
									aria-label="Apply link"
									onClick={applyLink}
								>
									<Check className="h-4 w-4" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-8 w-8 shrink-0 p-0"
									title="Remove link"
									aria-label="Remove link"
									disabled={!state?.link}
									onClick={() => {
										editor
											?.chain()
											.focus()
											.extendMarkRange("link")
											.unsetLink()
											.run();
										setLinkOpen(false);
									}}
								>
									<Unlink className="h-4 w-4" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-8 w-8 shrink-0 p-0"
									title="Close link editor"
									aria-label="Close link editor"
									onClick={() => setLinkOpen(false)}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
							{linkError ? (
								<p
									role="alert"
									className="mb-0 mt-1 text-xs text-[var(--danger)]"
								>
									{linkError}
								</p>
							) : null}
						</fieldset>
					) : null}
				</>
			) : null}
			<EditorContent editor={editor} />
		</div>
	);
}

export function DescriptionContent({
	description,
	descriptionDoc,
}: Partial<DescriptionValue>) {
	const emptyDocument = descriptionDoc?.content.every(
		(node) =>
			node.type === "paragraph" &&
			!node.content?.some((child) => child.text?.trim()),
	);
	if (!descriptionDoc || emptyDocument)
		return (
			<p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--muted-text)]">
				{description?.trim() ? description : "No description provided."}
			</p>
		);
	return (
		<DescriptionEditor
			readOnly
			value={{ description: description ?? "", descriptionDoc }}
		/>
	);
}
