---
name: Alex tenant state, distribution & brand fields
description: How Alex isolates/stores per-workspace state, how multi-workspace install works, and deliberate scoping decisions.
---

# Alex tenant state & distribution

Alex (multi-tenant editorial Slack bot, `artifacts/api-server`) treats each Slack
workspace as a tenant keyed by `team_id`. All per-workspace state lives in **Postgres**
(`tenants` registry + `tenant_files`, one row per `(team_id, field)`), not on local disk
and not in the external Context API.

**Why Postgres:** deploy target is Autoscale — local disk is ephemeral and not shared
across instances, so local-FS state silently vanished/diverged. Postgres was chosen over
the Context API so durability doesn't depend on that single external service (Context API
holds memory only).

**How to apply:** any new per-workspace setting is a new `field` in `tenant_files`
(upsert on `(team_id, field)`), reachable via `/alex-update <field>`. Always filter reads
by `teamId` — keep it that way; there is no cross-tenant read path.

## Multi-workspace distribution (OAuth)
Alex is a **publicly distributable** Slack app: each workspace installs via OAuth and
gets its **own bot token**, stored on its `tenants` row. Replies use Slack `response_url`
(no token); the bot token is only needed for Web API calls (e.g. `users.info` admin
check), resolved per-workspace.

**Why this matters:** a single env `SLACK_BOT_TOKEN` only works for one workspace; it
remains as a dev/single-workspace fallback only.

**Constraints / gotchas:**
- OAuth needs `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` and the app set to "public
  distribution" with the redirect URL registered in the Slack dashboard.
- Redirect URI is derived from `REPLIT_DOMAINS` (prod) else `REPLIT_DEV_DOMAIN` (dev); it
  must EXACTLY match a redirect URL registered in Slack, so register both dev and prod.
- CSRF `state` is a stateless HMAC over `SESSION_SECRET` (works across Autoscale
  instances — do not switch to in-memory state).
- **Bot tokens are stored plaintext** in `tenants.bot_token` — acceptable early, but
  encrypt at rest before a broad public launch.

## Scoping decisions (deliberate, not oversights)
- The editorial **gate uses brand voice only**, not the style guide. Style guide feeds
  the generation prompt but is intentionally kept out of the gate to limit scope.
- **Per-client identity:** `/alex-update teammate` text becomes Alex's persona; a
  `Name: <X>` first line sets the display name in Slack footers (default "Alex").
- Onboarding is check-then-insert; a concurrent first command can rarely double-post the
  welcome. Known + harmless; make the insert atomic only if it ever matters.
