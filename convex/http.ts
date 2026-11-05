import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { normalizeRepository, normalizeWebhookEvent, verifyWebhookSignature } from './lib/githubAutomation'
import { decryptSecret, getEncryptionKey } from './lib/githubCrypto'

// GitHub webhook receiver. Every delivery is verified against the secret of
// each project that linked the repository; only matching projects process it.

const MAX_BODY_BYTES = 5 * 1024 * 1024

function respond(status: number, message: string) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

const http = httpRouter()

http.route({
  path: '/github/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const eventName = request.headers.get('x-github-event')
    const deliveryId = request.headers.get('x-github-delivery')
    const signature = request.headers.get('x-hub-signature-256')
    if (!eventName || !deliveryId) return respond(400, 'Missing GitHub headers.')

    const body = await request.text()
    if (body.length > MAX_BODY_BYTES) return respond(413, 'Payload too large.')
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return respond(400, 'Invalid JSON.')
    }

    const repository = normalizeRepository((payload as { repository?: unknown } | null)?.repository)
    if (!repository) return respond(202, 'No repository in payload; ignored.')

    const candidates = await ctx.runQuery(internal.githubWebhooks.lookupRepository, {
      repositoryId: repository.repositoryId,
    })
    // Same answer as a bad signature so callers cannot probe which repositories are linked.
    if (!candidates.length) return respond(401, 'Signature did not match.')

    const key = await getEncryptionKey()
    const matched: Array<(typeof candidates)[number]> = []
    for (const candidate of candidates) {
      let secret: string
      try {
        secret = await decryptSecret(key, candidate.secret)
      } catch {
        continue
      }
      if (await verifyWebhookSignature(secret, body, signature)) matched.push(candidate)
    }
    if (!matched.length) return respond(401, 'Signature did not match.')

    const event = normalizeWebhookEvent(eventName, payload)
    const summary = {
      repositoryId: repository.repositoryId,
      deliveryId,
      event: eventName,
      action: typeof (payload as { action?: unknown }).action === 'string' ? ((payload as { action: string }).action) : null,
      pullNumber:
        event?.kind === 'pull_request' || event?.kind === 'pull_request_review' ? event.pullRequest.number : undefined,
      ref: event?.kind === 'push' ? event.ref : undefined,
      sha:
        event?.kind === 'push'
          ? (event.headSha ?? undefined)
          : event?.kind === 'check_suite' || event?.kind === 'workflow_run'
            ? event.headSha
            : undefined,
      senderLogin: event?.senderLogin ?? undefined,
    }
    const { duplicate } = await ctx.runMutation(internal.githubWebhooks.recordDelivery, {
      ...summary,
      outcome: event ? 'processing' : 'ignored',
    })
    if (duplicate) return respond(200, 'Already processed.')
    if (!event) return respond(200, `Event ${eventName} ignored.`)

    try {
      const { outcomes } = await ctx.runMutation(internal.githubWebhooks.processEvent, {
        deliveryId,
        linkIds: matched.map((candidate) => candidate.linkId),
        event,
      })
      await ctx.runMutation(internal.githubWebhooks.updateDeliveryOutcome, {
        deliveryId,
        outcome: outcomes.join('; ').slice(0, 1000) || 'processed',
      })
    } catch (error) {
      // Leave the delivery marked failed so GitHub's redelivery is processed again.
      const message = error instanceof Error ? error.message : 'processing failed'
      await ctx.runMutation(internal.githubWebhooks.updateDeliveryOutcome, {
        deliveryId,
        outcome: `failed: ${message}`.slice(0, 1000),
      })
      return respond(500, 'Processing failed; redeliver to retry.')
    }
    return respond(200, 'OK')
  }),
})

export default http
