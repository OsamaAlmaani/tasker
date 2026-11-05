# Agent instructions

Read [AGENT.md](./AGENT.md) before changing this repository; it is the canonical
project guide for architecture, conventions, validation and roadmap maintenance.

For Tasker MCP setup or task operations, also read the
[agent workspace guide](./docs/agent-workspace.md). Tool availability does not
itself authorize production changes.

## Deploying

"Deploy" means two steps, and both are needed whenever `convex/` changed:

1. **Convex (backend):** `pnpm exec convex deploy -y` pushes the schema and
   functions to the self-hosted Convex deployment configured in `.env.local`
   (`CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY`). Do this
   before pushing the app so the frontend never runs against an older backend.
   Set backend env vars with `pnpm exec convex env set NAME value`.
2. **App (frontend):** commit and `git push origin main`. Railway deploys the
   app automatically from the push; nothing else is needed.

A frontend-only change needs only step 2. Before deploying, run `pnpm check`,
`pnpm test` and the type checks (`pnpm exec tsc --noEmit -p tsconfig.json`
and `-p convex/tsconfig.json`). `convex deploy` regenerates
`convex/_generated/*`; keep `api.d.ts` changes and restore `server.d.ts` and
`server.js` from git if the CLI strips their typed-env block.
