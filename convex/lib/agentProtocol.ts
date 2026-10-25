import type { QueryCtx } from '../_generated/server'
import { hashToken } from './agentTokens'

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export async function revision(value: unknown) {
  return hashToken(canonical(value))
}
// Add revision tokens from stored records, not normalized/projected response shapes.
export async function decorate(ctx: QueryCtx, value: unknown): Promise<any> {
  if (Array.isArray(value))
    return Promise.all(value.map((item) => decorate(ctx, item)))
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source))
    result[key] = await decorate(ctx, item)
  if (typeof source._id === 'string') {
    const table =
      'issueNumber' in source
        ? 'issues'
        : 'recipientUserId' in source
          ? 'notifications'
          : 'ownerId' in source && 'body' in source
            ? 'userNotes'
            : 'authorId' in source && 'issueId' in source
              ? 'comments'
              : 'projectId' in source &&
                  'position' in source &&
                  'name' in source
                ? 'issueLists'
                : 'key' in source && 'name' in source
                  ? 'projects'
                  : 'globalRole' in source
                    ? 'users'
                    : null
    if (!table) return result
    const id = ctx.db.normalizeId(table, source._id)
    if (!id) return result
    const row = await ctx.db.get(id)
    if (row) result.revision = await revision(row)
    const path =
      'issueNumber' in source
        ? `/issues/${source._id}`
        : 'statuses' in source || ('key' in source && 'name' in source)
          ? `/projects/${source._id}`
          : undefined
    if (path) {
      result.path = path
      result.url = process.env.APP_BASE_URL
        ? `${process.env.APP_BASE_URL.replace(/\/$/, '')}${path}`
        : path
    }
  }
  return result
}
