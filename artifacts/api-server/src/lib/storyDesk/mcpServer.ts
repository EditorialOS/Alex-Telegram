import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ClientRecord, CreateOpportunityBoardInput } from "./contracts.js";
import { STORY_DESK_OAUTH_SCOPES } from "./auth.js";
import { asStoryDeskError } from "./errors.js";
import type { StoryDeskService } from "./service.js";

const contextSourceSchema = z.object({
  type: z.literal("uploaded_files"),
  files: z.array(z.object({
    name: z.string(),
    media_type: z.enum(["text/markdown", "text/plain"]),
    content_utf8: z.string(),
  })).max(6),
});

interface DownloadReference {
  filename: string;
  url: string;
}

function ok(result: unknown, summary: string, downloads: DownloadReference[] = []) {
  return {
    structuredContent: { result },
    content: [
      { type: "text" as const, text: summary },
      ...downloads.map((item) => ({
        type: "resource_link" as const,
        uri: item.url,
        name: item.filename,
        description: `Download ${item.filename}. This private link expires in one hour.`,
        mimeType: "text/markdown",
      })),
    ],
  };
}

function downloadSummary(downloads: Array<{ filename: string; url: string }> | undefined): string {
  if (!downloads?.length) return "";
  return `\n\nDownloads:\n${downloads.map((item) => `- [${item.filename}](${item.url})`).join("\n")}`;
}

function fail(error: unknown) {
  const storyError = asStoryDeskError(error);
  const body = { error: storyError.code, message: storyError.message, details: storyError.details };
  return {
    isError: true,
    structuredContent: { result: body },
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
  };
}

export function buildStoryDeskMcpServer(service: StoryDeskService, client: ClientRecord): McpServer {
  const server = new McpServer(
    { name: "alex-story-desk", version: "1.0.0" },
    {
      instructions:
        "Create a board before approving briefs. Always pass uploaded file contents, never local paths or arbitrary URLs. Approval requires the stored brief ID, version and hash returned by Alex Story Desk.",
    },
  );

  server.registerTool(
    "alex.create_opportunity_board",
    {
      title: "Create an Alex opportunity board",
      description:
        "Turn an editorial or business goal into 8–10 ranked story opportunities and 4–6 gated commission briefs. Supply explicit uploaded UTF-8 context contents. The result includes short-lived inline download links.",
      inputSchema: {
        goal: z.string().min(1),
        idempotency_key: z.string().min(1).max(200),
        context_source: contextSourceSchema,
        timing: z.string().optional(),
        campaign: z.string().optional(),
        channels: z.array(z.string()).optional(),
      },
      outputSchema: { result: z.unknown() },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [...STORY_DESK_OAUTH_SCOPES] }] },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await service.createOpportunityBoard(client, args as CreateOpportunityBoardInput);
        return ok(
          result,
          `Opportunity board job ${result.job.jobId} is ${result.job.state}.` +
            downloadSummary(result.board?.downloads),
          result.board?.downloads,
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "alex.get_opportunity_board",
    {
      title: "Get an Alex opportunity board",
      description: "Retrieve the authenticated client's saved opportunity board and exact current brief versions.",
      inputSchema: { job_id: z.string().min(1) },
      outputSchema: { result: z.unknown() },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [...STORY_DESK_OAUTH_SCOPES] }] },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ job_id }) => {
      try {
        const result = await service.getOpportunityBoard(client, job_id);
        return ok(
          result,
          `Retrieved opportunity board ${result.id}.` + downloadSummary(result.downloads),
          result.downloads,
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "alex.approve_briefs",
    {
      title: "Approve or reject Alex briefs",
      description:
        "Record immutable approval or rejection events for exact stored brief versions. Use only after showing the user the current brief IDs, versions, hashes and Gate dispositions.",
      inputSchema: {
        job_id: z.string().min(1),
        selections: z.array(z.object({
          brief_id: z.string().min(1),
          version: z.number().int().positive(),
          content_hash: z.string().regex(/^[a-f0-9]{64}$/),
          decision: z.enum(["approved", "rejected"]),
        })).min(1),
      },
      outputSchema: { result: z.unknown() },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [...STORY_DESK_OAUTH_SCOPES] }] },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await service.approveBriefs(client, `supabase:${client.authSubject ?? client.id}`, args);
        return ok(result, `Recorded ${result.recorded} brief decision(s).`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "alex.get_job_status",
    {
      title: "Get Alex Story Desk job status",
      description: "Check the authenticated client's Story Desk job state and safe error code.",
      inputSchema: { job_id: z.string().min(1) },
      outputSchema: { result: z.unknown() },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [...STORY_DESK_OAUTH_SCOPES] }] },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ job_id }) => {
      try {
        const result = await service.getJobStatus(client, job_id);
        return ok(result, `Story Desk job ${job_id} is ${result.state}.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
