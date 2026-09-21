// Vercel's Express entrypoint. Keep this import narrow: the exported app does
// not mount the repository's legacy Telegram, Slack, or admin routes.
import express from "express";
import { createStoryDeskApp } from "./artifacts/api-server/src/storyDeskApp.js";

export default createStoryDeskApp(express());
