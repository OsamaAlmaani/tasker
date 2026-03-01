export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 className="m-0 text-2xl font-semibold tracking-tight text-[var(--text)]">
					{title}
				</h1>
				{description ? (
					<p className="mt-1 mb-0 text-sm text-[var(--muted-text)]">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}
