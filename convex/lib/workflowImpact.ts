import { asArray, asRecord, asString, parseYaml, type YamlValue } from './yamlLite'

// Works out which repository files can change what a workflow builds, so a
// run can be skipped when nothing it depends on changed since its last
// successful build. The analysis follows docker/build-push-action steps into
// their Dockerfiles, `dotnet` commands into project files and their
// ProjectReference graph, and adds shared build settings. Anything it cannot
// follow marks the analysis incomplete, and incomplete analyses never report
// "unchanged" on their own.

// ---------------------------------------------------------------------------
// Paths

/** Normalizes a repository path: forward slashes, no `./`, `..` resolved, no leading `/`. */
export function normalizePath(path: string) {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // A Docker build context cannot reach above its root; neither can we.
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function joinPath(directory: string, path: string) {
  if (path.startsWith('/')) return normalizePath(path)
  return normalizePath(directory ? `${directory}/${path}` : path)
}

export function dirname(path: string) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function ancestors(directory: string) {
  const result = ['']
  const parts = directory ? directory.split('/') : []
  for (let index = 1; index <= parts.length; index++) result.push(parts.slice(0, index).join('/'))
  return result
}

/** The directory part of a glob, so `src/**\/*.cs` watches `src`. */
function globBase(path: string) {
  const wildcard = path.search(/[*?[]/)
  if (wildcard === -1) return { path, isGlob: false }
  return { path: dirname(path.slice(0, wildcard + 1)), isGlob: true }
}

// ---------------------------------------------------------------------------
// Workflow files

export type WorkflowInputType = 'string' | 'boolean' | 'choice' | 'number' | 'environment'

export type WorkflowInput = {
  name: string
  description: string | null
  required: boolean
  default: string | null
  type: WorkflowInputType
  options: string[]
}

type WorkflowStep = {
  name: string | null
  uses: string | null
  run: string | null
  with: Record<string, string>
  workingDirectory: string | null
}

export type ParsedWorkflow = {
  name: string | null
  triggers: string[]
  dispatchable: boolean
  inputs: WorkflowInput[]
  /** Names of workflows whose runs start this one (`on.workflow_run.workflows`). */
  listensTo: string[]
  steps: WorkflowStep[]
}

function stringRecord(value: YamlValue | undefined) {
  const record = asRecord(value)
  const result: Record<string, string> = {}
  if (!record) return result
  for (const [key, entry] of Object.entries(record)) {
    const text = asString(entry)
    if (text !== null) result[key] = text
    else if (Array.isArray(entry)) result[key] = entry.map((item) => asString(item) ?? '').join('\n')
  }
  return result
}

function parseInputs(value: YamlValue | undefined): WorkflowInput[] {
  const record = asRecord(value)
  if (!record) return []
  return Object.entries(record).map(([name, raw]) => {
    const definition = asRecord(raw) ?? {}
    const type = asString(definition.type)
    return {
      name,
      description: asString(definition.description),
      required: definition.required === true,
      default: asString(definition.default),
      type:
        type === 'boolean' || type === 'choice' || type === 'number' || type === 'environment'
          ? type
          : 'string',
      options: asArray(definition.options)
        .map((option) => asString(option))
        .filter((option): option is string => option !== null),
    }
  })
}

export function parseWorkflowFile(text: string): ParsedWorkflow {
  const root = asRecord(parseYaml(text)) ?? {}
  const on = root.on ?? root.true ?? null
  let triggers: string[] = []
  let dispatch: Record<string, YamlValue> | null = null
  let dispatchable = false
  let listensTo: string[] = []

  if (typeof on === 'string') triggers = [on]
  else if (Array.isArray(on)) triggers = on.map((entry) => asString(entry) ?? '').filter(Boolean)
  else if (asRecord(on)) {
    const events = asRecord(on) ?? {}
    triggers = Object.keys(events)
    dispatch = asRecord(events.workflow_dispatch)
    const workflowRun = asRecord(events.workflow_run)
    if (workflowRun) {
      const names = workflowRun.workflows
      listensTo = (Array.isArray(names) ? names : [names])
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry))
    }
  }
  dispatchable = triggers.includes('workflow_dispatch')

  const steps: WorkflowStep[] = []
  for (const jobValue of Object.values(asRecord(root.jobs) ?? {})) {
    const job = asRecord(jobValue)
    if (!job) continue
    const jobDirectory = asString(asRecord(asRecord(job.defaults)?.run)?.['working-directory'])
    for (const stepValue of asArray(job.steps)) {
      const step = asRecord(stepValue)
      if (!step) continue
      steps.push({
        name: asString(step.name),
        uses: asString(step.uses),
        run: asString(step.run),
        with: stringRecord(step.with),
        workingDirectory: asString(step['working-directory']) ?? jobDirectory,
      })
    }
  }

  return {
    name: asString(root.name),
    triggers,
    dispatchable,
    inputs: parseInputs(dispatch?.inputs),
    listensTo,
    steps,
  }
}

