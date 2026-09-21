import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.js";
import { storyDeskResourceMetadata } from "./lib/storyDesk/auth.js";
import healthRouter from "./routes/health.js";
import storyDeskMcpRouter from "./routes/storyDeskMcp.js";
import storyDeskOauthRouter from "./routes/storyDeskOauth.js";

function publicDirectory(): string {
  const candidate = path.resolve(process.cwd(), "public");
  return process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..", "public")
    : candidate;
}

function oauthProtectedResource(_req: Request, res: Response): void {
  try {
    res.json(storyDeskResourceMetadata());
  } catch (error) {
    res.status(503).json({
      error: "authentication_not_configured",
      message:
        error instanceof Error ? error.message : "OAuth is not configured.",
    });
  }
}

export function createStoryDeskApp(app: Express = express()): Express {
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(cors());

  app.get("/.well-known/oauth-protected-resource", oauthProtectedResource);
  app.get(
    "/.well-known/oauth-protected-resource/api/mcp",
    oauthProtectedResource,
  );

  // Vercel serves public/ from its CDN. This keeps the same asset available
  // when the narrow app is run directly for local validation.
  app.use(express.static(publicDirectory()));

  app.use(express.json({ limit: "2mb" }));

  // This deployment surface intentionally omits Telegram, Slack, and admin
  // routers. They remain in the legacy app but cannot be reached through this
  // app.
  app.use("/api", healthRouter);
  app.use("/api", storyDeskMcpRouter);
  app.use("/api", storyDeskOauthRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      logger.error(
        { error, method: req.method, path: req.path },
        "Story Desk request failed",
      );
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
