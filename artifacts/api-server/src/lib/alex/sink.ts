// The reply-sink abstraction — the ONE contract every surface implements.
//
// This file is written FIRST, before slackSink.ts and telegramSink.ts, so the
// two implementations cannot drift: both consume the same `Deliverable` and
// implement the same `Sink`. The command pipeline (processor.ts) is
// surface-agnostic — it produces a `Deliverable` and hands it to a `Sink`; the
// sink is the only thing that knows about Slack response_urls or Telegram
// message ids.
//
// Contract, made explicit: by the time any `sink.send*()` is called, the
// deliverable already carries (a) the full draft as text/buffer and (b) a Drive
// URL if one was configured. Sinks NEVER call Drive.
import { type GateVerdict } from "./types.js";

/** The finished draft as a file — used for long output. */
export interface DeliverableFile {
  buffer: Buffer;
  /** e.g. "brief-brunch-launch-2026-08-07.md" */
  filename: string;
  /** Resolved by the command handler before the sink is called, when configured. */
  driveUrl?: string;
}

/** Structured gate outcome, so any surface can render it natively. */
export interface DeliverableGate {
  verdict: GateVerdict;
  score: number;
  notes: string;
  revisions: number;
}

/**
 * The surface-agnostic result of running a command. Sinks decide how to present
 * it (inline text vs. document), but the content and the Drive URL are already
 * resolved here.
 */
export interface Deliverable {
  /** Routine label, e.g. "Brief ready". Header chrome; each sink formats it. */
  label: string;
  /** Short, already-trimmed echo of the request for the header, or "". */
  topic: string;
  /** Persona/display name for the signature ("— Alex"). */
  displayName: string;
  /** Drive URL if the deliverable was filed. Resolved before any sink call. */
  driveUrl?: string;
  /** Structured gate result — verdict, score, notes, revisions. */
  gate: DeliverableGate;
  /**
   * Neutral, pre-rendered gate summary (verdict, score, notes, signature) — no
   * surface markup. ALWAYS shown inline: the refusal is the feature, keep it
   * loud (spec §5.2). Surfaces that don't render `gate` natively use this.
   */
  summaryText: string;
  /** The full generated draft as plain text. Sinks choose inline vs. file. */
  bodyText: string;
  /** The same draft as a .md file (+ Drive URL). Sinks may deliver this instead. */
  file: DeliverableFile;
}

/**
 * An opaque, per-surface handle to the "working…" placeholder opened by
 * `Sink.ack()`. `update()` replaces that placeholder with new text.
 * - Slack: posts to the slash command's response_url (no editing).
 * - Telegram: editMessageText, with a sendMessage fallback on any edit failure.
 */
export interface AckHandle {
  update(text: string): Promise<void>;
}

/** The ONLY contract surfaces implement. */
export interface Sink {
  /** Open the interaction. Slack: no-op (the route already acked). Telegram: typing + "Working on it…". */
  ack(): Promise<AckHandle>;
  /** Deliver the finished result, replacing the placeholder where the surface supports it. */
  send(d: Deliverable, ack: AckHandle): Promise<void>;
  /** A standalone note (onboarding, memory confirmation, held-drop ask). Never edits the placeholder. */
  sendNote(noteText: string): Promise<void>;
  /**
   * Deliver a terminal message in place of the placeholder — errors, gate
   * blocks, unknown commands. The text is fully formed and neutral (it carries
   * its own leading emoji); the sink only applies surface framing/escaping.
   */
  error(message: string, ack: AckHandle): Promise<void>;
}

// ── Neutral builders (surface-agnostic) ────────────────────────────────────
// These produce plain text with no Slack/Telegram markup. Each sink re-wraps
// as needed. Emoji are safe across both surfaces.

export function verdictEmoji(verdict: GateVerdict): string {
  switch (verdict) {
    case "APPROVED":
      return "✅";
    case "APPROVED_WITH_NOTES":
      return "✅";
    case "REVISE":
      return "🔄";
    case "NEEDS_INPUT":
      return "❓";
    case "BLOCKED":
      return "🚫";
  }
}

export function revisionNote(revisions: number): string {
  if (revisions <= 0) return "";
  if (revisions === 1) return " (revised once)";
  return ` (revised ${revisions}× by Gate)`;
}

/** The always-shown gate summary, neutral. e.g. "Gate: ✅ APPROVED (92/100)\n<notes>\n— Alex" */
export function buildGateSummary(gate: DeliverableGate, displayName: string): string {
  const emoji = verdictEmoji(gate.verdict);
  const scoreStr = gate.score != null ? ` (${gate.score}/100)` : "";
  const lines = [`Gate: ${emoji} ${gate.verdict}${scoreStr}${revisionNote(gate.revisions)}`];
  if (gate.notes && gate.verdict !== "APPROVED") lines.push(gate.notes);
  lines.push(`— ${displayName}`);
  return lines.join("\n");
}

/** Trim a request echo to a header-friendly length. */
export function topicEcho(userText: string, max = 60): string {
  const t = userText.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ── Neutral system messages ────────────────────────────────────────────────
// Plain text, surface-neutral, each carrying its own leading emoji. Sinks apply
// their own escaping. (Onboarding is surface-specific and lives with each
// surface — Slack: the /alex-update list; Telegram: the wizard link.)

export function buildUnknownText(command: string, displayName = "Alex"): string {
  return `No routine registered for ${command} yet — want me to run /brief on it first?\n\n— ${displayName}`;
}

export function buildBlockedText(command: string, notes: string, displayName = "Alex"): string {
  return `🚫 ${command} blocked by Gate.\n\n${notes}\n\nRevise your input and try again.\n\n— ${displayName}`;
}

export function buildErrorText(command: string, message: string, displayName = "Alex"): string {
  return `⚠️ Something went wrong running ${command}.\n${message}\n\nPlease try again — or ping your admin if this keeps happening.\n\n— ${displayName}`;
}

/**
 * Build a Deliverable from the command pipeline's result. The Drive URL must
 * already be resolved (passed in via `driveUrl`).
 */
export function buildDeliverable(opts: {
  label: string;
  userText: string;
  displayName: string;
  gate: DeliverableGate;
  draft: string;
  driveUrl?: string;
  /** Document title (no extension), used for the file name. */
  docTitle: string;
}): Deliverable {
  const { label, userText, displayName, gate, draft, driveUrl, docTitle } = opts;
  return {
    label,
    topic: topicEcho(userText),
    displayName,
    driveUrl,
    gate,
    summaryText: buildGateSummary(gate, displayName),
    bodyText: draft,
    file: {
      buffer: Buffer.from(draft, "utf-8"),
      filename: `${docTitle}.md`,
      driveUrl,
    },
  };
}
