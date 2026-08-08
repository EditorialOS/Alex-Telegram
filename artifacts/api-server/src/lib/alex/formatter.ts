import { type Deliverable } from "./sink.js";
import { verdictEmoji } from "./sink.js";

function driveSection(driveLink?: string): string {
  if (!driveLink) return "";
  return `\n📄 *Google Doc:* <${driveLink}|Open in Drive>`;
}

function revisionNote(revisions: number): string {
  if (revisions <= 0) return "";
  if (revisions === 1) return " _(revised once)_";
  return ` _(revised ${revisions}× by Gate)_`;
}

/**
 * Render a Deliverable as the Slack in-channel reply. This reproduces the
 * pre-adapter Slack output exactly (header · draft · gate footer, mrkdwn) — the
 * sink refactor must not regress Slack.
 */
export function formatSlackReply(d: Deliverable): string {
  const { label, topic, driveUrl, gate, bodyText, displayName } = d;
  const emoji = verdictEmoji(gate.verdict);
  const scoreStr = gate.score != null ? ` (${gate.score}/100)` : "";
  const revNote = revisionNote(gate.revisions);
  const drive = driveSection(driveUrl);

  const topicSuffix = topic ? ` — ${topic}` : "";
  const header = `*${label}${topicSuffix}*${drive}`;

  const gateFooter = [
    `Gate: ${emoji} ${gate.verdict}${scoreStr}${revNote}`,
    gate.notes && gate.verdict !== "APPROVED" ? `_${gate.notes}_` : "",
    `— ${displayName}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [header, "", bodyText, "", "---", gateFooter].filter(Boolean).join("\n");
}

export function formatOnboarding(teamId: string): string {
  return [
    `👋 *Welcome — I'm Alex, your editorial AI agent.*`,
    ``,
    `This is the first time I've seen your workspace (\`${teamId}\`). I've set up your brand files — you'll want to fill them in so my output actually sounds like you.`,
    ``,
    `*Set up your workspace (run each command):*`,
    `• \`/alex-update brand-voice [your brand voice description]\``,
    `• \`/alex-update content-pillars [your content pillars]\``,
    `• \`/alex-update audience-personas [who you're talking to]\``,
    `• \`/alex-update style-guide [formatting and style rules]\``,
    `• \`/alex-update competitive-landscape [competitive context]\``,
    `• \`/alex-update standing-orders [recurring tasks and active campaigns]\``,
    `• \`/alex-update teammate [Name: ... — my name & persona]\` _(optional — customizes who I am for you; without it I'm "Alex")_`,
    `• \`/alex-update drive-folder [your Google Drive folder ID]\` _(optional — approved routine output auto-saves to your Drive; set this to file it in a specific folder)_`,
    ``,
    `*Commands available now:*`,
    `\`/brief\` \`/weekly-social\` \`/morning-briefing\``,
    `\`/caption\` \`/hook\` \`/headline\` \`/subject-line\` \`/reply\` \`/outline\``,
    ``,
    `_Try: \`/brief [your idea here]\` — I'll work with placeholder context until you fill in your files._`,
    ``,
    `— Alex`,
  ].join("\n");
}

// Unknown-command, blocked, and error messages are now surface-neutral and live
// in sink.ts (buildUnknownText / buildBlockedText / buildErrorText) so both
// Slack and Telegram render the same wording. formatOnboarding stays here
// because the onboarding message is Slack-specific (the /alex-update command
// list); Telegram supplies its own wizard-link onboarding.
