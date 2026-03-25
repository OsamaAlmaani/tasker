import type { ProjectLabelDefinition } from '../constants'

const DEFAULT_PROJECT_LABEL_COLORS = [
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f59e0b',
] as const

type ProjectLike = {
  labels?: ProjectLabelDefinition[] | null
}

function normalizeLabelName(name: string) {
  return name.trim() || 'New Label'
}

function normalizeLabelColor(color: string, position: number) {
  const normalized = color.trim().toLowerCase()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) {
    if (normalized.length === 4) {
      const [hash, red, green, blue] = normalized
      return `${hash}${red}${red}${green}${green}${blue}${blue}`
    }
    return normalized
  }

  return (
    DEFAULT_PROJECT_LABEL_COLORS[
      position % DEFAULT_PROJECT_LABEL_COLORS.length
    ] ?? '#06b6d4'
  )
}

function dedupeProjectLabels(
  labels: ProjectLabelDefinition[],
): ProjectLabelDefinition[] {
  const seenKeys = new Set<string>()
  const seenNames = new Set<string>()

  return labels.filter((label) => {
    const normalizedName = label.name.trim().toLowerCase()
    if (!label.key) {
      return false
    }
    if (seenKeys.has(label.key) || seenNames.has(normalizedName)) {
      return false
    }

    seenKeys.add(label.key)
    seenNames.add(normalizedName)
    return true
  })
}

export function normalizeProjectLabels(
  labels?: ProjectLabelDefinition[] | null,
): ProjectLabelDefinition[] {
  return dedupeProjectLabels(
    (labels ?? []).map((label) => ({
      key: label.key,
      name: normalizeLabelName(label.name),
      color: normalizeLabelColor(label.color, label.position),
      position: Number.isFinite(label.position) ? label.position : 0,
    })),
  )
    .sort((left, right) => left.position - right.position)
    .map((label, index) => ({
      ...label,
      position: index,
    }))
}

export function getProjectLabel(
  project: ProjectLike | null | undefined,
  labelKey: string,
) {
  return normalizeProjectLabels(project?.labels).find((label) => label.key === labelKey)
}

export function ensureProjectLabelsExist(
  project: ProjectLike | null | undefined,
  labelKeys: string[],
) {
  const labels = normalizeProjectLabels(project?.labels)
  return labelKeys.every((labelKey) =>
    labels.some((label) => label.key === labelKey),
  )
}
