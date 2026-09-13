import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ContextResolver,
  resolveUploadedFiles,
} from "../src/lib/storyDesk/contextResolver.ts";
import { StoryDeskError } from "../src/lib/storyDesk/errors.ts";
import { StoryDeskDownloadSigner } from "../src/lib/storyDesk/downloads.ts";
import { dispositionFor, StoryDeskWorkers, type StoryDeskModel } from "../src/lib/storyDesk/workers.ts";
import { StoryDeskService } from "../src/lib/storyDesk/service.ts";
import { storyDeskResourceMetadata } from "../src/lib/storyDesk/auth.ts";
import { buildStoryDeskMcpServer } from "../src/lib/storyDesk/mcpServer.ts";
import type {
  ApprovalSelection,
  ClientRecord,
  CreateOpportunityBoardInput,
  JobRecord,
  JobState,
  NormalizedContext,
  OpportunityBoard,
} from "../src/lib/storyDesk/contracts.ts";
import type { ExportAdapter, ExportArtifact, ExportReceipt } from "../src/lib/storyDesk/box.ts";
import type { CreateJobResult, NewJob, StoryDeskStore } from "../src/lib/storyDesk/store.ts";
import type { VerifiedSkills } from "../src/lib/storyDesk/sourceBundle.ts";

const clientA: ClientRecord = { id: "client-a", name: "Client A", boxFolderId: "box-a" };
const clientB: ClientRecord = { id: "client-b", name: "Client B", boxFolderId: "box-b" };

function downloadSigner(ttlSeconds = 3600): StoryDeskDownloadSigner {
  return new StoryDeskDownloadSigner({
    secret: "test-download-secret-that-is-long-enough-for-production",
    origin: "https://story.example.com",
    ttlSeconds,
  });
}

const sourceSkills: VerifiedSkills = {
  osVersion: "2.0.0",
  contractVersion: "1.0.0",
  orchestrator: "ORCHESTRATOR",
  storyCommissioner: "STORY COMMISSIONER",
  contentStrategist: "CONTENT STRATEGIST",
  editorialGate: "EDITORIAL GATE DEFAULT",
  editorialVoice: "EDITORIAL VOICE",
  storyDeskGateContract: "story_desk_commissioning five criteria",
};

function contextFiles() {
  return [
    { name: "brand-voice.md", media_type: "text/markdown" as const, content_utf8: "Clear and restrained.\r\n" },
    { name: "content-pillars.md", media_type: "text/markdown" as const, content_utf8: "Design systems\n" },
    { name: "audience-personas.md", media_type: "text/plain" as const, content_utf8: "Editorial leaders\n" },
  ];
}

function opportunityPayload() {
  return {
    opportunities: Array.from({ length: 8 }, (_, index) => ({
      id: `opp-${index + 1}`,
      title: `Opportunity ${index + 1}`,
      angle: `A specific angle ${index + 1}`,
      audience: "Editorial leaders",
      channel: "Web",
      format: "Feature",
      why_now: "A current business moment",
      sources: ["Client context pack"],
      stretch: index === 0,
      reliable: index === 1,
      audience_demand: 4,
      editorial_differentiation: 4,
      production_feasibility: 4,
    })),
  };
}

function briefPayload() {
  return {
    briefs: Array.from({ length: 4 }, (_, index) => ({
      opportunity_id: `opp-${index + 1}`,
      title: `Brief ${index + 1}`,
      angle: `Commissionable angle ${index + 1}`,
      audience: "Editorial leaders",
      why_they_care: "It reduces editorial coordination cost.",
      sources: ["Client context pack"],
      format: "Feature",
      length: "1,200 words",
      channel: "Web",
      pillar: "Design systems",
      tone: "Clear and restrained",
      deadline: "2026-10-01",
      success_criteria: "Ten qualified replies",
      outline: [{ heading: "Opening", purpose: "Establish the stakes" }],
      self_assessment: { private_note: "must not reach Gate" },
    })),
  };
}

