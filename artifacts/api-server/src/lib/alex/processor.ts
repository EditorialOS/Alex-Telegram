import { getRoutine } from "./registry.js";
import {
  loadTenantContext,
  ensureTenantExists,
  registerTenant,
  getDisplayName,
} from "./tenant.js";
import { runAlex } from "./agent.js";
import { runGate } from "./gate.js";
import { writeToDrive } from "./drive.js";
import { fetchMemory, recordLearning } from "./context.js";
import {
  fetchHistory,
  recordExchange,
  type ConversationStatus,
} from "./conversation.js";
import {
  type Sink,
  buildDeliverable,
  buildBlockedText,
  buildUnknownText,
  buildErrorText,
} from "./sink.js";
import { logger } from "../logger.js";
import { type GateVerdict, type RoutineConfig } from "./types.js";

const MAX_REVISIONS = 2;
const APPROVED_VERDICTS: GateVerdict[] = ["APPROVED", "APPROVED_WITH_NOTES"];

function buildDocTitle(command: string, userText: string): string {
  const date = new Date().toISOString().split("T")[0];
  const slug = userText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
  const cmd = command.replace("/", "");
  return `${date}-${cmd}-${slug}`;
}

export interface ProcessCommandOptions {
  /** Canonical command, e.g. "/brief" (already normalized by the caller). */
  command: string;
  text: string;
  teamId: string;
  userId: string;
  /** The surface that delivers the reply. */
  sink: Sink;
  /**
   * Surface-specific first-contact onboarding. Invoked once, when this tenant
   * is seen for the first time, BEFORE the command runs. Slack posts the
   * /alex-update list; Telegram posts the wizard link. Optional.
   */
  onNewTenant?: () => Promise<void>;
  /**
   * Fired in the command handler when a gated output is delivered (status
   * "completed"). Telegram uses it to bump last_activity_at for the held-drop
   * rule (§5.5). Not a sink concern — the handler owns activity tracking.
   */
  onActivity?: () => Promise<void>;
  /**
   * Override the registry lookup with an ad-hoc routine. Push jobs use this to
   * run generation for outputs that have no slash command (e.g. the monthly
   * calendar drop) while reusing the identical gate + Drive + memory pipeline.
   * registry.ts itself is never modified.
   */
  routine?: RoutineConfig;
}

/**
 * Run one Alex command end to end, surface-agnostically. The pipeline —
 * tenant context, generation, the gate loop, and the Drive save — is identical
 * across surfaces; only the `sink` differs. By the time any sink method is
 * called, the Drive URL (if any) is already resolved: sinks never touch Drive.
 */
export async function processCommand(opts: ProcessCommandOptions): Promise<void> {
  const { command, text, teamId, userId, sink, onNewTenant, onActivity } = opts;
  const routineOverride = opts.routine;

  logger.info({ command, teamId, userId }, "Processing Alex command");

  let displayName = "Alex";
  let assistantReply: string | undefined;
  let status: ConversationStatus = "error";

  const ack = await sink.ack();

  try {
    const isNewTenant = !(await ensureTenantExists(teamId));
    if (isNewTenant) {
      await registerTenant(teamId);
      if (onNewTenant) await onNewTenant();
    }

    const routine = routineOverride ?? getRoutine(command);
    if (!routine) {
      const unknown = buildUnknownText(command);
      await sink.error(unknown, ack);
      assistantReply = unknown;
      status = "unknown";
      return;
    }

    const tenantContext = await loadTenantContext(teamId);
    displayName = getDisplayName(tenantContext.teammate);
    const [memory, history] = await Promise.all([
      fetchMemory(teamId),
      fetchHistory(teamId, userId),
    ]);

    let draft = await runAlex(routine, text, tenantContext, undefined, memory, history);
    let revisions = 0;

    const gateResult = await runGate(draft, text, tenantContext.brandVoice, routine.gateMode);

    if (gateResult.verdict === "BLOCKED") {
      const blocked = buildBlockedText(command, gateResult.notes, displayName);
      await sink.error(blocked, ack);
      assistantReply = blocked;
      status = "blocked";
      return;
    }

    if (routine.gateLoop && gateResult.verdict === "REVISE") {
      for (let i = 0; i < MAX_REVISIONS; i++) {
        logger.info({ command, teamId, revision: i + 1 }, "Gate requested revision");
        draft = await runAlex(routine, text, tenantContext, gateResult.notes, memory, history);
        revisions++;

        const recheck = await runGate(draft, text, tenantContext.brandVoice, routine.gateMode);

        if (recheck.verdict === "BLOCKED") {
          const blocked = buildBlockedText(command, recheck.notes, displayName);
          await sink.error(blocked, ack);
          assistantReply = blocked;
          status = "blocked";
          return;
        }

        Object.assign(gateResult, recheck);

        if (recheck.verdict !== "REVISE") {
          break;
        }
      }
    }

    // Drive save runs HERE, in the handler, before the sink is called — so the
    // Deliverable carries the Drive URL and sinks never touch Drive (sink.ts).
    let driveUrl: string | undefined;
    if (routine.writeToDrive && APPROVED_VERDICTS.includes(gateResult.verdict)) {
      const title = buildDocTitle(command, text);
      driveUrl = await writeToDrive(tenantContext.driveFolderId, title, draft, teamId);
    }

    const deliverable = buildDeliverable({
      label: routine.summaryLabel,
      userText: text,
      displayName,
      gate: {
        verdict: gateResult.verdict,
        score: gateResult.score,
        notes: gateResult.notes,
        revisions,
      },
      draft,
      driveUrl,
      docTitle: buildDocTitle(command, text),
    });

    await sink.send(deliverable, ack);

    assistantReply = draft;
    status = "completed";

    if (onActivity) await onActivity().catch(() => undefined);

    if (APPROVED_VERDICTS.includes(gateResult.verdict)) {
      await recordLearning({
        teamId,
        command,
        userText: text,
        draft,
        verdict: gateResult.verdict,
        score: gateResult.score,
      });
    }

    logger.info(
      { command, teamId, verdict: gateResult.verdict, score: gateResult.score, revisions },
      "Alex command completed"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, command, teamId }, "Alex processor error");
    const errorReply = buildErrorText(command, message, displayName);
    await sink.error(errorReply, ack).catch(() => undefined);
    assistantReply = errorReply;
    status = "error";
  } finally {
    // Record every invocation that produced a reply (success, blocked, unknown,
    // or error). Only "completed" exchanges are replayed back to Claude; the
    // others are stored for completeness. recordExchange is fail-open.
    if (assistantReply !== undefined) {
      await recordExchange({
        teamId,
        userId,
        command,
        userText: text,
        assistantText: assistantReply,
        status,
      });
    }
  }
}
