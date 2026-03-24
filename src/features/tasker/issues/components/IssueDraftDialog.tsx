import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	issuePriorityLabel,
	issueStatusLabel,
} from "#/features/tasker/model";

export type IssueDraft = {
	title: string;
	description: string;
	listId: string;
	parentIssueId: string;
	status: (typeof ISSUE_STATUSES)[number];
	priority: (typeof ISSUE_PRIORITIES)[number];
	assigneeId: string;
	dueDate: string;
	labels: string;
};

type IssueListOption = {
	_id: string;
	name: string;
};

type AssignableUserOption = {
	_id: string;
	name: string;
};

type ParentIssueOption = {
	value: string;
	label: string;
};

type IssueDraftDialogProps = {
	assignableUsers?: AssignableUserOption[];
	dialogLabel: string;
	draft: IssueDraft;
	error?: string | null;
	issueLists?: IssueListOption[];
	onClose: () => void;
	onParentIssueChange?: (parentIssueId: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
	open: boolean;
	parentIssueOptions?: ParentIssueOption[];
	setDraft: Dispatch<SetStateAction<IssueDraft>>;
	submitLabel: string;
	title: string;
};

export function IssueDraftDialog({
	assignableUsers,
	dialogLabel,
	draft,
	error,
	issueLists,
	onClose,
	onParentIssueChange,
	onSubmit,
	open,
	parentIssueOptions,
	setDraft,
	submitLabel,
	title,
}: IssueDraftDialogProps) {
	if (!open) {
		return null;
	}

	return (
		<div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={dialogLabel}
				className="w-full max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_30px_70px_rgba(8,12,26,0.35)]"
			>
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 className="m-0 text-base font-semibold text-[var(--text)]">
						{title}
					</h2>
					<Button type="button" size="sm" variant="ghost" onClick={onClose}>
						Close
					</Button>
				</div>

				<form
					onSubmit={onSubmit}
					className="grid max-h-[70vh] gap-3 overflow-y-auto pb-4 pr-4 md:grid-cols-2"
				>
					<div className="md:col-span-2">
						<Label>Title</Label>
						<Input
							value={draft.title}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									title: event.target.value,
								}))
							}
						/>
					</div>
					<div className="md:col-span-2">
						<Label>Description</Label>
						<Textarea
							value={draft.description}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									description: event.target.value,
								}))
							}
						/>
					</div>
					<div>
						<Label>Status</Label>
						<Select
							value={draft.status}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									status: event.target.value as (typeof ISSUE_STATUSES)[number],
								}))
							}
						>
							{ISSUE_STATUSES.map((value) => (
								<option key={value} value={value}>
									{issueStatusLabel[value]}
								</option>
							))}
						</Select>
					</div>
					<div>
						<Label>Priority</Label>
						<Select
							value={draft.priority}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									priority: event.target
										.value as (typeof ISSUE_PRIORITIES)[number],
								}))
							}
						>
							{ISSUE_PRIORITIES.map((value) => (
								<option key={value} value={value}>
									{issuePriorityLabel[value]}
								</option>
							))}
						</Select>
					</div>
					<div>
						<Label>List</Label>
						<Select
							value={draft.listId}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									listId: event.target.value,
								}))
							}
						>
							<option value="">No list</option>
							{(issueLists ?? []).map((list) => (
								<option key={list._id} value={list._id}>
									{list.name}
								</option>
							))}
						</Select>
					</div>
					{parentIssueOptions ? (
						<div>
							<Label>Parent Task</Label>
							<Select
								value={draft.parentIssueId}
								onChange={(event) => {
									const nextParentIssueId = event.target.value;
									if (onParentIssueChange) {
										onParentIssueChange(nextParentIssueId);
										return;
									}

									setDraft((previous) => ({
										...previous,
										parentIssueId: nextParentIssueId,
									}));
								}}
							>
								<option value="">No parent</option>
								{parentIssueOptions.map((issue) => (
									<option key={issue.value} value={issue.value}>
										{issue.label}
									</option>
								))}
							</Select>
						</div>
					) : null}
					<div>
						<Label>Assignee</Label>
						<Select
							value={draft.assigneeId}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									assigneeId: event.target.value,
								}))
							}
						>
							<option value="">Unassigned</option>
							{(assignableUsers ?? []).map((user) => (
								<option key={user._id} value={user._id}>
									{user.name}
								</option>
							))}
						</Select>
					</div>
					<div>
						<Label>Due Date</Label>
						<Input
							type="date"
							value={draft.dueDate}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									dueDate: event.target.value,
								}))
							}
						/>
					</div>
					<div className="md:col-span-2">
						<Label>Labels (comma-separated)</Label>
						<Input
							value={draft.labels}
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									labels: event.target.value,
								}))
							}
						/>
					</div>
					{error ? (
						<p className="m-0 text-sm text-[var(--danger)]">{error}</p>
					) : null}
					<div className="md:col-span-2 flex items-center justify-end gap-2 pt-1">
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit">{submitLabel}</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
