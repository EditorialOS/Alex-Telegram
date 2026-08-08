// Telegram implementation of the Sink contract (sink.ts).
//
// Delivery rules (spec §2.4):
//   • ack()  → typing indicator + a "Working on it…" message we later edit.
//   • send() → short output edits that message in place; long output goes out as
//              a .md document, with the gate summary kept loud in the edit.
//   • every editMessageText is wrapped: on ANY failure (message too old, deleted,
//     or any Telegram error) it falls back to a fresh sendMessage. No dead ends.
import { type Sink, type AckHandle, type Deliverable } from "./sink.js";
import {
  sendMessage,
  editMessageText,
  sendChatAction,
  sendDocument,
  escapeHtml,
} from "./telegramApi.js";
import { inlineHtml, summaryHtml, fitsInline } from "./telegramRender.js";
import { logger } from "../logger.js";

/** AckHandle whose update() edits the placeholder, falling back to a new message. */
class TelegramAckHandle implements AckHandle {
  constructor(
    private readonly chatId: number,
    private messageId: number | undefined
  ) {}

  async update(text: string): Promise<void> {
    if (this.messageId !== undefined) {
      try {
        await editMessageText(this.chatId, this.messageId, text, { parseMode: "HTML" });
        return;
      } catch (err) {
        logger.warn({ err, chatId: this.chatId }, "editMessageText failed — falling back to sendMessage");
      }
    }
    try {
      const m = await sendMessage(this.chatId, text, { parseMode: "HTML" });
      this.messageId = m.message_id;
    } catch (err) {
      logger.error({ err, chatId: this.chatId }, "sendMessage fallback failed");
    }
  }
}

export class TelegramSink implements Sink {
  constructor(private readonly chatId: number) {}

  async ack(): Promise<AckHandle> {
    await sendChatAction(this.chatId, "typing");
    let messageId: number | undefined;
    try {
      const m = await sendMessage(this.chatId, "⏳ Working on it…");
      messageId = m.message_id;
    } catch (err) {
      logger.warn({ err, chatId: this.chatId }, "Failed to post Telegram ack message");
    }
    return new TelegramAckHandle(this.chatId, messageId);
  }

  async send(d: Deliverable, ack: AckHandle): Promise<void> {
    if (fitsInline(d)) {
      await ack.update(inlineHtml(d));
      return;
    }

    // Long output: keep the gate loud in the placeholder, deliver the draft as a
    // document. Never chunk text into walls.
    await ack.update(summaryHtml(d));
    try {
      await sendDocument(
        this.chatId,
        { buffer: d.file.buffer, filename: d.file.filename },
        `📄 ${escapeHtml(d.label)}`
      );
    } catch (err) {
      logger.error({ err, chatId: this.chatId }, "Failed to send Telegram document");
      await this.sendNote(
        "⚠️ I couldn't attach the document just now — the summary above still stands. Try the command again to get the file."
      );
    }
  }

  async sendNote(noteText: string): Promise<void> {
    try {
      await sendMessage(this.chatId, escapeHtml(noteText), { parseMode: "HTML" });
    } catch (err) {
      logger.error({ err, chatId: this.chatId }, "Failed to send Telegram note");
    }
  }

  async error(message: string, ack: AckHandle): Promise<void> {
    await ack.update(escapeHtml(message));
  }
}
