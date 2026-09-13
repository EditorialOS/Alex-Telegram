export const CONTEXT_FILE_NAMES = [
  "brand-voice.md",
  "content-pillars.md",
  "audience-personas.md",
  "style-guide.md",
  "competitive-landscape.md",
  "standing_orders.md",
] as const;

export const REQUIRED_CONTEXT_FILE_NAMES = [
  "brand-voice.md",
  "content-pillars.md",
  "audience-personas.md",
] as const;

export type ContextFileName = (typeof CONTEXT_FILE_NAMES)[number];

export interface UploadedContextFile {
  name: string;
  media_type: "text/markdown" | "text/plain";
  content_utf8: string;
}

export type ContextSourceRequest = { type: "uploaded_files"; files: UploadedContextFile[] };

export interface CreateOpportunityBoardInput {
  goal: string;
  idempotency_key: string;
  context_source: ContextSourceRequest;
  timing?: string;
  campaign?: string;
  channels?: string[];
}

export interface GetOpportunityBoardInput {
  job_id: string;
}

export interface ApprovalSelection {
  brief_id: string;
  version: number;
  content_hash: string;
  decision: "approved" | "rejected";
}

export interface ApproveBriefsInput {
  job_id: string;
  selections: ApprovalSelection[];
}

export type JobState =
  | "received"
  | "resolving_context"
  | "generating_opportunities"
  | "ranking_opportunities"
  | "developing_briefs"
  | "evaluating_briefs"
  | "persisting_artifacts"
  | "completed"
  | "needs_context"
  | "failed";

export interface ClientRecord {
  id: string;
  name: string;
  boxFolderId?: string;
  authSubject?: string;
  oauthClientId?: string;
}

export interface NormalizedContext {
  files: Partial<Record<ContextFileName, string>>;
  contentHash: string;
}

export interface Opportunity {
  id: string;
  title: string;
  angle: string;
  audience: string;
  channel: string;
  format: string;
  whyNow: string;
  sources: string[];
  stretch: boolean;
  reliable: boolean;
  audienceDemand: number;
  editorialDifferentiation: number;
  productionFeasibility: number;
  total: number;
  rank: number;
}

export interface BriefFields {
  title: string;
  angle: string;
  audience: string;
  whyTheyCare: string;
  sources: string[];
  format: string;
  length: string;
  channel: string;
  pillar: string;
  tone: string;
  deadline: string;
  successCriteria: string;
  outline: Array<{ heading: string; purpose: string }>;
  selfAssessment?: Record<string, unknown>;
}

export interface BriefVersion {
  id: string;
  briefId: string;
  opportunityId: string;
  version: number;
  fields: BriefFields;
  body: string;
  contentHash: string;
}

export const STORY_DESK_GATE_CRITERIA = [
  "audience_fit",
  "editorial_distinctiveness",
  "brand_fit",
  "source_sufficiency",
  "channel_fit",
] as const;

export type StoryDeskGateCriterion = (typeof STORY_DESK_GATE_CRITERIA)[number];
export type BriefDisposition =
  | "do_not_commission"
  | "commission_with_review"
  | "ready_to_commission";

export interface GateCriterionResult {
  score: number;
  notes: string;
}

export interface StoryDeskGateReport {
  id: string;
  briefVersionId: string;
  mode: "story_desk_commissioning";
  criteria: Record<StoryDeskGateCriterion, GateCriterionResult>;
  total: number;
  disposition: BriefDisposition;
  notes: string;
}

export interface OpportunityBoard {
  id: string;
  jobId: string;
  title: string;
  opportunities: Opportunity[];
  briefs: BriefVersion[];
  gateReports: StoryDeskGateReport[];
  body: string;
  contentHash: string;
}

export interface JobRecord {
  id: string;
  clientId: string;
  goal: string;
  requestHash: string;
  idempotencyKey: string;
  contextSourceType: ContextSourceRequest["type"];
  state: JobState;
  contextSnapshotId?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobStatus {
  jobId: string;
  state: JobState;
  error?: { code: string; details?: Record<string, unknown> };
  boardId?: string;
  updatedAt: string;
}
