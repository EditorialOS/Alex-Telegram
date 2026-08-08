import crypto from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export function verifySlackSignature(
  rawBody: Buffer | string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const sigBaseString = `v0:${timestamp}:${bodyStr}`;
  const mySignature = `v0=${crypto
    .createHmac("sha256", secret)
    .update(sigBaseString, "utf8")
    .digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

export function slackSignatureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.SLACK_SIGNING_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      logger.warn("SLACK_SIGNING_SECRET not configured — skipping verification in development");
      next();
      return;
    }
    logger.error("SLACK_SIGNING_SECRET is not set — rejecting request");
    res.status(500).json({ error: "Server misconfiguration: Slack signing secret not configured" });
    return;
  }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const signature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !signature) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Missing raw body for signature verification" });
    return;
  }

  const cleanSecret = secret.trim();
  const valid = verifySlackSignature(rawBody, timestamp, signature, cleanSecret);
  if (!valid) {
    const now = Math.floor(Date.now() / 1000);
    const computed = `v0=${crypto
      .createHmac("sha256", cleanSecret)
      .update(`v0:${timestamp}:${rawBody.toString("utf-8")}`, "utf8")
      .digest("hex")}`;
    logger.warn(
      {
        timestampDeltaSec: now - parseInt(timestamp, 10),
        rawBodyLen: rawBody.length,
        secretLen: cleanSecret.length,
        secretHadWhitespace: secret.length !== cleanSecret.length,
        sigReceivedPrefix: signature.slice(0, 12),
        sigComputedPrefix: computed.slice(0, 12),
        sigMatch: computed === signature,
      },
      "Invalid Slack signature — rejecting request"
    );
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  next();
}
