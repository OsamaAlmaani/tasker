import { useAction } from "convex/react";
import {
	ChevronRight,
	CircleCheck,
	CircleHelp,
	FileDiff,
	GitBranch,
	GitCommitHorizontal,
	ListChecks,
	Play,
	RefreshCw,
	ScanSearch,
	TriangleAlert,
	Undo2,
	Unlink,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { formatRelative } from "#/features/tasker/format";
import { cn, getClientErrorMessage, parseConvexError } from "#/lib/utils";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";
import type { PlannedWorkflow, RunPlan } from "#convex/githubWorkflows";
import { compactWorkflowName, shortSha } from "../workflowDisplay";
import { Checkbox, Kbd, Modal } from "./WorkflowPrimitives";

export type PlannerRequest = {
	workflowIds: number[];
	groupIds: string[];
	name: string;
};

type SectionKey =
	| "changed"
	| "unknown"
	| "unaffected"
	| "unchanged"
	| "blocked";

type CheckMode = RunPlan["analysis"];

const SECTIONS: Array<{
	key: SectionKey;
	title: string;
	hint: string;
}> = [
	{
		key: "changed",
		title: "Will change",
		hint: "Code these workflows build changed since their last successful build.",
	},
	{
		key: "unknown",
		title: "Will run without a check",
		hint: "Never built, or Tasker could not tell what they depend on.",
	},
	{
		key: "unaffected",
		title: "Changes don't reach it",
		hint: "Projects they reference changed, but deep analysis found no changed type that their own code uses. Running them rebuilds the same behaviour.",
	},
	{
		key: "unchanged",
		title: "No code changes",
		hint: "Nothing they build changed since their last successful build. Running them again rebuilds the same code.",
	},
	{
		key: "blocked",
		title: "Cannot start",
		hint: "Disabled, missing, or without a manual trigger.",
	},
];

/** Sections whose workflows start left out; one key adds them back. */
const SKIPPABLE: SectionKey[] = ["unaffected", "unchanged"];

function sectionOf(workflow: PlannedWorkflow): SectionKey {
	if (!workflow.dispatchable) return "blocked";
	if (workflow.impact.state === "changed") return "changed";
	if (workflow.impact.state === "unchanged") return "unchanged";
	if (workflow.impact.state === "unaffected") return "unaffected";
	return "unknown";
}

function isSkippable(workflow: PlannedWorkflow) {
	return (
		workflow.impact.state === "unchanged" ||
		workflow.impact.state === "unaffected"
	);
}

function defaultInputs(workflow: PlannedWorkflow) {
	const values: Record<string, string> = {};
	for (const input of workflow.inputs) {
		values[input.name] =
			input.default ??
			(input.type === "boolean"
				? "false"
				: input.type === "choice"
					? (input.options[0] ?? "")
					: "");
	}
	return values;
}

export function RunPlannerDialog({
	projectId,
	request,
	defaultBranch,
	repositoryUrl,
	onClose,
	onStarted,
}: {
	projectId: Id<"projects">;
	request: PlannerRequest | null;
	defaultBranch: string;
	repositoryUrl: string;
	onClose: () => void;
	onStarted: (result: { releaseId: string; runIds: number[] }) => void;
}) {
	const planRun = useAction(api.githubWorkflows.planRun);
	const planDeepRun = useAction(api.githubWorkflowsDeep.planDeepRun);
	const getPlanOptions = useAction(api.githubWorkflows.getPlanOptions);
	const startRun = useAction(api.githubWorkflows.startRun);
	const listBranches = useAction(api.githubWorkflows.listBranches);

	const [ref, setRef] = useState(defaultBranch);
	const [refDraft, setRefDraft] = useState(defaultBranch);
	const [branches, setBranches] = useState<string[]>([]);
	const [name, setName] = useState("");
	const [plan, setPlan] = useState<RunPlan | null>(null);
	const [planError, setPlanError] = useState<string | null>(null);
	const [planning, setPlanning] = useState(false);
	// C# repositories offer two checks and wait for a choice; others run the usual check.
	const [deepAvailable, setDeepAvailable] = useState<boolean | null>(null);
	const [mode, setMode] = useState<CheckMode | null>(null);
	const [included, setIncluded] = useState<Set<number>>(new Set());
	const [inputs, setInputs] = useState<Record<number, Record<string, string>>>(
		{},
	);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const planRequest = useRef(0);
	const fieldId = useId();
	const startButtonRef = useRef<HTMLButtonElement>(null);

	const open = request !== null;

	const loadPlan = useCallback(
		async (branch: string, keepSelection: boolean, checkMode: CheckMode) => {
			if (!request) return;
			const id = ++planRequest.current;
			setMode(checkMode);
			setPlanning(true);
			setPlanError(null);
			try {
				const args = {
					projectId,
					workflowIds: request.workflowIds,
					ref: branch,
				};
				const result =
					checkMode === "deep" ? await planDeepRun(args) : await planRun(args);
				if (id !== planRequest.current) return;
				setPlan(result);
				setIncluded((current) => {
					const next = new Set<number>();
					for (const workflow of result.workflows) {
						if (!workflow.dispatchable) continue;
						const wasIncluded = current.has(workflow.workflowId);
						if (keepSelection && current.size) {
							if (wasIncluded) next.add(workflow.workflowId);
						} else if (!isSkippable(workflow)) {
							// Unchanged and unaffected workflows start left out; one key adds them back.
							next.add(workflow.workflowId);
						}
					}
					return next;
				});
				setInputs((current) => {
					const next: Record<number, Record<string, string>> = {};
					for (const workflow of result.workflows) {
						next[workflow.workflowId] = {
							...defaultInputs(workflow),
							...(current[workflow.workflowId] ?? {}),
						};
					}
					return next;
				});
			} catch (error) {
				if (id !== planRequest.current) return;
				setPlanError(
					getClientErrorMessage(error, "Could not check what would change."),
				);
			} finally {
				if (id === planRequest.current) setPlanning(false);
			}
		},
		[planRun, planDeepRun, projectId, request],
	);

	/** Clears the current result and runs the chosen check. */
	const runCheck = useCallback(
		(checkMode: CheckMode) => {
			setPlan(null);
			setIncluded(new Set());
			setExpanded(new Set());
			setStartError(null);
			setNotice(null);
			void loadPlan(ref, false, checkMode);
		},
		[loadPlan, ref],
	);

	// Reset whenever a new request opens the dialog, then decide which checks to offer.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs only when a new request opens the dialog
	useEffect(() => {
		if (!request) return;
		const id = ++planRequest.current;
		setRef(defaultBranch);
		setRefDraft(defaultBranch);
		setName(request.name);
		setPlan(null);
		setPlanError(null);
		setIncluded(new Set());
		setInputs({});
		setExpanded(new Set());
		setStartError(null);
		setNotice(null);
		setMode(null);
		setDeepAvailable(null);
		setPlanning(true);
		getPlanOptions({ projectId })
			.catch(() => ({ deepAnalysis: false }))
			.then((options) => {
				if (id !== planRequest.current) return;
				setDeepAvailable(options.deepAnalysis);
				if (options.deepAnalysis) setPlanning(false);
				else void loadPlan(defaultBranch, false, "standard");
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- only when the request changes
	}, [request]);

	useEffect(() => {
		if (!open || branches.length) return;
		listBranches({ projectId })
			.then((result) => setBranches(result.branches))
			.catch(() => setBranches([]));
	}, [open, branches.length, listBranches, projectId]);

	const sections = useMemo(() => {
		const result: Record<SectionKey, PlannedWorkflow[]> = {
			changed: [],
			unknown: [],
			unaffected: [],
			unchanged: [],
			blocked: [],
		};
		for (const workflow of plan?.workflows ?? []) {
			result[sectionOf(workflow)].push(workflow);
		}
		for (const list of Object.values(result)) {
			list.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { numeric: true }),
			);
		}
		return result;
	}, [plan]);

	const skippableIds = useMemo(
		() =>
			SKIPPABLE.flatMap((key) =>
				sections[key].map((workflow) => workflow.workflowId),
			),
		[sections],
	);
	const startCount = included.size;

	/** Removes the given workflows if any is included, otherwise adds them all back. */
	const toggleIds = useCallback((ids: number[]) => {
		setIncluded((current) => {
			const next = new Set(current);
			const anyIncluded = ids.some((id) => next.has(id));
			for (const id of ids) {
				if (anyIncluded) next.delete(id);
				else next.add(id);
			}
			return next;
		});
	}, []);

	const start = useCallback(async () => {
		if (!plan || !request || !included.size || starting) return;
		setStarting(true);
		setStartError(null);
		try {
			const items = plan.workflows
				.filter((workflow) => included.has(workflow.workflowId))
				.map((workflow) => ({
					workflowId: workflow.workflowId,
					inputs: workflow.inputs.length
						? (inputs[workflow.workflowId] ?? {})
						: {},
				}));
			const skipped = plan.workflows
				.filter(
					(workflow) =>
						workflow.dispatchable && !included.has(workflow.workflowId),
				)
				.map((workflow) => ({
					workflowId: workflow.workflowId,
					workflowName: workflow.name,
					reason:
						workflow.impact.state === "unchanged"
							? ("unchanged" as const)
							: workflow.impact.state === "unaffected"
								? ("unaffected" as const)
								: ("removed" as const),
				}));
			const result = await startRun({
				projectId,
				name: name.trim() || request.name,
				ref: plan.ref,
				expectedHeadSha: plan.head.sha,
				groupIds: request.groupIds as Id<"githubWorkflowGroups">[],
				items,
				skipped,
			});
			onStarted({
				releaseId: result.releaseId,
				runIds: result.runs
					.map((run) => run.runId)
					.filter((id): id is number => id !== null),
			});
		} catch (error) {
			const parsed = parseConvexError(error);
			if (parsed?.code === "GITHUB_REF_MOVED") {
				setNotice(parsed.message ?? "The branch moved. Checked again.");
				void loadPlan(plan.ref, true, plan.analysis);
			} else {
				setStartError(
					getClientErrorMessage(error, "GitHub did not start the workflows."),
				);
			}
		} finally {
			setStarting(false);
		}
	}, [
		plan,
		request,
		included,
		starting,
		inputs,
		startRun,
		projectId,
		name,
		onStarted,
		loadPlan,
	]);

	// U toggles unchanged and unaffected workflows; Cmd/Ctrl + Enter starts.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing = Boolean(
				target?.closest("input:not([type=checkbox]), textarea, select"),
			);
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void start();
				return;
			}
			if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key.toLowerCase() === "u" && skippableIds.length) {
				event.preventDefault();
				toggleIds(skippableIds);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, start, toggleIds, skippableIds]);

	function commitRef(value: string) {
		const next = value.trim();
		if (!next || next === ref) {
			setRefDraft(ref);
			return;
		}
		setRef(next);
		// Before a C# repository's check is chosen, changing the branch only remembers it.
		if (mode) void loadPlan(next, false, mode);
	}

	const mainBase = useMemo(() => {
		if (!plan?.bases.length) return null;
		const usage = new Map<string, number>();
		for (const workflow of plan.workflows) {
			if (workflow.base && included.has(workflow.workflowId))
				usage.set(workflow.base.sha, (usage.get(workflow.base.sha) ?? 0) + 1);
		}
		const sorted = [...plan.bases].sort(
			(a, b) => (usage.get(b.sha) ?? 0) - (usage.get(a.sha) ?? 0),
		);
		return {
			base: sorted[0],
			users: usage.get(sorted[0].sha) ?? 0,
			others: sorted.length - 1,
		};
	}, [plan, included]);

	const total = plan?.workflows.length ?? request?.workflowIds.length ?? 0;
	const missingRequired = plan?.workflows.some(
		(workflow) =>
			included.has(workflow.workflowId) &&
			workflow.inputs.some(
				(input) =>
					input.required &&
					!(inputs[workflow.workflowId]?.[input.name] ?? "").trim(),
			),
	);

	return (
		<Modal
			open={open}
			onClose={onClose}
			closeDisabled={starting}
			size="xl"
			initialFocusRef={startButtonRef}
			title="Review and start"
			description={
				<span>
					{total} {total === 1 ? "workflow" : "workflows"} selected.{" "}
					{deepAvailable && !mode
						? "Choose how Tasker checks which ones the latest changes affect."
						: mode === "deep"
							? "Tasker traced which ones the latest changes reach."
							: "Tasker checked which ones the latest changes affect."}
				</span>
			}
			footer={
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-text)]">
						<span>
							<span className="font-medium text-[var(--text)]">
								{startCount}
							</span>{" "}
							of {total} will start
						</span>
						{skippableIds.length ? (
							<span className="hidden items-center gap-1 sm:inline-flex">
								<Kbd>U</Kbd> toggles{" "}
								{sections.unaffected.length && sections.unchanged.length
									? "unchanged and unaffected"
									: sections.unaffected.length
										? "unaffected"
										: "unchanged"}
							</span>
						) : null}
						<span className="hidden items-center gap-1 sm:inline-flex">
							<Kbd>⌘</Kbd>
							<Kbd>↵</Kbd> starts
						</span>
					</div>
					<div className="flex gap-2">
						<Button variant="ghost" onClick={onClose} disabled={starting}>
							Cancel
						</Button>
						<Button
							ref={startButtonRef}
							onClick={() => void start()}
							disabled={
								!plan ||
								planning ||
								starting ||
								!startCount ||
								Boolean(missingRequired)
							}
							title={
								missingRequired
									? "Fill in the required inputs first."
									: undefined
							}
						>
							<Play className="mr-1.5 h-4 w-4" />
							{starting
								? "Starting…"
								: `Start ${startCount} ${startCount === 1 ? "workflow" : "workflows"}`}
						</Button>
					</div>
				</div>
			}
		>
			<div className="space-y-4 px-5 py-4">
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
					<div className="space-y-1.5">
						<label
							htmlFor={`${fieldId}-name`}
							className="block text-xs font-medium text-[var(--muted-text)]"
						>
							Release name
						</label>
						<Input
							id={`${fieldId}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={100}
							disabled={starting}
						/>
					</div>
					<div className="space-y-1.5">
						<label
							htmlFor={`${fieldId}-ref`}
							className="block text-xs font-medium text-[var(--muted-text)]"
						>
							Branch or tag
						</label>
						<div className="relative">
							<GitBranch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted-text)]" />
							<Input
								id={`${fieldId}-ref`}
								className="pl-9 font-mono"
								value={refDraft}
								list="workflow-branches"
								onChange={(event) => setRefDraft(event.target.value)}
								onBlur={(event) => commitRef(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitRef(event.currentTarget.value);
									}
								}}
								disabled={starting}
								spellCheck={false}
							/>
							<datalist id="workflow-branches">
								{branches.map((branch) => (
									<option key={branch} value={branch} />
								))}
							</datalist>
						</div>
					</div>
				</div>

				{notice ? (
					<div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-200">
						<RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
						{notice}
					</div>
				) : null}

				{deepAvailable ? (
					<CheckChooser
						mode={mode}
						hasResult={plan !== null}
						disabled={planning || starting}
						onChoose={runCheck}
					/>
				) : null}

				{plan ? (
					<HeadSummary
						plan={plan}
						repositoryUrl={repositoryUrl}
						mainBase={mainBase}
					/>
				) : null}

				{planError ? (
					<div className="space-y-2 rounded-lg border border-[color-mix(in_oklab,var(--danger)_40%,var(--line))] p-3">
						<p className="m-0 text-sm text-[var(--danger)]" role="alert">
							{planError}
						</p>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => void loadPlan(ref, false, mode ?? "standard")}
						>
							Try again
						</Button>
					</div>
				) : null}

				{planning && !plan ? (
					<PlanSkeleton
						count={Math.min(total, 6)}
						message={
							deepAvailable === null
								? "Checking the repository…"
								: mode === "deep"
									? "Tracing which changed C# types each workflow's own code uses… The first deep analysis of a repository reads every C# file and can take about a minute."
									: undefined
						}
					/>
				) : null}

				{plan ? (
					<div
						className={cn(
							"space-y-4",
							planning && "pointer-events-none opacity-60",
						)}
					>
						<CountsBar plan={plan} />
						{plan.deep ? <DeepSummary stats={plan.deep} /> : null}
						{SECTIONS.map((section) => {
							const list = sections[section.key];
							if (!list.length) return null;
							const sectionIds = list
								.filter((workflow) => workflow.dispatchable)
								.map((workflow) => workflow.workflowId);
							const sectionIncluded = sectionIds.filter((id) =>
								included.has(id),
							).length;
							return (
								<PlanSection
									key={section.key}
									section={section}
									workflows={list}
									included={included}
									setIncluded={setIncluded}
									expanded={expanded}
									setExpanded={setExpanded}
									inputs={inputs}
									setInputs={setInputs}
									repositoryUrl={repositoryUrl}
									headSha={plan.head.sha}
									disabled={starting}
									unchangedAction={
										SKIPPABLE.includes(section.key) && sectionIds.length ? (
											<Button
												size="sm"
												variant="secondary"
												className="h-7 gap-1.5 px-2.5 text-xs"
												onClick={() => toggleIds(sectionIds)}
												disabled={starting}
											>
												{sectionIncluded ? (
													<>
														Remove {section.key} ({sectionIncluded})
													</>
												) : (
													<>
														<Undo2 className="h-3.5 w-3.5" />
														Add back ({sectionIds.length})
													</>
												)}
											</Button>
										) : null
									}
								/>
							);
						})}
					</div>
				) : null}

				{startError ? (
					<p className="m-0 text-sm text-[var(--danger)]" role="alert">
						{startError}
					</p>
				) : null}
			</div>
		</Modal>
	);
}

function HeadSummary({
	plan,
	repositoryUrl,
	mainBase,
}: {
	plan: RunPlan;
	repositoryUrl: string;
	mainBase: {
		base: RunPlan["bases"][number];
		users: number;
		others: number;
	} | null;
}) {
	const [showCommits, setShowCommits] = useState(false);
	const base = mainBase?.base;
	return (
		<div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
				<GitCommitHorizontal className="h-4 w-4 text-[var(--muted-text)]" />
				<a
					href={`${repositoryUrl}/commit/${plan.head.sha}`}
					target="_blank"
					rel="noreferrer"
					className="font-mono text-xs text-[var(--text)]"
				>
					{plan.ref} @ {shortSha(plan.head.sha)}
				</a>
				<span className="min-w-0 flex-1 truncate text-[var(--text)]">
					{plan.head.message}
				</span>
				<span className="text-xs text-[var(--muted-text)]">
					{plan.head.author ? `${plan.head.author} · ` : ""}
					{plan.head.committedAt ? formatRelative(plan.head.committedAt) : ""}
				</span>
			</div>
			{base?.commits.length ? (
				<div className="border-t border-[var(--line)]">
					<button
						type="button"
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted-text)] hover:text-[var(--text)]"
						onClick={() => setShowCommits((value) => !value)}
						aria-expanded={showCommits}
					>
						<ChevronRight
							className={cn(
								"h-3.5 w-3.5 transition-transform",
								showCommits && "rotate-90",
							)}
						/>
						<span>
							<span className="font-medium text-[var(--text)]">
								{base.totalCommits} new{" "}
								{base.totalCommits === 1 ? "commit" : "commits"}
							</span>{" "}
							since {shortSha(base.sha)}, the last build of{" "}
							{mainBase?.users ?? 0} selected{" "}
							{mainBase?.users === 1 ? "workflow" : "workflows"}
							{mainBase?.others
								? ` (${mainBase.others} other ${mainBase.others === 1 ? "build" : "builds"} compared separately)`
								: ""}
						</span>
					</button>
					{showCommits ? (
						<ul className="m-0 max-h-56 list-none overflow-y-auto border-t border-[var(--line)] p-0">
							{base.commits.map((commit) => (
								<li
									key={commit.sha}
									className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-[var(--surface)]"
								>
									<a
										href={`${repositoryUrl}/commit/${commit.sha}`}
										target="_blank"
										rel="noreferrer"
										className="shrink-0 font-mono text-[var(--muted-text)]"
									>
										{shortSha(commit.sha)}
									</a>
									<span className="min-w-0 flex-1 truncate text-[var(--text)]">
										{commit.message}
									</span>
									<span className="shrink-0 text-[var(--muted-text)]">
										{commit.author ?? ""}
									</span>
								</li>
							))}
							{base.totalCommits > base.commits.length ? (
								<li className="px-3 py-1.5 text-xs text-[var(--muted-text)]">
									…and {base.totalCommits - base.commits.length} older commits
								</li>
							) : null}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}

const CHECKS: Array<{
	mode: CheckMode;
	title: string;
	detail: string;
	icon: typeof ListChecks;
}> = [
	{
		mode: "standard",
		title: "Usual check",
		detail:
			"Folders and project files: any change in a project a workflow builds counts. Takes a few seconds.",
		icon: ListChecks,
	},
	{
		mode: "deep",
		title: "Deep analysis",
		detail:
			"Also traces which changed C# types each service's own code uses, so shared-library changes it never touches are left out. The first run on a repository can take about a minute.",
		icon: ScanSearch,
	},
];

/** The two checks offered for C# repositories. Choosing one clears the current result. */
function CheckChooser({
	mode,
	hasResult,
	disabled,
	onChoose,
}: {
	mode: CheckMode | null;
	hasResult: boolean;
	disabled: boolean;
	onChoose: (mode: CheckMode) => void;
}) {
	if (!mode) {
		return (
			<div className="space-y-2">
				<p className="m-0 text-sm text-[var(--muted-text)]">
					This repository has C# code. Choose how Tasker checks which workflows
					the changes affect.
				</p>
				<div className="grid gap-2 sm:grid-cols-2">
					{CHECKS.map((check) => (
						<button
							key={check.mode}
							type="button"
							disabled={disabled}
							onClick={() => onChoose(check.mode)}
							className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-60"
						>
							<check.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
							<span className="min-w-0">
								<span className="block text-sm font-semibold text-[var(--text)]">
									{check.title}
								</span>
								<span className="mt-0.5 block text-xs text-[var(--muted-text)]">
									{check.detail}
								</span>
							</span>
						</button>
					))}
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-text)]">
			<span>Check</span>
			<div className="inline-flex overflow-hidden rounded-md border border-[var(--line)]">
				{CHECKS.map((check) => {
					const active = check.mode === mode;
					return (
						<button
							key={check.mode}
							type="button"
							disabled={disabled}
							aria-pressed={active}
							title={
								active && hasResult
									? `Run the ${check.title.toLowerCase()} again`
									: check.detail
							}
							onClick={() => onChoose(check.mode)}
							className={cn(
								"inline-flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors disabled:opacity-60",
								active
									? "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]"
									: "text-[var(--muted-text)] hover:text-[var(--text)]",
							)}
						>
							<check.icon className="h-3.5 w-3.5" />
							{check.title}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function DeepSummary({ stats }: { stats: NonNullable<RunPlan["deep"]> }) {
	if (!stats.traced) {
		return (
			<p className="m-0 text-xs text-[var(--muted-text)]">
				Deep analysis had nothing to trace: no workflow the usual check marks as
				changed builds .NET code Tasker can follow.
			</p>
		);
	}
	return (
		<p className="m-0 text-xs text-[var(--muted-text)]">
			Deep analysis traced {stats.traced}{" "}
			{stats.traced === 1 ? "workflow" : "workflows"} through{" "}
			{stats.indexedFiles.toLocaleString()} C# files (
			{stats.cachedFiles.toLocaleString()} already indexed) in{" "}
			{(stats.durationMs / 1000).toFixed(1)} s.{" "}
			<span className="font-medium text-[var(--text)]">
				{stats.unaffected} of {stats.traced}
			</span>{" "}
			are not reached by the changes.
		</p>
	);
}

function CountsBar({ plan }: { plan: RunPlan }) {
	const items = [
		{
			label: "will change",
			count: plan.counts.changed,
			className: "text-[var(--accent)]",
		},
		{
			label: "not reached",
			count: plan.counts.unaffected,
			className: "text-[var(--muted-text)]",
		},
		{
			label: "never built",
			count: plan.counts["never-built"],
			className: "text-[var(--text)]",
		},
		{
			label: "couldn't check",
			count: plan.counts.unknown,
			className: "text-amber-600 dark:text-amber-400",
		},
		{
			label: "no code changes",
			count: plan.counts.unchanged,
			className: "text-[var(--muted-text)]",
		},
		{
			label: "can't start",
			count: plan.counts.blocked,
			className: "text-[var(--danger)]",
		},
	].filter((item) => item.count);
	return (
		<p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-sm">
			{items.map((item) => (
				<span key={item.label}>
					<span className={cn("font-semibold tabular-nums", item.className)}>
						{item.count}
					</span>{" "}
					<span className="text-[var(--muted-text)]">{item.label}</span>
				</span>
			))}
		</p>
	);
}

function PlanSection({
	section,
	workflows,
	included,
	setIncluded,
	expanded,
	setExpanded,
	inputs,
	setInputs,
	repositoryUrl,
	headSha,
	disabled,
	unchangedAction,
}: {
	section: (typeof SECTIONS)[number];
	workflows: PlannedWorkflow[];
	included: Set<number>;
	setIncluded: React.Dispatch<React.SetStateAction<Set<number>>>;
	expanded: Set<number>;
	setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>;
	inputs: Record<number, Record<string, string>>;
	setInputs: React.Dispatch<
		React.SetStateAction<Record<number, Record<string, string>>>
	>;
	repositoryUrl: string;
	headSha: string;
	disabled: boolean;
	unchangedAction: React.ReactNode;
}) {
	const selectable = workflows.filter((workflow) => workflow.dispatchable);
	const includedCount = selectable.filter((workflow) =>
		included.has(workflow.workflowId),
	).length;
	const all = selectable.length > 0 && includedCount === selectable.length;
	const blocked = section.key === "blocked";
	return (
		<section className="overflow-hidden rounded-lg border border-[var(--line)]">
			<header
				className={cn(
					"flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-3 py-2",
					SKIPPABLE.includes(section.key)
						? "bg-[var(--surface-muted)]"
						: "bg-[color-mix(in_oklab,var(--surface-muted)_60%,var(--surface))]",
				)}
			>
				{!blocked ? (
					<Checkbox
						checked={all}
						indeterminate={!all && includedCount > 0}
						disabled={disabled || !selectable.length}
						label={`Include all in ${section.title}`}
						onChange={(checked) =>
							setIncluded((current) => {
								const next = new Set(current);
								for (const workflow of selectable) {
									if (checked) next.add(workflow.workflowId);
									else next.delete(workflow.workflowId);
								}
								return next;
							})
						}
					/>
				) : null}
				<div className="min-w-0 flex-1">
					<h3 className="m-0 text-sm font-semibold">
						{section.title}{" "}
						<span className="font-normal text-[var(--muted-text)]">
							{blocked
								? workflows.length
								: `${includedCount} of ${selectable.length}`}
						</span>
					</h3>
					<p className="m-0 text-xs text-[var(--muted-text)]">{section.hint}</p>
				</div>
				{unchangedAction}
			</header>
			<ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
				{workflows.map((workflow) => (
					<PlanRow
						key={workflow.workflowId}
						workflow={workflow}
						checked={included.has(workflow.workflowId)}
						onToggle={(checked) =>
							setIncluded((current) => {
								const next = new Set(current);
								if (checked) next.add(workflow.workflowId);
								else next.delete(workflow.workflowId);
								return next;
							})
						}
						expanded={expanded.has(workflow.workflowId)}
						onExpand={() =>
							setExpanded((current) => {
								const next = new Set(current);
								if (next.has(workflow.workflowId))
									next.delete(workflow.workflowId);
								else next.add(workflow.workflowId);
								return next;
							})
						}
						values={inputs[workflow.workflowId] ?? {}}
						onInput={(name, value) =>
							setInputs((current) => ({
								...current,
								[workflow.workflowId]: {
									...(current[workflow.workflowId] ?? {}),
									[name]: value,
								},
							}))
						}
						repositoryUrl={repositoryUrl}
						headSha={headSha}
						disabled={disabled}
					/>
				))}
			</ul>
		</section>
	);
}

function ImpactBadge({ workflow }: { workflow: PlannedWorkflow }) {
	if (!workflow.dispatchable) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--danger)_40%,var(--line))] px-1.5 py-0.5 text-[10px] text-[var(--danger)]">
				<TriangleAlert className="h-3 w-3" />
				{workflow.state !== "active" && workflow.state !== "deleted"
					? "Disabled"
					: workflow.state === "deleted"
						? "Missing"
						: "No manual trigger"}
			</span>
		);
	}
	const state = workflow.impact.state;
	if (state === "changed") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
				<FileDiff className="h-3 w-3" />
				{workflow.impact.files.length + workflow.impact.moreFiles} changed
			</span>
		);
	}
	if (state === "unchanged") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-text)]">
				<CircleCheck className="h-3 w-3" />
				Up to date
			</span>
		);
	}
	if (state === "unaffected") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-text)]">
				<Unlink className="h-3 w-3" />
				Not reached
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
			<CircleHelp className="h-3 w-3" />
			{state === "never-built" ? "First build" : "Not checked"}
		</span>
	);
}

function PlanRow({
	workflow,
	checked,
	onToggle,
	expanded,
	onExpand,
	values,
	onInput,
	repositoryUrl,
	headSha,
	disabled,
}: {
	workflow: PlannedWorkflow;
	checked: boolean;
	onToggle: (checked: boolean) => void;
	expanded: boolean;
	onExpand: () => void;
	values: Record<string, string>;
	onInput: (name: string, value: string) => void;
	repositoryUrl: string;
	headSha: string;
	disabled: boolean;
}) {
	const hasDetails =
		workflow.impact.files.length > 0 ||
		workflow.impact.notes.length > 0 ||
		workflow.impact.trace !== undefined ||
		workflow.startsOthers.length > 0 ||
		workflow.inputs.length > 0 ||
		workflow.base !== null;
	const muted = workflow.dispatchable && !checked;
	return (
		<li className={cn(muted && "bg-[var(--surface-muted)]/40")}>
			<div className="flex items-start gap-3 px-3 py-2">
				<Checkbox
					className="mt-0.5"
					checked={checked}
					disabled={disabled || !workflow.dispatchable}
					label={`Include ${workflow.name}`}
					onChange={onToggle}
				/>
				<button
					type="button"
					className="min-w-0 flex-1 text-left disabled:cursor-default"
					onClick={onExpand}
					disabled={!hasDetails}
					aria-expanded={hasDetails ? expanded : undefined}
				>
					<span className="flex min-w-0 flex-wrap items-center gap-2">
						<span
							className={cn(
								"truncate text-sm font-medium",
								muted
									? "text-[var(--muted-text)] line-through decoration-[var(--line)]"
									: "text-[var(--text)]",
							)}
						>
							{compactWorkflowName(workflow.name)}
						</span>
						<ImpactBadge workflow={workflow} />
						{workflow.startsOthers.length ? (
							<span className="inline-flex items-center gap-1 rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
								<TriangleAlert className="h-3 w-3" />
								Starts {workflow.startsOthers.length} more
							</span>
						) : null}
					</span>
					<span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-[var(--muted-text)]">
						<span>{workflow.impact.summary}</span>
						{workflow.base ? (
							<span className="hidden sm:inline">
								· last built {formatRelative(workflow.base.at)} from{" "}
								<span className="font-mono">
									{workflow.base.branch ? `${workflow.base.branch}@` : ""}
									{shortSha(workflow.base.sha)}
								</span>
							</span>
						) : null}
					</span>
				</button>
				{hasDetails ? (
					<ChevronRight
						className={cn(
							"mt-1 h-4 w-4 shrink-0 text-[var(--muted-text)] transition-transform",
							expanded && "rotate-90",
						)}
						aria-hidden="true"
					/>
				) : null}
			</div>
			{expanded ? (
				<div className="space-y-3 px-3 pt-1 pb-3 pl-10 text-xs">
					{workflow.startsOthers.length ? (
						<div className="rounded-md border border-amber-300 bg-amber-500/10 px-2.5 py-2 text-amber-800 dark:border-amber-800 dark:text-amber-200">
							Starting this also starts {workflow.startsOthers.length}{" "}
							{workflow.startsOthers.length === 1 ? "workflow" : "workflows"}{" "}
							that listen for it:{" "}
							{workflow.startsOthers
								.slice(0, 8)
								.map(compactWorkflowName)
								.join(", ")}
							{workflow.startsOthers.length > 8
								? ` and ${workflow.startsOthers.length - 8} more`
								: ""}
							. Tasker cannot check or remove those.
						</div>
					) : null}
					{workflow.inputs.length ? (
						<WorkflowInputs
							workflow={workflow}
							values={values}
							onInput={onInput}
							disabled={disabled}
						/>
					) : null}
					{workflow.impact.trace ? (
						<TraceEvidence
							trace={workflow.impact.trace}
							unaffected={workflow.impact.state === "unaffected"}
							repositoryUrl={repositoryUrl}
							headSha={headSha}
						/>
					) : null}
					{workflow.impact.files.length ? (
						<div>
							<p className="m-0 mb-1 font-medium text-[var(--text)]">
								{workflow.impact.state === "unaffected"
									? "Changed files in projects it references"
									: "Changed files it builds"}
							</p>
							<ul className="m-0 list-none space-y-0.5 p-0">
								{workflow.impact.files.map((file) => (
									<li
										key={file.path}
										className="flex min-w-0 items-baseline gap-2"
									>
										<a
											href={`${repositoryUrl}/blob/${headSha}/${file.path}`}
											target="_blank"
											rel="noreferrer"
											className="min-w-0 truncate font-mono text-[11px] text-[var(--text)]"
										>
											{file.path}
										</a>
										<span className="shrink-0 text-[var(--muted-text)]">
											{file.label}
										</span>
									</li>
								))}
							</ul>
							{workflow.impact.moreFiles ? (
								<p className="m-0 mt-1 text-[var(--muted-text)]">
									and {workflow.impact.moreFiles} more
								</p>
							) : null}
						</div>
					) : null}
					{workflow.impact.notes.length ? (
						<ul className="m-0 list-disc space-y-0.5 pl-4 text-[var(--muted-text)]">
							{workflow.impact.notes.map((note) => (
								<li key={note}>{note}</li>
							))}
						</ul>
					) : null}
					{workflow.base ? (
						<p className="m-0 text-[var(--muted-text)]">
							Compared with run #{workflow.base.runNumber}, built{" "}
							{new Date(workflow.base.at).toLocaleString()} from{" "}
							<a
								href={`${repositoryUrl}/compare/${workflow.base.sha}...${headSha}`}
								target="_blank"
								rel="noreferrer"
								className="font-mono"
							>
								{shortSha(workflow.base.sha)}…{shortSha(headSha)}
							</a>
							.
						</p>
					) : null}
				</div>
			) : null}
		</li>
	);
}

const MAX_TRACED_NAMES = 12;

/** What deep analysis found: the path that reaches the workflow, or the names it traced. */
function TraceEvidence({
	trace,
	unaffected,
	repositoryUrl,
	headSha,
}: {
	trace: NonNullable<PlannedWorkflow["impact"]["trace"]>;
	unaffected: boolean;
	repositoryUrl: string;
	headSha: string;
}) {
	return (
		<div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 py-2">
			<p className="m-0 mb-0.5 flex items-center gap-1.5 font-medium text-[var(--text)]">
				<ScanSearch className="h-3.5 w-3.5 text-[var(--accent)]" />
				Deep analysis
			</p>
			{unaffected ? (
				<p className="m-0 text-[var(--muted-text)]">
					Traced{" "}
					{trace.traced.slice(0, MAX_TRACED_NAMES).map((name, index) => (
						<span key={name}>
							{index ? ", " : ""}
							<code className="text-[11px] text-[var(--text)]">{name}</code>
						</span>
					))}
					{trace.traced.length > MAX_TRACED_NAMES
						? ` and ${trace.traced.length - MAX_TRACED_NAMES} more`
						: ""}
					. None of them reach its own code.
				</p>
			) : (
				<p className="m-0 break-words text-[var(--muted-text)]">
					{trace.reason}
					{trace.path ? (
						<>
							{" "}
							<a
								href={`${repositoryUrl}/blob/${headSha}/${trace.path}`}
								target="_blank"
								rel="noreferrer"
								className="text-[var(--accent)]"
							>
								Open file
							</a>
						</>
					) : null}
				</p>
			)}
		</div>
	);
}

function WorkflowInputs({
	workflow,
	values,
	onInput,
	disabled,
}: {
	workflow: PlannedWorkflow;
	values: Record<string, string>;
	onInput: (name: string, value: string) => void;
	disabled: boolean;
}) {
	const baseId = useId();
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			{workflow.inputs.map((input) => (
				<div key={input.name} className="space-y-1">
					<label
						htmlFor={`${baseId}-${input.name}`}
						className="block font-medium text-[var(--text)]"
					>
						{input.name}
						{input.required ? (
							<span className="text-[var(--danger)]"> *</span>
						) : null}
					</label>
					{input.type === "boolean" ? (
						<span className="flex items-center gap-2">
							<Checkbox
								id={`${baseId}-${input.name}`}
								checked={values[input.name] === "true"}
								label={input.name}
								disabled={disabled}
								onChange={(checked) =>
									onInput(input.name, checked ? "true" : "false")
								}
							/>
							<span className="text-[var(--muted-text)]">
								{input.description}
							</span>
						</span>
					) : input.type === "choice" && input.options.length ? (
						<select
							id={`${baseId}-${input.name}`}
							className="h-8 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-2 text-xs"
							value={values[input.name] ?? ""}
							disabled={disabled}
							onChange={(event) => onInput(input.name, event.target.value)}
						>
							{input.options.map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					) : (
						<Input
							id={`${baseId}-${input.name}`}
							className="h-8 text-xs"
							value={values[input.name] ?? ""}
							type={input.type === "number" ? "number" : "text"}
							placeholder={input.description ?? ""}
							disabled={disabled}
							onChange={(event) => onInput(input.name, event.target.value)}
						/>
					)}
				</div>
			))}
		</div>
	);
}

function PlanSkeleton({ count, message }: { count: number; message?: string }) {
	return (
		<div className="space-y-3" aria-live="polite">
			<p className="m-0 flex items-start gap-2 text-sm text-[var(--muted-text)]">
				<RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
				{message ??
					"Checking what changed since each workflow's last successful build…"}
			</p>
			<div className="overflow-hidden rounded-lg border border-[var(--line)]">
				{Array.from({ length: Math.max(count, 3) }, (_, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
						key={index}
						className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-3 last:border-b-0"
					>
						<span className="h-4 w-4 rounded bg-[var(--surface-muted)]" />
						<span
							className="workflow-pulse h-3 rounded bg-[var(--surface-muted)]"
							style={{ width: `${40 + ((index * 17) % 35)}%` }}
						/>
					</div>
				))}
			</div>
		</div>
	);
}
