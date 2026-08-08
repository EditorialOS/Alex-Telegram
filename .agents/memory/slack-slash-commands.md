---
name: Slack slash command integration
description: Hard-won gotchas wiring Slack slash commands to an Express server behind the Replit proxy
---

# Slack slash commands on Express + Replit

## Reply via response_url, NOT chat.postMessage
For slash commands, post the async result back via the `response_url` Slack
includes in the request body.

**Why:** `chat.postMessage` requires the bot to be a member of the target
channel (or hold `chat:write.public`). Users hit a wall trying to "Add people →
@bot" to a channel — Slack won't add a bot that way. `response_url` works in any
channel or DM with zero channel membership, for up to 5 replies within 30 min.

**How to apply:** ACK immediately with a 200 JSON ephemeral ("working…"), then
do async work and POST the result to `response_url` with
`response_type: in_channel`. Slash commands have no parent message, so "thread
replies" via `thread_ts` are not applicable.

## Signature verification: trim the secret, fail closed
A pasted `SLACK_SIGNING_SECRET` often carries a trailing newline → HMAC mismatch
→ 401 → Slack shows "the app did not respond." Always `.trim()` the secret
before HMAC. Signature base string is `v0:{timestamp}:{rawBody}` and needs the
RAW request bytes (capture via the `verify` option on `express.urlencoded`).

**Why:** "did not respond" is Slack's generic message for any non-2xx or timeout,
so a silent 401 from signature failure looks identical to a dead server. Diagnose
by logging (on failure only) timestamp delta, rawBody length, secret length, and
whether trimming changed the length.

## Signing secret is per-APP; bot token is per-WORKSPACE
The signing secret is shared across all installs of one Slack app. Only the bot
token differs per workspace (issued at OAuth install). A single-workspace /
internal-app deployment can use one env bot token. True multi-workspace
distribution needs an OAuth install flow + per-team token storage keyed by
team_id; signature verification stays unchanged.

## Google Drive via Replit connector (not static tokens)
Use the `google-drive` Replit connector with `@replit/connectors-sdk`
(`new ReplitConnectors().proxy("google-drive", path, opts)`) for Drive writes —
it injects OAuth and refreshes tokens automatically. Do NOT use a static
`GOOGLE_DRIVE_ACCESS_TOKEN` (expires, manual).

- Create a native Google Doc from text in ONE Drive API call via multipart
  upload: POST `/upload/drive/v3/files?uploadType=multipart` with a
  `multipart/related` body (metadata part with `mimeType:
  application/vnd.google-apps.document` + a `text/plain` media part). Google
  converts it. Avoids needing the separate Docs API host.
- `listConnections("google-drive")[0].status` is `"healthy"` (NOT `active`/`ACTIVE`)
  when connected — match `healthy` when gating on connection status.
- The proxy passes string/Buffer/FormData bodies through untouched; only
  plain objects get JSON.stringified. Set `Content-Type` yourself for multipart.
- The code_execution sandbox resolves modules from the workspace ROOT, so it
  can't import a package installed only in an artifact. Run such smoke tests
  from the artifact dir (`cd artifacts/<pkg> && node --input-type=module -e ...`).
