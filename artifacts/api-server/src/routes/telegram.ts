import { Router, type IRouter, type Request, type Response } from "express";
import { processCommand } from "../lib/alex/processor.js";
import { TelegramSink } from "../lib/alex/telegramSink.js";
import { parseCommand } from "../lib/alex/commandParser.js";
import { getRoutine } from "../lib/alex/registry.js";
import { updateTenantFile, registerTenant } from "../lib/alex/tenant.js";
import { recordNote } from "../lib/alex/context.js";
import { transcribe, isTranscriptionConfigured } from "../lib/alex/transcribe.js";
import { handleInlineQuery } from "../lib/alex/telegramInline.js";
import { runPushTick, runWeeklyDrop } from "../lib/alex/telegramPush.js";
import {
  ensureTelegramTenant,
  isOnboarded,
  touchActivity,
  tenantRefForChat,
  getTelegramTenant,
  type TelegramChat,
} from "../lib/alex/telegramTenant.js";
import {
  isTelegramConfigured,
  getMe,
  sendMessage,
  sendChatAction,
  getFilePath,
  downloadFile,
  getChatAdministrators,
  setWebhook,
  setMyCommands,
  setMessageReaction,
  escapeHtml,
  type TelegramMessage,
  type BotInfo,
} from "../lib/alex/telegramApi.js";
import {
  onboardingHtml,
  welcomeBackHtml,
  helpHtml,
  telegramCommandList,
} from "../lib/alex/telegramCommands.js";
import { getPublicBaseUrl } from "../lib/alex/slackInstall.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Webhook security ────────────────────────────────────────────────────────
// Telegram echoes the secret we set at setWebhook time in this header on every
// update — the equivalent of Slack's signing secret. Mandatory in production.
function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "development") {
      logger.warn("TELEGRAM_WEBHOOK_SECRET not set — skipping verification in development");
      return true;
    }
    logger.error("TELEGRAM_WEBHOOK_SECRET is not set — rejecting Telegram update");
    return false;
  }
  const got = req.header("x-telegram-bot-api-secret-token");
  return got === expected;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  inline_query?: { id: string; query: string; from: { id: number } };
}

router.post("/telegram/webhook", (req: Request, res: Response): void => {
  if (!verifyWebhookSecret(req)) {
    res.status(403).json({ error: "Invalid secret token" });
    return;
  }
  // Ack immediately; process out of band so generation never trips Telegram's
  // retry timer.
  res.json({ ok: true });

  const update = req.body as TelegramUpdate;
  setImmediate(() => {
    handleUpdate(update).catch((err) => logger.error({ err }, "Telegram update handler error"));
  });
});

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.inline_query) {
    await handleInlineQuery(update.inline_query).catch((err) =>
      logger.error({ err }, "Inline query handler error")
    );
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

// ── Addressing rules in groups ──────────────────────────────────────────────
function isReplyToBot(msg: TelegramMessage, bot: BotInfo): boolean {
  return msg.reply_to_message?.from?.id === bot.id;
}

function mentionsBot(text: string, bot: BotInfo): boolean {
  if (!bot.username) return false;
  return text.toLowerCase().includes(`@${bot.username.toLowerCase()}`);
}

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const chat = msg.chat;
  const chatId = chat.id;

  const bot = await getMe();
  const tenantRef = tenantRefForChat(chatId);
  const isGroup = chat.type !== "private";

  const text = msg.text ?? "";
  const parsed = parseCommand(text, bot.username);

  // In groups, only engage on a command, an @mention, or a reply to my message.
  // Voice is treated like plain text for addressing. Non-addressed group
  // chatter is ignored entirely — no tenant write, no reply.
  const addressed =
    !isGroup || parsed.isCommand || isReplyToBot(msg, bot) || mentionsBot(text, bot);
  if (!addressed) return;

  // We're engaging: upsert the tenant row (metadata refresh) now.
  const telegramChat: TelegramChat = { id: chat.id, type: chat.type, title: chat.title };
  await ensureTelegramTenant(telegramChat);

  // Voice memo → transcript → command / note / raw material for /brief (§7).
  if (msg.voice) {
    await handleVoice(msg, bot, tenantRef);
    return;
  }

  if (parsed.isCommand && parsed.command) {
    await handleCommand(parsed.command, parsed.args, msg, tenantRef);
    return;
  }

  // Plain, addressed text that replies to one of my messages → a memory note
  // (the Script 2 loop, §5.3): write it to the Context API, confirm in writing,
  // ack with a 👍, and count it as activity for the held-drop rule.
  if (isReplyToBot(msg, bot) && text.trim()) {
    const wrote = await recordNote({
      teamId: tenantRef,
      userId: String(msg.from?.id ?? chatId),
      text,
    });
    if (wrote) {
      await touchActivity(chatId);
      await setMessageReaction(chatId, msg.message_id, "👍");
      await sendMessage(
        chatId,
        "📝 Noted — folding it in. You'll see it in Thursday's drop."
      );
    } else {
      await sendMessage(
        chatId,
        "I couldn't save that just now — memory isn't reachable. Try again in a moment."
      );
    }
    return;
  }

  // Other addressed text — nudge toward a command.
  await sendMessage(
    chatId,
    "Send me a command like <code>/brief a rooftop brunch launch</code>, or /help to see everything."
  );
}

