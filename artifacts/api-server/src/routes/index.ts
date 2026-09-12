import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import slackRouter from "./slack.js";
import slackOauthRouter from "./slackOauth.js";
import telegramRouter from "./telegram.js";
import adminRouter from "./admin.js";
import storyDeskMcpRouter from "./storyDeskMcp.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(slackOauthRouter);
router.use(slackRouter);
router.use(telegramRouter);
router.use(storyDeskMcpRouter);

export default router;
