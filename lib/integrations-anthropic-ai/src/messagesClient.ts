import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicMessagesClientOptions {
  apiKey: string;
  baseURL?: string;
}

/**
 * Create an Anthropic Messages-compatible client without changing the shared
 * legacy client. This lets a bounded workload opt into an API-compatible
 * gateway while the existing Alex surfaces keep their current configuration.
 */
export function createAnthropicMessagesClient(
  options: AnthropicMessagesClientOptions,
): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
}

export type AnthropicMessagesClient = ReturnType<
  typeof createAnthropicMessagesClient
>;
