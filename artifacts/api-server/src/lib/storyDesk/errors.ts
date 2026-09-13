export type StoryDeskErrorCode =
  | "unauthorized"
  | "authentication_not_configured"
  | "invalid_request"
  | "idempotency_conflict"
  | "needs_context"
  | "unsupported_context_transport"
  | "context_limit_exceeded"
  | "invalid_context_file"
  | "download_not_configured"
  | "invalid_download"
  | "download_expired"
  | "box_not_configured"
  | "box_access_denied"
  | "box_export_failed"
  | "source_integrity_failed"
  | "model_output_invalid"
  | "brief_incomplete"
  | "not_found"
  | "version_conflict"
  | "invalid_state";

export class StoryDeskError extends Error {
  readonly code: StoryDeskErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: StoryDeskErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StoryDeskError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asStoryDeskError(error: unknown): StoryDeskError {
  if (error instanceof StoryDeskError) return error;
  return new StoryDeskError("invalid_state", "Story Desk could not complete the operation.", 500);
}
