// Telegram command surface: the setMyCommands list, the /help + onboarding
// copy, and the wizard link. The wizard is reused verbatim from the Slack
// install flow — the setup token simply carries the Telegram tenant_ref, and
// the wizard writes the same tenant_files.
import { listRoutineMeta } from "./registry.js";
import { toTelegramCommandName } from "./commandParser.js";
import { signSetupToken, getPublicBaseUrl } from "./slackInstall.js";
import { escapeHtml, type BotCommand } from "./telegramApi.js";

/** The full command list registered once via setMyCommands (spec §3.2 — one global list). */
export function telegramCommandList(): BotCommand[] {
  const routines = listRoutineMeta().map((r) => ({
    command: toTelegramCommandName(r.command),
    description: r.description,
  }));
  return [
    ...routines,
    { command: "alex_update", description: "Update your brand files (admin only)" },
    { command: "help", description: "Show commands and set-up link" },
    { command: "start", description: "Get started with Alex" },
  ];
}

/** Hosted arrival-wizard URL for a tenant, gated by an HMAC setup token. */
export function wizardUrl(tenantRef: string): string {
  const base = getPublicBaseUrl();
  const token = signSetupToken(tenantRef);
  return `${base}/api/slack/setup?token=${encodeURIComponent(token)}`;
}

/** First-contact onboarding message (HTML). Sent directly, not via the sink. */
export function onboardingHtml(tenantRef: string): string {
  const url = wizardUrl(tenantRef);
  return [
    `👋 <b>I'm Alex — your editorial teammate.</b>`,
    ``,
    `Teach me your brand in about two minutes and everything I make will sound like you:`,
    `👉 <a href="${escapeHtml(url)}">Set up Alex</a>`,
    ``,
    `Then try <code>/brief your idea here</code>, or /help to see everything I can do.`,
  ].join("\n");
}

/** Returning-user /start message (HTML). */
export function welcomeBackHtml(tenantRef: string): string {
  const url = wizardUrl(tenantRef);
  return [
    `👋 Good to see you. I'm ready when you are.`,
    ``,
    `Try <code>/brief your idea</code>, or /help for the full list.`,
    `Need to tweak your brand? <a href="${escapeHtml(url)}">Open setup</a> or use <code>/alex_update</code>.`,
  ].join("\n");
}

/** /help message (HTML): every command + the setup link. */
export function helpHtml(tenantRef: string): string {
  const lines = listRoutineMeta().map(
    (r) => `<code>/${toTelegramCommandName(r.command)}</code> — ${escapeHtml(r.description)}`
  );
  return [
    `<b>Alex — editorial commands</b>`,
    ``,
    ...lines,
    ``,
    `<code>/alex_update</code> — update your brand files (admin only)`,
    ``,
    `In a group, address me with a command, an @mention, or a reply to one of my messages.`,
    `Set up or edit your brand any time: <a href="${escapeHtml(wizardUrl(tenantRef))}">open setup</a>.`,
  ].join("\n");
}
