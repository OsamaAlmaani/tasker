import type { GitHubTemplates, IssueChecklistItem } from '../constants'

// Pure helpers that connect GitHub text (branch names, titles, bodies, commit
// messages) to Tasker tasks, plus the templates used when Tasker creates a
// branch or pull request for a task. No I/O.

export type TaskReferences = {
  /** Task numbers found as `KEY-123` or, when allowed, `#123`. */
  issueNumbers: number[]
  /** Task ids found in Tasker task URLs (`/issues/<id>`). */
  issueIds: string[]
}

const MAX_TEXT_LENGTH = 100_000

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Finds task references in free text.
 *
 * - `KEY-123` matches the project's key case-insensitively (branch names are
 *   often lower case) and is never confused with other projects' keys.
 * - `/issues/<id>` from a Tasker URL yields a task id.
 * - Bare `#123` is deliberately not a reference: on GitHub it names a GitHub
 *   issue or pull request, so treating it as a task number would link and move
 *   unrelated tasks.
 */
export function parseTaskReferences(
  text: string | null | undefined,
  options: { projectKey: string },
): TaskReferences {
  const source = (text ?? '').slice(0, MAX_TEXT_LENGTH)
  const issueNumbers = new Set<number>()
  const issueIds = new Set<string>()
  if (!source) return { issueNumbers: [], issueIds: [] }

  const key = options.projectKey.trim()
  if (key) {
    const keyPattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(key)}[-_](\\d{1,9})(?!\\d)`, 'gi')
    for (const match of source.matchAll(keyPattern)) {
      const number = Number(match[1])
      if (number > 0) issueNumbers.add(number)
    }
  }

  const urlPattern = /\/issues\/([a-z0-9]{16,64})(?![a-z0-9])/g
  for (const match of source.matchAll(urlPattern)) {
    issueIds.add(match[1])
  }

  return {
    issueNumbers: [...issueNumbers].sort((a, b) => a - b),
    issueIds: [...issueIds],
  }
}

/** `SHOP-142` */
export function formatTaskKey(projectKey: string, issueNumber: number) {
  return `${projectKey}-${issueNumber}`
}

// ---------------------------------------------------------------------------
// Templates

export const DEFAULT_GITHUB_TEMPLATES: GitHubTemplates = {
  branch: 'feat/{key}-{slug}',
  pullRequestTitle: '{key}: {title}',
  pullRequestBody: ['## {key}: {title}', '', '{description}', '', '{checklist}', '', 'Tasker task: {url}'].join(
    '\n',
  ),
}

const MAX_TEMPLATE_LENGTH = 4_000

export function normalizeTemplates(templates: Partial<GitHubTemplates> | null | undefined): GitHubTemplates {
  const pick = (value: string | undefined, fallback: string) => {
    const trimmed = (value ?? '').trim()
    return trimmed && trimmed.length <= MAX_TEMPLATE_LENGTH ? trimmed : fallback
  }
  return {
    branch: pick(templates?.branch, DEFAULT_GITHUB_TEMPLATES.branch),
    pullRequestTitle: pick(templates?.pullRequestTitle, DEFAULT_GITHUB_TEMPLATES.pullRequestTitle),
    pullRequestBody: pick(templates?.pullRequestBody, DEFAULT_GITHUB_TEMPLATES.pullRequestBody),
  }
}

/** Lower-case, dash separated, ASCII only, at most `maxLength` characters. */
export function slugify(value: string, maxLength = 40) {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= maxLength) return slug
  const cut = slug.slice(0, maxLength)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > maxLength / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

/**
 * Makes a string a valid git branch name: no spaces or control characters,
 * none of `~ ^ : ? * [ \`, no `..`, `@{` or `//`, no leading `-` or `/`, no
 * trailing `/`, `.` or `.lock`.
 */
export function sanitizeBranchName(value: string) {
  let name = value
    .trim()
    .replace(/[\s~^:?*[\]\\]+/g, '-')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: git forbids control characters in refs
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/@\{/g, '@')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/.]+/, '')
    .replace(/[/.]+$/, '')
  while (name.endsWith('.lock')) name = name.slice(0, -'.lock'.length)
  return name.replace(/[-/.]+$/, '').slice(0, 200)
}

export type TemplateContext = {
  projectKey: string
  issueNumber: number
  title: string
  description: string
  checklistItems: IssueChecklistItem[]
  url: string
  login: string | null
}

function renderChecklist(items: IssueChecklistItem[]) {
  if (!items.length) return ''
  return [
    '### Checklist',
    ...[...items]
      .sort((a, b) => a.position - b.position)
      .map((item) => `- [${item.completed ? 'x' : ' '}] ${item.text}`),
  ].join('\n')
}

export function renderTemplate(template: string, context: TemplateContext) {
  const key = formatTaskKey(context.projectKey, context.issueNumber)
  const values: Record<string, string> = {
    key,
    'key.lower': key.toLowerCase(),
    number: String(context.issueNumber),
    slug: slugify(context.title),
    title: context.title.trim(),
    description: context.description.trim(),
    checklist: renderChecklist(context.checklistItems),
    url: context.url,
    login: context.login ?? '',
  }
  return template
    .replace(/\{([a-z.]+)\}/gi, (match, name: string) => values[name.toLowerCase()] ?? match)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function renderBranchName(template: string, context: TemplateContext) {
  return sanitizeBranchName(renderTemplate(template, context)) || sanitizeBranchName(formatTaskKey(context.projectKey, context.issueNumber).toLowerCase())
}