function gatePayload(score = 4) {
  return {
    criteria: Object.fromEntries([
      "audience_fit",
      "editorial_distinctiveness",
      "brand_fit",
      "source_sufficiency",
      "channel_fit",
    ].map((name) => [name, { score, notes: `${name} evidence` }])),
    notes: "Commissioning guidance",
  };
}

class ScriptedModel implements StoryDeskModel {
  outputs: string[];
  calls: Array<{ system: string; user: string }> = [];

  constructor(outputs: unknown[]) {
    this.outputs = outputs.map((value) => JSON.stringify(value));
  }

  async generate(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    const output = this.outputs.shift();
    if (!output) throw new Error("No scripted model response left");
    return output;
  }
}

class MemoryStore implements StoryDeskStore {
  clients = new Map<string, ClientRecord>();
  jobs = new Map<string, JobRecord>();
  keys = new Map<string, { requestHash: string; jobId: string }>();
  contexts = new Map<string, NormalizedContext>();
  boards = new Map<string, { clientId: string; board: OpportunityBoard }>();
  events: Array<{ clientId: string; jobId: string; type: string }> = [];
  decisions: Array<{ clientId: string; selection: ApprovalSelection }> = [];
  exports: Array<{ clientId: string; jobId: string; receipt: ExportReceipt }> = [];

  async authenticateOAuthIdentity(authSubject: string, oauthClientId: string): Promise<ClientRecord | undefined> {
    return this.clients.get(`${authSubject}:${oauthClientId}`);
  }

  async createJob(input: NewJob): Promise<CreateJobResult> {
    const key = `${input.clientId}:${input.idempotencyKey}`;
    const existing = this.keys.get(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new StoryDeskError("idempotency_conflict", "different request", 409);
      }
      return { job: this.jobs.get(existing.jobId)!, existing: true };
    }
    const now = new Date();
    const job: JobRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      goal: input.goal,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
      contextSourceType: input.contextSourceType,
      state: "received",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.keys.set(key, { requestHash: input.requestHash, jobId: job.id });
    return { job, existing: false };
  }

  async getJob(clientId: string, jobId: string): Promise<JobRecord | undefined> {
    const job = this.jobs.get(jobId);
    return job?.clientId === clientId ? job : undefined;
  }

  async updateJob(
    clientId: string,
    jobId: string,
    state: JobState,
    options: { contextSnapshotId?: string; errorCode?: string; errorDetails?: Record<string, unknown> } = {},
  ): Promise<void> {
    const job = await this.getJob(clientId, jobId);
    if (!job) throw new StoryDeskError("not_found", "job", 404);
    delete job.errorCode;
    delete job.errorDetails;
    Object.assign(job, options, { state, updatedAt: new Date() });
  }

  async saveContextSnapshot(clientId: string, jobId: string, context: NormalizedContext): Promise<string> {
    if (!(await this.getJob(clientId, jobId))) throw new StoryDeskError("not_found", "job", 404);
    const id = randomUUID();
    this.contexts.set(`${clientId}:${jobId}`, structuredClone(context));
    return id;
  }

  async getContextSnapshot(clientId: string, jobId: string): Promise<NormalizedContext | undefined> {
    return this.contexts.get(`${clientId}:${jobId}`);
  }

  async appendEvent(clientId: string, jobId: string, type: string): Promise<void> {
    this.events.push({ clientId, jobId, type });
  }

  async saveBoard(clientId: string, board: OpportunityBoard): Promise<void> {
    this.boards.set(board.jobId, { clientId, board: structuredClone(board) });
  }

  async getBoard(clientId: string, jobId: string): Promise<OpportunityBoard | undefined> {
    const stored = this.boards.get(jobId);
    return stored?.clientId === clientId ? structuredClone(stored.board) : undefined;
  }

  async saveExportReceipts(clientId: string, jobId: string, receipts: ExportReceipt[]): Promise<void> {
    this.exports.push(...receipts.map((receipt) => ({ clientId, jobId, receipt })));
  }

  async hasExportReceipt(
    clientId: string,
    jobId: string,
    artifact: { artifactType: "opportunity_board" | "brief"; artifactId: string; version: number; contentHash: string },
  ): Promise<boolean> {
    return this.exports.some((entry) =>
      entry.clientId === clientId &&
      entry.jobId === jobId &&
      entry.receipt.artifactType === artifact.artifactType &&
      entry.receipt.artifactId === artifact.artifactId &&
      entry.receipt.version === artifact.version &&
      entry.receipt.contentHash === artifact.contentHash
    );
  }

  async decideBriefs(
    clientId: string,
    _actorId: string,
    jobId: string,
    selections: ApprovalSelection[],
  ): Promise<void> {
    const board = await this.getBoard(clientId, jobId);
    if (!board) throw new StoryDeskError("not_found", "board", 404);
    for (const selection of selections) {
      const brief = board.briefs.find((item) => item.briefId === selection.brief_id);
      if (!brief || brief.version !== selection.version || brief.contentHash !== selection.content_hash) {
        throw new StoryDeskError("version_conflict", "stale", 409);
      }
      this.decisions.push({ clientId, selection });
    }
  }
}

