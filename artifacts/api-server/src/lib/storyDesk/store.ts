import type {
  ApprovalSelection,
  ClientRecord,
  JobRecord,
  JobState,
  NormalizedContext,
  OpportunityBoard,
} from "./contracts.js";
import type { ExportReceipt } from "./box.js";

export interface NewJob {
  clientId: string;
  goal: string;
  requestHash: string;
  idempotencyKey: string;
  contextSourceType: "uploaded_files" | "connected_box";
  constraints: Record<string, unknown>;
}

export interface CreateJobResult {
  job: JobRecord;
  existing: boolean;
}

export interface StoryDeskStore {
  authenticateOAuthIdentity(authSubject: string, oauthClientId: string): Promise<ClientRecord | undefined>;
  createJob(input: NewJob): Promise<CreateJobResult>;
  getJob(clientId: string, jobId: string): Promise<JobRecord | undefined>;
  updateJob(
    clientId: string,
    jobId: string,
    state: JobState,
    options?: { contextSnapshotId?: string; errorCode?: string; errorDetails?: Record<string, unknown> },
  ): Promise<void>;
  saveContextSnapshot(clientId: string, jobId: string, context: NormalizedContext): Promise<string>;
  getContextSnapshot(clientId: string, jobId: string): Promise<NormalizedContext | undefined>;
  appendEvent(clientId: string, jobId: string, type: string, payload?: Record<string, unknown>): Promise<void>;
  saveBoard(clientId: string, board: OpportunityBoard): Promise<void>;
  getBoard(clientId: string, jobId: string): Promise<OpportunityBoard | undefined>;
  hasExportReceipt(clientId: string, jobId: string, artifact: {
    artifactType: "opportunity_board" | "brief";
    artifactId: string;
    version: number;
    contentHash: string;
  }): Promise<boolean>;
  saveExportReceipts(clientId: string, jobId: string, receipts: ExportReceipt[]): Promise<void>;
  decideBriefs(clientId: string, actorId: string, jobId: string, selections: ApprovalSelection[]): Promise<void>;
}
