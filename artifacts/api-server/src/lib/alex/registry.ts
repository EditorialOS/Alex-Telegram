import { type RoutineConfig } from "./types.js";

const ROUTINES: RoutineConfig[] = [
  {
    command: "/brief",
    type: "routine",
    description: "Vague idea → structured editorial brief",
    summaryLabel: "Brief ready",
    skills: ["content-strategist", "editorial-voice", "editorial-gate"],
    gateMode: "strategy",
    gateLoop: true,
    writeToDrive: true,
    drivePath: "strategy",
    instruction: `You are producing a structured editorial brief for a content team.

Your task:
1. Read the user's vague idea or source material carefully.
2. Apply the content strategist framework: determine the angle, target audience, format, channel, and a measurable success metric.
3. Confirm the proposed angle aligns with the client's brand voice, content pillars, and avoids banned terms (from the brand context below).
4. Produce a structured editorial brief with a draft outline.

Output a complete brief in this exact format:

---
EDITORIAL BRIEF: [TOPIC]

Angle: [One crisp sentence stating the editorial angle]
Target Audience: [Who this is for, specifically]
Format: [Article / Video / Newsletter / Social Post / etc.]
Channel: [Where it will publish]
Success Metric: [How you'll know it worked — specific, measurable]

Outline:
[Section 1 heading] — [One line purpose]
[Section 2 heading] — [One line purpose]
[Section 3 heading] — [One line purpose]
[Additional sections as needed]

What I need from you: [List any gaps or decisions the client needs to make. If none, write "Nothing — ready to draft."]
---

Use the brand context provided to ensure alignment with voice, pillars, and strategy.`,
  },

  {
    command: "/weekly-social",
    type: "routine",
    description: "Prior week's content → 5–7 platform-native posts",
    summaryLabel: "Weekly social pack",
    skills: ["social-content", "editorial-voice", "editorial-gate"],
    gateMode: "content",
    gateLoop: true,
    writeToDrive: true,
    drivePath: "social",
    instruction: `You are producing a weekly social media content pack.

Your task:
1. Based on the user's input (source content, topics, or themes for this week), create 5–7 platform-native posts.
2. Write posts for LinkedIn, X (Twitter), Instagram, and TikTok as appropriate.
3. Each post must have: a strong hook, on-brand body copy, a clear CTA, and relevant hashtags.
4. Use the brand voice and content pillars provided below. Avoid any banned terms.
5. Include a posting order recommendation.

For each post, use this format:

---
[PLATFORM] — Post [N]
Hook: [First 1-2 sentences — must stop the scroll]
[Full post body]
CTA: [Clear call to action]
Hashtags: [3-5 relevant hashtags]
---

After all posts:
Posting Order Recommendation: [Day and suggested time for each post]
Image Direction: [Brief note on what visual would pair well with each post, or "No image needed"]`,
  },

  {
    command: "/morning-briefing",
    type: "routine",
    description: "Competitive scan + today's priorities + pipeline status",
    summaryLabel: "Morning Briefing",
    skills: [
      "content-strategist",
      "content-performance",
      "editorial-voice",
      "editorial-gate",
    ],
    gateMode: "strategy",
    gateLoop: true,
    writeToDrive: true,
    drivePath: "reports",
    instruction: `You are producing a morning editorial briefing for a content team.

Your task:
1. Based on the context provided (standing orders, any signals the user has shared), identify today's priorities.
2. Note what is due today, what is blocked, and what needs client input.
3. Highlight any competitive signals or relevant market context from the brand context.
4. Flag what ships today.

Keep this concise and actionable — this is read in the first 5 minutes of the workday.

Output in this exact format:

---
MORNING BRIEFING — [TODAY'S DATE]

Today's Priorities:
• [Primary deliverable — due when]
• [Secondary item]
• [Additional items]

Blocked:
• [What's stuck and why — or "Nothing blocked"]

Need From You:
• [Decisions or missing info required — or "Nothing needed"]

Ships Today:
• [What goes out today — or "Nothing shipping today"]

Competitive Signals:
• [Any relevant market or competitive context — or "No new signals"]
---`,
  },

  {
    command: "/caption",
    type: "quickhit",
    description: "Platform-specific caption with hashtags",
    summaryLabel: "Caption",
    skills: ["social-content"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Write a platform-specific social media caption for the user's content.

Determine the platform from context clues in the user's input, or default to a versatile caption that works across platforms.

Requirements:
- Open with a hook that earns the next sentence
- Stay on-brand (use the brand voice context below)
- Include a clear CTA
- Add 3-5 relevant hashtags

Output format:
Caption: [The full caption]
Hashtags: [#hashtag1 #hashtag2 #hashtag3]`,
  },

  {
    command: "/hook",
    type: "quickhit",
    description: "5 video hook options with first 2 seconds scripted",
    summaryLabel: "Video hooks",
    skills: ["social-content"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Generate 5 video hook options for the user's topic or concept.

For each hook, script the exact first 2 seconds of spoken audio. These hooks must earn attention immediately — the viewer's thumb is on the screen.

Use the brand voice context below. Each hook should feel distinct from the others.

Output exactly 5 hooks in this format:

Hook 1: [One-line description of the approach]
First 2 seconds: "[Exact words to say]"

Hook 2: [One-line description]
First 2 seconds: "[Exact words to say]"

[...through Hook 5]`,
  },

  {
    command: "/headline",
    type: "quickhit",
    description: "10 headline options",
    summaryLabel: "Headlines",
    skills: ["feature-writer", "blog-writer"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Generate 10 headline options for the user's topic or content piece.

Vary the approaches: use questions, statements, how-tos, list formats, provocations, and curiosity gaps. Every headline must be specific — no vague filler.

Use the brand voice and style guide context below.

Output numbered 1-10, one per line:
1. [Headline]
2. [Headline]
[...through 10]`,
  },

  {
    command: "/subject-line",
    type: "quickhit",
    description: "5 email subject lines with rationale",
    summaryLabel: "Subject lines",
    skills: ["newsletter-writer", "email-copywriter"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Generate 5 email subject line options for the user's email or newsletter.

Each subject line should use a different approach: curiosity, urgency, benefit, social proof, or directness. Keep them under 50 characters where possible.

For each, include a one-line rationale explaining why it works.

Output in this format:
1. "[Subject line]" — [One-line rationale]
2. "[Subject line]" — [One-line rationale]
[...through 5]`,
  },

  {
    command: "/reply",
    type: "quickhit",
    description: "2–3 on-brand reply options",
    summaryLabel: "Reply options",
    skills: ["social-content"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Generate 2–3 on-brand reply options to the user's message, comment, or thread.

Replies should be:
- Tone-matched to the original message
- On-brand (use the brand voice context below)
- Genuine and not robotic
- The right length — no padding, no unnecessary filler

Output each option labeled:

Option A: [Reply text]
Option B: [Reply text]
Option C: [Reply text — only if genuinely different from A and B]`,
  },

  {
    command: "/outline",
    type: "quickhit",
    description: "Structural outline with one-line section summaries",
    summaryLabel: "Outline",
    skills: ["feature-writer", "blog-writer"],
    gateMode: "content",
    gateLoop: false,
    writeToDrive: false,
    instruction: `Produce a structural content outline for the user's topic or content piece.

Each section should have:
- A clear heading
- A one-line summary of what that section accomplishes for the reader

Use the brand voice and content pillars context below.

Output in this format:

[Content Title]

Introduction — [One-line purpose: what the reader learns or feels by the end of the intro]
[Section 1 Heading] — [One-line purpose]
[Section 2 Heading] — [One-line purpose]
[Section 3 Heading] — [One-line purpose]
[Additional sections as needed]
Conclusion / CTA — [One-line purpose]`,
  },
];

const registryMap = new Map<string, RoutineConfig>();
for (const r of ROUTINES) {
  registryMap.set(r.command, r);
}

export function getRoutine(command: string): RoutineConfig | undefined {
  const normalized = command.startsWith("/") ? command : `/${command}`;
  return registryMap.get(normalized);
}

export function listCommands(): string[] {
  return ROUTINES.map((r) => r.command);
}

/** Command + one-line description for every routine (for /help and setMyCommands). */
export function listRoutineMeta(): { command: string; description: string }[] {
  return ROUTINES.map((r) => ({ command: r.command, description: r.description }));
}
