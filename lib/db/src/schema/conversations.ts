import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One conversation thread per Slack workspace + user (team_id + user_id). Each
// slash command invocation appends messages to this thread so Alex can recall
// prior work and stay consistent across requests.
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("conversations_team_user_idx").on(table.teamId, table.userId)]
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
