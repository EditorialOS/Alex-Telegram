---
name: Alex deployment / pilot go-live
description: How to ship Alex to production for external pilot installs — deployment target, Slack app wiring order, prod schema/secrets.
---

# Shipping Alex for pilot users

The whole multi-tenant flow (public "Add to Slack" landing → OAuth → per-workspace
bot token → onboarding wizard → slash commands) was already built and verified in dev.
Going live is operational, not new code.

## Deploy target: Reserved VM, NOT autoscale
**Rule:** Deploy Alex as a Reserved VM (always-on), not scale-to-zero autoscale.
**Why:** Slack handlers must ack within 3s, so they ack then do the slow AI work in a
post-response `setImmediate` and reply via `response_url`. On autoscale the instance can
be suspended right after the ack, so the background work never finishes and users are
stuck on "Working on it…". A queue+worker would make it autoscale-safe but is overkill
for a pilot.
**How to apply:** Tell the user to pick Reserved VM in the Publish UI. Agent cannot set
the deploy target programmatically (artifact.toml doesn't carry it; user picks at publish).

## Slack app wiring is chicken-and-egg with the domain
The prod domain isn't known until the first publish. Correct order:
1. Publish → get the `.replit.app` (or custom) domain.
2. In the Slack app settings set OAuth Redirect URL `<domain>/api/slack/oauth_redirect`,
   and each slash command's Request URL `<domain>/api/slack/events`
   (and `<domain>/api/slack/alex-update` for `/alex-update`).
3. Then install. Shareable button link is `<domain>/api/slack/landing`.

Redirect URI must EXACTLY match `getPublicBaseUrl()/api/slack/oauth_redirect`
(`getPublicBaseUrl` prefers `REPLIT_DOMAINS`).

## Prod schema + secrets
- Prod schema is applied automatically by Replit's Publish flow (dev→prod diff). Never
  write migration scripts / startup DDL.
- Required prod env (carried from workspace secrets): `SLACK_CLIENT_ID`,
  `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SESSION_SECRET`, `DATABASE_URL`,
  Anthropic integration base URL. `SLACK_SIGNING_SECRET` missing in prod = every Slack
  request 500s (verification only skipped when `NODE_ENV=development`).

## Slash commands must ack BEFORE any external call
Every slash command handler must respond to Slack within ~3s, then do slow work
(AI generation, Slack Web API calls like `users.info`) in a post-response `setImmediate`
and reply via `response_url`. Doing an external call before the ack (the old
`/alex-update` bug) causes intermittent timeouts even on a VM. This is *why* the deploy
target must be always-on, not just a nice-to-have.

## Verification the agent cannot do alone
A real external install (clicking Add to Slack in a fresh workspace, onboarding, running a
slash command, `/alex-update` as admin) is user-side. Also confirm the Slack app has
public distribution enabled so non-dev workspaces can install. Agent verifies
code/health/typecheck and provides the runbook; the human does the live install test.
