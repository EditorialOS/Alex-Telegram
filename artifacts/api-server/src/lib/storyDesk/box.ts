import { createHash } from "node:crypto";
import {
  CONTEXT_FILE_NAMES,
  type ClientRecord,
  type UploadedContextFile,
} from "./contracts.js";
import { StoryDeskError } from "./errors.js";
import type { BoxContextReader } from "./contextResolver.js";

interface BoxTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface BoxItem {
  id: string;
  name: string;
  type: "file" | "folder";
}

interface BoxListResponse {
  entries?: BoxItem[];
}

export interface ExportArtifact {
  artifactType: "opportunity_board" | "brief";
  artifactId: string;
  version: number;
  contentHash: string;
  filename: string;
  body: string;
}

export interface ExportReceipt {
  artifactType: ExportArtifact["artifactType"];
  artifactId: string;
  version: number;
  contentHash: string;
  boxFileId: string;
  exportHash: string;
}

export interface ExportAdapter {
  export(client: ClientRecord, jobId: string, artifacts: ExportArtifact[]): Promise<ExportReceipt[]>;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new StoryDeskError("box_not_configured", `${name} is required for Box access.`, 500);
  return value;
}

export class BoxAdapter implements BoxContextReader, ExportAdapter {
  private token?: { value: string; expiresAt: number };
  private readonly apiBase = (process.env.BOX_API_BASE_URL ?? "https://api.box.com/2.0").replace(/\/$/, "");
  private readonly uploadBase = (process.env.BOX_UPLOAD_BASE_URL ?? "https://upload.box.com/api/2.0").replace(/\/$/, "");
  private readonly tokenUrl = process.env.BOX_TOKEN_URL ?? "https://api.box.com/oauth2/token";

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env("BOX_CLIENT_ID"),
      client_secret: env("BOX_CLIENT_SECRET"),
      box_subject_type: "enterprise",
      box_subject_id: env("BOX_ENTERPRISE_ID"),
    });
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new StoryDeskError("box_access_denied", "Box Client Credentials authentication failed.", 502, {
        status: response.status,
      });
    }
    const data = (await response.json()) as BoxTokenResponse;
    if (!data.access_token) throw new StoryDeskError("box_access_denied", "Box returned no access token.", 502);
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    return fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  }

  async verifyFolderAccess(folderId: string): Promise<void> {
    const response = await this.request(`${this.apiBase}/folders/${encodeURIComponent(folderId)}?fields=id,name`);
    if (!response.ok) {
      throw new StoryDeskError("box_access_denied", "The Box service account cannot access the client folder.", 422, {
        status: response.status,
      });
    }
  }

  async readContextFiles(folderId: string): Promise<UploadedContextFile[]> {
    const response = await this.request(
      `${this.apiBase}/folders/${encodeURIComponent(folderId)}/items?limit=1000&fields=id,name,type`,
    );
    if (!response.ok) {
      throw new StoryDeskError("box_access_denied", "Could not list the client Box folder.", 422, {
        status: response.status,
      });
    }
    const listing = (await response.json()) as BoxListResponse;
    const wanted = new Set<string>(CONTEXT_FILE_NAMES);
    const entries = (listing.entries ?? []).filter((entry) => entry.type === "file" && wanted.has(entry.name));
    return Promise.all(entries.map(async (entry) => {
      const fileResponse = await this.request(`${this.apiBase}/files/${encodeURIComponent(entry.id)}/content`);
      if (!fileResponse.ok) {
        throw new StoryDeskError("box_access_denied", `Could not read ${entry.name} from Box.`, 422, {
          status: fileResponse.status,
        });
      }
      return {
        name: entry.name,
        media_type: entry.name.endsWith(".md") ? "text/markdown" as const : "text/plain" as const,
        content_utf8: await fileResponse.text(),
      };
    }));
  }

  async export(client: ClientRecord, jobId: string, artifacts: ExportArtifact[]): Promise<ExportReceipt[]> {
    if (!client.boxFolderId) throw new StoryDeskError("box_not_configured", "No Box folder is configured.", 422);
    const receipts: ExportReceipt[] = [];
    for (const artifact of artifacts) {
      const frontMatter = [
        "---",
        `job_id: ${jobId}`,
        `artifact_id: ${artifact.artifactId}`,
        `version: ${artifact.version}`,
        `content_hash: ${artifact.contentHash}`,
        "---",
        "",
      ].join("\n");
      const exported = `${frontMatter}${artifact.body}`;
      const form = new FormData();
      form.append("attributes", JSON.stringify({ name: artifact.filename, parent: { id: client.boxFolderId } }));
      form.append("file", new Blob([exported], { type: "text/markdown;charset=utf-8" }), artifact.filename);
      const response = await this.request(`${this.uploadBase}/files/content`, { method: "POST", body: form });
      if (!response.ok) {
        throw new StoryDeskError("box_export_failed", `Could not export ${artifact.filename} to Box.`, 502, {
          status: response.status,
          artifact_id: artifact.artifactId,
        });
      }
      const data = (await response.json()) as { entries?: Array<{ id: string }> };
      const boxFileId = data.entries?.[0]?.id;
      if (!boxFileId) throw new StoryDeskError("box_export_failed", "Box returned no file ID.", 502);
      receipts.push({
        artifactType: artifact.artifactType,
        artifactId: artifact.artifactId,
        version: artifact.version,
        contentHash: artifact.contentHash,
        boxFileId,
        exportHash: createHash("sha256").update(exported, "utf8").digest("hex"),
      });
    }
    return receipts;
  }
}
