import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const storyDeskClients = pgTable("story_desk_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  boxFolderId: text("box_folder_id"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storyDeskClientIdentities = pgTable(
  "story_desk_client_identities",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    authSubject: text("auth_subject").notNull(),
    oauthClientId: text("oauth_client_id").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("story_desk_identity_subject_oauth_client_idx").on(table.authSubject, table.oauthClientId),
    index("story_desk_identity_client_idx").on(table.clientId),
  ],
);

export const storyDeskJobs = pgTable(
  "story_desk_jobs",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    goal: text("goal").notNull(),
    requestHash: text("request_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    contextSourceType: text("context_source_type").notNull(),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().default({}).notNull(),
    state: text("state").notNull(),
    contextSnapshotId: text("context_snapshot_id"),
    errorCode: text("error_code"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("story_desk_jobs_client_idempotency_idx").on(table.clientId, table.idempotencyKey),
    index("story_desk_jobs_client_state_idx").on(table.clientId, table.state),
  ],
);

export const storyDeskContextSnapshots = pgTable(
  "story_desk_context_snapshots",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    content: jsonb("content").$type<Record<string, string>>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("story_desk_context_job_idx").on(table.clientId, table.jobId)],
);

export const storyDeskBoards = pgTable(
  "story_desk_boards",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    title: text("title").notNull(),
    opportunities: jsonb("opportunities").$type<unknown[]>().notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("story_desk_boards_client_job_idx").on(table.clientId, table.jobId)],
);

export const storyDeskBriefVersions = pgTable(
  "story_desk_brief_versions",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    boardId: text("board_id").notNull().references(() => storyDeskBoards.id),
    briefId: text("brief_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    version: integer("version").notNull(),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    current: boolean("current").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("story_desk_brief_version_idx").on(table.clientId, table.briefId, table.version),
    index("story_desk_brief_current_idx").on(table.clientId, table.briefId, table.current),
  ],
);

export const storyDeskGateReports = pgTable(
  "story_desk_gate_reports",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    briefVersionId: text("brief_version_id").notNull().references(() => storyDeskBriefVersions.id),
    mode: text("mode").notNull(),
    criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull(),
    total: integer("total").notNull(),
    disposition: text("disposition").notNull(),
    notes: text("notes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("story_desk_gate_once_idx").on(table.clientId, table.briefVersionId, table.mode)],
);

export const storyDeskDecisions = pgTable(
  "story_desk_decisions",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    briefId: text("brief_id").notNull(),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    decision: text("decision").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("story_desk_decisions_client_brief_idx").on(table.clientId, table.briefId)],
);

export const storyDeskJobEvents = pgTable(
  "story_desk_job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("story_desk_events_client_job_idx").on(table.clientId, table.jobId)],
);

export const storyDeskBoxExports = pgTable(
  "story_desk_box_exports",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    artifactType: text("artifact_type").notNull(),
    artifactId: text("artifact_id").notNull(),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    boxFileId: text("box_file_id").notNull(),
    exportHash: text("export_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("story_desk_box_export_idx").on(
      table.clientId,
      table.artifactType,
      table.artifactId,
      table.version,
      table.exportHash,
    ),
    index("story_desk_box_exports_client_job_idx").on(table.clientId, table.jobId),
  ],
);

export const storyDeskIdempotency = pgTable(
  "story_desk_idempotency",
  {
    clientId: text("client_id").notNull().references(() => storyDeskClients.id),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    jobId: text("job_id").notNull().references(() => storyDeskJobs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.idempotencyKey] })],
);
