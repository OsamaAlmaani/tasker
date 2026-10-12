# Hosted Tasker MCP Implementation Plan

> **For agentic workers:** Implement this plan task-by-task with test-first changes and verify the full suite and production build.

**Goal:** Agents connect to the deployed Tasker app at `/mcp` using a personal token, without installing Tasker or CLI tools.

**Architecture:** Add a stateless Streamable HTTP adapter around the existing MCP tool factory and mount it as a TanStack Start server route. Authenticate every HTTP request with a dedicated Convex query; keep task authorization in the existing Convex handlers. Create a separate MCP server/transport for each request so credentials cannot cross callers.

**Tech Stack:** Existing MCP SDK v1, TanStack Start, Nitro, Convex, Vitest.

**Spec:** The agreed five-step hosted MCP design in this chat (2026-10-12).

## Global Constraints

- Deploy the endpoint with the existing Node app; no additional client-side runtime or new dependencies.
- Existing personal tokens, expiry/revocation, project access, and human review rules apply.
- Authentication uses bearer headers; tokens must not appear in URLs, logs, or cached responses.
- Support remote clients that accept bearer headers; OAuth sign-in is outside this implementation.
- Keep local stdio available for existing clients, but make hosted configuration the default.

## Review Focus

- Initialization and tool discovery reject invalid/revoked tokens.
- Parallel callers never share tokens, claims, or task visibility.
- Cross-origin browser requests require an explicitly allowed origin.
- Misconfigured/unavailable backends produce sanitized errors and no HTML login redirect.
- The production app actually routes `/mcp` and excludes server adapter code from the browser bundle.

### Task 1: HTTP transport and authentication

Files: `mcp/http.ts`, `tests/mcpHttp.test.ts`, `convex/agentTokens.ts`, `tests/agentTasks.test.ts`.

- [x] Write HTTP protocol tests for discovery, per-caller tool results, write dispatch, invalid/revoked tokens, backend errors, origins, and unsupported methods. Observe failure.
- [x] Add `agentTokens.authenticate({token})`, returning null after existing token/user validation.
- [x] Implement `createTaskerHttpHandler(backend, options): (Request) => Promise<Response>` with per-request token binding, stateless JSON responses, bounded body reads, sanitization, and lifecycle cleanup.
- [x] Run targeted HTTP and backend authentication tests.

### Task 2: Deployable route and connection settings

Files: `src/routes/mcp.ts`, `src/server/taskerMcp.ts`, `src/features/tasker/agents/AgentConnectionCard.tsx`, its existing test, generated route tree, `scripts/mcp-smoke.mjs`, `package.json`, `README.md`, `AGENT.md`, `ROADMAP.md`.

- [x] Write a Settings test showing URL/header configuration and token removal after hiding it. Observe failure.
- [x] Mount the adapter at `/mcp`; resolve backend URL from server environment or existing Vite backend configuration, and optional browser origin allowlist from server environment.
- [x] Generate the endpoint URL from the app origin after hydration; update user-facing setup instructions.
- [x] Document hosting, bearer-client compatibility, deployment order, backend configuration, and optional browser origin allowlist.
- [x] Run the full test suite, MCP type check, formatting/lint checks, and production build.
- [x] Smoke-test the built app's HTTP endpoint and review the final diff.
