// Shared Telegram HTML rendering for a Deliverable, used by both the
// interactive sink (telegramSink.ts) and the push sink (telegramPush.ts) so the
// two render identically.
import { type Deliverable } from "./sink.js";
import { escapeHtml } from "./telegramApi.js";

// Telegram hard-caps messages at 4096 chars. We inline well under that; larger
// output goes out as a .md document instead of a wall of text.
export const INLINE_LIMIT = 3500;
export const TELEGRAM_MAX = 4096;

export function headerHtml(d: Deliverable): string {
  const topicSuffix = d.topic ? ` — ${d.topic}` : "";
  let h = `<b>${escapeHtml(d.label + topicSuffix)}</b>`;
  if (d.driveUrl) {
    h += `\n📄 <a href="${escapeHtml(d.driveUrl)}">Open in Drive</a>`;
  }
  return h;
}

/** Full inline rendering: header + draft + gate summary. */
export function inlineHtml(d: Deliverable): string {
  return `${headerHtml(d)}\n\n${escapeHtml(d.bodyText)}\n\n${escapeHtml(d.summaryText)}`;
}

/** Header + gate summary only — used when the draft is delivered as a document. */
export function summaryHtml(d: Deliverable): string {
  return `${headerHtml(d)}\n\n${escapeHtml(d.summaryText)}`;
}

/** True when the whole thing fits comfortably in one inline message. */
export function fitsInline(d: Deliverable): boolean {
  return d.bodyText.length <= INLINE_LIMIT && inlineHtml(d).length <= TELEGRAM_MAX;
}
