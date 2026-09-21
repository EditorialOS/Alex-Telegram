import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoryDeskModelConfig } from "../src/lib/storyDesk/gatewayModel.js";

test("Story Desk prefers Vercel AI Gateway when it is configured", () => {
  const config = resolveStoryDeskModelConfig({
    AI_GATEWAY_API_KEY: "gateway-secret",
    VERCEL_OIDC_TOKEN: "oidc-token",
    ANTHROPIC_API_KEY: "direct-secret",
  });

  assert.deepEqual(config, {
    provider: "vercel-ai-gateway",
    apiKey: "gateway-secret",
    baseURL: "https://ai-gateway.vercel.sh",
    model: "anthropic/claude-opus-4.6",
  });
});

test("Story Desk accepts an explicit gateway URL and model", () => {
  const config = resolveStoryDeskModelConfig({
    AI_GATEWAY_API_KEY: "gateway-secret",
    AI_GATEWAY_BASE_URL: "https://gateway.example.test",
    STORY_DESK_MODEL: "anthropic/claude-opus-4.5",
  });

  assert.equal(config.provider, "vercel-ai-gateway");
  assert.equal(config.baseURL, "https://gateway.example.test");
  assert.equal(config.model, "anthropic/claude-opus-4.5");
});

test("Story Desk uses the Vercel deployment OIDC token without another secret", () => {
  const config = resolveStoryDeskModelConfig({
    VERCEL_OIDC_TOKEN: "short-lived-oidc-token",
  });

  assert.equal(config.provider, "vercel-ai-gateway");
  assert.equal(config.apiKey, "short-lived-oidc-token");
  assert.equal(config.baseURL, "https://ai-gateway.vercel.sh");
});

test("Story Desk retains a direct Anthropic path for local validation", () => {
  const config = resolveStoryDeskModelConfig({
    ANTHROPIC_API_KEY: "direct-secret",
  });

  assert.deepEqual(config, {
    provider: "anthropic",
    apiKey: "direct-secret",
    model: "claude-opus-4-6",
  });
});

test("Story Desk model configuration fails closed without credentials", () => {
  assert.throws(() => resolveStoryDeskModelConfig({}), /VERCEL_OIDC_TOKEN/);
});
