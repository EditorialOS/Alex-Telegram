// Inline mode — the injector (M4). `@alexbot 5 hooks for the rooftop breakfast`
// in ANY chat returns up to 5 tap-to-insert options.
//
// Design notes (spec §6):
//   • Brand context by user: an inline query's from.id is the user's Telegram id,
//     which equals their private-chat id — so their DM tenant is tg_<from.id>.
//     Onboarded → their voice; otherwise generic voice + a "link your Alex" card.
//   • Inline must return fast, so generation is compact and the full gate loop is
//     skipped (a compressed, prompt-level guardrail stands in). The real gate
//     still runs for DM/group commands.
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { loadTenantContext } from "./tenant.js";
import { getTelegramTenant, tenantRefForChat } from "./telegramTenant.js";
import { answerInlineQuery, type InlineQueryResultArticle } from "./telegramApi.js";
import { wizardUrl } from "./telegramCommands.js";
import { logger } from "../logger.js";

const MAX_RESULTS = 5;

export interface InlineQuery {
  id: string;
  query: string;
  from: { id: number };
}

/** Compact generation: up to 5 distinct one-line options, on-voice. */
async function generateOptions(query: string, brandVoice: string): Promise<string[]> {
  const voice =
    brandVoice && !brandVoice.startsWith("[")
      ? brandVoice
      : "A sharp, modern, plainspoken editorial brand voice — concrete, no buzzwords.";

  const system = `You are Alex, an editorial copywriter. Produce up to 5 distinct, ready-to-send options for the user's request.
Rules: one option per line, no numbering, no preamble, no commentary. Each must stand alone and be immediately usable.
Stay strictly on this brand voice:
${voice}`;

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: query }],
  });
  const block = resp.content[0];
  if (block.type !== "text") return [];

  return block.text
    .split("\n")
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_RESULTS);
}

export async function handleInlineQuery(q: InlineQuery): Promise<void> {
  const query = q.query.trim();
  if (!query) {
    await answerInlineQuery(q.id, []);
    return;
  }

  const tenantRef = tenantRefForChat(q.from.id);
  const tenant = await getTelegramTenant(q.from.id);
  const onboarded = !!tenant?.onboardedAt;

  let brandVoice = "";
  if (onboarded) {
    try {
      const ctx = await loadTenantContext(tenantRef);
      brandVoice = ctx.brandVoice;
    } catch (err) {
      logger.warn({ err, from: q.from.id }, "Inline: failed to load tenant context");
    }
  }

  let options: string[] = [];
  try {
    options = await generateOptions(query, brandVoice);
  } catch (err) {
    logger.error({ err, from: q.from.id }, "Inline generation failed");
  }

  const results: InlineQueryResultArticle[] = options.map((opt, i) => ({
    type: "article",
    id: `opt_${i}`,
    title: opt.length > 64 ? `${opt.slice(0, 64)}…` : opt,
    description: onboarded ? undefined : "Generic voice — link your Alex for on-brand output",
    input_message_content: { message_text: opt },
  }));

  // Not onboarded → offer a link card so they can make it on-brand.
  if (!onboarded) {
    results.unshift({
      type: "article",
      id: "link",
      title: "🔗 Link your Alex for on-brand results",
      description: "These are in a generic voice. Tap to set up your brand.",
      input_message_content: { message_text: `Set up Alex: ${wizardUrl(tenantRef)}` },
    });
  }

  await answerInlineQuery(q.id, results.slice(0, MAX_RESULTS));
}
