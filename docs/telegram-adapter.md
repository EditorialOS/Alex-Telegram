# Alex × Telegram — Adapter

Telegram is a surface adapter on Alex Core. The brain (`registry`, `agent`,
`gate`, `tenant`, Context API) is unchanged — only the delivery surface is new.
Everything routes through the same command pipeline as Slack via a shared
`Sink` abstraction.

## What shipped

| Milestone | Contents |
|---|---|
| **M0** | `lib/alex/sink.ts` (Deliverable/Sink/AckHandle contract), `slackSink.ts` (extracted Slack path — success replies byte-identical), surface-agnostic `processor.ts`, `commandParser.ts` + unit test (`test/commandParser.test.ts`). |
| **M1** | `telegram_tenants` table, `telegramTenant.ts`, `telegramApi.ts`, `telegramSink.ts` (edit→sendMessage fallback), `routes/telegram.ts` webhook (secret verify, DM/group addressing), `/start`→wizard, `/help`, `/alex_update` (admin), wizard timezone field. |
| **M2** | `telegramPush.ts` (push sink, timezone-aware jobs, held-drop), `telegramRender.ts`, Context API `recordNote`/`countRecentNotes`, reply-to-Alex → memory note loop. |
| **M3** | `transcribe.ts` (OpenAI Whisper), voice memo → transcript → command / note / `/brief`. |
| **M4** | `telegramInline.ts` — `@alexbot …` inline mode, per-user tenant lookup, up to 5 tap-to-insert results, link card when not onboarded. |

The tenant key `tg_<chat_id>` maps straight onto the existing `tenant_files`,
Context API `product`, and conversation store — no changes to any of them.

## Environment variables

| Var | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Random string (`openssl rand -hex 32`). Verified on every update; also guards the ops endpoints below. **Mandatory in production.** |
| `OPENAI_API_KEY` | Whisper transcription (voice memos). Optional — voice degrades gracefully without it. |

Reused from the Slack side: `SESSION_SECRET` (or `SLACK_CLIENT_SECRET`) signs the
wizard setup token; `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN` give the public base URL;
`DATABASE_URL`, `CONTEXT_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` as today.

## Deploy steps

1. **Migrate the DB** (adds `telegram_tenants`):
   ```bash
   pnpm --filter @workspace/db push
   ```
2. **BotFather setup**: create the bot; enable inline mode with `/setinline`
   (needed for M4); leave privacy mode **ON** (BotFather default — the reply-as-
   memory UX works on defaults).
3. **Register webhook + commands** (once per deploy):
   ```
   GET /api/telegram/register?secret=<TELEGRAM_WEBHOOK_SECRET>
   ```
   Sets the webhook (with the secret token) and runs `setMyCommands`.
4. **Schedule pushes**: point an hourly cron at
   ```
   GET /api/telegram/push/tick?secret=<TELEGRAM_WEBHOOK_SECRET>
   ```
   Each job keys on the tenant's local hour, so hourly cadence fires each slot
   once (Weekly Drop Thu 16:00; morning note 08:00 for Pro/linked accounts;
   calendar first Monday 08:00). Run **hourly**, not more often.

Health: `GET /api/telegram/health`.

## Local verification (done)

- `pnpm run typecheck:libs && pnpm --filter @workspace/api-server run typecheck` → clean.
- `pnpm --filter @workspace/api-server run test` → 9/9 (command-table normalization).
- `pnpm --filter @workspace/api-server run build` → bundles.

## Acceptance gates that need a live bot + DB (not runnable in CI)

These require a real `TELEGRAM_BOT_TOKEN`, a provisioned `DATABASE_URL`, and a
Telegram client — run them after deploy:

- **M0** — existing Slack flow unchanged (regression check on a real workspace).
- **M1 privacy gate (§4.5)** — new test group, bot with default BotFather
  settings; confirm the webhook receives (1) a command, (2) an @mention, (3) a
  reply to a bot message. 15 minutes, week one.
- **M1** — Script 1 (Copper Kettle) start to finish in a DM; gate scores visible.
- **M2** — Script 2: reply-to-drop → note → confirmation; weekly drop via
  `/api/telegram/push/weekly?secret=…&chat=<id>`; held-drop after 7 idle days.
- **M3** — a 20-second voice memo becomes a brief.
- **M4** — `@alexbot 5 hooks …` in a chat Alex isn't a member of returns options.

## Notes / known deltas

- **Slack cosmetic delta:** the three *edge* messages (unknown command, gate
  block, error) are now surface-neutral plain text shared with Telegram — they
  lost Slack `*bold*`/backtick mrkdwn. The **success reply** path
  (`formatSlackReply`) is byte-identical to before.
- **Wizard copy:** the shared arrival wizard's done-screen says "Head to Slack".
  Harmless for Telegram users (the wizard still writes their brand files); a
  surface-neutral rewrite is a follow-up polish, out of adapter scope.
- **Calendar drop** uses an ad-hoc routine defined in `telegramPush.ts` (not the
  registry) so `registry.ts` stays untouched, via the `processCommand` routine
  override.
