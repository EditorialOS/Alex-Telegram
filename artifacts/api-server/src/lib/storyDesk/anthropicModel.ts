import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { StoryDeskModel } from "./workers.js";

export class AnthropicStoryDeskModel implements StoryDeskModel {
  async generate(system: string, user: string, maxTokens = 8192): Promise<string> {
    const response = await anthropic.messages.create({
      model: process.env.STORY_DESK_MODEL ?? "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = response.content[0];
    if (!block || block.type !== "text") throw new Error("Story Desk model returned no text.");
    return block.text;
  }
}