class FakeExporter implements ExportAdapter {
  calls: ExportArtifact[][] = [];
  async export(_client: ClientRecord, _jobId: string, artifacts: ExportArtifact[]): Promise<ExportReceipt[]> {
    this.calls.push(artifacts);
    return artifacts.map((artifact) => ({
      artifactType: artifact.artifactType,
      artifactId: artifact.artifactId,
      version: artifact.version,
      contentHash: artifact.contentHash,
      boxFileId: `box-${artifact.artifactId}`,
      exportHash: createHash("sha256").update(artifact.body).digest("hex"),
    }));
  }
}

function createInput(key = "request-1"): CreateOpportunityBoardInput {
  return {
    goal: "Build category authority",
    idempotency_key: key,
    context_source: { type: "uploaded_files", files: contextFiles() },
    channels: ["Web"],
  };
}

test("uploaded context normalizes, hashes and reports exact missing filenames", () => {
  const resolved = resolveUploadedFiles(contextFiles());
  assert.equal(resolved.files["brand-voice.md"], "Clear and restrained.\n");
  assert.match(resolved.contentHash, /^[a-f0-9]{64}$/);
  assert.throws(
    () => resolveUploadedFiles(contextFiles().slice(0, 2)),
    (error: unknown) => {
      assert.ok(error instanceof StoryDeskError);
      assert.equal(error.code, "needs_context");
      assert.deepEqual(error.details?.missing_files, ["audience-personas.md"]);
      return true;
    },
  );
});

test("OAuth protected-resource metadata binds ChatGPT tokens to the exact MCP audience", () => {
  const previousIssuer = process.env.SUPABASE_AUTH_ISSUER;
  const previousResource = process.env.STORY_DESK_RESOURCE_URL;
  process.env.SUPABASE_AUTH_ISSUER = "https://project.supabase.co/auth/v1";
  process.env.STORY_DESK_RESOURCE_URL = "https://story.example.com/api/mcp";
  try {
    assert.deepEqual(storyDeskResourceMetadata(), {
      resource: "https://story.example.com/api/mcp",
      authorization_servers: ["https://project.supabase.co/auth/v1"],
      scopes_supported: ["email"],
      bearer_methods_supported: ["header"],
    });
  } finally {
    if (previousIssuer === undefined) delete process.env.SUPABASE_AUTH_ISSUER;
    else process.env.SUPABASE_AUTH_ISSUER = previousIssuer;
    if (previousResource === undefined) delete process.env.STORY_DESK_RESOURCE_URL;
    else process.env.STORY_DESK_RESOURCE_URL = previousResource;
  }
});

