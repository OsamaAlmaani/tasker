export function PageHeader({
	title,
	description,
	actions,
}: {
	title: React.ReactNode;
	description?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="page-header mb-6 flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 break-words">
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
				<div className="relative flex min-w-0 max-w-full flex-wrap items-center gap-2">
					{actions}
				</div>
			) : null}
		</div>
	);
}
