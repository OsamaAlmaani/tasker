import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireCurrentUser } from './lib/auth'

function stripNoteMarkup(body: string) {
  return body
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/[#>*_`~[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeNoteTitle(title: string | undefined, body: string) {
  const trimmedTitle = title?.trim()
  if (trimmedTitle) {
    return trimmedTitle
  }

  const firstBodyLine = stripNoteMarkup(body)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return firstBodyLine?.slice(0, 80) || 'Untitled note'
}

function buildExcerpt(body: string) {
  const normalizedBody = stripNoteMarkup(body)

  return normalizedBody.slice(0, 180)
}

function buildSearchText(title: string, body: string) {
  return `${title} ${stripNoteMarkup(body)}`.trim().toLowerCase()
}

async function ensureOwnedNote(
  ctx: { db: { get: (id: Id<'userNotes'>) => Promise<Doc<'userNotes'> | null> } },
  noteId: Id<'userNotes'>,
  ownerId: Id<'users'>,
) {
  const note = await ctx.db.get(noteId)
  if (!note || note.ownerId !== ownerId) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Note not found.',
    })
  }

  return note
}

export const list = query({
  args: {
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const notes = await ctx.db
      .query('userNotes')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', user._id))
      .collect()

    const search = args.search?.trim().toLowerCase()

    return notes
      .filter((note) => {
        if (!search) {
          return true
        }
        return note.searchText.includes(search)
      })
      .sort((left, right) => {
        if (left.pinned !== right.pinned) {
          return left.pinned ? -1 : 1
        }
        return right.updatedAt - left.updatedAt
      })
  },
})

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const now = Date.now()
    const body = args.body ?? ''
    const title = normalizeNoteTitle(args.title, body)

    const noteId = await ctx.db.insert('userNotes', {
      ownerId: user._id,
      title,
      body,
      excerpt: buildExcerpt(body),
      searchText: buildSearchText(title, body),
      pinned: false,
      createdAt: now,
      updatedAt: now,
    })

    return await ctx.db.get(noteId)
  },
})

export const update = mutation({
  args: {
    noteId: v.id('userNotes'),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    const note = await ensureOwnedNote(ctx, args.noteId, user._id)

    const nextBody = args.body ?? note.body
    const nextTitle = normalizeNoteTitle(args.title ?? note.title, nextBody)

    await ctx.db.patch(args.noteId, {
      title: nextTitle,
      body: nextBody,
      excerpt: buildExcerpt(nextBody),
      searchText: buildSearchText(nextTitle, nextBody),
      pinned: args.pinned ?? note.pinned,
      updatedAt: Date.now(),
    })

    return await ctx.db.get(args.noteId)
  },
})

export const remove = mutation({
  args: {
    noteId: v.id('userNotes'),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    await ensureOwnedNote(ctx, args.noteId, user._id)
    await ctx.db.delete(args.noteId)

    return {
      noteId: args.noteId,
    }
  },
})
