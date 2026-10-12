import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ConvexError } from 'convex/values'
import { api } from '../convex/_generated/api.js'
import { createTaskerServer, type TaskerBackend } from './server.js'

export function createTaskerHttpHandler(backend: TaskerBackend, options: { allowedOrigins?: string[] } = {}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' })
    const allowedOrigins = [new URL(request.url).origin, ...(options.allowedOrigins ?? [])]
    const error = (status: number, message: string) => Response.json({ error: message }, { status, headers })
    if (origin && !allowedOrigins.includes(origin)) return error(403, 'Origin is not allowed.')
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate')
    }
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID')
      return new Response(null, { status: 204, headers })
    }
    const match = /^Bearer (tsk_[a-f0-9]{64})$/i.exec(request.headers.get('authorization') ?? '')
    const token = match?.[1]
    if (!token) {
      headers.set('WWW-Authenticate', 'Bearer realm="tasker"')
      return error(401, 'Provide a valid Tasker agent token in the Authorization header.')
    }
    try {
      // No authentication cache: revocation and account changes apply to every request.
      await backend.query(api.agentTokens.authenticate, { token })
    } catch (failure) {
      const data = failure instanceof ConvexError ? failure.data : null
      const code = data && typeof data === 'object' && 'code' in data ? data.code : null
      if (code === 'UNAUTHORIZED') {
        headers.set('WWW-Authenticate', 'Bearer realm="tasker", error="invalid_token"')
        return error(401, 'Agent token is invalid, expired, or revoked.')
      }
      if (code === 'FORBIDDEN') return error(403, 'The token owner cannot access Tasker.')
      return error(503, 'Tasker authentication is unavailable. Please retry later.')
    }
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS')
      return error(405, 'This endpoint uses stateless MCP requests over POST.')
    }
    // A fresh server captures only this request's token. No global user or session state.
    const server = createTaskerServer(backend, token)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1024 * 1024,
    })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      const combinedHeaders = new Headers(response.headers)
      headers.forEach((value, key) => combinedHeaders.set(key, value))
      return new Response(response.body, { status: response.status, headers: combinedHeaders })
    } catch {
      return error(500, 'Tasker could not process this MCP request.')
    } finally {
      await server.close()
    }
  }
}
