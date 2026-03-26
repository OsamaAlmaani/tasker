import { Input } from "#/components/ui/input";
import { Select } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import type {
	ProjectCustomFieldDefinition,
	ProjectCustomFieldDraftValue,
} from "#/features/tasker/projectCustomFields";
import { cn } from "#/lib/utils";

type ProjectCustomFieldInputProps = {
	className?: string;
	field: ProjectCustomFieldDefinition;
	onBlur?: () => void;
	onChange: (value: ProjectCustomFieldDraftValue) => void;
	value: ProjectCustomFieldDraftValue | undefined;
};

export function ProjectCustomFieldInput({
	className,
	field,
	onBlur,
	onChange,
	value,
}: ProjectCustomFieldInputProps) {
	switch (field.type) {
		case "checkbox":
			return (
				<div className={cn("flex items-center justify-end", className)}>
					<Switch
						checked={Boolean(value)}
						onChange={(next) => onChange(next)}
					/>
				</div>
			);

		case "date":
			return (
				<Input
					className={className}
					type="date"
					value={typeof value === "string" ? value : ""}
					onBlur={onBlur}
					onChange={(event) => onChange(event.target.value)}
				/>
			);

		case "number":
			return (
				<Input
					className={className}
					type="number"
					inputMode="decimal"
					step="any"
					value={typeof value === "string" ? value : ""}
					onBlur={onBlur}
					onKeyDown={(event) => {
						const allowedKeys = new Set([
							"Backspace",
							"Delete",
							"Tab",
							"Escape",
							"Enter",
							"ArrowLeft",
							"ArrowRight",
							"ArrowUp",
							"ArrowDown",
							"Home",
							"End",
						]);

						if (event.ctrlKey || event.metaKey || allowedKeys.has(event.key)) {
							return;
						}

						if (event.key.length === 1 && !/[0-9.-]/.test(event.key)) {
							event.preventDefault();
						}

						if (event.key === "." && event.currentTarget.value.includes(".")) {
							event.preventDefault();
						}

						if (
							event.key === "-" &&
							(event.currentTarget.selectionStart !== 0 ||
								event.currentTarget.value.includes("-"))
						) {
							event.preventDefault();
						}
					}}
					onChange={(event) => {
						if (event.target.value === "") {
							onChange("");
							return;
						}
						if (!Number.isNaN(event.currentTarget.valueAsNumber)) {
							onChange(event.target.value);
						}
					}}
				/>
			);

		case "select":
			return (
				<Select
					className={className}
					value={typeof value === "string" ? value : ""}
					onBlur={onBlur}
					onChange={(event) => onChange(event.target.value)}
				>
					<option value="">No value</option>
					{(field.options ?? []).map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</Select>
			);

		default:
			return (
				<Input
					className={className}
					value={typeof value === "string" ? value : ""}
					onBlur={onBlur}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
	}
}