async function handleVoice(
  msg: TelegramMessage,
  bot: BotInfo,
  tenantRef: string
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? chatId);

  if (!isTranscriptionConfigured() || !msg.voice) {
    await sendMessage(
      chatId,
      "🎤 Voice memos aren't set up yet. For now, type it out or use a command like <code>/brief …</code>."
    );
    return;
  }

  await sendChatAction(chatId, "typing");
  let transcript = "";
  try {
    const filePath = await getFilePath(msg.voice.file_id);
    const audio = await downloadFile(filePath);
    transcript = await transcribe(audio);
  } catch (err) {
    logger.error({ err, chatId }, "Voice transcription failed");
    await sendMessage(chatId, "⚠️ I couldn't transcribe that voice memo — try again in a moment.");
    return;
  }

  if (!transcript) {
    await sendMessage(chatId, "🎤 I couldn't make out that voice memo — mind trying again?");
    return;
  }

  const heard = `🎤 Heard: “${escapeHtml(transcript)}”`;
  const parsed = parseCommand(transcript, bot.username);

  // Transcript is itself a command → run it.
  if (parsed.isCommand && parsed.command) {
    await sendMessage(chatId, `${heard} — running <code>${escapeHtml(parsed.command)}</code>.`);
    await handleCommand(parsed.command, parsed.args, msg, tenantRef);
    return;
  }

  // A spoken reply to one of my messages → a memory note.
  if (isReplyToBot(msg, bot)) {
    await sendMessage(chatId, `${heard} — noting it.`);
    const wrote = await recordNote({ teamId: tenantRef, userId, text: transcript });
    if (wrote) {
      await touchActivity(chatId);
      await setMessageReaction(chatId, msg.message_id, "👍");
      await sendMessage(chatId, "📝 Noted — folding it in. You'll see it in Thursday's drop.");
    }
    return;
  }

  // Otherwise treat it as raw material for a brief.
  await sendMessage(chatId, `${heard} — running /brief on this.`);
  await handleCommand("/brief", transcript, msg, tenantRef);
}

async function handleCommand(
  command: string,
  args: string,
  msg: TelegramMessage,
  tenantRef: string
): Promise<void> {
  const chatId = msg.chat.id;

  switch (command) {
    case "/start": {
      await registerTenant(tenantRef); // so first-command onboarding doesn't double-fire
      const onboarded = await isOnboarded(chatId);
      await sendMessage(
        chatId,
        onboarded ? welcomeBackHtml(tenantRef) : onboardingHtml(tenantRef)
      );
      return;
    }
    case "/help": {
      await sendMessage(chatId, helpHtml(tenantRef));
      return;
    }
    case "/alex-update": {
      await handleAlexUpdate(command, args, msg, tenantRef);
      return;
    }
    default: {
      // Registry command, or an unknown slash — processCommand handles both.
      const sink = new TelegramSink(chatId);
      await processCommand({
        command,
        text: args,
        teamId: tenantRef,
        userId: String(msg.from?.id ?? chatId),
        sink,
        onNewTenant: () => sendMessage(chatId, onboardingHtml(tenantRef)).then(() => undefined),
        onActivity: () => touchActivity(chatId),
      });
      return;
    }
  }
}