// ---------------------------------------------------------------------------
// Dockerfiles

export type ParsedDockerfile = {
  /** Repository paths copied into the image from the build context. */
  copies: string[]
  copiesWholeContext: boolean
  /** Project or solution paths named by `dotnet` commands, as written. */
  projects: Array<{ path: string; workdir: string }>
  /** A variable could not be resolved, so something may be missed. */
  unresolved: boolean
}

function substituteVariables(text: string, variables: Map<string, string>) {
  return text.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced: string | undefined, fallback: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? ''
      const value = variables.get(name)
      if (value !== undefined && value !== '') return value
      if (fallback !== undefined) return fallback
      return match
    },
  )
}

function tokenize(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // Fall through to whitespace splitting.
    }
  }
  return (trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ''))
}

const DOTNET_PROJECT = /\.(csproj|fsproj|vbproj|sln|slnx)$/i

function dotnetProjects(command: string) {
  const projects: string[] = []
  const pattern = /\bdotnet\s+(publish|build|restore|test|pack|run)\b([^&|;]*)/g
  for (const match of command.matchAll(pattern)) {
    for (const token of tokenize(match[2])) {
      if (DOTNET_PROJECT.test(token)) projects.push(token)
    }
  }
  return projects
}

export function parseDockerfile(text: string, context: string, buildArgs: Record<string, string>): ParsedDockerfile {
  const variables = new Map(Object.entries(buildArgs))
  const result: ParsedDockerfile = { copies: [], copiesWholeContext: false, projects: [], unresolved: false }
  let workdir = '/'
  const instructions = text
    .replace(/\r\n?/g, '\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  for (const line of instructions) {
    const [keyword = '', ...restParts] = line.split(/\s+/)
    const instruction = keyword.toUpperCase()
    const rest = restParts.join(' ')
    if (instruction === 'ARG' || instruction === 'ENV') {
      for (const token of tokenize(rest)) {
        const [name, ...value] = token.split('=')
        if (!name) continue
        // Build args passed by the workflow win over Dockerfile defaults.
        if (instruction === 'ARG' && variables.has(name)) continue
        if (value.length) variables.set(name, substituteVariables(value.join('='), variables))
      }
      continue
    }
    if (instruction === 'WORKDIR') {
      const target = substituteVariables(tokenize(rest)[0] ?? '/', variables)
      workdir = target.startsWith('/') ? target : `${workdir.replace(/\/$/, '')}/${target}`
      continue
    }
    if (instruction === 'COPY' || instruction === 'ADD') {
      const tokens = tokenize(substituteVariables(rest, variables))
      if (tokens.some((token) => token.startsWith('--from'))) continue
      const paths = tokens.filter((token) => !token.startsWith('--'))
      for (const source of paths.slice(0, -1)) {
        if (/^[a-z]+:\/\//i.test(source)) continue
        if (source.includes('$')) {
          result.unresolved = true
          continue
        }
        const resolved = joinPath(context, source)
        if (resolved === normalizePath(context)) result.copiesWholeContext = true
        else result.copies.push(resolved)
      }
      continue
    }
    if (instruction === 'RUN') {
      const command = substituteVariables(rest, variables)
      for (const project of dotnetProjects(command)) {
        if (project.includes('$')) result.unresolved = true
        else result.projects.push({ path: project, workdir })
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// .NET projects

export type ProjectReferences = {
  projects: string[]
  /** Props/targets files imported by path. */
  imports: string[]
  /** Source folders outside the project directory, such as linked files. */
  linkedDirectories: string[]
}

export function parseProjectFile(text: string, projectPath: string): ProjectReferences {
  const directory = dirname(projectPath)
  const result: ProjectReferences = { projects: [], imports: [], linkedDirectories: [] }
  for (const match of text.matchAll(/<ProjectReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)) {
    if (!match[1].includes('$(')) result.projects.push(joinPath(directory, match[1]))
  }
  for (const match of text.matchAll(/<Import\b[^>]*\bProject\s*=\s*"([^"]+)"/gi)) {
    if (!match[1].includes('$(')) result.imports.push(joinPath(directory, match[1]))
  }
  for (const match of text.matchAll(
    /<(Compile|Content|None|EmbeddedResource|AdditionalFiles)\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi,
  )) {
    const include = match[2].replace(/\\/g, '/')
    if (!include.startsWith('..') || include.includes('$(')) continue
    for (const part of include.split(';')) {
      const base = globBase(joinPath(directory, part))
      result.linkedDirectories.push(base.isGlob ? base.path : dirname(base.path))
    }
  }
  return result
}

export function parseSolutionFile(text: string, solutionPath: string) {
  const directory = dirname(solutionPath)
  const projects: string[] = []
  for (const match of text.matchAll(/^Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gm)) {
    if (DOTNET_PROJECT.test(match[1])) projects.push(joinPath(directory, match[1]))
  }
  // .slnx (XML) solutions.
  for (const match of text.matchAll(/<Project\b[^>]*\bPath\s*=\s*"([^"]+)"/gi)) {
    if (DOTNET_PROJECT.test(match[1])) projects.push(joinPath(directory, match[1]))
  }
  return projects
}

const SHARED_BUILD_FILES = [
  'Directory.Build.props',
  'Directory.Build.targets',
  'Directory.Build.rsp',
  'Directory.Packages.props',
  'global.json',
  'NuGet.config',
  'nuget.config',
  'NuGet.Config',
]

// ---------------------------------------------------------------------------
// Analysis

export type DependencyRule = {
  kind: 'file' | 'directory'
  /** Repository path; an empty directory path means the whole repository. */
  path: string
  label: string
}

export type WorkflowAnalysis = {
  rules: DependencyRule[]
  /** False when part of the workflow could not be followed. */
  complete: boolean
  notes: string[]
  /** What the workflow produces, for display (Dockerfiles and projects). */
  builds: string[]
}

const TRIVIAL_ACTIONS = [
  'actions/checkout',
  'actions/cache',
  'actions/upload-artifact',
  'actions/download-artifact',
  'actions/setup-dotnet',
  'actions/setup-node',
  'actions/setup-python',
  'actions/setup-java',
  'actions/setup-go',
  'docker/setup-buildx-action',
  'docker/setup-qemu-action',
  'docker/login-action',
  'docker/metadata-action',
  'pnpm/action-setup',
]

const TRIVIAL_COMMAND = /^(echo|printf|cd|ls|pwd|cat|mkdir|export|set|true|exit|sleep|date|env|whoami)\b/
const PACKAGE_MANAGER_COMMAND = /^(pnpm|npm|npx|yarn|node|bun|corepack)\b/

function actionName(uses: string) {
  return uses.split('@')[0].toLowerCase()
}

type BuildPlan = {
  dockerBuilds: Array<{ dockerfile: string; context: string; buildArgs: Record<string, string> }>
  projectRefs: Array<{ path: string; workdir: string }>
  directories: Array<{ path: string; label: string }>
  notes: string[]
}

function parseBuildArgs(value: string | undefined) {
  const result: Record<string, string> = {}
  for (const line of (value ?? '').split('\n')) {
    const trimmed = line.trim()
    const separator = trimmed.indexOf('=')
    if (separator > 0) result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return result
}

function planBuild(workflow: ParsedWorkflow): BuildPlan {
  const plan: BuildPlan = { dockerBuilds: [], projectRefs: [], directories: [], notes: [] }
  for (const step of workflow.steps) {
    if (step.uses) {
      const action = actionName(step.uses)
      if (action === 'docker/build-push-action') {
        const contextInput = step.with.context ?? '.'
        const fileInput = step.with.file
        if (contextInput.includes('${{') || fileInput?.includes('${{')) {
          plan.notes.push('A Docker build uses a value only known while the workflow runs.')
          continue
        }
        // A git URL context builds from the repository at the run's commit.
        const context = /^https?:\/\/|^git@/.test(contextInput) ? '' : normalizePath(contextInput)
        const dockerfile = fileInput ? normalizePath(fileInput) : joinPath(context, 'Dockerfile')
        plan.dockerBuilds.push({ dockerfile, context, buildArgs: parseBuildArgs(step.with['build-args']) })
        continue
      }
      if (step.uses.startsWith('./')) {
        plan.notes.push(`Uses a local action (${step.uses}) that Tasker does not follow.`)
        continue
      }
      if (!TRIVIAL_ACTIONS.some((known) => action === known)) {
        plan.notes.push(`Uses ${step.uses.split('@')[0]}, which Tasker cannot follow.`)
      }
      continue
    }
    if (!step.run) continue
    const workdir = normalizePath(step.workingDirectory ?? '')
    let followed = true
    for (const rawCommand of step.run.split('\n')) {
      const command = rawCommand.trim()
      if (!command || command.startsWith('#')) continue
      if (/\bdotnet\s+(publish|build|restore|test|pack|run)\b/.test(command)) {
        const projects = dotnetProjects(command)
        if (projects.length) {
          for (const project of projects) {
            if (project.includes('$')) plan.notes.push('A dotnet command uses a variable Tasker cannot resolve.')
            else plan.projectRefs.push({ path: joinPath(workdir, project), workdir })
          }
        } else {
          plan.directories.push({ path: workdir, label: 'Working directory of a dotnet command' })
        }
        continue
      }
      if (TRIVIAL_COMMAND.test(command)) continue
      if (PACKAGE_MANAGER_COMMAND.test(command)) {
        plan.directories.push({ path: workdir, label: 'Working directory of a script' })
        continue
      }
      followed = false
    }
    if (!followed) {
      plan.notes.push(`The "${step.name ?? 'run'}" step runs a script Tasker cannot follow.`)
    }
  }
  return plan
}

export type RepositoryReader = {
  /** Every blob path in the repository at the analysed commit. */
  files: Set<string>
  /** Reads file contents; missing or binary files map to null. */
  read: (paths: string[]) => Promise<Map<string, string | null>>
}

function resolveProject(path: string, files: Set<string>, basenames: Map<string, string[]>) {
  const normalized = normalizePath(path)
  if (files.has(normalized)) return normalized
  // Relative to a WORKDIR inside the image: fall back to a unique file name.
  const candidates = basenames.get(basename(normalized).toLowerCase()) ?? []
  const suffixMatches = candidates.filter((candidate) => candidate.endsWith(`/${normalized}`))
  if (suffixMatches.length === 1) return suffixMatches[0]
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Analyses workflow files at one commit. `workflowTexts` maps workflow paths
 * to their contents. Reads Dockerfiles and project files through `reader`.
 */
export async function analyzeWorkflows(
  workflowTexts: Map<string, string>,
  reader: RepositoryReader,
): Promise<Map<string, WorkflowAnalysis>> {
  const basenames = new Map<string, string[]>()
  for (const file of reader.files) {
    if (!DOTNET_PROJECT.test(file)) continue
    const key = basename(file).toLowerCase()
    basenames.set(key, [...(basenames.get(key) ?? []), file])
  }
  const contents = new Map<string, string | null>()
  async function load(paths: string[]) {
    const missing = [...new Set(paths)].filter((path) => !contents.has(path) && reader.files.has(path))
    if (!missing.length) return
    for (const [path, text] of await reader.read(missing)) contents.set(path, text)
  }

  const plans = new Map<string, BuildPlan>()
  for (const [path, text] of workflowTexts) plans.set(path, planBuild(parseWorkflowFile(text)))

  await load([...plans.values()].flatMap((plan) => plan.dockerBuilds.map((build) => build.dockerfile)))

  // Resolve each workflow's root projects, then walk the reference graph.
  const roots = new Map<string, string[]>()
  const extraRules = new Map<string, DependencyRule[]>()
  const notes = new Map<string, string[]>()
  const builds = new Map<string, string[]>()
  for (const [path, plan] of plans) {
    const workflowNotes = [...plan.notes]
    const rules: DependencyRule[] = plan.directories.map((directory) => ({
      kind: 'directory',
      path: directory.path,
      label: directory.label,
    }))
    const projectPaths: string[] = []
    const built: string[] = []
    for (const reference of plan.projectRefs) {
      const resolved = resolveProject(reference.path, reader.files, basenames)
      if (resolved) projectPaths.push(resolved)
      else workflowNotes.push(`Could not find ${reference.path} in the repository.`)
    }
    for (const build of plan.dockerBuilds) {
      built.push(build.dockerfile)
      rules.push({ kind: 'file', path: build.dockerfile, label: 'Dockerfile' })
      for (const ignore of [joinPath(build.context, '.dockerignore'), `${build.dockerfile}.dockerignore`]) {
        if (reader.files.has(ignore)) rules.push({ kind: 'file', path: ignore, label: 'Docker ignore file' })
      }
      const text = contents.get(build.dockerfile)
      if (text === undefined || text === null) {
        workflowNotes.push(`Could not read ${build.dockerfile}.`)
        rules.push({ kind: 'directory', path: build.context, label: 'Docker build context' })
        continue
      }
      const dockerfile = parseDockerfile(text, build.context, build.buildArgs)
      if (dockerfile.unresolved) workflowNotes.push(`${build.dockerfile} uses a variable Tasker cannot resolve.`)
      const dockerProjects: string[] = []
      for (const project of dockerfile.projects) {
        const candidates = [joinPath(build.context, project.path)]
        // Paths relative to a WORKDIR such as /src/src/APIs/X.
        const workdirPath = normalizePath(project.workdir.replace(/^\/(source|src|app)(\/|$)/, ''))
        if (workdirPath) candidates.push(joinPath(joinPath(build.context, workdirPath), project.path))
        const resolved =
          candidates.find((candidate) => reader.files.has(candidate)) ??
          resolveProject(project.path, reader.files, basenames)
        if (resolved) dockerProjects.push(resolved)
        else workflowNotes.push(`Could not find ${project.path} from ${build.dockerfile}.`)
      }
      projectPaths.push(...dockerProjects)
      for (const copy of dockerfile.copies) {
        const base = globBase(copy)
        // Copies that only feed `dotnet restore` are covered by the project graph.
        if (dockerProjects.length && DOTNET_PROJECT.test(copy)) continue
        const isFile = !base.isGlob && reader.files.has(base.path)
        rules.push({ kind: isFile ? 'file' : 'directory', path: base.path, label: 'Copied into the image' })
      }
      if (dockerfile.copiesWholeContext && !dockerProjects.length) {
        rules.push({ kind: 'directory', path: build.context, label: 'Whole Docker build context' })
      }
    }
    roots.set(path, [...new Set(projectPaths)])
    extraRules.set(path, rules)
    notes.set(path, workflowNotes)
    builds.set(path, built)
  }

  // Breadth-first over project references, loading each layer in one batch.
  const references = new Map<string, ProjectReferences>()
  let frontier = [...new Set([...roots.values()].flat())]
  while (frontier.length) {
    await load(frontier)
    const next: string[] = []
    for (const project of frontier) {
      const text = contents.get(project)
      if (typeof text !== 'string') {
        references.set(project, { projects: [], imports: [], linkedDirectories: [] })
        continue
      }
      if (/\.(sln|slnx)$/i.test(project)) {
        const projects = parseSolutionFile(text, project)
        references.set(project, { projects, imports: [], linkedDirectories: [] })
        next.push(...projects)
        continue
      }
      const parsed = parseProjectFile(text, project)
      references.set(project, parsed)
      next.push(...parsed.projects)
    }
    frontier = [...new Set(next)].filter((project) => !references.has(project))
  }

  const results = new Map<string, WorkflowAnalysis>()
  for (const [path, plan] of plans) {
    const rules: DependencyRule[] = [{ kind: 'file', path, label: 'Workflow file' }, ...(extraRules.get(path) ?? [])]
    const workflowNotes = notes.get(path) ?? []
    const workflowRoots = roots.get(path) ?? []
    const visited = new Set<string>()
    const queue = [...workflowRoots]
    const projectDirectories = new Set<string>()
    while (queue.length) {
      const project = queue.shift() as string
      if (visited.has(project)) continue
      visited.add(project)
      const isRoot = workflowRoots.includes(project)
      const name = basename(project).replace(DOTNET_PROJECT, '')
      if (!reader.files.has(project)) {
        workflowNotes.push(`A referenced project is missing: ${project}`)
        continue
      }
      rules.push({ kind: 'file', path: project, label: isRoot ? `${name} (project file)` : `${name} (referenced project)` })
      if (!/\.(sln|slnx)$/i.test(project)) {
        const directory = dirname(project)
        projectDirectories.add(directory)
        rules.push({
          kind: 'directory',
          path: directory,
          label: isRoot ? name : `${name} (referenced project)`,
        })
      }
      const refs = references.get(project)
      if (!refs) continue
      queue.push(...refs.projects)
      for (const imported of refs.imports) {
        rules.push({ kind: 'file', path: imported, label: 'Imported build file' })
      }
      for (const linked of refs.linkedDirectories) {
        rules.push({ kind: 'directory', path: linked, label: `Files linked by ${name}` })
      }
    }
    // Shared settings apply to every project below them.
    const settingFiles = new Set<string>()
    for (const directory of projectDirectories) {
      for (const ancestor of ancestors(directory)) {
        for (const file of SHARED_BUILD_FILES) {
          const candidate = ancestor ? `${ancestor}/${file}` : file
          if (reader.files.has(candidate)) settingFiles.add(candidate)
        }
      }
    }
    for (const file of settingFiles) rules.push({ kind: 'file', path: file, label: 'Shared build settings' })

    const buildsSomething = plan.dockerBuilds.length > 0 || workflowRoots.length > 0 || plan.directories.length > 0
    if (!buildsSomething && !plan.notes.length) {
      workflowNotes.push('This workflow does not build anything Tasker can recognize.')
    }
    results.set(path, {
      rules: dedupeRules(rules),
      complete: workflowNotes.length === 0,
      notes: [...new Set(workflowNotes)],
      builds: [...(builds.get(path) ?? []), ...workflowRoots],
    })
  }
  return results
}

function dedupeRules(rules: DependencyRule[]) {
  const seen = new Set<string>()
  return rules.filter((rule) => {
    const key = `${rule.kind}:${rule.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Returns the rule that makes `path` relevant, preferring the most specific. */
export function matchRule(rules: DependencyRule[], path: string): DependencyRule | null {
  let best: DependencyRule | null = null
  for (const rule of rules) {
    const matches =
      rule.kind === 'file' ? rule.path === path : rule.path === '' || path.startsWith(`${rule.path}/`)
    if (!matches) continue
    if (
      !best ||
      (rule.kind === 'file' && best.kind !== 'file') ||
      (rule.kind === best.kind && rule.path.length > best.path.length)
    ) {
      best = rule
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Impact

export type ChangedFile = { path: string; previousPath: string | null }

export type ImpactState = 'changed' | 'unchanged' | 'unknown' | 'never-built'

export type WorkflowImpact = {
  state: ImpactState
  /** One sentence for the row. */
  summary: string
  files: Array<{ path: string; label: string }>
  /** Matched files beyond `files`. */
  moreFiles: number
  notes: string[]
}

const MAX_LISTED_FILES = 40

export function computeImpact({
  analysis,
  baseSha,
  headSha,
  changes,
}: {
  analysis: WorkflowAnalysis
  baseSha: string | null
  headSha: string
  /** Files that differ between the base and head commits; `complete` is false when the list was cut short. */
  changes: { files: ChangedFile[]; complete: boolean } | null
}): WorkflowImpact {
  if (!baseSha) {
    return {
      state: 'never-built',
      summary: 'No successful build yet, so it will run.',
      files: [],
      moreFiles: 0,
      notes: analysis.notes,
    }
  }
  if (baseSha === headSha) {
    return {
      state: 'unchanged',
      summary: 'Its last successful build used this exact commit.',
      files: [],
      moreFiles: 0,
      notes: [],
    }
  }
  const matched: Array<{ path: string; label: string }> = []
  for (const file of changes?.files ?? []) {
    const rule = matchRule(analysis.rules, file.path) ?? (file.previousPath ? matchRule(analysis.rules, file.previousPath) : null)
    if (rule) matched.push({ path: file.path, label: rule.label })
  }
  const files = matched.slice(0, MAX_LISTED_FILES)
  const moreFiles = matched.length - files.length
  if (matched.length) {
    return {
      state: 'changed',
      summary: `${matched.length} changed ${matched.length === 1 ? 'file affects' : 'files affect'} it.`,
      files,
      moreFiles,
      notes: analysis.notes,
    }
  }
  if (!changes) {
    return {
      state: 'unknown',
      summary: 'Could not compare with its last build, so it will run.',
      files: [],
      moreFiles: 0,
      notes: analysis.notes,
    }
  }
  if (!changes.complete) {
    return {
      state: 'unknown',
      summary: 'Too many files changed to check every one, so it will run.',
      files: [],
      moreFiles: 0,
      notes: analysis.notes,
    }
  }
  if (!analysis.complete) {
    return {
      state: 'unknown',
      summary: 'Tasker could not follow everything this workflow builds, so it will run.',
      files: [],
      moreFiles: 0,
      notes: analysis.notes,
    }
  }
  return {
    state: 'unchanged',
    summary:
      changes.files.length === 0
        ? 'No files changed since its last build.'
        : `None of the ${changes.files.length} changed files affect it.`,
    files: [],
    moreFiles: 0,
    notes: [],
  }
}

/** Paths whose blob differs between two trees (added, removed or modified). */
export function diffTrees(base: Map<string, string>, head: Map<string, string>): ChangedFile[] {
  const changed: ChangedFile[] = []
  for (const [path, sha] of head) {
    if (base.get(path) !== sha) changed.push({ path, previousPath: null })
  }
  for (const path of base.keys()) {
    if (!head.has(path)) changed.push({ path, previousPath: null })
  }
  return changed
}
