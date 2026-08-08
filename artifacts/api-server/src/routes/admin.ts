import crypto from "crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, tenants, tenantFiles, conversations, messages } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

// Read-only operator dashboard. Lets the person running the Alex pilot see, at a
// glance, which workspaces installed Alex, whether they finished onboarding
// (brand voice set), and what commands are being used — without querying the
// database by hand. Intended for the operator only, never for pilot users.

const router: IRouter = Router();

// How many recent command invocations to surface across all workspaces.
const RECENT_ACTIVITY_LIMIT = 60;

function operatorSecret(): string {
  return (process.env.OPERATOR_PASSWORD ?? "").trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// HTTP Basic Auth gate. The operator sets OPERATOR_PASSWORD; any username is
// accepted (the password is the shared secret). Returns 503 until configured so
// the dashboard is never reachable without a credential.
function operatorAuth(req: Request, res: Response, next: NextFunction): void {
  const password = operatorSecret();
  if (!password) {
    res
      .status(503)
      .send(
        page(
          "Operator dashboard unavailable",
          `<div class="mark">Alex · Operator</div>
           <h1>Dashboard not configured</h1>
           <p>Set the <code>OPERATOR_PASSWORD</code> secret to enable the operator dashboard, then reload this page.</p>`
        )
      );
    return;
  }

  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res
      .set("WWW-Authenticate", 'Basic realm="Alex Operator", charset="UTF-8"')
      .status(401)
      .send("Authentication required.");
    return;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const provided = sep >= 0 ? decoded.slice(sep + 1) : decoded;

  if (!timingSafeEqual(provided, password)) {
    res
      .set("WWW-Authenticate", 'Basic realm="Alex Operator", charset="UTF-8"')
      .status(401)
      .send("Invalid credentials.");
    return;
  }

  next();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// The leading token of a recorded user message is the slash command (e.g.
// "/brief some idea" → "/brief"). Anything without a leading slash is shown as
// "(command)".
function commandOf(content: string): string {
  const first = content.trim().split(/\s+/, 1)[0] ?? "";
  return first.startsWith("/") ? first : "(command)";
}

interface WorkspaceRow {
  teamId: string;
  teamName: string | null;
  installed: boolean;
  installedAt: Date | string | null;
  firstSeenAt: Date | string | null;
  hasBrandVoice: boolean;
  fieldCount: number;
  commandCount: number;
  lastActivityAt: Date | string | null;
}

router.get("/admin", operatorAuth, async (_req: Request, res: Response): Promise<void> => {
  // Workspaces Alex has seen, newest installs first.
  const tenantRows = await db
    .select({
      teamId: tenants.teamId,
      teamName: tenants.teamName,
      installedAt: tenants.installedAt,
      createdAt: tenants.createdAt,
      hasToken: sql<boolean>`${tenants.botToken} is not null`,
    })
    .from(tenants)
    .orderBy(desc(sql`coalesce(${tenants.installedAt}, ${tenants.createdAt})`));

  // Brand-field coverage per workspace (how much of onboarding is filled in).
  const fieldRows = await db
    .select({
      teamId: tenantFiles.teamId,
      fieldCount: sql<number>`count(*)::int`,
      hasBrandVoice: sql<boolean>`bool_or(${tenantFiles.field} = 'brand-voice')`,
    })
    .from(tenantFiles)
    .groupBy(tenantFiles.teamId);

  // Total command invocations + last-used time per workspace.
  const countRows = await db
    .select({
      teamId: conversations.teamId,
      total: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${messages.createdAt})`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.role, "user"))
    .groupBy(conversations.teamId);

  // The most recent command invocations across all workspaces.
  const activityRows = await db
    .select({
      teamId: conversations.teamId,
      userId: conversations.userId,
      content: messages.content,
      status: messages.status,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.role, "user"))
    .orderBy(desc(messages.id))
    .limit(RECENT_ACTIVITY_LIMIT);

  const fieldByTeam = new Map(fieldRows.map((r) => [r.teamId, r]));
  const countByTeam = new Map(countRows.map((r) => [r.teamId, r]));

  const workspaces: WorkspaceRow[] = tenantRows.map((t) => {
    const fields = fieldByTeam.get(t.teamId);
    const counts = countByTeam.get(t.teamId);
    return {
      teamId: t.teamId,
      teamName: t.teamName,
      installed: t.hasToken,
      installedAt: t.installedAt,
      firstSeenAt: t.createdAt,
      hasBrandVoice: fields?.hasBrandVoice ?? false,
      fieldCount: fields?.fieldCount ?? 0,
      commandCount: counts?.total ?? 0,
      lastActivityAt: counts?.lastAt ?? null,
    };
  });

  const nameByTeam = new Map(
    tenantRows.map((t) => [t.teamId, t.teamName])
  );

  const installedCount = workspaces.filter((w) => w.installed).length;
  const onboardedCount = workspaces.filter((w) => w.hasBrandVoice).length;
  const totalCommands = workspaces.reduce((sum, w) => sum + w.commandCount, 0);

  res.send(
    dashboardPage({
      workspaces,
      activity: activityRows.map((a) => ({
        teamLabel: nameByTeam.get(a.teamId) || a.teamId,
        userId: a.userId,
        command: commandOf(a.content),
        status: a.status,
        createdAt: a.createdAt,
      })),
      stats: {
        workspaces: workspaces.length,
        installed: installedCount,
        onboarded: onboardedCount,
        commands: totalCommands,
      },
    })
  );
});

interface ActivityItem {
  teamLabel: string;
  userId: string;
  command: string;
  status: string;
  createdAt: Date | string | null;
}

interface DashboardData {
  workspaces: WorkspaceRow[];
  activity: ActivityItem[];
  stats: { workspaces: number; installed: number; onboarded: number; commands: number };
}

function statusPill(status: string): string {
  const cls =
    status === "completed"
      ? "ok"
      : status === "blocked"
        ? "warn"
        : status === "error"
          ? "err"
          : "muted";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

function yesNo(value: boolean): string {
  return value
    ? `<span class="pill ok">yes</span>`
    : `<span class="pill muted">no</span>`;
}

function dashboardPage(data: DashboardData): string {
  const { workspaces, activity, stats } = data;

  const workspaceRows =
    workspaces.length === 0
      ? `<tr><td colspan="6" class="empty">No workspaces yet. Once someone installs Alex they'll appear here.</td></tr>`
      : workspaces
          .map((w) => {
            const name = w.teamName ? escapeHtml(w.teamName) : "<em>unnamed</em>";
            return `<tr>
              <td>
                <div class="ws-name">${name}</div>
                <div class="ws-id">${escapeHtml(w.teamId)}</div>
              </td>
              <td>${w.installed ? yesNo(true) : `<span class="pill muted">seen only</span>`}<div class="sub">${formatDate(w.installedAt ?? w.firstSeenAt)}</div></td>
              <td>${yesNo(w.hasBrandVoice)}</td>
              <td class="num">${w.fieldCount}<span class="of"> / 8</span></td>
              <td class="num">${w.commandCount}</td>
              <td>${formatDate(w.lastActivityAt)}</td>
            </tr>`;
          })
          .join("");

  const activityRows =
    activity.length === 0
      ? `<tr><td colspan="4" class="empty">No command activity yet.</td></tr>`
      : activity
          .map(
            (a) => `<tr>
              <td>${formatDate(a.createdAt)}</td>
              <td>${escapeHtml(a.teamLabel)}</td>
              <td><code>${escapeHtml(a.command)}</code></td>
              <td>${statusPill(a.status)}</td>
            </tr>`
          )
          .join("");

  const body = `
    <header class="top">
      <div class="mark">Alex · Operator</div>
      <h1>Pilot dashboard</h1>
      <p class="lede">Read-only view of who installed Alex and how it's being used.</p>
    </header>

    <section class="stats">
      <div class="stat"><div class="stat-num">${stats.workspaces}</div><div class="stat-label">Workspaces</div></div>
      <div class="stat"><div class="stat-num">${stats.installed}</div><div class="stat-label">Installed</div></div>
      <div class="stat"><div class="stat-num">${stats.onboarded}</div><div class="stat-label">Brand voice set</div></div>
      <div class="stat"><div class="stat-num">${stats.commands}</div><div class="stat-label">Commands run</div></div>
    </section>

    <section class="panel">
      <h2>Workspaces</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Installed</th>
              <th>Brand voice</th>
              <th>Brand fields</th>
              <th>Commands</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>${workspaceRows}</tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>Recent command activity</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Workspace</th>
              <th>Command</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${activityRows}</tbody>
        </table>
      </div>
    </section>`;

  return page("Alex · Operator dashboard", body, true);
}

function page(title: string, bodyHtml: string, wide = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f6f8; color: #1a1d23;
    ${wide ? "padding: 40px 20px;" : "display: grid; place-items: center; padding: 40px 16px;"}
  }
  .card {
    width: min(92vw, 460px); padding: 44px 40px; border-radius: 18px;
    background: #fff; border: 1px solid #e6e8ec;
    box-shadow: 0 20px 50px -30px rgba(17,24,39,0.22); text-align: center;
  }
  .wrap { width: min(96vw, 1040px); margin: 0 auto; }
  .mark { font-size: 13px; letter-spacing: 0.28em; text-transform: uppercase; color: #9aa1ad; margin-bottom: 14px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; font-weight: 650; }
  h2 { font-size: 16px; margin: 0 0 14px; font-weight: 650; }
  p { color: #5b6471; line-height: 1.6; margin: 0; font-size: 15px; }
  .lede { margin-bottom: 4px; }
  code { background: #eef0f3; padding: 2px 6px; border-radius: 5px; font-size: 12px; }
  .top { margin-bottom: 26px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 26px; }
  .stat { background: #fff; border: 1px solid #e6e8ec; border-radius: 14px; padding: 18px 20px; }
  .stat-num { font-size: 30px; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 13px; color: #6b7587; margin-top: 8px; }
  .panel { background: #fff; border: 1px solid #e6e8ec; border-radius: 16px; padding: 22px 24px; margin-bottom: 22px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9aa1ad; font-weight: 600; padding: 0 14px 10px; border-bottom: 1px solid #eceef1; white-space: nowrap; }
  td { padding: 12px 14px; border-bottom: 1px solid #f1f2f5; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td.num { font-variant-numeric: tabular-nums; }
  .of { color: #aab0ba; font-size: 12px; }
  .ws-name { font-weight: 600; }
  .ws-id { font-size: 12px; color: #9aa1ad; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .sub { font-size: 12px; color: #9aa1ad; margin-top: 4px; }
  .empty { text-align: center; color: #9aa1ad; padding: 28px 14px; }
  .pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
  .pill.ok { background: #dcfce7; color: #15803d; }
  .pill.warn { background: #fef9c3; color: #a16207; }
  .pill.err { background: #fee2e2; color: #b91c1c; }
  .pill.muted { background: #eef0f3; color: #6b7587; }
  @media (max-width: 720px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>${wide ? `<div class="wrap">${bodyHtml}</div>` : `<main class="card">${bodyHtml}</main>`}</body>
</html>`;
}

export default router;
