import { createStoryDeskApp } from "./storyDeskApp.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env.PORT ?? "8080";
const port = Number(rawPort);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

createStoryDeskApp().listen(port, (error) => {
  if (error) {
    logger.error({ error }, "Error listening for Story Desk requests");
    process.exit(1);
  }
  logger.info({ port }, "Story Desk server listening");
});
