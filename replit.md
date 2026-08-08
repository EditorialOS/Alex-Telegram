# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/slackOauth.ts` — public "Add to Slack" landing, OAuth flow, and the post-install **arrival onboarding wizard** (`/api/slack/setup`). The wizard has one structured field per brand attribute (`FIELD_DEFS`) and writes each directly via `updateTenantFile` — no AI step.
- `artifacts/api-server/src/routes/admin.ts` — read-only **operator dashboard** (`/api/admin`). HTTP Basic Auth gated on the `OPERATOR_PASSWORD` secret (any username). Lists installed workspaces (name, install date, brand-voice/onboarding status, brand-field count, command count) and recent command activity. For the pilot operator only — not pilot users.
- `artifacts/api-server/src/lib/alex/slackInstall.ts` — OAuth helpers, per-workspace bot tokens, HMAC CSRF `state` + `setup` tokens
- `artifacts/api-server/src/lib/alex/tenant.ts` — per-workspace brand-file store (`updateTenantFile`, `VALID_FIELDS`); single source of truth for brand setup
- `artifacts/api-server/src/lib/alex/agent.ts` / `gate.ts` — content generation + quality gate (Anthropic)

## Architecture decisions

- **Multi-tenant by team_id.** Each Slack workspace installs via OAuth and gets its own bot token (stored on `tenants`). Brand data is per-workspace in `tenant_files` (composite key `team_id` + `field`). `getBotToken(teamId)` falls back to `SLACK_BOT_TOKEN` only for single-workspace/dev.
- **Public base URL is derived, never hardcoded.** `getPublicBaseUrl()` prefers `REPLIT_DOMAINS` (production), falls back to `REPLIT_DEV_DOMAIN`. The OAuth redirect URI registered in the Slack app must exactly match `<base>/api/slack/oauth_redirect`.
- **Slash commands ack immediately, then process in the background.** `/api/slack/events` responds within Slack's 3s window, then runs the slow AI work via `setImmediate` and replies through `response_url`. This requires an always-running server (see Gotchas — deploy as Reserved VM, not scale-to-zero autoscale).
- **HMAC tokens, no server-side session store.** `state` (CSRF) and `setup` (post-install wizard auth, carries teamId) are stateless signed tokens over `SESSION_SECRET`.

## Product

Alex is a multi-tenant editorial AI Slack bot. A workspace installs Alex via "Add to
Slack" (OAuth), then a web **arrival wizard** captures its brand directly — one structured
field per attribute (brand voice ⭐, audience personas, content pillars, style guide, plus
optional competitive landscape, standing orders, name & persona, and Drive folder), each
with a ghosted example. Brand voice is the only required field (minimum viable brand). Every
field maps 1:1 to a tenant file and is the same store `/alex-update` writes to. From then on,
on-brand content commands (e.g. `/brief`, `/caption`, `/hook`) run against that profile.
Brand can be refined any time in Slack with `/alex-update`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Deploy as Reserved VM, not autoscale.** Slack handlers ack then do the real AI work in a post-response `setImmediate`. On scale-to-zero autoscale the instance can be suspended after the ack, so that background work (and the `response_url` reply) may never complete — users get stuck on "Working on it…". Reserved VM is always-on and completes the work.
- **Production schema is applied automatically on Publish.** Replit diffs dev schema against prod during the Publish flow. Do NOT write migration scripts or startup DDL.
- **Slack app config must point at the published domain after the first publish.** The prod domain isn't known until published. Order: publish → copy the `.replit.app` (or custom) domain → set Slack OAuth redirect URL `<domain>/api/slack/oauth_redirect` and each slash command's Request URL `<domain>/api/slack/events` (and `<domain>/api/slack/alex-update` for `/alex-update`) → then install.
- **Scopes:** `commands`, `users:read` (admin check for `/alex-update`), `chat:write`. Changing scopes requires reinstalling in each workspace.
- **`SLACK_SIGNING_SECRET` is mandatory in production** — without it every Slack request 500s (verification is only skipped when `NODE_ENV=development`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