test("MCP surface exposes only the four V.1 operations and marks each OAuth-protected", async () => {
  const server = buildStoryDeskMcpServer({} as StoryDeskService, clientA);
  const mcpClient = new Client({ name: "story-desk-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  try {
    const response = await mcpClient.listTools();
    assert.deepEqual(response.tools.map((tool) => tool.name).sort(), [
      "alex.approve_briefs",
      "alex.create_opportunity_board",
      "alex.get_job_status",
      "alex.get_opportunity_board",
    ]);
    for (const tool of response.tools) {
      assert.deepEqual(tool._meta?.securitySchemes, [{ type: "oauth2", scopes: ["email"] }]);
    }
  } finally {
    await Promise.all([mcpClient.close(), server.close()]);
  }
});

test("commissioning Gate derives the authoritative score once and excludes self-assessment", async () => {
  const model = new ScriptedModel([gatePayload(4)]);
  const workers = new StoryDeskWorkers(model);
  const briefsModel = new ScriptedModel([briefPayload()]);
  const briefs = await new StoryDeskWorkers(briefsModel).developBriefs(
    "goal",
    opportunityPayload().opportunities.slice(0, 4).map((item, index) => ({
      id: item.id,
      title: item.title,
      angle: item.angle,
      audience: item.audience,
      channel: item.channel,
      format: item.format,
      whyNow: item.why_now,
      sources: item.sources,
      stretch: item.stretch,
      reliable: item.reliable,
      audienceDemand: 4,
      editorialDifferentiation: 4,
      productionFeasibility: 4,
      total: 12,
      rank: index + 1,
    })),
    resolveUploadedFiles(contextFiles()),
    sourceSkills,
  );
  const report = await workers.evaluateBrief(briefs[0], resolveUploadedFiles(contextFiles()), sourceSkills);
  assert.equal(report.total, 20);
  assert.equal(report.disposition, "ready_to_commission");
  assert.equal(model.calls.length, 1);
  assert.doesNotMatch(model.calls[0].user, /private_note|self_assessment/);
});

test("commissioning Gate threshold boundaries are deterministic", () => {
  assert.equal(dispositionFor(16), "do_not_commission");
  assert.equal(dispositionFor(17), "commission_with_review");
  assert.equal(dispositionFor(19), "commission_with_review");
  assert.equal(dispositionFor(20), "ready_to_commission");
  assert.equal(dispositionFor(25), "ready_to_commission");
});

test("inline download links are signed, tenant-bound and expire", () => {
  const signer = downloadSigner(60);
  const now = Date.parse("2026-09-12T20:00:00.000Z");
  const board: OpportunityBoard = {
    id: "board-a",
    jobId: "job-a",
    title: "Alex Story Desk — Launch",
    opportunities: [],
    briefs: [],
    gateReports: [],
    body: "# Board\n",
    contentHash: "a".repeat(64),
  };
  const [link] = signer.createLinks(clientA.id, board, now);
  const url = new URL(link.url);
  const payload = signer.verify(url.searchParams.get("token") ?? undefined, url.searchParams.get("signature") ?? undefined, now);
  assert.equal(payload.clientId, clientA.id);
  assert.equal(payload.jobId, board.jobId);
  assert.throws(
    () => signer.verify(url.searchParams.get("token") ?? undefined, "tampered", now),
    (error: unknown) => error instanceof StoryDeskError && error.code === "invalid_download",
  );
  assert.throws(
    () => signer.verify(url.searchParams.get("token") ?? undefined, url.searchParams.get("signature") ?? undefined, now + 61_000),
    (error: unknown) => error instanceof StoryDeskError && error.code === "download_expired",
  );
});

test("end-to-end service is idempotent, tenant-isolated and version-binds decisions", async () => {
  const rankedIds = Array.from({ length: 8 }, (_, index) => `opp-${index + 1}`);
  const model = new ScriptedModel([
    opportunityPayload(),
    { ranked_ids: rankedIds },
    briefPayload(),
    gatePayload(4),
    gatePayload(4),
    gatePayload(4),
    gatePayload(4),
  ]);
  const store = new MemoryStore();
  const service = new StoryDeskService(
    store,
    new ContextResolver(),
    { load: async () => sourceSkills },
    new StoryDeskWorkers(model),
    downloadSigner(),
  );

  const first = await service.createOpportunityBoard(clientA, createInput());
  assert.equal(first.job.state, "completed");
  assert.equal(first.board?.opportunities.length, 8);
  assert.equal(first.board?.briefs.length, 4);
  assert.equal(first.board?.gateReports.length, 4);
  assert.equal(model.calls.filter((call) => call.system.includes("story_desk_commissioning")).length, 4);
  assert.equal(first.board?.downloads.length, 5);
  assert.ok(first.board?.downloads.every((item) => item.url.startsWith("https://story.example.com/api/story-desk/download?")));
  assert.equal(first.job.error, undefined);

  const replay = await service.createOpportunityBoard(clientA, createInput());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(model.calls.length, 7);

  await assert.rejects(
    service.createOpportunityBoard(clientA, { ...createInput(), goal: "Different goal" }),
    (error: unknown) => error instanceof StoryDeskError && error.code === "idempotency_conflict",
  );
  await assert.rejects(
    service.getOpportunityBoard(clientB, first.job.jobId),
    (error: unknown) => error instanceof StoryDeskError && error.code === "not_found",
  );

  const brief = first.board!.briefs[0];
  await assert.rejects(
    service.approveBriefs(clientB, "supabase:user-b", {
      job_id: first.job.jobId,
      selections: [{
        brief_id: brief.briefId,
        version: brief.version,
        content_hash: brief.contentHash,
        decision: "approved",
      }],
    }),
    (error: unknown) => error instanceof StoryDeskError && error.code === "not_found",
  );
  await service.approveBriefs(clientA, "chatgpt:client-a", {
    job_id: first.job.jobId,
    selections: [{
      brief_id: brief.briefId,
      version: brief.version,
      content_hash: brief.contentHash,
      decision: "approved",
    }],
  });
  assert.equal(store.decisions.length, 1);
  await assert.rejects(
    service.approveBriefs(clientA, "chatgpt:client-a", {
      job_id: first.job.jobId,
      selections: [{
        brief_id: brief.briefId,
        version: brief.version,
        content_hash: "0".repeat(64),
        decision: "rejected",
      }],
    }),
    (error: unknown) => error instanceof StoryDeskError && error.code === "version_conflict",
  );
});

test("an interrupted job resumes from its persisted context snapshot", async () => {
  const store = new MemoryStore();
  const input = createInput("restart-key");
  const requestHash = createHash("sha256").update("placeholder").digest("hex");
  // Let the service establish the canonical idempotency hash, then interrupt at source loading.
  const failing = new StoryDeskService(
    store,
    new ContextResolver(),
    { load: async () => { throw new StoryDeskError("source_integrity_failed", "interrupted", 500); } },
    new StoryDeskWorkers(new ScriptedModel([])),
    downloadSigner(),
  );
  await assert.rejects(failing.createOpportunityBoard(clientA, input));
  const interrupted = [...store.jobs.values()][0];
  assert.ok(await store.getContextSnapshot(clientA.id, interrupted.id));
  assert.notEqual(interrupted.requestHash, requestHash);

  const model = new ScriptedModel([
    opportunityPayload(),
    { ranked_ids: Array.from({ length: 8 }, (_, index) => `opp-${index + 1}`) },
    briefPayload(),
    gatePayload(5), gatePayload(5), gatePayload(5), gatePayload(5),
  ]);
  const resumed = new StoryDeskService(
    store,
    new ContextResolver(),
    { load: async () => sourceSkills },
    new StoryDeskWorkers(model),
    downloadSigner(),
  );
  const result = await resumed.createOpportunityBoard(clientA, input);
  assert.equal(result.job.jobId, interrupted.id);
  assert.equal(result.job.state, "completed");
  assert.equal(result.idempotentReplay, true);
});
