// Scheduled pushes — the reason Telegram wins: Alex speaks first.
//
// These are cron entry points. Call runPushTick() once an hour; it walks the
// onboarded tenants and fires whatever is due in each tenant's local timezone.
// Push jobs send FINISHED messages directly — never the ack/edit pattern — so
// the 48-hour edit window is irrelevant to pushes by design (spec §2.4/§5.4).
import { type TelegramTenant } from "@workspace/db";
import { type Sink, type AckHandle, type Deliverable } from "./sink.js";
import { type RoutineConfig } from "./types.js";
import { processCommand } from "./processor.js";
import { countRecentNotes } from "./context.js";
import { listOnboardedTenants, pushTimezone } from "./telegramTenant.js";
import {
  sendMessage,
  sendDocument,
  escapeHtml,
} from "./telegramApi.js";
import { inlineHtml, summaryHtml, fitsInline } from "./telegramRender.js";
import { logger } from "../logger.js";

const NUDGE = "Reply to this message with notes — I'll fold them into next week's drop.";
const HELD_DROP_DAYS = 7;

// ── Push sink ───────────────────────────────────────────────────────────────
/** Delivers a Deliverable as a fresh message (+ document), with the reply nudge. */
class PushSink implements Sink {
  constructor(
    private readonly chatId: number,
    private readonly nudge = true
  ) {}

  private nudgeSuffix(): string {
    return this.nudge ? `\n\n<i>${escapeHtml(NUDGE)}</i>` : "";
  }

  async ack(): Promise<AckHandle> {
    // No placeholder for pushes — nothing to edit.
    const chatId = this.chatId;
    return {
      async update(text: string): Promise<void> {
        await sendMessage(chatId, text, { parseMode: "HTML" });
      },
    };
  }

  async send(d: Deliverable, _ack: AckHandle): Promise<void> {
    if (fitsInline(d)) {
      await sendMessage(this.chatId, inlineHtml(d) + this.nudgeSuffix(), { parseMode: "HTML" });
      return;
    }
    await sendMessage(this.chatId, summaryHtml(d), { parseMode: "HTML" });
    try {
      await sendDocument(
        this.chatId,
        { buffer: d.file.buffer, filename: d.file.filename },
        `📄 ${escapeHtml(d.label)}`
      );
    } catch (err) {
      logger.error({ err, chatId: this.chatId }, "Push document send failed");
    }
    if (this.nudge) {
      await sendMessage(this.chatId, `<i>${escapeHtml(NUDGE)}</i>`, { parseMode: "HTML" });
    }
  }

  async sendNote(noteText: string): Promise<void> {
    await sendMessage(this.chatId, escapeHtml(noteText), { parseMode: "HTML" });
  }

  async error(message: string, _ack: AckHandle): Promise<void> {
    await sendMessage(this.chatId, escapeHtml(message), { parseMode: "HTML" });
  }
}

// ── Timezone-aware scheduling ────────────────────────────────────────────────
interface LocalParts {
  weekday: string; // "Mon".."Sun"
  hour: number; // 0..23
  day: number; // 1..31
}

/** Local wall-clock parts for a tenant's timezone. */
export function localParts(now: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10);
  return {
    weekday: get("weekday"),
    hour: Number.isFinite(hour) ? hour % 24 : 0,
    day: parseInt(get("day"), 10) || 1,
  };
}

/** Held-drop check: no activity in the last HELD_DROP_DAYS days (§5.5). */
export function isHeld(tenant: Pick<TelegramTenant, "lastActivityAt">, now: Date): boolean {
  const last = tenant.lastActivityAt ? new Date(tenant.lastActivityAt).getTime() : 0;
  return now.getTime() - last > HELD_DROP_DAYS * 24 * 60 * 60 * 1000;
}

