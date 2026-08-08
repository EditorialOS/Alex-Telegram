import crypto from "crypto";
import { db, tenants } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

// Multi-workspace Slack distribution. Each workspace installs Alex via OAuth and
// gets its own bot token, stored on the tenants row. Slash-command replies use
// response_url (no token), but Web API calls (e.g. users.info for the admin
// check) need the installing workspace's token — looked up here by teamId.

// Scopes Alex needs: slash commands, reading user info (admin check), and
// posting messages (future-proofing; replies currently use response_url).
const SCOPES = ["commands", "users:read", "chat:write"].join(",");

const STATE_TTL_MS = 10 * 60 * 1000;

export function isOauthConfigured(): boolean {
  return !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET;
}

/**
 * Public base URL for this deployment, used to build the OAuth redirect URI.
 * Prefers the published domain, falls back to the dev domain.
 */
export function getPublicBaseUrl(): string {
  // Self-hosted: set PUBLIC_BASE_URL to your public HTTPS origin
  // (e.g. https://alex.example.com). Takes precedence everywhere.
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  // Common PaaS-provided domains, so the webhook/wizard URL needs no hardcoding.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway}`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return "";
}

export function getRedirectUri(): string {
  return `${getPublicBaseUrl()}/api/slack/oauth_redirect`;
}

function stateSecret(): string {
  return (process.env.SESSION_SECRET ?? process.env.SLACK_CLIENT_SECRET ?? "").trim();
}

/** Signed, stateless CSRF token: base64url(payload).hmac — no server storage. */
export function signState(): string {
  const payload = JSON.stringify({ n: crypto.randomBytes(8).toString("hex"), t: Date.now() });
  const body = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const [body, sig] = state.split(".");
  if (!body || !sig) return false;
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  try {
    const { t } = JSON.parse(Buffer.from(body, "base64url").toString()) as { t: number };
    return typeof t === "number" && Date.now() - t < STATE_TTL_MS;
  } catch {
    return false;
  }
}

// Setup token: proves the holder just completed an install for a specific
// workspace, authorizing the post-install onboarding wizard to write that
// workspace's brand files. Same HMAC scheme as state, but purpose-tagged and
// carrying the teamId, with a longer TTL so people have time to onboard.
const SETUP_TTL_MS = 60 * 60 * 1000;

export function signSetupToken(teamId: string): string {
  const payload = JSON.stringify({ p: "setup", team: teamId, t: Date.now() });
  const body = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verify a setup token and return its teamId, or null if invalid/expired. */
export function verifySetupToken(token: string | undefined): string | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      p?: string;
      team?: string;
      t?: number;
    };
    if (data.p !== "setup" || !data.team || typeof data.t !== "number") return null;
    if (Date.now() - data.t >= SETUP_TTL_MS) return null;
    return data.team;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

interface SlackOauthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
}

export interface Installation {
  teamId: string;
  teamName: string | null;
  botToken: string;
  botUserId: string | null;
}

/** Exchange the OAuth code for a bot token via Slack's oauth.v2.access. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<Installation> {
  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as SlackOauthResponse;

  if (!data.ok || !data.access_token || !data.team?.id) {
    throw new Error(`Slack OAuth failed: ${data.error ?? "unknown error"}`);
  }

  return {
    teamId: data.team.id,
    teamName: data.team.name ?? null,
    botToken: data.access_token,
    botUserId: data.bot_user_id ?? null,
  };
}

/** Persist (or refresh) a workspace installation, keyed by teamId. */
export async function saveInstallation(install: Installation): Promise<void> {
  await db
    .insert(tenants)
    .values({
      teamId: install.teamId,
      teamName: install.teamName,
      botToken: install.botToken,
      botUserId: install.botUserId,
      installedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenants.teamId,
      set: {
        teamName: install.teamName,
        botToken: install.botToken,
        botUserId: install.botUserId,
        installedAt: new Date(),
      },
    });
  logger.info({ teamId: install.teamId, teamName: install.teamName }, "Saved Slack installation");
}

/**
 * Resolve the bot token for a workspace. Prefers the per-workspace token stored
 * at install time; falls back to the env token (single-workspace / dev setups).
 */
export async function getBotToken(teamId: string): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ botToken: tenants.botToken })
      .from(tenants)
      .where(eq(tenants.teamId, teamId))
      .limit(1);
    const token = rows[0]?.botToken;
    if (token) return token;
  } catch (err) {
    logger.error({ err, teamId }, "Failed to read bot token from DB");
  }
  return process.env.SLACK_BOT_TOKEN || undefined;
}
