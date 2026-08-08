import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Durable per-workspace brand/config state, one row per (team_id, field).
// Keyed by field string so new fields require no schema migration. Replaces the
// previous local-filesystem storage, which was ephemeral on Autoscale.
export const tenantFiles = pgTable(
  "tenant_files",
  {
    id: serial("id").primaryKey(),
    teamId: text("team_id").notNull(),
    field: text("field").notNull(),
    content: text("content").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenant_files_team_field_idx").on(table.teamId, table.field),
  ]
);

export const insertTenantFileSchema = createInsertSchema(tenantFiles).omit({
  id: true,
  updatedAt: true,
});

export type TenantFile = typeof tenantFiles.$inferSelect;
export type InsertTenantFile = z.infer<typeof insertTenantFileSchema>;