// ── Ad-hoc routine for the monthly calendar (no slash command, no registry change) ──
const CALENDAR_ROUTINE: RoutineConfig = {
  command: "/calendar",
  type: "routine",
  description: "Monthly editorial calendar",
  summaryLabel: "Monthly calendar",
  skills: ["content-strategist", "editorial-voice", "editorial-gate"],
  gateMode: "strategy",
  gateLoop: true,
  writeToDrive: true,
  drivePath: "strategy",
  instruction: `Produce a month-ahead editorial calendar for the client.
For each week, propose themes, a few concrete pieces (format + channel), and any tentpoles tied to the client's standing orders and content pillars. Keep it scannable — this is a planning artifact the client reviews in a few minutes.`,
};

// ── Jobs ─────────────────────────────────────────────────────────────────────
export async function runWeeklyDrop(tenant: TelegramTenant): Promise<void> {
  const chatId = tenant.chatId;

  if (isHeld(tenant, new Date())) {
    await sendHeldDrop(chatId);
    return;
  }

  const notes = await countRecentNotes(tenant.tenantRef, HELD_DROP_DAYS);
  const receipt =
    notes > 0
      ? `Open with a one-line receipt noting you folded in ${notes} note${notes === 1 ? "" : "s"} from this week.`
      : `Open with a one-line note on what changed since last week.`;

  await processCommand({
    command: "/weekly-social",
    text: `Build this week's editorial drop from the client's standing orders, content pillars, and recent activity. ${receipt}`,
    teamId: tenant.tenantRef,
    userId: "push:weekly",
    sink: new PushSink(chatId, true),
  });
}

export async function runMorningNote(tenant: TelegramTenant): Promise<void> {
  await processCommand({
    command: "/morning-briefing",
    text: "Produce today's morning note: priorities, what's in the pipeline, and anything that needs the client's input.",
    teamId: tenant.tenantRef,
    userId: "push:morning",
    sink: new PushSink(tenant.chatId, false),
  });
}

export async function runCalendarDrop(tenant: TelegramTenant): Promise<void> {
  await processCommand({
    command: "/calendar",
    routine: CALENDAR_ROUTINE,
    text: "Produce the month-ahead editorial calendar.",
    teamId: tenant.tenantRef,
    userId: "push:calendar",
    sink: new PushSink(tenant.chatId, true),
  });
}

async function sendHeldDrop(chatId: number): Promise<void> {
  const text = [
    "<b>Weekly drop — held this week.</b>",
    "",
    "No new content or activity since the last drop to build on.",
    "",
    "<b>What I need:</b> run one <code>/brief</code> or drop a line about what's happening this week, and I'll take it from there.",
    "",
    "— Alex",
  ].join("\n");
  await sendMessage(chatId, text, { parseMode: "HTML" });
}

// ── The cron tick ─────────────────────────────────────────────────────────────
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fire every push due at `now`, per tenant local time. Intended to run ONCE an
 * hour (each job keys on hour === N, so an hourly cadence fires each slot once).
 * Tenants are processed sequentially with light pacing to respect Telegram's
 * per-chat and global rate limits (§8).
 */
export async function runPushTick(now: Date = new Date()): Promise<{ fired: number }> {
  const tenants = await listOnboardedTenants();
  let fired = 0;

  for (const tenant of tenants) {
    if (!tenant.onboardedAt) continue;
    const tz = pushTimezone(tenant);
    const { weekday, hour, day } = localParts(now, tz);

    try {
      if (weekday === "Thu" && hour === 16) {
        await runWeeklyDrop(tenant);
        fired++;
      }
      // Morning note is a Pro feature; gate on a linked billing account.
      if (tenant.linkedAccount && hour === 8) {
        await runMorningNote(tenant);
        fired++;
      }
      // Calendar drop: first Monday of the month, 8am local.
      if (weekday === "Mon" && day <= 7 && hour === 8) {
        await runCalendarDrop(tenant);
        fired++;
      }
    } catch (err) {
      logger.error({ err, chatId: tenant.chatId }, "Push job failed for tenant");
    }

    await sleep(60);
  }

  logger.info({ tenants: tenants.length, fired }, "Push tick complete");
  return { fired };
}
