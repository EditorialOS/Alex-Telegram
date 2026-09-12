import { createHash, randomUUID } from "node:crypto";
import {
  STORY_DESK_GATE_CRITERIA,
  type BriefDisposition,
  type BriefFields,
  type BriefVersion,
  type GateCriterionResult,
  type NormalizedContext,
  type Opportunity,
  type StoryDeskGateCriterion,
  type StoryDeskGateReport,
} from "./contracts.js";
import { StoryDeskError } from "./errors.js";
import type { VerifiedSkills } from "./sourceBundle.js";

export interface StoryDeskModel {
  generate(system: string, user: string, maxTokens?: number): Promise<string>;
}

export interface StoryDeskConstraints {
  timing?: string;
  campaign?: string;
  channels?: string[];
}

function contextText(context: NormalizedContext): string {
  return Object.entries(context.files)
    .map(([name, content]) => `<client_file name="${name}">\n${content}\n</client_file>`)
    .join("\n\n");
}

function parseJson<T>(raw: string, label: string): T {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) throw new StoryDeskError("model_output_invalid", `${label} returned no JSON object.`, 502);
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    throw new StoryDeskError("model_output_invalid", `${label} returned invalid JSON.`, 502);
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StoryDeskError("model_output_invalid", `Model output is missing ${field}.`, 502);
  }
  return value.trim();
}

function score(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new StoryDeskError("model_output_invalid", `${field} must be an integer from 1 to 5.`, 502);
  }
  return value as number;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new StoryDeskError("model_output_invalid", `${field} must be a string array.`, 502);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function dispositionFor(total: number): BriefDisposition {
  if (total < 17) return "do_not_commission";
  if (total < 20) return "commission_with_review";
  return "ready_to_commission";
}

function validateOpportunities(value: unknown): Opportunity[] {
  if (!Array.isArray(value) || value.length < 8 || value.length > 10) {
    throw new StoryDeskError("model_output_invalid", "Story Commissioner must return 8–10 opportunities.", 502);
  }
  const opportunities = value.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const audienceDemand = score(item.audience_demand, `opportunities[${index}].audience_demand`);
    const editorialDifferentiation = score(
      item.editorial_differentiation,
      `opportunities[${index}].editorial_differentiation`,
    );
    const productionFeasibility = score(
      item.production_feasibility,
      `opportunities[${index}].production_feasibility`,
    );
    return {
      id: nonEmpty(item.id, `opportunities[${index}].id`),
      title: nonEmpty(item.title, `opportunities[${index}].title`),
      angle: nonEmpty(item.angle, `opportunities[${index}].angle`),
      audience: nonEmpty(item.audience, `opportunities[${index}].audience`),
      channel: nonEmpty(item.channel, `opportunities[${index}].channel`),
      format: nonEmpty(item.format, `opportunities[${index}].format`),
      whyNow: nonEmpty(item.why_now, `opportunities[${index}].why_now`),
      sources: stringArray(item.sources, `opportunities[${index}].sources`),
      stretch: item.stretch === true,
      reliable: item.reliable === true,
      audienceDemand,
      editorialDifferentiation,
      productionFeasibility,
      total: audienceDemand + editorialDifferentiation + productionFeasibility,
      rank: index + 1,
    };
  });
  if (new Set(opportunities.map((item) => item.id)).size !== opportunities.length) {
    throw new StoryDeskError("model_output_invalid", "Story Commissioner returned duplicate opportunity IDs.", 502);
  }
  if (opportunities.filter((item) => item.stretch).length !== 1) {
    throw new StoryDeskError("model_output_invalid", "Story Commissioner must return exactly one stretch opportunity.", 502);
  }
  if (!opportunities.some((item) => item.reliable)) {
    throw new StoryDeskError("model_output_invalid", "Story Commissioner must return at least one reliable opportunity.", 502);
  }
  return opportunities;
}

function validateBriefFields(raw: unknown, index: number): { opportunityId: string; fields: BriefFields } {
  const item = raw as Record<string, unknown>;
  const outlineRaw = item.outline;
  if (!Array.isArray(outlineRaw)) {
    throw new StoryDeskError("model_output_invalid", `briefs[${index}].outline must be an array.`, 502);
  }
  const outline = outlineRaw.map((entry, outlineIndex) => {
    const row = entry as Record<string, unknown>;
    return {
      heading: nonEmpty(row.heading, `briefs[${index}].outline[${outlineIndex}].heading`),
      purpose: nonEmpty(row.purpose, `briefs[${index}].outline[${outlineIndex}].purpose`),
    };
  });
  return {
    opportunityId: nonEmpty(item.opportunity_id, `briefs[${index}].opportunity_id`),
    fields: {
      title: nonEmpty(item.title, `briefs[${index}].title`),
      angle: typeof item.angle === "string" ? item.angle.trim() : "",
      audience: typeof item.audience === "string" ? item.audience.trim() : "",
      whyTheyCare: nonEmpty(item.why_they_care, `briefs[${index}].why_they_care`),
      sources: stringArray(item.sources, `briefs[${index}].sources`),
      format: typeof item.format === "string" ? item.format.trim() : "",
      length: nonEmpty(item.length, `briefs[${index}].length`),
      channel: typeof item.channel === "string" ? item.channel.trim() : "",
      pillar: nonEmpty(item.pillar, `briefs[${index}].pillar`),
      tone: nonEmpty(item.tone, `briefs[${index}].tone`),
      deadline: typeof item.deadline === "string" ? item.deadline.trim() : "",
      successCriteria: typeof item.success_criteria === "string" ? item.success_criteria.trim() : "",
      outline,
      selfAssessment: typeof item.self_assessment === "object" && item.self_assessment !== null
        ? item.self_assessment as Record<string, unknown>
        : undefined,
    },
  };
}

