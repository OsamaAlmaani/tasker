import type { IssueChecklistItem } from '../constants'

function normalizeChecklistText(text: string) {
  return text.trim()
}

export function normalizeIssueChecklistItems(
  checklistItems?: IssueChecklistItem[] | null,
) {
  const seenIds = new Set<string>()

  return [...(checklistItems ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((item) => ({
      id: item.id.trim(),
      text: normalizeChecklistText(item.text),
      completed: Boolean(item.completed),
      position: Number.isFinite(item.position) ? item.position : 0,
    }))
    .filter((item) => {
      if (!item.id || !item.text || seenIds.has(item.id)) {
        return false
      }
      seenIds.add(item.id)
      return true
    })
    .map((item, index) => ({
      ...item,
      position: index,
    }))
}

export function getIssueChecklistProgress(
  checklistItems?: IssueChecklistItem[] | null,
) {
  const normalizedItems = normalizeIssueChecklistItems(checklistItems)
  const completedChecklistItemCount = normalizedItems.filter(
    (item) => item.completed,
  ).length

  return {
    checklistItems: normalizedItems,
    checklistItemCount: normalizedItems.length,
    completedChecklistItemCount,
    checklistCompletionRate: normalizedItems.length
      ? completedChecklistItemCount / normalizedItems.length
      : 0,
    hasChecklist: normalizedItems.length > 0,
  }
}
