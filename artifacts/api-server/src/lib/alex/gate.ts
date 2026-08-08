import { anthropic } from "@workspace/integrations-anthropic-ai";
import { type GateMode, type GateResult, type GateVerdict } from "./types.js";
import { logger } from "../logger.js";

const GATE_SYSTEM = `You are a senior editorial quality gate inspector. Your job is to evaluate content drafts against quality standards and brand guidelines.

You must respond with ONLY a valid JSON object — no preamble, no markdown, no explanation outside the JSON.

Response format:
{
  "verdict": "APPROVED" | "APPROVED_WITH_NOTES" | "REVISE" | "BLOCKED",
  "score": <integer 0-100>,
  "notes": "<specific, actionable feedback>"
}

Verdict guide:
- APPROVED (90-100): Ready to publish as-is. No changes needed.
- APPROVED_WITH_NOTES (75-89): Can publish with minor optional tweaks noted.
- REVISE (50-74): Needs specific improvements before it's ready. Notes must be concrete and actionable.
- BLOCKED (0-49): Fundamental problems. Off-brand, factually wrong, or structurally broken.`;

function parseGateResponse(raw: string): GateResult {
  let cleaned = raw.trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned) as { verdict?: string; score?: unknown; notes?: string };
    const validVerdicts: GateVerdict[] = [
      "APPROVED",
      "APPROVED_WITH_NOTES",
      "REVISE",
      "NEEDS_INPUT",
      "BLOCKED",
    ];

    const verdict = validVerdicts.includes(parsed.verdict as GateVerdict)
      ? (parsed.verdict as GateVerdict)
      : "REVISE";

    const score =
      typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 70;

    const notes = typeof parsed.notes === "string" ? parsed.notes : "No specific notes provided.";

    return { verdict, score, notes };
  } catch (err) {
    logger.warn({ raw, err }, "Failed to parse gate response — defaulting to REVISE");
    return {
      verdict: "REVISE",
      score: 60,
      notes:
        "Could not parse gate evaluation. Please review the draft manually before publishing.",
    };
  }
}

export async function runGate(
  draft: string,
  brief: string,
  voiceGuide: string,
  mode: GateMode
): Promise<GateResult> {
  const modeInstructions =
    mode === "strategy"
      ? `You are evaluating a STRATEGY document (brief, plan, or report).
Assess: clarity of angle, audience specificity, measurable success metric, actionability, and strategic coherence.`
      : `You are evaluating CONTENT (post, caption, hook, headline, email, etc.).
Assess: hook strength, brand voice alignment, banned-term compliance, channel-format fit, and CTA clarity.`;

  const userMessage = `${modeInstructions}

ORIGINAL BRIEF / REQUEST:
${brief}

BRAND VOICE GUIDE:
${voiceGuide}

DRAFT TO EVALUATE:
${draft}

Return your verdict as a JSON object now.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: GATE_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== "text") {
    return { verdict: "REVISE", score: 60, notes: "Gate produced an unexpected response." };
  }

  return parseGateResponse(block.text);
}
