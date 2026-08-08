# Deploying Alex (Telegram)

The server is a standard long-running Node/Express app in a container. It runs
identically on Railway, a VPS, Fly, Render, or Cloud Run. Config is entirely via
environment variables — nothing hardcoded.

## Environment variables

Required:
- `ANTHROPIC_API_KEY` — direct Anthropic API key (`sk-ant-…`).
- `DATABASE_URL` — any Postgres connection string.
- `TELEGRAM_BOT_TOKEN` — from @BotFather.
- `TELEGRAM_WEBHOOK_SECRET` — random string (`openssl rand -hex 32`); verified on every update and guards the ops endpoints.
- `SESSION_SECRET` — random string; signs the onboarding-wizard token.

Auto-detected (set `PUBLIC_BASE_URL` yourself only if you want to override):
- `PUBLIC_BASE_URL` — your public HTTPS origin. On Railway it derives from
  `RAILWAY_PUBLIC_DOMAIN` automatically; set it explicitly on a VPS.

Optional (each degrades gracefully if unset):
- `OPENAI_API_KEY` — Whisper voice memos.
- `CONTEXT_API_KEY` (+ `CONTEXT_API_BASE_URL`) — conversation memory / notes.
- `PORT` — defaults to 8080; most hosts inject their own.

## Option A — Railway (managed, ~5 minutes)

1. **New Project → Deploy from GitHub repo** → pick `EditorialOS/Alex-Telegram`.
   Railway builds the `Dockerfile` automatically.
2. **Add a database**: New → Database → **PostgreSQL**. Railway sets `DATABASE_URL`
   on the service (reference it in the service's Variables if needed).
3. **Set variables** (service → Variables): the required list above. Leave
   `PUBLIC_BASE_URL` unset — it derives from Railway's domain.
4. **Generate a public domain**: service → Settings → Networking → Generate Domain.
5. **Migrate the DB once** (creates the tables). From this repo on your machine,
   pointing at the Railway Postgres public URL:
   ```bash
   DATABASE_URL='postgres://…railway…' pnpm --filter @workspace/db push
   ```
6. **Register the Telegram webhook + commands** (once):
   ```
   https://<your-app>.up.railway.app/api/telegram/register?secret=<TELEGRAM_WEBHOOK_SECRET>
   ```
7. **Enable inline mode** in @BotFather: `/setinline` (for the @bot inline feature).
8. **Schedule drops**: add a Railway Cron service (or any external cron) hitting
   `GET /api/telegram/push/tick?secret=<TELEGRAM_WEBHOOK_SECRET>` hourly.

Health check: `GET /api/telegram/health`.

## Option B — VPS with Docker

```bash
git clone https://github.com/EditorialOS/Alex-Telegram.git
cd Alex-Telegram
cp artifacts/api-server/.env.example .env      # fill in values; set PUBLIC_BASE_URL
docker build -t alex .
# run it (behind a reverse proxy that terminates HTTPS, e.g. Caddy):
docker run -d --name alex --env-file .env -p 8080:8080 --restart unless-stopped alex
# one-time DB migration:
docker run --rm --env-file .env -w /app -v "$PWD":/app node:22-bookworm-slim \
  sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/db push"
```
Telegram requires a valid HTTPS webhook, so front the container with a reverse
proxy that provides TLS for your domain (Caddy's automatic HTTPS is simplest),
set `PUBLIC_BASE_URL=https://your-domain`, then hit the `/api/telegram/register`
URL as above.

## First-run checklist
1. Create the bot in @BotFather → get `TELEGRAM_BOT_TOKEN`.
2. Deploy with the env vars set.
3. Run the DB migration.
4. Open `…/api/telegram/register?secret=…` once.
5. `/setinline` in BotFather (optional, for inline mode).
6. DM the bot `/start` → wizard → `/brief …`.
