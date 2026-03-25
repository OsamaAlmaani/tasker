import { Archive } from "lucide-react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";

export type ProjectSettingsForm = {
	name: string;
	description: string;
	color: string;
	icon: string;
	allowMemberInvites: boolean;
	allowIssueDelete: boolean;
};

type ProjectSettingsCardProps = {
	archived: boolean;
	form: ProjectSettingsForm;
	onArchiveClick: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	open: boolean;
	setForm: Dispatch<SetStateAction<ProjectSettingsForm>>;
};

export function ProjectSettingsCard({
	archived,
	form,
	onArchiveClick,
	onSubmit,
	open,
	setForm,
}: ProjectSettingsCardProps) {
	if (!open) {
		return null;
	}

	return (
		<Card className="mb-4">
			<CardHeader>
				<CardTitle>Project Settings</CardTitle>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
					<div>
						<Label>Name</Label>
						<Input
							value={form.name}
							onChange={(event) =>
								setForm((previous) => ({
									...previous,
									name: event.target.value,
								}))
							}
						/>
					</div>
					<div>
						<Label>Color</Label>
						<Input
							type="color"
							value={form.color}
							onChange={(event) =>
								setForm((previous) => ({
									...previous,
									color: event.target.value,
								}))
							}
						/>
					</div>
					<div className="md:col-span-2">
						<Label>Description</Label>
						<Textarea
							value={form.description}
							onChange={(event) =>
								setForm((previous) => ({
									...previous,
									description: event.target.value,
								}))
							}
						/>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							checked={form.allowMemberInvites}
							onChange={(next) =>
								setForm((previous) => ({
									...previous,
									allowMemberInvites: next,
								}))
							}
						/>
						<span className="text-sm text-[var(--muted-text)]">
							Allow member invites
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							checked={form.allowIssueDelete}
							onChange={(next) =>
								setForm((previous) => ({
									...previous,
									allowIssueDelete: next,
								}))
							}
						/>
						<span className="text-sm text-[var(--muted-text)]">
							Allow task deletion
						</span>
					</div>
					<div className="md:col-span-2">
						<Button type="submit">Save project</Button>
					</div>
					<div className="md:col-span-2">
						<div className="flex justify-end border-t border-[var(--line)] pt-3">
							<Button
								type="button"
								variant={archived ? "secondary" : "danger"}
								onClick={onArchiveClick}
							>
								<Archive className="mr-2 h-4 w-4" />
								{archived ? "Unarchive project" : "Archive project"}
							</Button>
						</div>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
