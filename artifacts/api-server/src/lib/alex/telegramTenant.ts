// chat_id → tenant mapping for Telegram.
//
// The tenant_ref ("tg_<chat_id>") is the single key the rest of Alex Core is
// scoped by. Passing it to processCommand as `teamId` makes tenant files,
// Context API memory, and conversation history all resolve through the same
// code the Slack surface uses — no changes to any of that.
import { db, telegramTenants, type TelegramTenant } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

/** Pacific — Roger and the first pilots are Pacific (spec §4.4). */
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export interface TelegramChat {
  id: number;
  type: string; // 'private' | 'group' | 'supergroup' | 'channel'
  title?: string;
}

/** The tenant key for a chat. Everything downstream is scoped by this. */
export function tenantRefForChat(chatId: number): string {
  return `tg_${chatId}`;
}

/**
 * Upsert the telegram_tenants row for a chat on contact, refreshing metadata.
 * Returns the row plus whether this was the chat's first-ever contact.
 */
export async function ensureTelegramTenant(
  chat: TelegramChat
): Promise<{ tenant: TelegramTenant; isNew: boolean }> {
  const existing = await getTelegramTenant(chat.id);

  const [row] = await db
    .insert(telegramTenants)
    .values({
      chatId: chat.id,
      tenantRef: tenantRefForChat(chat.id),
      chatType: chat.type,
      title: chat.title ?? null,
    })
    .onConflictDoUpdate({
      target: telegramTenants.chatId,
      set: { chatType: chat.type, title: chat.title ?? null },
    })
    .returning();

  return { tenant: row, isNew: !existing };
}

export async function getTelegramTenant(
  chatId: number
): Promise<TelegramTenant | undefined> {
  try {
    const [row] = await db
      .select()
      .from(telegramTenants)
      .where(eq(telegramTenants.chatId, chatId))
      .limit(1);
    return row;
  } catch (err) {
    logger.error({ err, chatId }, "Failed to read telegram tenant");
    return undefined;
  }
}

export async function isOnboarded(chatId: number): Promise<boolean> {
  const t = await getTelegramTenant(chatId);
  return !!t?.onboardedAt;
}

/** Mark the wizard complete for a chat, optionally recording its timezone. */
export async function markOnboarded(chatId: number, timezone?: string): Promise<void> {
  try {
    await db
      .insert(telegramTenants)
      .values({
        chatId,
        tenantRef: tenantRefForChat(chatId),
        chatType: "private",
        onboardedAt: new Date(),
        timezone: timezone ?? null,
      })
      .onConflictDoUpdate({
        target: telegramTenants.chatId,
        set: {
          onboardedAt: new Date(),
          ...(timezone ? { timezone } : {}),
        },
      });
  } catch (err) {
    logger.error({ err, chatId }, "Failed to mark telegram tenant onboarded");
  }
}

/**
 * Bump last_activity_at for the held-drop rule (§5.5). Called from the command
 * handler on a delivered gated output, and from the note handler on a memory
 * write — never from a sink.
 */
export async function touchActivity(chatId: number): Promise<void> {
  try {
    await db
      .update(telegramTenants)
      .set({ lastActivityAt: new Date() })
      .where(eq(telegramTenants.chatId, chatId));
  } catch (err) {
    logger.warn({ err, chatId }, "Failed to update telegram last_activity_at");
  }
}

/** Resolve the timezone to schedule pushes in, applying the default fallback. */
export function pushTimezone(tenant: Pick<TelegramTenant, "timezone">): string {
  return tenant.timezone?.trim() || DEFAULT_TIMEZONE;
}

/** All onboarded Telegram tenants — the audience for scheduled pushes (§5.4). */
export async function listOnboardedTenants(): Promise<TelegramTenant[]> {
  try {
    return await db.select().from(telegramTenants);
  } catch (err) {
    logger.error({ err }, "Failed to list telegram tenants");
    return [];
  }
}
