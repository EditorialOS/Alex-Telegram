import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { storyDeskResourceMetadata } from "./lib/storyDesk/auth.js";

const app: Express = express();

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
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());

function oauthProtectedResource(_req: Request, res: Response): void {
  try {
    res.json(storyDeskResourceMetadata());
  } catch (error) {
    res.status(503).json({
      error: "authentication_not_configured",
      message: error instanceof Error ? error.message : "OAuth is not configured.",
    });
  }
}

app.get("/.well-known/oauth-protected-resource", oauthProtectedResource);
app.get("/.well-known/oauth-protected-resource/api/mcp", oauthProtectedResource);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

app.use(
  express.json({
    // Uploaded Story Desk context is capped at 1 MiB after parsing. Allow JSON
    // escaping overhead here; the domain validator enforces the real limit.
    limit: "2mb",
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

app.use("/api", router);

export default app;
