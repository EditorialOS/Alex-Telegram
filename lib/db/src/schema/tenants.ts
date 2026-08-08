import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Registry of Slack workspaces ("tenants") Alex has seen. A row exists once a
// workspace has run any command or installed Alex, which is how onboarding is
// shown only once. Installation columns are populated by the OAuth flow and hold
// each workspace's own bot token (required for multi-workspace distribution).
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  teamId: text("team_id").notNull().unique(),
  teamName: text("team_name"),
  botToken: text("bot_token"),
  botUserId: text("bot_user_id"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
