'use node'

import { ConvexError, v } from 'convex/values'
import nodemailer from 'nodemailer'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { buildAssignmentNotificationContent } from './lib/notifications'

function getRequiredEnv(key: string) {
  const value = process.env[key]
  if (!value) {
    throw new ConvexError({
      code: 'CONFIG_ERROR',
      message: `${key} is missing. Set it with \`pnpm dlx convex env set ${key} ...\`.`,
    })
  }
  return value
}

function getSmtpConfig() {
  return {
    host: getRequiredEnv('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: /^(1|true|yes)$/i.test(process.env.SMTP_SECURE ?? 'false'),
    user: getRequiredEnv('SMTP_USER'),
    pass: getRequiredEnv('SMTP_PASS'),
    fromEmail: getRequiredEnv('SMTP_FROM_EMAIL'),
    fromName: process.env.SMTP_FROM_NAME ?? 'Tasker',
  }
}

function getAppBaseUrl() {
  return process.env.APP_BASE_URL ?? 'http://localhost:3000'
}

export const deliverNotificationEmail = internalAction({
  args: {
    notificationId: v.id('notifications'),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.notifications.getDeliveryPayload, {
      notificationId: args.notificationId,
    })

    if (!payload) {
      return { status: 'skipped', reason: 'notification_not_found' as const }
    }

    if (payload.notification.emailStatus === 'sent') {
      return { status: 'skipped', reason: 'already_sent' as const }
    }

    if (!payload.recipient.isActive) {
      await ctx.runMutation(internal.notifications.recordEmailDeliveryResult, {
        notificationId: args.notificationId,
        status: 'skipped',
        errorMessage: 'Recipient is inactive.',
      })
      return { status: 'skipped', reason: 'recipient_inactive' as const }
    }

    if (payload.notification.type !== 'issue_assigned' || !payload.metadata) {
      await ctx.runMutation(internal.notifications.recordEmailDeliveryResult, {
        notificationId: args.notificationId,
        status: 'skipped',
        errorMessage: 'Unsupported notification type.',
      })
      return { status: 'skipped', reason: 'unsupported_type' as const }
    }

    try {
      const smtp = getSmtpConfig()
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      })
      const content = buildAssignmentNotificationContent({
        actorName: payload.metadata.actorName,
        appBaseUrl: getAppBaseUrl(),
        issueId: payload.notification.issueId ?? '',
        issueNumber: payload.metadata.issueNumber,
        issueTitle: payload.metadata.issueTitle,
        projectKey: payload.metadata.projectKey,
        projectName: payload.metadata.projectName,
      })

      await transport.sendMail({
        from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
        to: payload.recipient.email,
        subject: content.emailSubject,
        text: content.emailText,
        html: content.emailHtml,
      })

      await ctx.runMutation(internal.notifications.recordEmailDeliveryResult, {
        notificationId: args.notificationId,
        status: 'sent',
      })

      return { status: 'sent' as const }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send notification email.'
      await ctx.runMutation(internal.notifications.recordEmailDeliveryResult, {
        notificationId: args.notificationId,
        status: 'failed',
        errorMessage,
      })
      return {
        status: 'failed' as const,
        errorMessage,
      }
    }
  },
})
