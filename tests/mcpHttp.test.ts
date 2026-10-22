import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'
import { createTaskerHttpHandler } from '../mcp/http'
import type { TaskerBackend } from '../mcp/server'

const alice = `tsk_${'a'.repeat(64)}`
const bob = `tsk_${'b'.repeat(64)}`
const endpoint = 'https://tasker.example/mcp'

function setup() {
  const revoked = new Set<string>()
  const writes: Record<string, unknown>[] = []
  let unavailable = false
  const backend: TaskerBackend = {
    query: async (reference, args) => {
      if (unavailable) throw new Error(`Network request failed with ${args.token}`)
      if (![alice, bob].includes(String(args.token)) || revoked.has(String(args.token))) {
        throw new ConvexError({ code: 'UNAUTHORIZED', message: 'Agent token is invalid, expired, or revoked.' })
      }
      const name = getFunctionName(reference)
      if (name === 'agentTokens:authenticate') return null
      if (name === 'agentTasks:list' || name === 'agentTasks:listDone') {
        return { tasks: [{ issue: { _id: args.token === alice ? 'alice-task' : 'bob-task' } }], nextCursor: null }
      }
      return { issue: { _id: args.issueId, title: 'Work' } }
    },
    mutation: async (_reference, args) => {
      writes.push(args)
      return { _id: args.issueId, status: 'in_review' }
    },
  }
  const handle = createTaskerHttpHandler(backend)
  async function connect(token: string) {
    const client = new Client({ name: 'http-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => handle(new Request(input, init)),
    })
    await client.connect(transport)
    return client
  }
  return { backend, handle, connect, revoked, writes, disconnectBackend: () => { unavailable = true } }
}

function request(token?: string, method = 'POST', origin?: string) {
  return new Request(endpoint, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) } : {}),
  })
}

describe('hosted Tasker MCP', () => {
  it('discovers tools and keeps concurrent callers isolated across requests', async () => {
    const { connect } = setup()
    const clients = await Promise.all([connect(alice), connect(bob)])
    try {
      const tools = await clients[0].listTools()
      expect(tools.tools.map(tool => tool.name)).toEqual(['list_tasks', 'list_done_tasks', 'get_task', 'claim_task', 'submit_task_for_review', 'release_task'])
      const results = await Promise.all(clients.map(client => client.callTool({ name: 'list_tasks', arguments: {} })))
      expect(JSON.stringify(results[0])).toContain('alice-task')
      expect(JSON.stringify(results[0])).not.toContain('bob-task')
      expect(JSON.stringify(results[1])).toContain('bob-task')
      expect(JSON.stringify(results)).not.toContain(alice)
      expect(JSON.stringify(results)).not.toContain(bob)
    } finally { await Promise.all(clients.map(client => client.close())) }
  })

  it('dispatches claim, review, and release with the caller token', async () => {
    const { connect, writes } = setup()
    const client = await connect(alice)
    try {
      for (const [name, args] of [
        ['claim_task', { issueId: 'task', runId: 'run' }],
        ['submit_task_for_review', { issueId: 'task', runId: 'run', summary: 'Verified result' }],
        ['release_task', { issueId: 'task', runId: 'run' }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args })
        expect(result.isError).not.toBe(true)
      }
      expect(writes).toHaveLength(3)
      expect(writes.every(args => args.token === alice && args.runId === 'run')).toBe(true)
    } finally { await client.close() }
  })

  it.each([undefined, 'malformed', `tsk_${'c'.repeat(64)}`])('rejects missing or invalid tokens before discovery: %s', async token => {
    const { handle } = setup()
    const response = await handle(request(token))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain(token ?? 'undefined')
  })

  it('rejects revoked credentials on the next request, including discovery', async () => {
    const { connect, revoked, handle } = setup()
    const client = await connect(alice)
    try {
      await client.listTools()
      revoked.add(alice)
      expect((await handle(request(alice))).status).toBe(401)
    } finally { await client.close() }
  })

  it('sanitizes backend failures without mistaking outages for invalid credentials', async () => {
    const { handle, disconnectBackend } = setup()
    disconnectBackend()
    const response = await handle(request(alice))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(alice)
  })

  it('rejects untrusted browser origins and allows configured preflight', async () => {
    const { backend, handle } = setup()
    expect((await handle(request(alice, 'POST', 'https://evil.example'))).status).toBe(403)
    const configured = createTaskerHttpHandler(backend, { allowedOrigins: ['https://agent.example'] })
    const response = await configured(request(undefined, 'OPTIONS', 'https://agent.example'))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://agent.example')
    expect(response.headers.get('access-control-allow-headers')).toMatch(/authorization/i)
  })

  it.each(['GET', 'DELETE', 'HEAD', 'PUT', 'PATCH'])('does not open persistent streams or sessions for %s', async method => {
    const { handle } = setup()
    const response = await handle(request(alice, method))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toContain('POST')
  })

  it('bounds incoming bodies and rejects malformed JSON without exposing credentials', async () => {
    const { handle } = setup()
    const base = request(alice)
    const oversized = await handle(new Request(endpoint, { method: 'POST', headers: base.headers, body: 'x'.repeat(1024 * 1024 + 1) }))
    expect(oversized.status).toBe(413)
    const malformed = await handle(new Request(endpoint, { method: 'POST', headers: base.headers, body: '{' }))
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).not.toContain(alice)
  })
})
