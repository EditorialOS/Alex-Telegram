import { Router, type IRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PostgresStoryDeskStore } from "../lib/storyDesk/postgresStore.js";
import { ContextResolver } from "../lib/storyDesk/contextResolver.js";
import { StoryDeskDownloadSigner, resolveDownloadArtifact } from "../lib/storyDesk/downloads.js";
import { asStoryDeskError, StoryDeskError } from "../lib/storyDesk/errors.js";
import { VerifiedSkillLoader } from "../lib/storyDesk/sourceBundle.js";
import { StoryDeskWorkers } from "../lib/storyDesk/workers.js";
import { AnthropicStoryDeskModel } from "../lib/storyDesk/anthropicModel.js";
import { StoryDeskService } from "../lib/storyDesk/service.js";
import { storyDeskAuth, type StoryDeskRequest } from "../lib/storyDesk/auth.js";
import { buildStoryDeskMcpServer } from "../lib/storyDesk/mcpServer.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const store = new PostgresStoryDeskStore();
const downloads = new StoryDeskDownloadSigner();
const service = new StoryDeskService(
  store,
  new ContextResolver(),
  new VerifiedSkillLoader(),
  new StoryDeskWorkers(new AnthropicStoryDeskModel()),
  downloads,
);

router.get("/story-desk/download", async (req, res) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    const signature = typeof req.query.signature === "string" ? req.query.signature : undefined;
    const payload = downloads.verify(token, signature);
    const board = await store.getBoard(payload.clientId, payload.jobId);
    if (!board) throw new StoryDeskError("not_found", "Deliverable not found.", 404);
    const artifact = resolveDownloadArtifact(board, payload);
    const frontMatter = [
      "---",
      `job_id: ${payload.jobId}`,
      `artifact_id: ${payload.artifactId}`,
      `version: ${payload.version}`,
      `content_hash: ${artifact.contentHash}`,
      "---",
      "",
    ].join("\n");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(`${frontMatter}${artifact.body}`);
  } catch (error) {
    const storyError = asStoryDeskError(error);
    const exposed = ["invalid_download", "download_expired", "not_found"].includes(storyError.code);
    res.status(exposed ? storyError.status : 500).json({
      error: exposed ? storyError.code : "download_failed",
      message: exposed ? storyError.message : "The deliverable could not be downloaded.",
    });
  }
});

router.all("/mcp", storyDeskAuth(store), async (req: StoryDeskRequest, res) => {
  const client = req.storyDeskClient!;
  const server = buildStoryDeskMcpServer(service, client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error({ error, clientId: client.id }, "Story Desk MCP request failed");
    if (!res.headersSent) res.status(500).json({ error: "mcp_request_failed" });
  } finally {
    await server.close().catch(() => undefined);
  }
});

export default router;