export function structuralMissing(fields: BriefFields): string[] {
  const missing: string[] = [];
  if (!fields.angle) missing.push("angle");
  if (!fields.audience) missing.push("audience");
  if (fields.sources.length === 0) missing.push("sources");
  if (!fields.format) missing.push("format");
  if (!fields.channel) missing.push("channel");
  if (!fields.deadline) missing.push("deadline");
  if (!fields.successCriteria) missing.push("success_criteria");
  return missing;
}

export function renderBrief(fields: BriefFields): string {
  return [
    `# Story Brief — ${fields.title}`,
    "",
    "## Angle",
    fields.angle,
    "",
    "## Audience",
    `**Primary:** ${fields.audience}`,
    `**Why they care:** ${fields.whyTheyCare}`,
    "",
    "## Format & Specs",
    "| Attribute | Spec |",
    "|---|---|",
    `| Format | ${fields.format} |`,
    `| Length | ${fields.length} |`,
    `| Channel | ${fields.channel} |`,
    `| Pillar | ${fields.pillar} |`,
    `| Tone | ${fields.tone} |`,
    "",
    "## Deadline",
    fields.deadline,
    "",
    "## Sources & References",
    ...fields.sources.map((source) => `- ${source}`),
    "",
    "## Success Criteria",
    fields.successCriteria,
    "",
    "## Outline",
    ...fields.outline.map((item) => `- **${item.heading}:** ${item.purpose}`),
    "",
  ].join("\n");
}

export class StoryDeskWorkers {
  private readonly model: StoryDeskModel;

  constructor(model: StoryDeskModel) {
    this.model = model;
  }

  async generateOpportunities(
    goal: string,
    constraints: StoryDeskConstraints,
    context: NormalizedContext,
    skills: VerifiedSkills,
  ): Promise<Opportunity[]> {
    const system = `${skills.orchestrator}\n\n<skill>\n${skills.editorialVoice}\n</skill>\n\n<skill>\n${skills.storyCommissioner}\n</skill>`;
    const user = `Create the /commission-batch opportunity set for this goal: ${goal}\n\nConstraints: ${JSON.stringify(constraints)}\n\n${contextText(context)}\n\nReturn only JSON: {"opportunities":[8-10 objects with id, title, angle, audience, channel, format, why_now, sources (real supplied sources only), stretch, reliable, audience_demand (1-5), editorial_differentiation (1-5), production_feasibility (1-5)]}. Include exactly one stretch and at least one reliable opportunity. Do not write production content.`;
    const data = parseJson<{ opportunities?: unknown }>(await this.model.generate(system, user), "Story Commissioner");
    return validateOpportunities(data.opportunities);
  }

  async rankOpportunities(
    goal: string,
    constraints: StoryDeskConstraints,
    opportunities: Opportunity[],
    context: NormalizedContext,
    skills: VerifiedSkills,
  ): Promise<Opportunity[]> {
    const system = `${skills.orchestrator}\n\n<skill>\n${skills.editorialVoice}\n</skill>\n\n<skill>\n${skills.contentStrategist}\n</skill>`;
    const user = `Rank these opportunities for the stated goal, authenticated audience context and calendar/channel fit.\nGoal: ${goal}\nConstraints: ${JSON.stringify(constraints)}\n${contextText(context)}\nOpportunities: ${JSON.stringify(opportunities)}\nReturn only JSON: {"ranked_ids":[every opportunity id exactly once, best first]}.`;
    const data = parseJson<{ ranked_ids?: unknown }>(await this.model.generate(system, user, 2048), "Content Strategist");
    const rankedIds = stringArray(data.ranked_ids, "ranked_ids");
    const expected = new Set(opportunities.map((item) => item.id));
    if (rankedIds.length !== opportunities.length || new Set(rankedIds).size !== rankedIds.length ||
      rankedIds.some((id) => !expected.has(id))) {
      throw new StoryDeskError("model_output_invalid", "Content Strategist returned an invalid opportunity ranking.", 502);
    }
    const byId = new Map(opportunities.map((item) => [item.id, item]));
    return rankedIds.map((id, index) => ({ ...byId.get(id)!, rank: index + 1 }));
  }

