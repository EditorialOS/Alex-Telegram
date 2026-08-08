# Alex — Editorial AI Slack Agent: System Overview

_Last updated: June 17, 2026_

This document describes what has been built, how it runs, how it can serve outside
clients, and how to set up a workspace so Alex retains state. It also maps your
**Minimal AI OS** specification onto what exists today and flags the gaps.

---

## 1. What Alex is

Alex is a multi-tenant editorial AI agent that lives inside Slack. A user types a
slash command (e.g. `/brief launch a spring campaign`), and Alex:

1. Loads that Slack workspace's brand context (voice, pillars, competition, standing orders).
2. Recalls recent past work for that workspace (memory).
3. Generates a draft with Claude.
4. Runs the draft through an editorial quality gate (and revises if needed).
5. Posts the result back into Slack and, for the longer "routines," auto-saves it to Google Drive.

It is **request-driven**: Alex acts when someone runs a command. It does not yet run
autonomously on a schedule (see §9 and §10).

---

## 2. Architecture & data flow

```
Slack user
   │  /command  (signed request)
   ▼
Express API  (artifacts/api-server, served at /api)
   │  1. verify Slack signature
   │  2. ack immediately ("⏳ Working on …")
   │  3. process in background:
   ▼
 ┌─────────────────────────────────────────────────────────┐
 │ loadTenantContext(teamId)   → brand files for this team  │
 │ fetchMemory(teamId)         → recent learnings (Context) │
 │ runAlex(...)                → Claude draft               │
 │ runGate(...)                → APPROVE / REVISE / BLOCK    │
 │ (gate loop: up to N revisions for "routines")            │
 │ writeToDrive(...)           → native Google Doc (routines)│
 │ recordLearning(...)         → store approved output       │
 └─────────────────────────────────────────────────────────┘
   │  POST result back via Slack response_url
   ▼
Slack channel  (final reply + Drive link + gate footer)
```

**Stack:** Node.js 24, TypeScript, Express 5, pnpm monorepo. AI via the Replit
Anthropic integration (`claude-sonnet-4-6`). Served behind the shared proxy at `/api`.

**Key source files** (all under `artifacts/api-server/src/`):

| File | Responsibility |
|------|----------------|
| `routes/slack.ts` | Slack endpoints: `/slack/events`, `/slack/alex-update`, `/slack/health` |
| `lib/alex/processor.ts` | Orchestrates the whole command lifecycle |
| `lib/alex/registry.ts` | The catalog of commands (routines + quick hits) |
| `lib/alex/agent.ts` | Assembles the prompt and calls Claude |
| `lib/alex/gate.ts` | Editorial quality gate (Claude-as-judge) |
| `lib/alex/tenant.ts` | Per-workspace brand files (state) |
| `lib/alex/drive.ts` | Google Drive auto-save (via Replit connector) |
| `lib/alex/context.ts` | Conversation memory (external Context API) |
| `lib/alex/formatter.ts` | Slack message formatting + onboarding |

---

## 3. Commands

**Routines** (multi-step, gate-looped, auto-saved to Drive):

| Command | What it does | Saved to Drive |
|---------|--------------|----------------|
| `/brief` | Vague idea → structured editorial brief | `strategy/` |
| `/weekly-social` | A week's content → 5–7 platform-native posts | `social/` |
| `/morning-briefing` | Competitive scan + today's priorities + pipeline | `reports/` |

**Quick hits** (single-shot, fast, not saved to Drive):

`/caption` · `/hook` · `/headline` · `/subject-line` · `/reply` · `/outline`

---

## 4. The editorial quality gate

Every routine output is scored by a second Claude pass acting as a senior editor:

| Verdict | Score | Behavior |
|---------|-------|----------|
| APPROVED | 90–100 | Ship as-is |
| APPROVED_WITH_NOTES | 75–89 | Ship with minor optional tweaks |
| REVISE | 50–74 | Auto-revise (routines loop up to a max), then re-check |
| BLOCKED | 0–49 | Stop; report the problem |

The gate evaluates voice alignment, banned-term compliance, format fit, factual
integrity, and CTA clarity. Quick hits run a lighter content check without the loop.

---

## 5. Per-workspace state (`/alex-update`)

Each Slack workspace ("tenant") has its own brand files. Admins set them with:

```
/alex-update brand-voice <text>
/alex-update content-pillars <text>
/alex-update audience-personas <text>
/alex-update style-guide <text>
/alex-update competitive-landscape <text>
/alex-update standing-orders <text>
/alex-update teammate <text>          # optional — Alex's name & persona for this workspace
/alex-update drive-folder <Google Drive folder ID>
```

- Only **Slack workspace admins/owners** can run `/alex-update` (enforced via Slack's user API).
- Each update **replaces** that field for the workspace.
- New workspaces get a one-time welcome message listing these commands; it only shows once.
- Until a field is set, Alex injects a clear "not configured" placeholder for it.
- **`teammate`** lets a client rename and re-personalize Alex. Include a `Name: Maya`
  line and Alex will sign as "Maya" and adopt the persona text you provide; without
  it, the default identity is "Alex."

> ✅ **Durable now.** These fields are stored in **PostgreSQL** (table `tenant_files`,
> one row per `(team_id, field)`), so they survive redeploys and are shared across all
> Autoscale instances. See §10.

---

## 6. Google Drive auto-save

Approved routine outputs are saved as **native Google Docs** in the workspace's Drive.

- Uses the Replit Google Drive connector (OAuth handled by Replit; no manual token).
- If a workspace set `drive-folder`, the doc is filed there; otherwise it lands in the
  connected account's Drive root.
- The Slack reply includes a clickable link to the new doc.

---

## 7. Conversation memory (Context API)

Alex remembers past work via your external **Editorial OS Context API**.

- Approved outputs are stored as `learnings`; recent ones are injected into the prompt
  so replies stay consistent over time.
- **Tenant isolation:** records are scoped per workspace via `product = "alex:<teamId>"`.
- Now runs over your **HTTPS** endpoint (`https://context-api.srv1461270.hstgr.cloud/api`),
  so the key and data travel encrypted.
- **Fail-open:** memory has strict timeouts and swallows errors, so it can never block
  or slow a Slack command.
- Treated as untrusted reference data with a prompt-injection guard.

---

## 8. Deployment status & configuration

- **Currently NOT deployed** (no production deployment exists yet).
- Deployment target is **Autoscale** (`.replit` → `deploymentTarget = "autoscale"`).
- Production health check: `/api/healthz`. Operational status: `/api/slack/health`
  (reports which integrations are configured).
- Secrets in place: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SESSION_SECRET`,
  `CONTEXT_API_KEY`; config `CONTEXT_API_BASE_URL` (HTTPS).
- **Required for state:** `DATABASE_URL` (Postgres) — tenant brand files live here.

---

## 9. How this works for outside clients (multi-tenancy)

**The model:** every Slack workspace is a separate tenant, keyed by Slack's `team_id`.
Brand files, Drive destination, and memory are all isolated per `team_id`. So two
different client companies in two different Slack workspaces never see each other's
context. This is already true in the code.

**What is built for "outside client" use:**

1. ✅ **Multi-workspace Slack install (OAuth "Add to Slack").** Any company can add Alex
   to *their own* Slack from a shareable install page (`/api/slack/landing`). The flow:
   `/api/slack/install` → Slack authorize (signed, time-limited CSRF state) →
   `/api/slack/oauth_redirect` exchanges the code via `oauth.v2.access` and stores that
   workspace's **own bot token** on its `tenants` row. Admin checks (`users.info`) then
   use the per-workspace token (`getBotToken(teamId)`), with the old `SLACK_BOT_TOKEN`
   kept only as a dev/single-workspace fallback. Requires `SLACK_CLIENT_ID` +
   `SLACK_CLIENT_SECRET` and the app set to "public distribution" in the Slack dashboard,
   with the redirect URL registered.
2. ✅ **Durable, shared state.** See §10 — tenant state is in Postgres.

**What is still missing for true product use:**

3. **Per-client onboarding & billing** (if this becomes a product): usage limits and
   possibly a dashboard. (A dashboard task is already queued/paused.)
4. **Token-at-rest hardening.** Per-workspace bot tokens are currently stored in
   plaintext in `tenants.bot_token`. Fine for early rollout; encrypt at rest (e.g. KMS
   envelope encryption) before a broad public launch.

**Bottom line:** distribution and persistence are now built — outside companies can
self-install Alex into their own Slack and their state persists. Remaining work is
productization (billing/limits) and security hardening (token encryption).

---

## 10. The statelessness problem — RESOLVED

**Was:** `/alex-update` wrote brand files to the server's **local filesystem**
(`artifacts/api-server/tenants/<teamId>/`). On **Autoscale** that disk is ephemeral
(wiped on every redeploy/scale event) and not shared between instances — so a client's
settings could silently disappear or be inconsistent. That was the core reason Alex felt
"stateless."

**Now:** tenant state lives in **PostgreSQL** (Option A, the recommended fix):

- Table `tenants` — registry of workspaces seen (so onboarding shows only once).
- Table `tenant_files` — one row per `(team_id, field)`, upserted on each `/alex-update`.

This survives redeploys and is shared across all Autoscale instances. Combined with
Context API memory and Drive outputs (which already persisted), **all of Alex's state is
now durable.** `DATABASE_URL` is required for this to work.

---

## 11. Your "Minimal AI OS" mapped onto Alex

Your spec describes a richer, filesystem-as-brain, autonomously-scheduled system. Here's
how it lines up with what exists today.

| Your OS concept | Status in Alex today |
|-----------------|----------------------|
| `brand-voice.md` | ✅ `/alex-update brand-voice` |
| `content-pillars.md` | ✅ `/alex-update content-pillars` |
| `competitive-landscape.md` | ✅ `/alex-update competitive-landscape` |
| `standing_orders.md` (NTSL) | ⚠️ stored via `/alex-update standing-orders`, but **not parsed/scheduled** — used as prompt context only |
| `audience-personas.md` | ✅ `/alex-update audience-personas` |
| `style-guide.md` | ✅ `/alex-update style-guide` |
| `teammate.md` (identity) | ✅ `/alex-update teammate` — per-client name & persona (`Name:` line sets the name; defaults to "Alex") |
| `alex-log.md` / `logbook.md` | ◑ partially covered by Context API memory |
| `decision_log.md` | ❌ not built |
| `skills/*.md` (file-driven SOPs) | ⚠️ skills exist but are **hardcoded** in `registry.ts`, not loaded from files |
| 5-gate editorial gate | ✅ implemented (as a scored verdict, see §4) |
| Night Shift runtime + cron (autonomous nightly runs) | ❌ not built — Alex is on-demand only |
| Day Shift sprints + status board | ❌ not built |
| Morning report file | ◑ `/morning-briefing` produces one on demand; not auto-generated nightly |
| Google Drive `Data/Work/Assets` structure | ◑ outputs save to Drive subfolders (`strategy/`, `social/`, `reports/`); full structure not enforced |
| Multi-client (folder-per-client) | ✅ isolated per Slack workspace (different mechanism, same outcome) |

**Reading this:** the **interactive, on-demand half** of your OS is built and working
(voice, pillars, audience personas, style guide, competition, per-client identity, gate,
Drive, durable memory + state, multi-tenant). The **autonomous half** (NTSL scheduling,
nightly runtime, morning reports, file-driven skills) is not yet built.

---

## 12. Setup walkthrough — populating a workspace from your OS docs

For a client whose docs you have, an admin runs these in their Slack (paste the text
from each doc after the command):

1. `/alex-update brand-voice <paste your brand-voice.md content>`
2. `/alex-update content-pillars <paste your content-pillars.md content>`
3. `/alex-update audience-personas <paste your audience-personas.md content>`
4. `/alex-update style-guide <paste your style-guide.md content>`
5. `/alex-update competitive-landscape <paste your competitive-landscape.md content>`
6. `/alex-update standing-orders <paste your standing_orders.md (NTSL) content>`
7. `/alex-update teammate <paste your teammate.md — start with a "Name: ..." line>` _(optional)_
8. `/alex-update drive-folder <the Google Drive folder ID for this client>`

Notes:
- Every OS Data file now has a home. `teammate` is optional — set it to rename and
  re-personalize Alex per client; begin the text with `Name: <name>` so Alex signs as that name.
- `standing-orders` is stored and fed to Alex as context, but Alex won't *act on a
  schedule* from it yet — that requires the autonomous runtime.

---

## 13. Suggested next steps (priority order)

1. ✅ **Make state durable** — DONE (Postgres-backed tenant state, §10).
2. ✅ **Add the missing `/alex-update` fields** — DONE (`audience-personas`,
   `style-guide`, `teammate` identity).
3. **Multi-workspace Slack install** (§9) — OAuth "Add to Slack" + per-team tokens, so
   outside companies can self-onboard.
4. **(Bigger) Autonomous runtime** — NTSL scheduling + nightly morning reports, to deliver
   the "Night Shift" half of your OS.
5. **(Queued) Web dashboard** — currently paused at your request.
