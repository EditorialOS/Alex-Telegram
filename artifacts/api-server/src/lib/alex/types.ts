export type RoutineType = "routine" | "quickhit";
export type GateMode = "strategy" | "content";
export type GateVerdict =
  | "APPROVED"
  | "APPROVED_WITH_NOTES"
  | "REVISE"
  | "NEEDS_INPUT"
  | "BLOCKED";

export interface RoutineConfig {
  command: string;
  type: RoutineType;
  description: string;
  summaryLabel: string;
  skills: string[];
  gateMode: GateMode;
  gateLoop: boolean;
  instruction: string;
  writeToDrive: boolean;
  drivePath?: string;
}

export interface GateResult {
  verdict: GateVerdict;
  score: number;
  notes: string;
}

export interface ProcessResult {
  finalDraft: string;
  verdict: GateVerdict;
  score: number;
  notes: string;
  revisions: number;
  driveLink?: string;
}

export interface TenantContext {
  teamId: string;
  brandVoice: string;
  contentPillars: string;
  competitiveLandscape: string;
  standingOrders: string;
  audiencePersonas: string;
  styleGuide: string;
  /** Free-form identity/persona text. Empty when unset (agent defaults to "Alex"). */
  teammate: string;
  driveFolderId?: string;
}
