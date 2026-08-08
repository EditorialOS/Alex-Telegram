// Slack implementation of the Sink contract (sink.ts).
//
// This is the extraction of the pre-adapter Slack reply path: the slash-command
// route acks synchronously (Slack's ~3s window), then every follow-up — the
// result, notes, blocks, errors — is POSTed to the command's response_url. That
// behavior is preserved here 1:1; the successful-reply layout (formatSlackReply)
// is byte-identical to before.
import { type Sink, type AckHandle, type Deliverable } from "./sink.js";
import { formatSlackReply } from "./formatter.js";
import { logger } from "../logger.js";

/** POST a message to a slash command's response_url. */
async function postToResponseUrl(
  responseUrl: string,
  text: string,
  inChannel: boolean
): Promise<void> {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: inChannel ? "in_channel" : "ephemeral",
        text,
        replace_original: false,
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "Failed to post to Slack response_url");
    }
  } catch (err) {
    logger.error({ err }, "Failed to post to Slack response_url");
  }
}

export class SlackSink implements Sink {
  constructor(private readonly responseUrl: string) {}

  // The route already posted the ephemeral "Working on …" ack before handing
  // off, so ack() is a no-op. The handle's update() posts a fresh ephemeral,
  // available for parity but unused on the happy path (Slack doesn't edit).
  async ack(): Promise<AckHandle> {
    const responseUrl = this.responseUrl;
    return {
      async update(text: string): Promise<void> {
        await postToResponseUrl(responseUrl, text, false);
      },
    };
  }

  async send(d: Deliverable, _ack: AckHandle): Promise<void> {
    // Slack always inlines the full draft as an in-channel message.
    await postToResponseUrl(this.responseUrl, formatSlackReply(d), true);
  }

  async sendNote(noteText: string): Promise<void> {
    await postToResponseUrl(this.responseUrl, noteText, false);
  }

  async error(message: string, _ack: AckHandle): Promise<void> {
    await postToResponseUrl(this.responseUrl, message, false);
  }
}
