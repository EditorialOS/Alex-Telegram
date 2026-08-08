// DB-backed conversation memory. Every slash command invocation is appended to
// a per-(team_id, user_id) conversation thread as a user message (the request)
// and an assistant message (Alex's final reply). Recent turns are replayed back
// to Claude so Alex can build on prior work and avoid repeating itself.
//
// Failures here must never block command processing: reads return an empty
// history and writes are logged and swallowed.
import { db, conversations, messages } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "../logger.js";

// Outcome of a recorded invocation. Only "completed" exchanges (a routine reply
// that passed the gate and was posted) are replayed back to Claude; the others
// are stored for completeness/audit but kept out of the prompt.
export type ConversationStatus = "completed" | "blocked" | "unknown" | "error";

// Cap how much history we replay so the prompt does not balloon. 10 exchanges =
// 20 messages (user + assistant per exchange).
const MAX_EXCHANGES = 10;
const MAX_MESSAGES = MAX_EXCHANGES * 2;
const MAX_CONTENT_CHARS = 1500;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function truncate(text: string): string {
  return text.length > MAX_CONTENT_CHARS
    ? `${text.slice(0, MAX_CONTENT_CHARS)}…`
    : text;
}

async function findConversationId(
  teamId: string,
  userId: string
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.teamId, teamId), eq(conversations.userId, userId)))
    .limit(1);
  return row?.id;
}

/**
 * Fetch the recent conversation history for a workspace user, oldest-first,
 * ready to prepend to Claude's messages array. Capped to the last
 * MAX_EXCHANGES exchanges and each message truncated to bound token usage.
 * Returns an empty array on any error.
 */
export async function fetchHistory(
  teamId: string,
  userId: string
): Promise<HistoryTurn[]> {
  try {
    const conversationId = await findConversationId(teamId, userId);
    if (conversationId === undefined) return [];

    const rows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.status, "completed")
        )
      )
      .orderBy(desc(messages.id))
      .limit(MAX_MESSAGES);

    return rows
      .reverse()
      .map((r) => ({
        role: r.role === "assistant" ? "assistant" : "user",
        content: truncate(r.content),
      }));
  } catch (err) {
    logger.warn({ err, teamId, userId }, "Failed to fetch conversation history");
    return [];
  }
}

/**
 * Append one completed exchange (the user's request and Alex's final reply) to
 * the per-user conversation thread, creating the thread on first use. Failures
 * are logged and swallowed so they never block the user's reply.
 */
export async function recordExchange(opts: {
  teamId: string;
  userId: string;
  command: string;
  userText: string;
  assistantText: string;
  status: ConversationStatus;
}): Promise<void> {
  const { teamId, userId, command, userText, assistantText, status } = opts;
  try {
    let conversationId = await findConversationId(teamId, userId);

    if (conversationId === undefined) {
      const title = `${teamId}:${userId}`;
      const [created] = await db
        .insert(conversations)
        .values({ teamId, userId, title })
        .returning({ id: conversations.id });
      conversationId = created.id;
    }

    const request = userText.trim() || "(no prompt)";
    await db.insert(messages).values([
      { conversationId, role: "user", content: `${command} ${request}`.trim(), status },
      { conversationId, role: "assistant", content: assistantText, status },
    ]);

    logger.info({ teamId, userId, command, status }, "Recorded conversation exchange");
  } catch (err) {
    logger.warn(
      { err, teamId, userId, command },
      "Failed to record conversation exchange"
    );
  }
}
