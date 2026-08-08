// Conversation memory backed by the Editorial OS Context API.
// Past command outputs are stored as "learnings" and recent ones are
// retrieved and injected into Alex's prompt so replies stay consistent.
//
// Multi-tenancy: a single Context API key (CONTEXT_API_KEY) is used, and
// records are scoped per Slack workspace via the `product` field
// (product = "alex:<teamId>"), which the API exposes as a query filter.
import { logger } from "../logger.js";

const DEFAULT_BASE_URL = "http://187.124.87.148:8080/api";
const MEMORY_LIMIT = 8;
const MAX_BODY_CHARS = 1500;
const FETCH_TIMEOUT_MS = 2000;
const WRITE_TIMEOUT_MS = 3000;

interface Learning {
  id: string;
  product: string;
  category: string;
  title: string;
  body: string;
  confidence: string;
  createdAt: string;
  updatedAt: string;
}

function getBaseUrl(): string {
  return (process.env.CONTEXT_API_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

function getApiKey(): string | undefined {
  const key = process.env.CONTEXT_API_KEY;
  return key ? key.trim() : undefined;
}

export function isContextConfigured(): boolean {
  return !!getApiKey();
}

function productFor(teamId: string): string {
  return `alex:${teamId}`;
}

async function contextFetch(
  path: string,
  init: RequestInit,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch recent memory for a workspace, formatted for prompt injection.
 * Returns an empty string when memory is unconfigured, empty, or on error —
 * memory must never break command processing.
 */
export async function fetchMemory(teamId: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return "";

  try {
    const res = await contextFetch(
      `/learnings?product=${encodeURIComponent(productFor(teamId))}`,
      { method: "GET" },
      apiKey,
      FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
      logger.warn(
        { teamId, status: res.status },
        "Context API memory fetch returned non-OK"
      );
      return "";
    }

    const learnings = (await res.json()) as Learning[];
    if (!Array.isArray(learnings) || learnings.length === 0) return "";

    const recent = [...learnings]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, MEMORY_LIMIT);

    return recent
      .map((l) => {
        const when = l.createdAt.split("T")[0];
        const body =
          l.body.length > MAX_BODY_CHARS
            ? `${l.body.slice(0, MAX_BODY_CHARS)}…`
            : l.body;
        return `• [${when}] (${l.category}) ${l.title}\n${body}`;
      })
      .join("\n\n");
  } catch (err) {
    logger.warn({ err, teamId }, "Failed to fetch memory from Context API");
    return "";
  }
}

/**
 * Persist an approved command output as a learning so future runs can recall
 * it. Failures are logged and swallowed — never block the user's reply.
 */
export async function recordLearning(opts: {
  teamId: string;
  command: string;
  userText: string;
  draft: string;
  verdict: string;
  score: number;
}): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const { teamId, command, userText, draft, verdict, score } = opts;
  const category = command.replace(/^\//, "");
  const request = userText.trim() || "(no prompt)";
  const title = `${category}: ${request.slice(0, 80)}`;
  const excerpt =
    draft.length > MAX_BODY_CHARS ? `${draft.slice(0, MAX_BODY_CHARS)}…` : draft;
  const body = [
    `Request: ${request}`,
    `Gate: ${verdict} (${score}/100)`,
    `Output:`,
    excerpt,
  ].join("\n");
  const confidence = verdict === "APPROVED" ? "high" : "medium";

  try {
    const res = await contextFetch(
      "/learnings",
      {
        method: "POST",
        body: JSON.stringify({
          product: productFor(teamId),
          category,
          title,
          body,
          confidence,
          metadata: { teamId, command, verdict, score },
        }),
      },
      apiKey,
      WRITE_TIMEOUT_MS
    );

    if (!res.ok) {
      logger.warn(
        { teamId, command, status: res.status },
        "Context API learning write returned non-OK"
      );
      return;
    }

    logger.info({ teamId, command }, "Recorded learning to Context API");
  } catch (err) {
    logger.warn({ err, teamId, command }, "Failed to record learning to Context API");
  }
}

/**
 * Persist a free-form note (the reply-to-drop memory loop, §5.3) as a learning
 * scoped to the tenant. Category "note" so drops can surface a receipt. Fail-open.
 * Returns true on success so callers can tailor their confirmation.
 */
export async function recordNote(opts: {
  teamId: string;
  userId: string;
  text: string;
}): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) return false;

  const { teamId, userId, text } = opts;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const title = `note: ${trimmed.slice(0, 80)}`;
  const body = trimmed.length > MAX_BODY_CHARS ? `${trimmed.slice(0, MAX_BODY_CHARS)}…` : trimmed;

  try {
    const res = await contextFetch(
      "/learnings",
      {
        method: "POST",
        body: JSON.stringify({
          product: productFor(teamId),
          category: "note",
          title,
          body,
          confidence: "medium",
          metadata: { teamId, userId, source: "telegram-note" },
        }),
      },
      apiKey,
      WRITE_TIMEOUT_MS
    );
    if (!res.ok) {
      logger.warn({ teamId, status: res.status }, "Context API note write returned non-OK");
      return false;
    }
    logger.info({ teamId }, "Recorded note to Context API");
    return true;
  } catch (err) {
    logger.warn({ err, teamId }, "Failed to record note to Context API");
    return false;
  }
}

/**
 * Count notes recorded for a tenant within the last `sinceDays` days — used to
 * open a Weekly Drop with a receipt ("Built on your notes: …"). Fail-open (0).
 */
export async function countRecentNotes(teamId: string, sinceDays = 7): Promise<number> {
  const apiKey = getApiKey();
  if (!apiKey) return 0;

  try {
    const res = await contextFetch(
      `/learnings?product=${encodeURIComponent(productFor(teamId))}`,
      { method: "GET" },
      apiKey,
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return 0;
    const learnings = (await res.json()) as Learning[];
    if (!Array.isArray(learnings)) return 0;
    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    return learnings.filter(
      (l) => l.category === "note" && Date.parse(l.createdAt) >= cutoff
    ).length;
  } catch (err) {
    logger.warn({ err, teamId }, "Failed to count recent notes");
    return 0;
  }
}
