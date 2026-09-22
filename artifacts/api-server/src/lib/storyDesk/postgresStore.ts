import { randomUUID } from "node:crypto";
import {
  db,
  storyDeskBoards,
  storyDeskBoxExports,
  storyDeskBriefVersions,
  storyDeskClients,
  storyDeskContextSnapshots,
  storyDeskDecisions,
  storyDeskGateReports,
  storyDeskIdempotency,
  storyDeskClientIdentities,
  storyDeskJobEvents,
  storyDeskJobs,
} from "../../../../../lib/db/src/index.js";
import { and, eq, sql } from "drizzle-orm";
import type {
  ApprovalSelection,
  BriefFields,
  BriefVersion,
  ClientRecord,
  JobRecord,
  JobState,
  NormalizedContext,
  Opportunity,
  OpportunityBoard,
  StoryDeskGateReport,
} from "./contracts.js";
import { StoryDeskError } from "./errors.js";
import type { ExportReceipt } from "./box.js";
import type { CreateJobResult, NewJob, StoryDeskStore } from "./store.js";

function toJob(row: typeof storyDeskJobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    goal: row.goal,
    requestHash: row.requestHash,
    idempotencyKey: row.idempotencyKey,
    contextSourceType: row.contextSourceType as JobRecord["contextSourceType"],
    state: row.state as JobState,
    contextSnapshotId: row.contextSnapshotId ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorDetails: row.errorDetails ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresStoryDeskStore implements StoryDeskStore {
  async authenticateOAuthIdentity(authSubject: string, oauthClientId: string): Promise<ClientRecord | undefined> {
    const [row] = await db.select({
      id: storyDeskClients.id,
      name: storyDeskClients.name,
      boxFolderId: storyDeskClients.boxFolderId,
    }).from(storyDeskClientIdentities)
      .innerJoin(storyDeskClients, eq(storyDeskClientIdentities.clientId, storyDeskClients.id))
      .where(and(
        eq(storyDeskClientIdentities.authSubject, authSubject),
        eq(storyDeskClientIdentities.oauthClientId, oauthClientId),
        eq(storyDeskClientIdentities.active, true),
        eq(storyDeskClients.active, true),
      )).limit(1);
    return row ? {
      id: row.id,
      name: row.name,
      boxFolderId: row.boxFolderId ?? undefined,
      authSubject,
      oauthClientId,
    } : undefined;
  }

  async createJob(input: NewJob): Promise<CreateJobResult> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.clientId}:${input.idempotencyKey}`}))`);
      const [existing] = await tx.select().from(storyDeskIdempotency).where(and(
        eq(storyDeskIdempotency.clientId, input.clientId),
        eq(storyDeskIdempotency.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new StoryDeskError(
            "idempotency_conflict",
            "This idempotency key was already used for a different request.",
            409,
          );
        }
        const [job] = await tx.select().from(storyDeskJobs).where(and(
          eq(storyDeskJobs.clientId, input.clientId),
          eq(storyDeskJobs.id, existing.jobId),
        )).limit(1);
        if (!job) throw new StoryDeskError("invalid_state", "Idempotency record points to a missing job.", 500);
        return { job: toJob(job), existing: true };
      }

      const id = randomUUID();
      const [job] = await tx.insert(storyDeskJobs).values({
        id,
        clientId: input.clientId,
        goal: input.goal,
        requestHash: input.requestHash,
        idempotencyKey: input.idempotencyKey,
        contextSourceType: input.contextSourceType,
        constraints: input.constraints,
        state: "received",
      }).returning();
      await tx.insert(storyDeskIdempotency).values({
        clientId: input.clientId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        jobId: id,
      });
      return { job: toJob(job), existing: false };
    });
  }

  async getJob(clientId: string, jobId: string): Promise<JobRecord | undefined> {
    const [row] = await db.select().from(storyDeskJobs).where(and(
      eq(storyDeskJobs.clientId, clientId),
      eq(storyDeskJobs.id, jobId),
    )).limit(1);
    return row ? toJob(row) : undefined;
  }

  async updateJob(
    clientId: string,
    jobId: string,
    state: JobState,
    options: { contextSnapshotId?: string; errorCode?: string; errorDetails?: Record<string, unknown> } = {},
  ): Promise<void> {
    const rows = await db.update(storyDeskJobs).set({
      state,
      updatedAt: new Date(),
      completedAt: state === "completed" ? new Date() : undefined,
      contextSnapshotId: options.contextSnapshotId,
      errorCode: options.errorCode ?? null,
      errorDetails: options.errorDetails ?? null,
    }).where(and(eq(storyDeskJobs.clientId, clientId), eq(storyDeskJobs.id, jobId))).returning({ id: storyDeskJobs.id });
    if (rows.length === 0) throw new StoryDeskError("not_found", "Job not found.", 404);
  }

  async saveContextSnapshot(clientId: string, jobId: string, context: NormalizedContext): Promise<string> {
    const id = randomUUID();
    await db.insert(storyDeskContextSnapshots).values({
      id,
      clientId,
      jobId,
      content: context.files as Record<string, string>,
      contentHash: context.contentHash,
    });
    return id;
  }

  async getContextSnapshot(clientId: string, jobId: string): Promise<NormalizedContext | undefined> {
    const [row] = await db.select({
      content: storyDeskContextSnapshots.content,
      contentHash: storyDeskContextSnapshots.contentHash,
    }).from(storyDeskContextSnapshots).where(and(
      eq(storyDeskContextSnapshots.clientId, clientId),
      eq(storyDeskContextSnapshots.jobId, jobId),
    )).limit(1);
    return row ? {
      files: row.content,
      contentHash: row.contentHash,
    } as NormalizedContext : undefined;
  }

  async appendEvent(clientId: string, jobId: string, type: string, payload = {}): Promise<void> {
    await db.insert(storyDeskJobEvents).values({ clientId, jobId, type, payload });
  }

  async saveBoard(clientId: string, board: OpportunityBoard): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(storyDeskBoards).values({
        id: board.id,
        clientId,
        jobId: board.jobId,
        title: board.title,
        opportunities: board.opportunities,
        body: board.body,
        contentHash: board.contentHash,
      });
      if (board.briefs.length > 0) {
        await tx.insert(storyDeskBriefVersions).values(board.briefs.map((brief) => ({
          id: brief.id,
          clientId,
          jobId: board.jobId,
          boardId: board.id,
          briefId: brief.briefId,
          opportunityId: brief.opportunityId,
          version: brief.version,
          fields: brief.fields as unknown as Record<string, unknown>,
          body: brief.body,
          contentHash: brief.contentHash,
          current: true,
        })));
      }
      if (board.gateReports.length > 0) {
        await tx.insert(storyDeskGateReports).values(board.gateReports.map((report) => ({
          id: report.id,
          clientId,
          jobId: board.jobId,
          briefVersionId: report.briefVersionId,
          mode: report.mode,
          criteria: report.criteria,
          total: report.total,
          disposition: report.disposition,
          notes: report.notes,
        })));
      }
    });
  }

  async getBoard(clientId: string, jobId: string): Promise<OpportunityBoard | undefined> {
    const [board] = await db.select().from(storyDeskBoards).where(and(
      eq(storyDeskBoards.clientId, clientId),
      eq(storyDeskBoards.jobId, jobId),
    )).limit(1);
    if (!board) return undefined;
    const [briefRows, reportRows] = await Promise.all([
      db.select().from(storyDeskBriefVersions).where(and(
        eq(storyDeskBriefVersions.clientId, clientId),
        eq(storyDeskBriefVersions.jobId, jobId),
        eq(storyDeskBriefVersions.current, true),
      )),
      db.select().from(storyDeskGateReports).where(and(
        eq(storyDeskGateReports.clientId, clientId),
        eq(storyDeskGateReports.jobId, jobId),
      )),
    ]);
    const briefs: BriefVersion[] = briefRows.map((row) => ({
      id: row.id,
      briefId: row.briefId,
      opportunityId: row.opportunityId,
      version: row.version,
      fields: row.fields as unknown as BriefFields,
      body: row.body,
      contentHash: row.contentHash,
    }));
    const gateReports: StoryDeskGateReport[] = reportRows.map((row) => ({
      id: row.id,
      briefVersionId: row.briefVersionId,
      mode: "story_desk_commissioning",
      criteria: row.criteria as StoryDeskGateReport["criteria"],
      total: row.total,
      disposition: row.disposition as StoryDeskGateReport["disposition"],
      notes: row.notes,
    }));
    return {
      id: board.id,
      jobId: board.jobId,
      title: board.title,
      opportunities: board.opportunities as Opportunity[],
      briefs,
      gateReports,
      body: board.body,
      contentHash: board.contentHash,
    };
  }

  async saveExportReceipts(clientId: string, jobId: string, receipts: ExportReceipt[]): Promise<void> {
    if (receipts.length === 0) return;
    await db.insert(storyDeskBoxExports).values(receipts.map((receipt) => ({
      id: randomUUID(),
      clientId,
      jobId,
      artifactType: receipt.artifactType,
      artifactId: receipt.artifactId,
      version: receipt.version,
      contentHash: receipt.contentHash,
      boxFileId: receipt.boxFileId,
      exportHash: receipt.exportHash,
    }))).onConflictDoNothing();
  }

  async hasExportReceipt(
    clientId: string,
    jobId: string,
    artifact: { artifactType: "opportunity_board" | "brief"; artifactId: string; version: number; contentHash: string },
  ): Promise<boolean> {
    const [row] = await db.select({ id: storyDeskBoxExports.id }).from(storyDeskBoxExports).where(and(
      eq(storyDeskBoxExports.clientId, clientId),
      eq(storyDeskBoxExports.jobId, jobId),
      eq(storyDeskBoxExports.artifactType, artifact.artifactType),
      eq(storyDeskBoxExports.artifactId, artifact.artifactId),
      eq(storyDeskBoxExports.version, artifact.version),
      eq(storyDeskBoxExports.contentHash, artifact.contentHash),
    )).limit(1);
    return Boolean(row);
  }

  async decideBriefs(
    clientId: string,
    actorId: string,
    jobId: string,
    selections: ApprovalSelection[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      for (const selection of selections) {
        const result = await tx.execute(sql<{
          brief_id: string;
          version: number;
          content_hash: string;
        }>`select brief_id, version, content_hash from story_desk_brief_versions
           where client_id = ${clientId} and job_id = ${jobId}
             and brief_id = ${selection.brief_id} and current = true
           for update`);
        const current = result.rows[0];
        if (!current || current.version !== selection.version || current.content_hash !== selection.content_hash) {
          throw new StoryDeskError("version_conflict", "Brief version or hash does not match the current stored version.", 409, {
            brief_id: selection.brief_id,
          });
        }
      }
      await tx.insert(storyDeskDecisions).values(selections.map((selection) => ({
        id: randomUUID(),
        clientId,
        jobId,
        briefId: selection.brief_id,
        version: selection.version,
        contentHash: selection.content_hash,
        decision: selection.decision,
        actorId,
      })));
    });
  }
}
