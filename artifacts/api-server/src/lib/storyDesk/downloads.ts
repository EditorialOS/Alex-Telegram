import { createHmac, timingSafeEqual } from "node:crypto";
import type { BriefVersion, OpportunityBoard } from "./contracts.js";
import { StoryDeskError } from "./errors.js";

const DEFAULT_TTL_SECONDS = 60 * 60;

export interface DeliverableDownload {
  artifactType: "opportunity_board" | "brief";
  artifactId: string;
  version: number;
  filename: string;
  mediaType: "text/markdown";
  url: string;
  expiresAt: string;
}

export interface DownloadPayload {
  clientId: string;
  jobId: string;
  artifactType: DeliverableDownload["artifactType"];
  artifactId: string;
  version: number;
  expiresAt: number;
}

export interface DownloadArtifact {
  filename: string;
  body: string;
  contentHash: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "story-desk";
}

function requiredSecret(): string {
  const secret = process.env.STORY_DESK_DOWNLOAD_SECRET?.trim();
  if (!secret) {
    throw new StoryDeskError(
      "download_not_configured",
      "STORY_DESK_DOWNLOAD_SECRET is required for inline downloads.",
      503,
    );
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new StoryDeskError(
      "download_not_configured",
      "STORY_DESK_DOWNLOAD_SECRET must contain at least 32 characters in production.",
      503,
    );
  }
  return secret;
}

function publicOrigin(): string {
  const resource = process.env.STORY_DESK_RESOURCE_URL?.trim();
  if (!resource) {
    throw new StoryDeskError(
      "download_not_configured",
      "STORY_DESK_RESOURCE_URL is required for inline downloads.",
      503,
    );
  }
  try {
    return new URL(resource).origin;
  } catch {
    throw new StoryDeskError(
      "download_not_configured",
      "STORY_DESK_RESOURCE_URL must be an absolute URL.",
      503,
    );
  }
}

function parsePayload(token: string): DownloadPayload {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
  }
  if (!value || typeof value !== "object") {
    throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
  }
  const payload = value as Partial<DownloadPayload>;
  if (
    typeof payload.clientId !== "string" || !payload.clientId ||
    typeof payload.jobId !== "string" || !payload.jobId ||
    !["opportunity_board", "brief"].includes(payload.artifactType ?? "") ||
    typeof payload.artifactId !== "string" || !payload.artifactId ||
    !Number.isInteger(payload.version) || Number(payload.version) < 1 ||
    !Number.isInteger(payload.expiresAt)
  ) {
    throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
  }
  return payload as DownloadPayload;
}

function briefFilename(brief: BriefVersion, jobId: string): string {
  return `${slug(brief.fields.title)}-${jobId.slice(0, 8)}-v${brief.version}.md`;
}

export class StoryDeskDownloadSigner {
  private readonly secret: string;
  private readonly origin: string;
  private readonly ttlSeconds: number;

  constructor(options: { secret?: string; origin?: string; ttlSeconds?: number } = {}) {
    this.secret = options.secret ?? requiredSecret();
    this.origin = (options.origin ?? publicOrigin()).replace(/\/$/, "");
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  private signature(token: string): string {
    return createHmac("sha256", this.secret).update(token, "utf8").digest("base64url");
  }

  private link(payload: DownloadPayload, filename: string): DeliverableDownload {
    const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.signature(token);
    const url = new URL("/api/story-desk/download", this.origin);
    url.searchParams.set("token", token);
    url.searchParams.set("signature", signature);
    return {
      artifactType: payload.artifactType,
      artifactId: payload.artifactId,
      version: payload.version,
      filename,
      mediaType: "text/markdown",
      url: url.href,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    };
  }

  createLinks(clientId: string, board: OpportunityBoard, now = Date.now()): DeliverableDownload[] {
    const expiresAt = Math.floor(now / 1000) + this.ttlSeconds;
    const common = { clientId, jobId: board.jobId, expiresAt };
    return [
      this.link({
        ...common,
        artifactType: "opportunity_board",
        artifactId: board.id,
        version: 1,
      }, `${slug(board.title)}-${board.jobId.slice(0, 8)}.md`),
      ...board.briefs.map((brief) => this.link({
        ...common,
        artifactType: "brief",
        artifactId: brief.briefId,
        version: brief.version,
      }, briefFilename(brief, board.jobId))),
    ];
  }

  verify(token: string | undefined, signature: string | undefined, now = Date.now()): DownloadPayload {
    if (!token || !signature || token.length > 4096 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
      throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
    }
    const expected = Buffer.from(this.signature(token));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
    }
    const payload = parsePayload(token);
    if (payload.expiresAt <= Math.floor(now / 1000)) {
      throw new StoryDeskError("download_expired", "This download link has expired. Ask Alex for the board again.", 410);
    }
    return payload;
  }
}

export function resolveDownloadArtifact(board: OpportunityBoard, payload: DownloadPayload): DownloadArtifact {
  if (board.jobId !== payload.jobId) {
    throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
  }
  if (payload.artifactType === "opportunity_board") {
    if (payload.artifactId !== board.id || payload.version !== 1) {
      throw new StoryDeskError("invalid_download", "This download link is invalid.", 404);
    }
    return {
      filename: `${slug(board.title)}-${board.jobId.slice(0, 8)}.md`,
      body: board.body,
      contentHash: board.contentHash,
    };
  }
  const brief = board.briefs.find((item) =>
    item.briefId === payload.artifactId && item.version === payload.version
  );
  if (!brief) throw new StoryDeskError("not_found", "Deliverable not found.", 404);
  return {
    filename: briefFilename(brief, board.jobId),
    body: brief.body,
    contentHash: brief.contentHash,
  };
}
