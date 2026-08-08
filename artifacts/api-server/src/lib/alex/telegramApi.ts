// Thin Telegram Bot API client. One place for every Bot API call so the sink,
// webhook route, push scheduler, and inline handler share the same transport,
// error handling, and HTML escaping.
import { logger } from "../logger.js";

const API_ROOT = "https://api.telegram.org";

export function getBotToken(): string | undefined {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t ? t.trim() : undefined;
}

export function isTelegramConfigured(): boolean {
  return !!getBotToken();
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Escape text for parse_mode: "HTML". Only &, <, > need escaping. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Call a Bot API method with a JSON body. Throws on !ok so callers can fall back. */
export async function callTelegram<T = unknown>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as TelegramResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed (${data.error_code}): ${data.description}`);
  }
  return data.result as T;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; is_bot: boolean; username?: string; first_name?: string };
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  reply_to_message?: TelegramMessage;
}

export async function sendMessage(
  chatId: number,
  text: string,
  opts: { parseMode?: "HTML"; replyToMessageId?: number; disablePreview?: boolean } = {}
): Promise<TelegramMessage> {
  return callTelegram<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode ?? "HTML",
    ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
    link_preview_options: { is_disabled: opts.disablePreview ?? true },
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  opts: { parseMode?: "HTML" } = {}
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts.parseMode ?? "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function sendChatAction(chatId: number, action = "typing"): Promise<void> {
  try {
    await callTelegram("sendChatAction", { chat_id: chatId, action });
  } catch (err) {
    // Non-critical — never block on the typing indicator.
    logger.debug({ err, chatId }, "sendChatAction failed");
  }
}

export async function sendDocument(
  chatId: number,
  file: { buffer: Buffer; filename: string },
  caption?: string
): Promise<TelegramMessage> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  const blob = new Blob([new Uint8Array(file.buffer)], { type: "text/markdown" });
  form.append("document", blob, file.filename);

  const res = await fetch(`${API_ROOT}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as TelegramResponse<TelegramMessage>;
  if (!data.ok) {
    throw new Error(`Telegram sendDocument failed (${data.error_code}): ${data.description}`);
  }
  return data.result as TelegramMessage;
}

/** Best-effort emoji reaction (memory ack). Never throws. */
export async function setMessageReaction(
  chatId: number,
  messageId: number,
  emoji: string
): Promise<void> {
  try {
    await callTelegram("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  } catch (err) {
    logger.debug({ err, chatId }, "setMessageReaction failed");
  }
}

export interface BotCommand {
  command: string;
  description: string;
}

export async function setMyCommands(commands: BotCommand[]): Promise<void> {
  await callTelegram("setMyCommands", { commands });
}

export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await callTelegram("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "inline_query"],
  });
}

export async function deleteWebhook(): Promise<void> {
  await callTelegram("deleteWebhook", {});
}

export async function getWebhookInfo(): Promise<unknown> {
  return callTelegram("getWebhookInfo", {});
}

export interface BotInfo {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
}

let cachedBotInfo: BotInfo | undefined;
export async function getMe(): Promise<BotInfo> {
  if (cachedBotInfo) return cachedBotInfo;
  cachedBotInfo = await callTelegram<BotInfo>("getMe", {});
  return cachedBotInfo;
}

export interface ChatMember {
  user: { id: number; username?: string; is_bot?: boolean };
  status: string; // 'creator' | 'administrator' | 'member' | ...
}

export async function getChatAdministrators(chatId: number): Promise<ChatMember[]> {
  return callTelegram<ChatMember[]>("getChatAdministrators", { chat_id: chatId });
}

// ── Files (voice memos, M3) ────────────────────────────────────────────────
export async function getFilePath(fileId: string): Promise<string> {
  const result = await callTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!result.file_path) throw new Error("Telegram getFile returned no file_path");
  return result.file_path;
}

export async function downloadFile(filePath: string): Promise<Buffer> {
  const token = getBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const res = await fetch(`${API_ROOT}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Inline mode (M4) ───────────────────────────────────────────────────────
export interface InlineQueryResultArticle {
  type: "article";
  id: string;
  title: string;
  description?: string;
  input_message_content: { message_text: string; parse_mode?: "HTML" };
}

export async function answerInlineQuery(
  inlineQueryId: string,
  results: InlineQueryResultArticle[],
  opts: { cacheTime?: number } = {}
): Promise<void> {
  await callTelegram("answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results,
    cache_time: opts.cacheTime ?? 0,
    is_personal: true,
  });
}