  async developBriefs(
    goal: string,
    opportunities: Opportunity[],
    context: NormalizedContext,
    skills: VerifiedSkills,
    revisionNotes?: Record<string, string[]>,
    revisionAttempt = 0,
  ): Promise<BriefVersion[]> {
    const selected = opportunities.filter((item) => item.total >= 11).slice(0, 6);
    if (selected.length < 4) {
      throw new StoryDeskError(
        "model_output_invalid",
        "Fewer than four opportunities met the 11/15 commissioning threshold.",
        502,
        { commissionable_opportunities: selected.length },
      );
    }
    const system = `${skills.orchestrator}\n\n<skill>\n${skills.editorialVoice}\n</skill>\n\n<skill>\n${skills.storyCommissioner}\n</skill>`;
    const user = `Develop the selected /commission-batch opportunities into complete commissionable story briefs. Do not produce the stories.\nGoal: ${goal}\n${contextText(context)}\nSelected opportunities: ${JSON.stringify(selected)}\nStructural revision requirements: ${JSON.stringify(revisionNotes ?? {})}\nReturn only JSON: {"briefs":[4-6 objects with opportunity_id, title, angle, audience, why_they_care, sources, format, length, channel, pillar, tone, deadline, success_criteria, outline:[{heading,purpose}], and optional self_assessment]}. Never invent a source. If a source is unavailable, name the specific reporting source that must be secured.`;
    const data = parseJson<{ briefs?: unknown }>(await this.model.generate(system, user), "Story Commissioner briefs");
    if (!Array.isArray(data.briefs) || data.briefs.length < 4 || data.briefs.length > 6) {
      throw new StoryDeskError("model_output_invalid", "Story Commissioner must return 4–6 briefs.", 502);
    }
    const selectedIds = new Set(selected.map((item) => item.id));
    const briefs = data.briefs.map((raw, index) => {
      const { opportunityId, fields } = validateBriefFields(raw, index);
      if (!selectedIds.has(opportunityId)) {
        throw new StoryDeskError("model_output_invalid", `Brief references unknown opportunity ${opportunityId}.`, 502);
      }
      const body = renderBrief(fields);
      const briefId = `brief_${opportunityId}`;
      return {
        id: randomUUID(),
        briefId,
        opportunityId,
        version: revisionAttempt + 1,
        fields,
        body,
        contentHash: hash(body),
      };
    });
    if (new Set(briefs.map((brief) => brief.opportunityId)).size !== briefs.length) {
      throw new StoryDeskError("model_output_invalid", "Story Commissioner returned duplicate briefs.", 502);
    }
    return briefs;
  }

  async evaluateBrief(
    brief: BriefVersion,
    context: NormalizedContext,
    skills: VerifiedSkills,
  ): Promise<StoryDeskGateReport> {
    const missing = structuralMissing(brief.fields);
    if (missing.length > 0) {
      throw new StoryDeskError("brief_incomplete", "Brief is not structurally scoreable.", 422, {
        brief_id: brief.briefId,
        missing_fields: missing,
      });
    }
    const { selfAssessment: _privateSelfAssessment, ...gateFields } = brief.fields;
    const system = `${skills.editorialGate}\n\n<mode_contract>\n${skills.storyDeskGateContract}\n</mode_contract>`;
    const user = `Evaluate this brief once in story_desk_commissioning mode.\n\nFrozen client context:\n${contextText(context)}\n\nStored brief version:\n${JSON.stringify(gateFields)}\n\nReturn only the JSON required by the mode contract.`;
    const data = parseJson<{ criteria?: unknown; notes?: unknown }>(await this.model.generate(system, user, 2048), "Editorial Gate");
    const rawCriteria = data.criteria as Record<string, unknown> | undefined;
    if (!rawCriteria) throw new StoryDeskError("model_output_invalid", "Editorial Gate omitted criteria.", 502);
    const criteria = {} as Record<StoryDeskGateCriterion, GateCriterionResult>;
    for (const name of STORY_DESK_GATE_CRITERIA) {
      const raw = rawCriteria[name] as Record<string, unknown> | undefined;
      if (!raw) throw new StoryDeskError("model_output_invalid", `Editorial Gate omitted ${name}.`, 502);
      criteria[name] = {
        score: score(raw.score, `criteria.${name}.score`),
        notes: nonEmpty(raw.notes, `criteria.${name}.notes`),
      };
    }
    const total = STORY_DESK_GATE_CRITERIA.reduce((sum, name) => sum + criteria[name].score, 0);
    return {
      id: randomUUID(),
      briefVersionId: brief.id,
      mode: "story_desk_commissioning",
      criteria,
      total,
      disposition: dispositionFor(total),
      notes: typeof data.notes === "string" ? data.notes.trim() : "",
    };
  }
}
