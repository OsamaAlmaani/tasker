import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Exercise the built app and real HTTP client against a disposable backend fixture.
// Build with the app's usual public Vite configuration before running this script.
const alice = `tsk_${'a'.repeat(64)}`
const bob = `tsk_${'b'.repeat(64)}`
const revoked = new Set()
const calls = []
const backend = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const body = JSON.parse(text)
  const args = body.args[0]
  calls.push({ name: body.path, token: args.token })
  response.setHeader('Content-Type', 'application/json')
  if (revoked.has(args.token) || ![alice, bob].includes(args.token)) {
    response.end(JSON.stringify({ status: 'error', errorMessage: 'Rejected token', errorData: { code: 'UNAUTHORIZED', message: 'Rejected token' } }))
    return
  }
  let value = null
  if (body.path === 'agentTasks:list' || body.path === 'agentTasks:listDone') {
    value = { tasks: [{ issue: { _id: args.token === alice ? 'alice-task' : 'bob-task' } }], nextCursor: null }
  } else if (body.path !== 'agentTokens:authenticate') {
    value = { issue: { _id: args.issueId }, _id: args.issueId, status: 'in_review' }
  }
  response.end(JSON.stringify({ status: 'success', value }))
})
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const slot = createServer()
await new Promise(resolve => slot.listen(0, '127.0.0.1', resolve))
const port = slot.address().port
await new Promise(resolve => slot.close(resolve))
const endpoint = new URL(`http://127.0.0.1:${port}/mcp`)
const app = spawn(process.execPath, ['.output/server/index.mjs'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), TASKER_CONVEX_URL: `http://127.0.0.1:${backend.address().port}`, TASKER_MCP_ALLOWED_ORIGINS: 'https://agent.example' },
})
let logs = ''
app.stdout.on('data', chunk => { logs = (logs + chunk).slice(-5000) })
app.stderr.on('data', chunk => { logs = (logs + chunk).slice(-5000) })
const clients = []
try {
  let response
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      break
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  assert.ok(response, 'Built app did not start')
  assert.equal(response.status, 401, 'Unauthenticated endpoint must reject requests rather than render app pages')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  for (const method of ['HEAD', 'PUT', 'PATCH', 'GET', 'DELETE']) {
    const response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${alice}` } })
    assert.equal(response.status, 405, `${method} must reach the MCP handler and return 405`)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://agent.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://agent.example')
  for (const token of [alice, bob]) {
    const client = new Client({ name: 'production-http-smoke', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  }
  assert.equal((await clients[0].listTools()).tools.length, 6)
  const queues = await Promise.all(clients.map(client => client.callTool({ name: 'list_tasks', arguments: {} })))
  assert.match(JSON.stringify(queues[0]), /alice-task/)
  assert.doesNotMatch(JSON.stringify(queues[0]), /bob-task/)
  assert.match(JSON.stringify(queues[1]), /bob-task/)
  for (const [name, args] of [
    ['list_done_tasks', {}], ['get_task', { issueId: 'alice-task' }],
    ['claim_task', { issueId: 'alice-task', runId: 'smoke' }],
    ['release_task', { issueId: 'alice-task', runId: 'smoke' }],
    ['submit_task_for_review', { issueId: 'alice-task', runId: 'smoke', summary: 'Smoke result' }],
  ]) {
    assert.notEqual((await clients[0].callTool({ name, arguments: args })).isError, true, `${name} dispatch failed`)
  }
  revoked.add(alice)
  const rejected = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(rejected.status, 401)
  assert.ok(calls.some(call => call.name === 'agentTokens:authenticate'))
  console.log('Built app MCP smoke passed: authentication, all six tools, caller isolation, revocation, CORS, and unsupported methods. No live data used.')
} catch (error) {
  console.error(error.message)
  console.error(logs.split(alice).join('[redacted]').split(bob).join('[redacted]'))
  process.exitCode = 1
} finally {
  await Promise.allSettled(clients.map(client => client.close()))
  app.kill()
  await new Promise(resolve => backend.close(resolve))
}
