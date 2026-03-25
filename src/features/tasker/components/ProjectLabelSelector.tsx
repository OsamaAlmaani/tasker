import { Button } from "#/components/ui/button";
import { IssueLabelBadge } from "#/features/tasker/components/IssueBadges";
import type { ProjectLabelDefinition } from "#/features/tasker/projectLabels";
import { cn } from "#/lib/utils";

type ProjectLabelSelectorProps = {
	labelOptions: ProjectLabelDefinition[];
	onChange: (labelKeys: string[]) => void;
	selectedLabelKeys: string[];
};

export function ProjectLabelSelector({
	labelOptions,
	onChange,
	selectedLabelKeys,
}: ProjectLabelSelectorProps) {
	function toggleLabel(labelKey: string) {
		onChange(
			selectedLabelKeys.includes(labelKey)
				? selectedLabelKeys.filter((value) => value !== labelKey)
				: [...selectedLabelKeys, labelKey],
		);
	}

	if (!labelOptions.length) {
		return (
			<p className="m-0 text-sm text-[var(--muted-text)]">
				No project labels yet.
			</p>
		);
	}

	return (
		<div className="flex flex-wrap gap-2">
			{labelOptions.map((label) => {
				const selected = selectedLabelKeys.includes(label.key);
				return (
					<Button
						key={label.key}
						type="button"
						size="sm"
						variant="ghost"
						className={cn(
							"h-auto rounded-full border px-1.5 py-1",
							selected
								? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]"
								: "border-[var(--line)] bg-transparent",
						)}
						onClick={() => toggleLabel(label.key)}
					>
						<IssueLabelBadge color={label.color} label={label.name} />
					</Button>
				);
			})}
		</div>
	);
}
