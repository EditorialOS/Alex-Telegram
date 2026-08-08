import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Telegram tenancy. The Slack side is keyed by team_id; Telegram is keyed by
// chat_id (a DM is a personal tenant, a group/supergroup is a team tenant).
//
// tenant_ref ("tg_<chat_id>") is the key everything ELSE is scoped by — it maps
// straight onto the existing tenant_files rows, the Context API `product`, and
// the conversation store, so brand voice, memory, and history all work through
// the exact same code paths as Slack with no changes.
//
// chat_id is stored as a bigint in "number" mode: Telegram ids (including the
// large negative supergroup ids like -100…) stay within JS's safe integer range.
export const telegramTenants = pgTable("telegram_tenants", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  tenantRef: text("tenant_ref").notNull(),
  chatType: text("chat_type").notNull(), // 'private' | 'group' | 'supergroup'
  title: text("title"),
  // IANA timezone (e.g. "America/Los_Angeles"), used by the push scheduler.
  // Null until set; callers apply the DEFAULT_TIMEZONE fallback.
  timezone: text("timezone"),
  linkedAccount: text("linked_account"), // future billing link
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // Denormalized cache of the last successful command / note, for the held-drop
  // rule (§5.5). Source of truth remains the invocation history.
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTelegramTenantSchema = createInsertSchema(telegramTenants).omit({
  createdAt: true,
});

export type TelegramTenant = typeof telegramTenants.$inferSelect;
export type InsertTelegramTenant = z.infer<typeof insertTelegramTenantSchema>;
