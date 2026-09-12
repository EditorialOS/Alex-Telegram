# Alex — Multi-Tenant Editorial AI for Slack

> The repository also contains the private-first **Alex Story Desk V.1** MCP
> surface. See [`docs/story-desk-private-chatgpt.md`](docs/story-desk-private-chatgpt.md)
> for its Supabase, verified-source, Box and ChatGPT setup. Story Desk does not
> change the existing Slack or Telegram routines.

Alex is a multi-tenant editorial AI teammate that lives in Slack. A workspace installs
Alex via **"Add to Slack"** (OAuth), spends a couple of minutes teaching it their brand
voice, then generates on-brand editorial content directly from slash commands
(`/brief`, `/caption`, `/hook`, and more).

Every Slack workspace is its own tenant: its own bot token, its own brand profile, its
own content. Alex reads each workspace's brand context on every command so the output
stays on-voice.

---

## Table of contents

- [How it works](#how-it-works)
- [Slash commands](#slash-commands)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Environment variables & secrets](#environment-variables--secrets)
- [Deployment](#deployment)
- [Connecting the Slack app](#connecting-the-slack-app)
- [Operator dashboard](#operator-dashboard)
- [Gotchas](#gotchas)

---

## How it works

1. **Install.** A workspace admin opens the landing page and clicks **Add to Slack**.
   Slack runs the OAuth flow and Alex stores a per-workspace bot token.
2. **Onboard.** Right after install, an **arrival wizard** (a web page) captures the
   workspace's brand — one structured field per attribute (brand voice ⭐, audience
   personas, content pillars, style guide, plus optional competitive landscape,
   standing orders, name & persona, and a Google Drive folder). Brand voice is the only
   required field (the minimum viable brand). Each field maps 1:1 to a stored brand file.
3. **Create.** Team members run slash commands in Slack. Alex acknowledges instantly,
   generates content in the background against that workspace's brand profile, runs it
   through a quality gate, and posts the result back.
4. **Refine.** Brand can be updated any time in Slack with `/alex-update`.

---

## Slash commands

All content commands share one Slack Request URL (`/api/slack/events`); `/alex-update`
has its own (`/api/slack/alex-update`).

| Command             | What it does                                             |
| ------------------- | ------------------------------------------------------- |
| `/brief`            | Vague idea → structured editorial brief                 |
| `/weekly-social`    | Prior week's content → 5–7 platform-native posts        |
| `/morning-briefing` | Competitive scan + today's priorities + pipeline status |
| `/caption`          | Platform-specific caption with hashtags                 |
| `/hook`             | 5 video hook options with the first 2 seconds scripted  |
| `/headline`         | 10 headline options                                     |
| `/subject-line`     | 5 email subject lines with rationale                    |
| `/reply`            | 2–3 on-brand reply options                              |
| `/outline`          | Structural outline with one-line section summaries      |
| `/alex-update`      | Refine the workspace's brand profile (admin only)       |

---

## Architecture

**Multi-tenant by `team_id`.** Each Slack workspace installs via OAuth and gets its own
bot token (stored on the `tenants` table). Brand data is per-workspace in `tenant_files`
(composite key `team_id` + `field`). `getBotToken(teamId)` falls back to
`SLACK_BOT_TOKEN` only for single-workspace/dev use.

**Public base URL is derived, never hardcoded.** `getPublicBaseUrl()` prefers
`REPLIT_DOMAINS` (production) and falls back to `REPLIT_DEV_DOMAIN`. The OAuth redirect
URI registered in the Slack app must exactly match `<base>/api/slack/oauth_redirect`.

**Slash commands ack immediately, then process in the background.**
`/api/slack/events` responds within Slack's 3-second window, then runs the slow AI work
via `setImmediate` and replies through Slack's `response_url`. This requires an
always-running server — see [Gotchas](#gotchas).

**HMAC tokens, no server-side session store.** The `state` (CSRF) and `setup`
(post-install wizard auth, which carries `teamId`) values are stateless signed tokens
over `SESSION_SECRET`.

**Conversation memory (two systems, additive).**
- An external **Context API** stores learnings, scoped per workspace.
- The database keeps full conversation history. Every invocation is stored; only
  successful ones are replayed. Both are fail-open — a memory outage never blocks a command.

---

## Repository layout

This is a pnpm monorepo. Deployable apps live in `artifacts/`, shared code in `lib/`.

```
artifacts/
  api-server/       Express 5 API — Slack OAuth, events, wizard, agent, gate (served at /api)
  landing/          React + Vite "Add to Slack" landing page (served at /)
  mockup-sandbox/   Component preview sandbox (design/dev only, not deployed)
lib/
  api-spec/         OpenAPI spec — single source of truth for API contracts
  api-zod/          Generated Zod schemas (server validation)
  api-client-react/ Generated React Query hooks (frontend)
  db/               PostgreSQL schema + Drizzle ORM
  integrations-anthropic-ai/  Anthropic client wrapper
  integrations/     Shared integration helpers
```

### Key files

- `artifacts/api-server/src/routes/slackOauth.ts` — "Add to Slack" landing, OAuth flow,
  and the post-install arrival onboarding wizard (`/api/slack/setup`).
- `artifacts/api-server/src/routes/slack.ts` — slash command handling
  (`/api/slack/events`, `/api/slack/alex-update`).
- `artifacts/api-server/src/routes/admin.ts` — read-only operator dashboard.
- `artifacts/api-server/src/lib/alex/slackInstall.ts` — OAuth helpers, per-workspace
  bot tokens, HMAC CSRF/setup tokens.
- `artifacts/api-server/src/lib/alex/tenant.ts` — per-workspace brand-file store.
- `artifacts/api-server/src/lib/alex/agent.ts` / `gate.ts` — content generation + quality gate.
- `artifacts/api-server/src/lib/alex/registry.ts` — the slash command definitions.

---

## Tech stack

- **Runtime:** Node.js 24, TypeScript 5.9, pnpm workspaces
- **API:** Express 5
- **Database:** PostgreSQL + Drizzle ORM
- **Validation:** Zod (`zod/v4`) + `drizzle-zod`
- **API codegen:** Orval (React Query hooks + Zod schemas from the OpenAPI spec)
- **Frontend (landing):** React + Vite + Tailwind
- **AI:** Anthropic (content generation + quality gate)
- **Build:** esbuild (CJS bundle for the server)

---

## Local development

Prerequisites: Node.js 24 and pnpm, plus a PostgreSQL connection string in `DATABASE_URL`.

```bash
pnpm install

# Run the API server (port 5000)
pnpm --filter @workspace/api-server run dev

# Run the landing page dev server
pnpm --filter @workspace/landing run dev

# Full typecheck across all packages
pnpm run typecheck

# Typecheck + build everything
pnpm run build

# Regenerate API hooks and Zod schemas after editing the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (development only)
pnpm --filter @workspace/db run push
```

> This project was built on Replit, where each app runs via a configured workflow (which
> injects `PORT` and other env vars) rather than a root-level `pnpm dev`. The commands
> above are the per-package equivalents for running things directly.

---

## Environment variables & secrets

Secrets are **not** committed to this repository. To run Alex you must provide:

| Variable                | Purpose                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string                                  |
| `SESSION_SECRET`        | Signing key for HMAC `state` / `setup` tokens                 |
| `SLACK_CLIENT_ID`       | Slack app OAuth client ID                                     |
| `SLACK_CLIENT_SECRET`   | Slack app OAuth client secret                                 |
| `SLACK_SIGNING_SECRET`  | Verifies inbound Slack requests (**mandatory in production**) |
| `SLACK_BOT_TOKEN`       | Fallback bot token for single-workspace/dev only              |
| `CONTEXT_API_KEY`       | Auth for the external Context API (conversation memory)       |
| `OPERATOR_PASSWORD`     | HTTP Basic Auth password for the operator dashboard           |
| `ANTHROPIC_API_KEY`     | AI content generation (or a managed AI-integration equivalent)|

**Slack bot scopes:** `commands`, `chat:write`, `users:read`. Changing scopes requires
reinstalling Alex in each workspace.

---

## Deployment

Deploy as an **always-on Reserved VM**, not scale-to-zero autoscale. Alex's Slack
handlers ack immediately and then do the real AI work in a post-response `setImmediate`;
on autoscale the instance can be suspended right after the ack, so that background work
(and the `response_url` reply) may never complete and users get stuck on "Working on it…".
A Reserved VM stays up and completes the work.

On Replit, the production database schema is applied automatically during the Publish
flow (dev schema is diffed against prod). Do **not** write migration scripts or
startup-time DDL.

---

## Connecting the Slack app

The production domain isn't known until the app is first published, so wire Slack up
**after** the first deploy. In your Slack app config (https://api.slack.com/apps):

1. **OAuth & Permissions → Redirect URLs:** `https://<your-domain>/api/slack/oauth_redirect`
2. **Slash Commands:** set every content command's Request URL to
   `https://<your-domain>/api/slack/events`, and `/alex-update` to
   `https://<your-domain>/api/slack/alex-update`.
3. **Bot Token Scopes:** `commands`, `chat:write`, `users:read`.
4. **Install** by opening `https://<your-domain>/` and clicking **Add to Slack**.

Because production uses a separate database, every workspace must be installed fresh
against the production domain — a dev-side install does not carry over.

---

## Operator dashboard

`/api/admin` is a read-only operator view gated by HTTP Basic Auth (any username, the
`OPERATOR_PASSWORD` secret). It lists installed workspaces (name, install date,
brand-voice / onboarding status, brand-field count, command count) and recent command
activity. It is for the operator only — not for pilot users.

---

## Gotchas

- **Reserved VM, not autoscale** — background AI replies need an always-on instance
  (see [Deployment](#deployment)).
- **Production schema is applied automatically on Publish** — no migration scripts or
  startup DDL.
- **Point the Slack app at the published domain after the first publish** — the prod
  domain isn't known until then.
- **`SLACK_SIGNING_SECRET` is mandatory in production** — without it, every Slack request
  fails (signature verification is only skipped when `NODE_ENV=development`).
- **Scope changes require reinstalling** Alex in each workspace.
