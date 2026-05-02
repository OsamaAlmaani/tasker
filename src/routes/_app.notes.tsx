import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "#/features/tasker/components/PageHeader";
import { PersonalNotesWorkspace } from "#/features/tasker/notes/PersonalNotesWorkspace";

const notesSearchSchema = z.object({
	note: z.string().optional(),
});

export const Route = createFileRoute("/_app/notes")({
	validateSearch: notesSearchSchema,
	component: NotesPage,
});

function NotesPage() {
	const navigate = Route.useNavigate();
	const search = Route.useSearch();

	return (
		<div className="notes-page-shell">
			<PageHeader
				title="Personal Notes"
				description="Private notes for your own work, plans, and ideas."
			/>
			<div className="notes-page-body">
				<PersonalNotesWorkspace
					mode="page"
					selectedNoteId={search.note ?? null}
					onSelectedNoteIdChange={(noteId) =>
						void navigate({
							to: "/notes",
							search: noteId ? { note: noteId } : {},
							replace: true,
						})
					}
				/>
			</div>
		</div>
	);
}
