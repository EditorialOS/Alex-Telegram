import Anthropic from "@anthropic-ai/sdk";

// Works on Replit (via the AI_INTEGRATIONS_ANTHROPIC_* proxy vars) and off
// Replit (a plain ANTHROPIC_API_KEY against the default api.anthropic.com).
const apiKey =
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error(
    "Set ANTHROPIC_API_KEY (self-hosted) or AI_INTEGRATIONS_ANTHROPIC_API_KEY (Replit AI integration).",
  );
}

// Base URL is optional: when unset, the SDK talks directly to Anthropic.
const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;

export const anthropic = new Anthropic({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});
