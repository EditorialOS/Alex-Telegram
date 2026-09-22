import {
  createAnthropicMessagesClient,
  type AnthropicMessagesClient,
} from "../../../../../lib/integrations-anthropic-ai/src/messagesClient.js";
import type { StoryDeskModel } from "./workers.js";

const VERCEL_AI_GATEWAY_URL = "https://ai-gateway.vercel.sh";
const DEFAULT_DIRECT_MODEL = "claude-opus-4-6";
const DEFAULT_GATEWAY_MODEL = "anthropic/claude-opus-4.6";

type RuntimeEnvironment = Record<string, string | undefined>;

export interface StoryDeskModelConfig {
  provider: "vercel-ai-gateway" | "anthropic";
  apiKey: string;
  baseURL?: string;
  model: string;
}

function value(
  environment: RuntimeEnvironment,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}

/**
 * Vercel AI Gateway is the production preference. Direct Anthropic remains
 * available for local validation and never overrides an available gateway
 * configuration.
 */
export function resolveStoryDeskModelConfig(
  environment: RuntimeEnvironment = process.env,
): StoryDeskModelConfig {
  const configuredModel = value(environment, "STORY_DESK_MODEL");
  // Vercel injects a short-lived OIDC token into deployments. An explicit API
  // key remains useful off-platform and intentionally takes precedence.
  const gatewayKey =
    value(environment, "AI_GATEWAY_API_KEY") ??
    value(environment, "VERCEL_OIDC_TOKEN");
  if (gatewayKey) {
    return {
      provider: "vercel-ai-gateway",
      apiKey: gatewayKey,
      baseURL:
        value(environment, "AI_GATEWAY_BASE_URL") ?? VERCEL_AI_GATEWAY_URL,
      model: configuredModel ?? DEFAULT_GATEWAY_MODEL,
    };
  }

  const anthropicKey = value(environment, "ANTHROPIC_API_KEY");
  if (anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: configuredModel ?? DEFAULT_DIRECT_MODEL,
    };
  }

  throw new Error(
    "Use VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY for Vercel AI Gateway, or ANTHROPIC_API_KEY for local validation.",
  );
}

export class StoryDeskGatewayModel implements StoryDeskModel {
  private readonly client: AnthropicMessagesClient;
  private readonly model: string;

  constructor(
    config = resolveStoryDeskModelConfig(),
    client?: AnthropicMessagesClient,
  ) {
    this.model = config.model;
    this.client = client ?? createAnthropicMessagesClient(config);
  }

  async generate(
    system: string,
    user: string,
    maxTokens = 8192,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const blocks = response.content as Array<{ type: string; text?: string }>;
    const block = blocks.find((content) => content.type === "text");
    if (!block?.text)
      throw new Error("Story Desk model returned no text.");
    return block.text;
  }
}