const ALEX_UPDATE_USAGE = [
  "<b>Usage:</b> <code>/alex_update [field] [content]</code>",
  "",
  "<b>Fields:</b> brand-voice, content-pillars, audience-personas, style-guide, competitive-landscape, standing-orders, teammate, drive-folder",
].join("\n");

async function handleAlexUpdate(
  _command: string,
  args: string,
  msg: TelegramMessage,
  tenantRef: string
): Promise<void> {
  const chat = msg.chat;
  const chatId = chat.id;
  const userId = msg.from?.id;

  // Private chat: the user is the admin. Group: restrict to group admins.
  if (chat.type !== "private") {
    try {
      const admins = await getChatAdministrators(chatId);
      if (!userId || !admins.some((a) => a.user.id === userId)) {
        await sendMessage(chatId, "⛔ Only group admins can update Alex's brand files.");
        return;
      }
    } catch (err) {
      logger.error({ err, chatId }, "getChatAdministrators failed");
      await sendMessage(chatId, "⚠️ I couldn't verify group admins just now — try again in a moment.");
      return;
    }
  }

  const trimmed = args.trim();
  if (!trimmed) {
    await sendMessage(chatId, ALEX_UPDATE_USAGE);
    return;
  }

  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    await sendMessage(
      chatId,
      `Missing content. Usage: <code>/alex_update ${escapeHtml(trimmed)} your content here</code>`
    );
    return;
  }

  // Accept hyphen or underscore field names.
  const field = trimmed.slice(0, spaceIdx).trim().toLowerCase().replace(/_/g, "-");
  const content = trimmed.slice(spaceIdx + 1).trim();

  const result = await updateTenantFile(tenantRef, field, content);
  await sendMessage(chatId, escapeHtml(result.message));
}

// ── Ops: one-time webhook + command registration ────────────────────────────
// Call once after deploy: GET /api/telegram/register?secret=<TELEGRAM_WEBHOOK_SECRET>
// Sets the webhook (with the secret token) and registers the global command list.
router.get("/telegram/register", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!isTelegramConfigured()) {
    res.status(503).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
    return;
  }
  try {
    const base = getPublicBaseUrl();
    const url = `${base}/api/telegram/webhook`;
    await setWebhook(url, secret);
    await setMyCommands(telegramCommandList());
    res.json({ ok: true, webhook: url, commands: telegramCommandList().length });
  } catch (err) {
    logger.error({ err }, "Telegram register failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Ops: push scheduling ────────────────────────────────────────────────────
// Cron hits this once an hour: GET /api/telegram/push/tick?secret=<secret>.
// runPushTick fires whatever is due in each tenant's local timezone (§5.4).
router.get("/telegram/push/tick", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const result = await runPushTick(new Date());
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Push tick failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Manual trigger for the Script 2 acceptance test — force a weekly drop for one
// chat regardless of the clock: GET /api/telegram/push/weekly?secret=…&chat=<id>
router.get("/telegram/push/weekly", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const chatId = Number(req.query.chat);
  if (!Number.isFinite(chatId)) {
    res.status(400).json({ error: "Missing or invalid chat id" });
    return;
  }
  const tenant = await getTelegramTenant(chatId);
  if (!tenant) {
    res.status(404).json({ error: "Unknown chat" });
    return;
  }
  try {
    await runWeeklyDrop(tenant);
    res.json({ ok: true, chat: chatId });
  } catch (err) {
    logger.error({ err, chatId }, "Manual weekly drop failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/telegram/health", (_req: Request, res: Response): void => {
  res.json({
    status: "ok",
    botTokenConfigured: isTelegramConfigured(),
    webhookSecretConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
  });
});

export default router;
