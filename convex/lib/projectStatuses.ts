import type { Doc } from '../_generated/dataModel'
import { type ProjectStatusDefinition } from '../constants'
import { normalizeProjectLabels } from './projectLabels'

type LegacyProjectStatusDefinition = {
  key: string
  name: string
  color: string
  position: number
}

type ProjectLike = {
  statuses?: Array<ProjectStatusDefinition | LegacyProjectStatusDefinition> | null
}

export const DEFAULT_PROJECT_STATUSES: ProjectStatusDefinition[] = [
  { key: 'todo', name: 'Todo', color: '#3b82f6', position: 0 },
  { key: 'backlog', name: 'Backlog', color: '#64748b', position: 1 },
  { key: 'in_progress', name: 'In Progress', color: '#f59e0b', position: 2 },
  { key: 'in_review', name: 'In Review', color: '#8b5cf6', position: 3 },
  { key: 'done', name: 'Done', color: '#10b981', position: 4 },
]

const CUSTOM_STATUS_COLORS = [
  '#64748b',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
] as const

function getDefaultProjectStatus(key: string, position: number): ProjectStatusDefinition {
  return (
    DEFAULT_PROJECT_STATUSES.find((status) => status.key === key) ?? {
      key,
      name: key,
      color: CUSTOM_STATUS_COLORS[position % CUSTOM_STATUS_COLORS.length] ?? '#64748b',
      position,
    }
  )
}

function normalizeStatusColor(key: string, color: string | undefined, position: number) {
  if (key === 'todo' || key === 'done') {
    return getDefaultProjectStatus(key, position).color
  }

  const normalized = color?.trim().toLowerCase()
  if (normalized && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) {
    if (normalized.length === 4) {
      const [hash, red, green, blue] = normalized
      return `${hash}${red}${red}${green}${green}${blue}${blue}`
    }
    return normalized
  }

  return getDefaultProjectStatus(key, position).color
}

function normalizeStatusName(key: string, name: string) {
  if (key === 'todo') {
    return 'Todo'
  }
  if (key === 'done') {
    return 'Done'
  }

  return name.trim() || getDefaultProjectStatus(key, 0).name
}

function dedupeCustomStatuses(
  statuses: ProjectStatusDefinition[],
): ProjectStatusDefinition[] {
  const seenKeys = new Set<string>()
  const seenNames = new Set<string>()

  return statuses.filter((status) => {
    const normalizedName = status.name.trim().toLowerCase()
    if (!status.key || status.key === 'todo' || status.key === 'done') {
      return false
    }
    if (seenKeys.has(status.key) || seenNames.has(normalizedName)) {
      return false
    }

    seenKeys.add(status.key)
    seenNames.add(normalizedName)
    return true
  })
}

export function normalizeProjectStatuses(
  statuses?: Array<ProjectStatusDefinition | LegacyProjectStatusDefinition> | null,
): ProjectStatusDefinition[] {
  const incoming = statuses ?? []
  const customStatuses = dedupeCustomStatuses(
    incoming
      .map((status) => ({
        key: status.key,
        name: normalizeStatusName(status.key, status.name),
        color: normalizeStatusColor(status.key, status.color, status.position),
        position: Number.isFinite(status.position) ? status.position : 0,
      }))
      .filter((status) => status.key !== 'todo' && status.key !== 'done'),
  ).sort((left, right) => left.position - right.position)

  return [
    getDefaultProjectStatus('todo', 0),
    ...customStatuses.map((status, index) => ({
      ...status,
      position: index + 1,
    })),
    {
      ...getDefaultProjectStatus('done', customStatuses.length + 1),
      position: customStatuses.length + 1,
    },
  ]
}

export function getProjectStatusLabel(
  project: ProjectLike | null | undefined,
  statusKey: string,
) {
  return getProjectStatus(project, statusKey)?.name ?? statusKey
}

export function getProjectStatusColor(
  project: ProjectLike | null | undefined,
  statusKey: string,
) {
  return getProjectStatus(project, statusKey)?.color
}

export function ensureProjectStatusExists(
  project: ProjectLike | null | undefined,
  statusKey: string,
) {
  return normalizeProjectStatuses(project?.statuses).some(
    (status) => status.key === statusKey,
  )
}

export function getProjectStatus(
  project: ProjectLike | null | undefined,
  statusKey: string,
) {
  return normalizeProjectStatuses(project?.statuses).find(
    (status) => status.key === statusKey,
  )
}

export function normalizeProject<TProject extends Doc<'projects'>>(project: TProject) {
  return {
    ...project,
    labels: normalizeProjectLabels(project.labels),
    statuses: normalizeProjectStatuses(project.statuses),
  }
}
