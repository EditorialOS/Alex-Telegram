import { createHash } from "node:crypto";
import {
  CONTEXT_FILE_NAMES,
  REQUIRED_CONTEXT_FILE_NAMES,
  type ClientRecord,
  type ContextFileName,
  type ContextSourceRequest,
  type NormalizedContext,
  type UploadedContextFile,
} from "./contracts.js";
import { StoryDeskError } from "./errors.js";

const MAX_FILES = 6;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["text/markdown", "text/plain"]);
const ALLOWED_NAMES = new Set<string>(CONTEXT_FILE_NAMES);

export interface BoxContextReader {
  readContextFiles(folderId: string): Promise<UploadedContextFile[]>;
  verifyFolderAccess(folderId: string): Promise<void>;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function normalizeContextText(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .replace(/\n*$/, "\n");
  if (Buffer.from(normalized, "utf8").toString("utf8") !== normalized) {
    throw new StoryDeskError("invalid_context_file", "Context must contain valid UTF-8 text.");
  }
  return normalized;
}

export function hashContextFiles(files: Partial<Record<ContextFileName, string>>): string {
  const canonical = CONTEXT_FILE_NAMES.filter((name) => files[name] !== undefined)
    .map((name) => `<<<${name}>>>\n${files[name]}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function resolveUploadedFiles(input: UploadedContextFile[]): NormalizedContext {
  if (input.length > MAX_FILES) {
    throw new StoryDeskError("context_limit_exceeded", `No more than ${MAX_FILES} context files are allowed.`, 400, {
      maximum: MAX_FILES,
    });
  }

  const files: Partial<Record<ContextFileName, string>> = {};
  let totalBytes = 0;
  for (const file of input) {
    if (!ALLOWED_NAMES.has(file.name)) {
      throw new StoryDeskError("invalid_context_file", `Unsupported context filename: ${file.name}`, 400, {
        allowed: CONTEXT_FILE_NAMES,
      });
    }
    if (!ALLOWED_MEDIA_TYPES.has(file.media_type)) {
      throw new StoryDeskError("invalid_context_file", `Unsupported media type for ${file.name}.`, 400, {
        allowed: [...ALLOWED_MEDIA_TYPES],
      });
    }
    if (files[file.name as ContextFileName] !== undefined) {
      throw new StoryDeskError("invalid_context_file", `Duplicate context filename: ${file.name}`);
    }
    const normalized = normalizeContextText(file.content_utf8);
    const size = byteLength(normalized);
    if (size > MAX_FILE_BYTES) {
      throw new StoryDeskError("context_limit_exceeded", `${file.name} exceeds 256 KB.`, 400, {
        filename: file.name,
        bytes: size,
      });
    }
    totalBytes += size;
    files[file.name as ContextFileName] = normalized;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new StoryDeskError("context_limit_exceeded", "Context files exceed 1 MB in total.", 400, {
      bytes: totalBytes,
    });
  }

  const missing = REQUIRED_CONTEXT_FILE_NAMES.filter((name) => !files[name]?.trim());
  if (missing.length > 0) {
    throw new StoryDeskError("needs_context", "Required client context is missing.", 422, {
      missing_files: missing,
    });
  }

  return { files, contentHash: hashContextFiles(files) };
}

export class ContextResolver {
  private readonly box?: BoxContextReader;

  constructor(box?: BoxContextReader) {
    this.box = box;
  }

  async resolve(client: ClientRecord, source: ContextSourceRequest): Promise<NormalizedContext> {
    if (source.type === "uploaded_files") return resolveUploadedFiles(source.files);
    if (!client.boxFolderId) {
      throw new StoryDeskError("box_not_configured", "The authenticated client has no Box folder configured.", 422);
    }
    if (!this.box) {
      throw new StoryDeskError("box_not_configured", "Box credentials are not configured on the server.", 500);
    }
    await this.box.verifyFolderAccess(client.boxFolderId);
    return resolveUploadedFiles(await this.box.readContextFiles(client.boxFolderId));
  }
}
