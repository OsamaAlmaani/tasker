import { httpRouter } from 'convex/server'
import { z } from 'zod'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { verifyWebhookSignature } from './lib/github'

const id = z.number().int().positive()
const payloadSchema = z.object({
  action: z.string().optional(),
  repository: z.object({ id }).optional(),
  installation: z.object({ id }).optional(),
  ref: z.string().optional(),
  ref_type: z.string().optional(),
  pull_request: z.object({ head: z.object({ ref: z.string(), repo: z.object({ id }).nullable() }) }).optional(),
  repositories_removed: z.array(z.object({ id })).max(1000).optional(),
})

export const githubWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return new Response('GitHub integration is not configured.', { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > 1000000) return new Response('Payload too large.', { status: 413 })
  const body = await request.text()
  if (body.length > 1000000) return new Response('Payload too large.', { status: 413 })
  if (!await verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'), secret)) return new Response('Invalid signature.', { status: 401 })
  const deliveryId = request.headers.get('x-github-delivery')
  const event = request.headers.get('x-github-event')
  if (!deliveryId || !/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId)) return new Response('Missing delivery ID.', { status: 400 })
  if (event === 'ping') return new Response('OK')
  if (!['pull_request', 'push', 'create', 'delete', 'installation', 'installation_repositories'].includes(event ?? '')) return new Response(null, { status: 204 })
  let payload: z.infer<typeof payloadSchema>
  try { payload = payloadSchema.parse(JSON.parse(body)) } catch { return new Response('Invalid payload.', { status: 400 }) }
  const installationId = payload.installation?.id
  const repositoryId = payload.repository?.id
  let branch: string | undefined
  if (event === 'pull_request' && payload.pull_request?.head.repo?.id === repositoryId) branch = payload.pull_request?.head.ref
  if (event === 'push' && payload.ref?.startsWith('refs/heads/')) branch = payload.ref.slice('refs/heads/'.length)
  if (['create', 'delete'].includes(event!) && payload.ref_type === 'branch') branch = payload.ref
  const disableInstallation = event === 'installation' && ['deleted', 'suspend'].includes(payload.action ?? '')
  const removedRepositoryIds = event === 'installation_repositories' ? payload.repositories_removed?.map(repository => repository.id) : undefined
  if (!branch && !disableInstallation && !removedRepositoryIds?.length) return new Response(null, { status: 204 })
  await ctx.runMutation(internal.github.enqueueWebhook, {
    deliveryId,
    ...(repositoryId ? { repositoryId } : {}),
    ...(installationId ? { installationId } : {}),
    ...(branch ? { branch } : {}),
    ...(disableInstallation ? { disableInstallation } : {}),
    ...(removedRepositoryIds?.length ? { removedRepositoryIds } : {}),
  })
  return new Response('Queued', { status: 202 })
})

const http = httpRouter()
http.route({ path: '/github/webhook', method: 'POST', handler: githubWebhook })
export default http
