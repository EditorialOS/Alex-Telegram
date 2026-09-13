import { createHash, randomUUID } from "node:crypto";
import type {
  ApproveBriefsInput,
  BriefVersion,
  ClientRecord,
  CreateOpportunityBoardInput,
  JobRecord,
  JobStatus,
  NormalizedContext,
  Opportunity,
  OpportunityBoard,
  StoryDeskGateReport,
} from "./contracts.js";
import { ContextResolver } from "./contextResolver.js";
import { StoryDeskDownloadSigner, type DeliverableDownload } from "./downloads.js";
import { asStoryDeskError, StoryDeskError } from "./errors.js";
import type { StoryDeskStore } from "./store.js";
import { VerifiedSkillLoader } from "./sourceBundle.js";
import { StoryDeskWorkers, structuralMissing, type StoryDeskConstraints } from "./workers.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function renderBoard(
  title: string,
  opportunities: Opportunity[],
  briefs: BriefVersion[],
  reports: StoryDeskGateReport[],
): string {
  const reportByBrief = new Map(reports.map((report) => [report.briefVersionId, report]));
  const briefByOpportunity = new Map(briefs.map((brief) => [brief.opportunityId, brief]));
  const rows = opportunities.map((opportunity) => {
    const brief = briefByOpportunity.get(opportunity.id);
    const report = brief ? reportByBrief.get(brief.id) : undefined;
    return `| ${opportunity.rank} | ${opportunity.title} | ${opportunity.audienceDemand}/5 | ${opportunity.editorialDifferentiation}/5 | ${opportunity.productionFeasibility}/5 | ${opportunity.total}/15 | ${report?.disposition ?? "not_briefed"} |`;
  });
  return [
    `# ${title}`,
    "",
    "| Rank | Opportunity | Demand | Distinctiveness | Feasibility | Total | Brief disposition |",
    "|---:|---|---:|---:|---:|---:|---|",
    ...rows,
    "",
    "## Commissionable briefs",
    "",
    ...briefs.flatMap((brief) => {
      const report = reportByBrief.get(brief.id)!;
      return [
        `### ${brief.fields.title}`,
        `Brief ID: \`${brief.briefId}\` · Version: ${brief.version} · Hash: \`${brief.contentHash}\``,
        `Gate: ${report.total}/25 · \`${report.disposition}\``,
        "",
      ];
    }),
  ].join("\n");
}

export interface CreateBoardResult {
  job: JobStatus;
  board?: OpportunityBoard & { downloads: DeliverableDownload[] };
  idempotentReplay: boolean;
}

export class StoryDeskService {
  private readonly store: StoryDeskStore;
  private readonly contextResolver: ContextResolver;
  private readonly skillLoader: { load(): ReturnType<VerifiedSkillLoader["load"]> };
  private readonly workers: StoryDeskWorkers;
  private readonly downloads: StoryDeskDownloadSigner;

  constructor(
    store: StoryDeskStore,
    contextResolver: ContextResolver,
    skillLoader: { load(): ReturnType<VerifiedSkillLoader["load"]> },
    workers: StoryDeskWorkers,
    downloads: StoryDeskDownloadSigner,
  ) {
    this.store = store;
    this.contextResolver = contextResolver;
    this.skillLoader = skillLoader;
    this.workers = workers;
    this.downloads = downloads;
  }

  async createOpportunityBoard(
    client: ClientRecord,
    input: CreateOpportunityBoardInput,
  ): Promise<CreateBoardResult> {
    const goal = input.goal?.trim();
    const key = input.idempotency_key?.trim();
    if (!goal || !key) throw new StoryDeskError("invalid_request", "goal and idempotency_key are required.");
    if (!input.context_source || input.context_source.type !== "uploaded_files") {
      throw new StoryDeskError(
        "unsupported_context_transport",
        "Context must be supplied as uploaded UTF-8 contents. Connected Box context is deferred to V.2.",
        400,
      );
    }
    const constraints: StoryDeskConstraints = {
      timing: input.timing?.trim() || undefined,
      campaign: input.campaign?.trim() || undefined,
      channels: input.channels?.map((item) => item.trim()).filter(Boolean),
    };
    const requestHash = sha256(stable({ goal, constraints, context_source: input.context_source }));
    const created = await this.store.createJob({
      clientId: client.id,
      goal,
      requestHash,
      idempotencyKey: key,
      contextSourceType: input.context_source.type,
      constraints: constraints as Record<string, unknown>,
    });
    const job = created.job;
    const existingBoard = await this.store.getBoard(client.id, job.id);
    if (job.state === "completed" && existingBoard) {
      return {
        job: this.status(job, existingBoard.id),
        board: this.withDownloads(client.id, existingBoard),
        idempotentReplay: true,
      };
    }

    try {
      const board = existingBoard ?? await this.runJob(client, job, input, constraints);
      if (existingBoard) await this.complete(client.id, job.id, existingBoard);
      const finalJob = await this.requireJob(client.id, job.id);
      return {
        job: this.status(finalJob, board.id),
        board: this.withDownloads(client.id, board),
        idempotentReplay: created.existing,
      };
    } catch (error) {
      const storyError = asStoryDeskError(error);
      const state = storyError.code === "needs_context" ? "needs_context" : "failed";
      await this.store.updateJob(client.id, job.id, state, {
        errorCode: storyError.code,
        errorDetails: storyError.details,
      }).catch(() => undefined);
      await this.store.appendEvent(client.id, job.id, "job_failed", {
        code: storyError.code,
        details: storyError.details ?? {},
      }).catch(() => undefined);
      throw storyError;
    }
  }

