import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Context = QueryCtx | MutationCtx
export type AgentScope = 'read' | 'write' | 'delete' | 'notes' | 'inbox'
type AgentIdentity = {
  user: Doc<'users'>
  credential: Doc<'agentTokens'>
  requestId?: string
}
// Only server code can attach identity. No request argument or synthetic Clerk identity is trusted.
const identities = new WeakMap<Context, AgentIdentity>()
export function agentContext<T extends Context>(
  ctx: T,
  identity: AgentIdentity,
): T {
  const scoped = { ...ctx }
  identities.set(scoped, identity)
  return scoped
}
export function getAgentIdentity(ctx: Context) {
  return identities.get(ctx)
}
export function requireAgentScope(
  credential: Doc<'agentTokens'>,
  scope: AgentScope,
) {
  if (credential.scopes && !credential.scopes.includes(scope)) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: `Token does not permit ${scope} operations.`,
    })
  }
}
export function checkAgentProject(ctx: Context, projectId: Id<'projects'>) {
  const allowed = identities.get(ctx)?.credential.projectIds
  if (allowed && !allowed.includes(projectId)) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Project is outside this token’s scope.',
    })
  }
}
