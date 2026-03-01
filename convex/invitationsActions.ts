'use node'

import { ConvexError, v } from 'convex/values'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action } from './_generated/server'

function getClerkSecretKey() {
  const key = process.env.CLERK_SECRET_KEY
  if (!key) {
    throw new ConvexError({
      code: 'CONFIG_ERROR',
      message:
        'CLERK_SECRET_KEY is missing. Set it with `pnpm dlx convex env set CLERK_SECRET_KEY ...`.',
    })
  }
  return key
}

function getClerkApiBase() {
  return process.env.CLERK_API_URL ?? 'https://api.clerk.com/v1'
}

function getInviteRedirectUrl() {
  const appBase = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  return `${appBase.replace(/\/$/, '')}/dashboard`
}

type SendInvitePrepResult =
  | {
      resultType: 'already_member'
      email: string
      userId: Id<'users'>
    }
  | {
      resultType: 'added_existing_user'
      email: string
      userId: Id<'users'>
    }
  | {
      resultType: 'already_invited'
      email: string
      invitationId: Id<'projectInvites'>
    }
  | {
      resultType: 'needs_clerk_invite'
      email: string
    }

type SendInviteResult =
  | {
      resultType: 'already_member'
      email: string
    }
  | {
      resultType: 'added_existing_user'
      email: string
    }
  | {
      resultType: 'already_invited'
      email: string
      invitationId: Id<'projectInvites'>
    }
  | {
      resultType: 'sent'
      email: string
      clerkInvitationId: string
    }

export const sendProjectInvite = action({
  args: {
    projectId: v.id('projects'),
    email: v.string(),
  },
  handler: async (ctx, args): Promise<SendInviteResult> => {
    const prep: SendInvitePrepResult = await ctx.runMutation(
      api.invitations.prepareInviteSend,
      args,
    )

    if (prep.resultType === 'already_member') {
      return {
        resultType: 'already_member' as const,
        email: prep.email,
      }
    }

    if (prep.resultType === 'added_existing_user') {
      return {
        resultType: 'added_existing_user' as const,
        email: prep.email,
      }
    }

    if (prep.resultType === 'already_invited') {
      return {
        resultType: 'already_invited' as const,
        email: prep.email,
        invitationId: prep.invitationId,
      }
    }

    const clerkSecretKey = getClerkSecretKey()
    const clerkApiBase = getClerkApiBase()

    const response = await fetch(`${clerkApiBase}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: prep.email,
        redirect_url: getInviteRedirectUrl(),
        public_metadata: {
          projectId: args.projectId,
          source: 'tasker_project_invite',
        },
      }),
    })

    if (!response.ok) {
      const details = await response.text()
      throw new ConvexError({
        code: 'EXTERNAL_SERVICE_ERROR',
        message: `Failed to send invitation via Clerk (${response.status}): ${details}`,
      })
    }

    const data = (await response.json()) as {
      id: string
      expires_at?: number
    }

    await ctx.runMutation(api.invitations.finalizeInviteSend, {
      projectId: args.projectId,
      email: prep.email,
      clerkInvitationId: data.id,
      expiresAt: data.expires_at ? data.expires_at * 1000 : undefined,
    })

    return {
      resultType: 'sent' as const,
      email: prep.email,
      clerkInvitationId: data.id,
    }
  },
})

export const revokeProjectInvite = action({
  args: {
    projectInviteId: v.id('projectInvites'),
  },
  handler: async (ctx, args) => {
    const prep = await ctx.runMutation(api.invitations.prepareInviteRevoke, args)

    if (prep.clerkInvitationId) {
      const clerkSecretKey = getClerkSecretKey()
      const clerkApiBase = getClerkApiBase()

      const response = await fetch(
        `${clerkApiBase}/invitations/${prep.clerkInvitationId}/revoke`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clerkSecretKey}`,
            'Content-Type': 'application/json',
          },
        },
      )

      if (!response.ok) {
        const details = await response.text()
        throw new ConvexError({
          code: 'EXTERNAL_SERVICE_ERROR',
          message: `Failed to revoke invitation in Clerk (${response.status}): ${details}`,
        })
      }
    }

    await ctx.runMutation(api.invitations.finalizeInviteRevoke, args)

    return {
      revoked: true,
      projectInviteId: args.projectInviteId,
    }
  },
})
