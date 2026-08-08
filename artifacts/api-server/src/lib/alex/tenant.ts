import { db, tenants, tenantFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type TenantContext } from "./types.js";
import { logger } from "../logger.js";

// Per-workspace state lives in Postgres (durable across redeploys and shared
// across Autoscale instances), one row per (team_id, field) in tenant_files.

const TEXT_FIELDS = [
  "brand-voice",
  "content-pillars",
  "competitive-landscape",
  "standing-orders",
  "audience-personas",
  "style-guide",
] as const;

const VALID_FIELDS = new Set<string>([...TEXT_FIELDS, "teammate", "drive-folder"]);

function notConfigured(field: string): string {
  return `[${field} not configured — use /alex-update ${field} to set this]`;
}

async function readTenantFiles(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ field: tenantFiles.field, content: tenantFiles.content })
    .from(tenantFiles)
    .where(eq(tenantFiles.teamId, teamId));
  return new Map(rows.map((r) => [r.field, r.content]));
}

export async function loadTenantContext(teamId: string): Promise<TenantContext> {
  const files = await readTenantFiles(teamId);
  const get = (field: string): string => files.get(field) ?? notConfigured(field);

  return {
    teamId,
    brandVoice: get("brand-voice"),
    contentPillars: get("content-pillars"),
    competitiveLandscape: get("competitive-landscape"),
    standingOrders: get("standing-orders"),
    audiencePersonas: get("audience-personas"),
    styleGuide: get("style-guide"),
    // Identity is free-form; empty when unset so the agent defaults to "Alex".
    teammate: (files.get("teammate") ?? "").trim(),
    driveFolderId: files.get("drive-folder")?.trim() || undefined,
  };
}

export async function ensureTenantExists(teamId: string): Promise<boolean> {
  const rows = await db
    .select({ teamId: tenants.teamId })
    .from(tenants)
    .where(eq(tenants.teamId, teamId))
    .limit(1);
  return rows.length > 0;
}

export async function registerTenant(teamId: string): Promise<void> {
  await db.insert(tenants).values({ teamId }).onConflictDoNothing();
  logger.info({ teamId }, "Registered tenant");
}

/**
 * Derive a display name from the teammate identity field. Convention: a line
 * like `Name: Maya` sets the name. Falls back to "Alex" when unset/unparseable.
 */
export function getDisplayName(teammate: string): string {
  if (!teammate) return "Alex";
  const match = teammate.match(/^\s*name\s*[:\-]\s*(.+)$/im);
  if (match) {
    const name = match[1].trim().split(/\s+/)[0];
    if (name) return name.slice(0, 30);
  }
  return "Alex";
}

export async function updateTenantFile(
  teamId: string,
  field: string,
  content: string
): Promise<{ success: boolean; message: string }> {
  if (!VALID_FIELDS.has(field)) {
    return {
      success: false,
      message: `Unknown field "${field}". Valid fields: ${[...VALID_FIELDS].join(", ")}`,
    };
  }

  // Make sure the workspace is registered so onboarding isn't shown again.
  await db.insert(tenants).values({ teamId }).onConflictDoNothing();

  const value = field === "drive-folder" ? content.trim() : content;

  await db
    .insert(tenantFiles)
    .values({ teamId, field, content: value })
    .onConflictDoUpdate({
      target: [tenantFiles.teamId, tenantFiles.field],
      set: { content: value, updatedAt: new Date() },
    });

  logger.info({ teamId, field }, "Updated tenant file");

  if (field === "drive-folder") {
    return { success: true, message: `Drive folder ID updated to: ${value}` };
  }
  return { success: true, message: `✅ Updated ${field} for your workspace.` };
}