  private async runJob(
    client: ClientRecord,
    job: JobRecord,
    input: CreateOpportunityBoardInput,
    constraints: StoryDeskConstraints,
  ): Promise<OpportunityBoard> {
    let context = await this.store.getContextSnapshot(client.id, job.id);
    if (!context) {
      await this.transition(client.id, job.id, "resolving_context");
      context = await this.contextResolver.resolve(input.context_source);
      const snapshotId = await this.store.saveContextSnapshot(client.id, job.id, context);
      await this.store.updateJob(client.id, job.id, "resolving_context", { contextSnapshotId: snapshotId });
      await this.store.appendEvent(client.id, job.id, "context_snapshotted", {
        snapshot_id: snapshotId,
        content_hash: context.contentHash,
      });
    }

    const skills = await this.skillLoader.load();
    await this.store.appendEvent(client.id, job.id, "source_verified", {
      os_version: skills.osVersion,
      contract_version: skills.contractVersion,
    });

    await this.transition(client.id, job.id, "generating_opportunities");
    const opportunities = await this.workers.generateOpportunities(job.goal, constraints, context, skills);

    await this.transition(client.id, job.id, "ranking_opportunities");
    const ranked = await this.workers.rankOpportunities(job.goal, constraints, opportunities, context, skills);

    await this.transition(client.id, job.id, "developing_briefs");
    let briefs = await this.workers.developBriefs(job.goal, ranked, context, skills);
    for (let revision = 1; revision <= 2; revision++) {
      const missing = Object.fromEntries(
        briefs.map((brief) => [brief.opportunityId, structuralMissing(brief.fields)])
          .filter(([, fields]) => fields.length > 0),
      );
      if (Object.keys(missing).length === 0) break;
      briefs = await this.workers.developBriefs(job.goal, ranked, context, skills, missing, revision);
    }
    const incomplete = briefs.map((brief) => ({ brief, missing: structuralMissing(brief.fields) }))
      .filter((item) => item.missing.length > 0);
    if (incomplete.length > 0) {
      throw new StoryDeskError("brief_incomplete", "Briefs remained incomplete after the revision limit.", 422, {
        briefs: incomplete.map((item) => ({ brief_id: item.brief.briefId, missing_fields: item.missing })),
      });
    }

    await this.transition(client.id, job.id, "evaluating_briefs");
    const reports = await Promise.all(briefs.map((brief) => this.workers.evaluateBrief(brief, context!, skills)));

    await this.transition(client.id, job.id, "persisting_artifacts");
    const boardId = randomUUID();
    const title = `Alex Story Desk — ${job.goal}`;
    const body = renderBoard(title, ranked, briefs, reports);
    const board: OpportunityBoard = {
      id: boardId,
      jobId: job.id,
      title,
      opportunities: ranked,
      briefs,
      gateReports: reports,
      body,
      contentHash: sha256(body),
    };
    await this.store.saveBoard(client.id, board);
    await this.store.appendEvent(client.id, job.id, "artifacts_persisted", {
      board_id: board.id,
      brief_count: briefs.length,
    });
    await this.complete(client.id, job.id, board);
    return board;
  }

  private async complete(clientId: string, jobId: string, board: OpportunityBoard): Promise<void> {
    const links = this.downloads.createLinks(clientId, board);
    await this.store.appendEvent(clientId, jobId, "inline_downloads_ready", {
      count: links.length,
      expires_at: links[0]?.expiresAt,
    });
    await this.store.updateJob(clientId, jobId, "completed");
  }

  async getOpportunityBoard(
    client: ClientRecord,
    jobId: string,
  ): Promise<OpportunityBoard & { downloads: DeliverableDownload[] }> {
    const board = await this.store.getBoard(client.id, jobId);
    if (!board) throw new StoryDeskError("not_found", "Opportunity board not found.", 404);
    return this.withDownloads(client.id, board);
  }

  async approveBriefs(client: ClientRecord, actorId: string, input: ApproveBriefsInput): Promise<{ recorded: number }> {
    if (!input.selections?.length) throw new StoryDeskError("invalid_request", "At least one brief decision is required.");
    const job = await this.requireJob(client.id, input.job_id);
    if (job.state !== "completed") {
      throw new StoryDeskError("invalid_state", "Briefs can be decided only after the job completes.", 409);
    }
    await this.store.decideBriefs(client.id, actorId, input.job_id, input.selections);
    await this.store.appendEvent(client.id, input.job_id, "brief_decisions_recorded", {
      count: input.selections.length,
    });
    return { recorded: input.selections.length };
  }

  async getJobStatus(client: ClientRecord, jobId: string): Promise<JobStatus> {
    const job = await this.requireJob(client.id, jobId);
    const board = await this.store.getBoard(client.id, jobId);
    return this.status(job, board?.id);
  }

  private async transition(clientId: string, jobId: string, state: JobRecord["state"]): Promise<void> {
    await this.store.updateJob(clientId, jobId, state);
    await this.store.appendEvent(clientId, jobId, "state_changed", { state });
  }

  private async requireJob(clientId: string, jobId: string): Promise<JobRecord> {
    const job = await this.store.getJob(clientId, jobId);
    if (!job) throw new StoryDeskError("not_found", "Job not found.", 404);
    return job;
  }

  private status(job: JobRecord, boardId?: string): JobStatus {
    return {
      jobId: job.id,
      state: job.state,
      error: job.errorCode ? { code: job.errorCode, details: job.errorDetails } : undefined,
      boardId,
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private withDownloads(
    clientId: string,
    board: OpportunityBoard,
  ): OpportunityBoard & { downloads: DeliverableDownload[] } {
    return { ...board, downloads: this.downloads.createLinks(clientId, board) };
  }
}
