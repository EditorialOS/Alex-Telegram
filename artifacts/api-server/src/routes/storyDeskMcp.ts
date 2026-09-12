import { Router, type IRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PostgresStoryDeskStore } from "../lib/storyDesk/postgresStore.js";
import { ContextResolver } from "../lib/storyDesk/contextResolver.js";
import { BoxAdapter } from "../lib/storyDesk/box.js";
import { VerifiedSkillLoader } from "../lib/storyDesk/sourceBundle.js";
import { StoryDeskWorkers } from "../lib/storyDesk/workers.js";
import { AnthropicStoryDeskModel } from "../lib/storyDesk/anthropicModel.js";
import { StoryDeskService } from "../lib/storyDesk/service.js";
import { storyDeskAuth, type StoryDeskRequest } from "../lib/storyDesk/auth.js";
import { buildStoryDeskMcpServer } from "../lib/storyDesk/mcpServer.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const store = new PostgresStoryDeskStore();
const box = new BoxAdapter();
const service = new StoryDeskService(
  store,
  new ContextResolver(box),
  new VerifiedSkillLoader(),
  new StoryDeskWorkers(new AnthropicStoryDeskModel()),
  box,
);

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
