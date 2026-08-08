import { Router, type IRouter } from "express";
import { slackSignatureMiddleware } from "../middlewares/slackVerify.js";
import { processCommand } from "../lib/alex/processor.js";
import { SlackSink } from "../lib/alex/slackSink.js";
import { formatOnboarding } from "../lib/alex/formatter.js";
import { updateTenantFile } from "../lib/alex/tenant.js";
import { listCommands } from "../lib/alex/registry.js";
import { isDriveConfigured } from "../lib/alex/drive.js";
import { isContextConfigured } from "../lib/alex/context.js";
import { isOauthConfigured, getBotToken } from "../lib/alex/slackInstall.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function isSlackAdmin(userId: string, teamId: string): Promise<boolean> {
  const token = await getBotToken(teamId);
  if (!token) return false;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok: boolean;
      user?: { is_admin?: boolean; is_owner?: boolean; is_primary_owner?: boolean };
    };
    if (!data.ok || !data.user) return false;
    return (
      data.user.is_admin === true ||
      data.user.is_owner === true ||
      data.user.is_primary_owner === true
    );
  } catch (err) {
    logger.error({ err }, "Failed to check Slack admin status");
    return false;
  }
}

router.post(
  "/slack/events",
  slackSignatureMiddleware,
  async (req, res): Promise<void> => {
    const body = req.body as Record<string, string>;

    if (body.type === "url_verification") {
      res.json({ challenge: body.challenge });
      return;
    }

    const command: string = body.command ?? "";
    const text: string = body.text ?? "";
    const teamId: string = body.team_id ?? "unknown";
    const userId: string = body.user_id ?? "unknown";
    const responseUrl: string = body.response_url ?? "";

    if (!command || !responseUrl) {
      res.status(400).json({ error: "Missing command or response_url" });
      return;
    }

    res.json({
      response_type: "ephemeral",
      text: `⏳ Working on \`${command}\`…`,
    });

    // Reply through the Slack sink; onboarding on first contact is the
    // Slack-specific /alex-update list (formatOnboarding), posted as a note.
    const sink = new SlackSink(responseUrl);
    setImmediate(() => {
      processCommand({
        command,
        text,
        teamId,
        userId,
        sink,
        onNewTenant: () => sink.sendNote(formatOnboarding(teamId)),
      }).catch(() => undefined);
    });
  }
);

const ALEX_UPDATE_USAGE = [
  "*Usage:* `/alex-update [field] [content]`",
  "",
  "*Fields:*",
  "• `brand-voice` — Your brand's tone, voice, and style guidelines",
  "• `content-pillars` — Core topics and themes",
  "• `audience-personas` — Who you're talking to",
  "• `style-guide` — Formatting and style rules",
  "• `competitive-landscape` — Competitors and market context",
  "• `standing-orders` — Recurring tasks and active campaigns",
  "• `teammate` — My name & persona for your workspace (use a `Name: ...` line to rename me)",
  "• `drive-folder` — Google Drive folder ID for outputs",
].join("\n");

/** Post an ephemeral follow-up to a slash command's response_url. */
async function postEphemeral(responseUrl: string, text: string): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text,
        replace_original: false,
      }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to post to Slack response_url");
  }
}

// The admin check (and the update) happen after the initial ack — the admin
// check hits the Slack Web API (users.info), which can be slow, so doing it
// before responding risks blowing Slack's ~3s window. All replies go through
// response_url, mirroring /slack/events.
async function handleAlexUpdate(args: {
  teamId: string;
  userId: string;
  responseUrl: string;
  text: string;
}): Promise<void> {
  const { teamId, userId, responseUrl, text } = args;

  const admin = await isSlackAdmin(userId, teamId);
  if (!admin) {
    await postEphemeral(responseUrl, "⛔ Only workspace admins can update Alex's brand files.");
    return;
  }

  if (!text) {
    await postEphemeral(responseUrl, ALEX_UPDATE_USAGE);
    return;
  }

  const spaceIdx = text.indexOf(" ");
  if (spaceIdx === -1) {
    await postEphemeral(
      responseUrl,
      `Missing content. Usage: \`/alex-update ${text} [your content here]\``
    );
    return;
  }

  const field = text.slice(0, spaceIdx).trim().toLowerCase();
  const content = text.slice(spaceIdx + 1).trim();

  const result = await updateTenantFile(teamId, field, content);
  await postEphemeral(responseUrl, result.message);
}

router.post(
  "/slack/alex-update",
  slackSignatureMiddleware,
  async (req, res): Promise<void> => {
    const body = req.body as Record<string, string>;

    const teamId: string = body.team_id ?? "unknown";
    const userId: string = body.user_id ?? "unknown";
    const responseUrl: string = body.response_url ?? "";
    const text: string = (body.text ?? "").trim();

    if (!responseUrl) {
      res.status(400).json({ error: "Missing response_url" });
      return;
    }

    // Ack immediately, then do the admin check + update in the background.
    res.json({
      response_type: "ephemeral",
      text: "⏳ Working on `/alex-update`…",
    });

    setImmediate(() => {
      handleAlexUpdate({ teamId, userId, responseUrl, text }).catch(() => undefined);
    });
  }
);

router.get("/slack/health", async (_req, res): Promise<void> => {
  const commands = listCommands();
  res.json({
    status: "ok",
    commands,
    slackSigningSecretConfigured: !!process.env.SLACK_SIGNING_SECRET,
    botTokenConfigured: !!process.env.SLACK_BOT_TOKEN,
    oauthConfigured: isOauthConfigured(),
    driveConfigured: await isDriveConfigured(),
    memoryConfigured: isContextConfigured(),
    dbConfigured: !!process.env.DATABASE_URL,
    anthropicConfigured: !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
});

export default router;
