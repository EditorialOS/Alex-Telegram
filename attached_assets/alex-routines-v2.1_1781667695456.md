---
name: alex-routines
description: "The editable routine registry Alex reads to handle slash commands. Each routine = a named recipe (instruction + skill files + Gate mode + output shape). Add or remove routines here without touching the agent engine."
version: 2.1.0
---

# Alex — Routine Registry

This is the **single editable file** that defines every Alex routine. Alex (the
agent) reads this to decide, for any incoming slash command, *which* skill files
to load, *in what order*, *whether to run the Gate revise loop*, and *what shape*
to return.

> **Mental model:** Skills are ingredients. Routines are recipes. The agent is
the cook. The Gate is the inspector who checks every plate before it leaves.

**To add a routine:** copy a block below, change the command, instruction,
skills, and output shape. **To remove one:** delete its block. Nothing in the
agent engine or the Slack adapter needs to change.

---

## The Universal Shape

Every routine obeys this flow:

```
INPUT → load skills → produce → CALL THE GATE → write to Work/ → deliver package
                                          │
                          REVISE verdict → redraft → re-Gate (max 2 loops)
                          BLOCKED verdict → stop, flag in summary
```

- **Routines** (heavy): run the Gate **revise loop** — redraft on REVISE, no
  human in the loop, cap at 2 redrafts. Verdict: APPROVED, APPROVED_WITH_NOTES,
  or BLOCKED.
- **Quick hits** (light): run the Gate **once** (single pass). Attach the score,
  do not loop. Speed matters.
- **Nothing leaves Alex ungated.** Every output carries a Gate verdict line.

**Available Skills (in `Skills/` or loaded from client `Data/`):**
- Production: `feature-writer.md`, `blog-writer.md`, `newsletter-writer.md`,
  `email-copywriter.md`, `social-content.md`, `video-scriptwriter.md`,
  `audio-scriptwriter.md`, `campaign-producer.md`, `content-repurposer.md`,
  `creative-brief.md`
- Strategy/Reference: `content-strategist.md`, `content-performance.md`,
  `seo-brief.md`, `editorial-voice.md`
- Quality: `editorial-gate.md` (local rubric) + external Gate API

**The Gate:** HTTPS POST to `$GATE_BASE_URL/grade` with `{ draft, brief,
voice_guide, mode }`. Returns `{ verdict, scores, notes }`. Verdicts:
APPROVED / APPROVED_WITH_NOTES / REVISE / NEEDS_INPUT / BLOCKED.

**Skill Loading Rules:**
- Always load `editorial-voice.md` before any writing/editing task.
- Always load `editorial-gate.md` as the final step for any content production.
- Never load more than 4 production skills + editorial-voice + editorial-gate
  in one task. Break into multiple tasks if needed.

---

# ROUTINES (Heavy — Full Gate Revise Loop)

## `/brief`
**Produces:** Vague idea → structured editorial brief (angle, audience, format,
channel, success metric, outline)

**Skills to load:** `content-strategist.md`, `editorial-voice.md`, `editorial-gate.md`
**Additional context:** `Data/brand-voice.md`, `Data/content-pillars.md`,
`Data/competitive-landscape.md`, `Data/standing_orders.md`
**Gate mode:** `strategy`
**Gate loop:** revise (max 2 redrafts)

**Instruction:**
1. Read the user's vague idea or source material.
2. Load `content-strategist.md` and apply its framework: determine angle,
   target audience, format, channel, and a measurable success metric.
3. Load `editorial-voice.md` and confirm the proposed angle aligns with the
   client's voice, pillars, and banned terms.
4. Produce a structured editorial brief with a draft outline.
5. Call the Gate (mode=`strategy`). If REVISE: apply notes, redraft brief,
   re-Gate (max 2). If BLOCKED: stop, explain why in the summary.
6. Write the brief package to `Work/strategy/`.

**Output package:**
- File: `Work/strategy/YYYY-MM-DD-[slug]-brief.md`
- Angle + audience + format + channel + success metric + outline
- Gate verdict + score line
- "What I need from you" (if any gaps flagged)

**Slack summary format:**
```
Brief ready — [topic]
→ `Work/strategy/YYYY-MM-DD-[slug]-brief.md`
Angle: [one line]
Format: [type], Channel: [channel], Success metric: [metric]
Gate: [verdict] ([score])
What I need: [gaps, if any]
— Alex
```

---

## `/weekly-social`
**Produces:** Prior week's content → 5–7 platform-native posts with hooks and CTAs

**Skills to load:** `social-content.md`, `editorial-voice.md`, `editorial-gate.md`
**Additional context:** Read last week's `work/drafts/` and `work/social/` via
`Data/alex-log.md` to identify source content. Load `Data/brand-voice.md`.
**Gate mode:** `content`
**Gate loop:** revise per post (max 2 each)

**Instruction:**
1. Pull last week's approved content from `work/drafts/` and `work/social/`
   (use `alex-log.md` to locate files).
2. Load `social-content.md` and apply its per-platform rules (LinkedIn / X /
   Instagram / TikTok). Write 5–7 native posts with hooks and CTAs.
3. Load `editorial-voice.md` and confirm every post matches the brand voice
   and banned-terms list.
4. Call the Gate (mode=`content`) on EACH post for voice compliance, banned
   terms, per-channel format, and hook strength. Auto-revise any post that
   scores REVISE; drop any that score BLOCKED after 2 loops.
5. Write the package to `Work/social/`.

**Output package:**
- File: `Work/social/YYYY-MM-DD-weekly-social-pack.md`
- 5–7 posts (per-channel formatted: caption + hook + CTA + hashtags)
- Posting order recommendation
- Per-post Gate verdict + score
- Image directions (if asset-library has matches) or flag if no images

**Slack summary format:**
```
Weekly social pack — [count] posts
→ `Work/social/YYYY-MM-DD-weekly-social-pack.md`
[Platform]: [one-line description of post]
[Platform]: [one-line description]
...
Gate: all passed / [n] revised / [n] dropped
— Alex
```

---

## `/morning-briefing`
**Produces:** Competitive scan + today's priorities + pipeline status

**Skills to load:** `content-strategist.md`, `content-performance.md`,
`editorial-voice.md`, `editorial-gate.md`
**Additional context:** `Data/competitive-landscape.md`,
`Data/standing_orders.md`, `work/reports/` (last report), `data/feeds/`
(Recon feed, if present)
**Gate mode:** `strategy`
**Gate loop:** single-pass (briefings ship daily; speed over perfection)

**Instruction:**
1. Read `Data/competitive-landscape.md` and the latest Recon feed from
   `data/feeds/` (if present) for competitive signals.
2. Read `Data/standing_orders.md` for today's recurring tasks and active
   campaigns.
3. Read `work/reports/` for last morning report to avoid repeating.
4. Load `content-strategist.md` to set today's priorities: what's due, what's
   blocked, what needs client input, what ships today.
5. Load `content-performance.md` for any performance signals (if client
   provides metrics).
6. Call the Gate (mode=`strategy`) once for signal-vs-noise, factual
   integrity, and actionability; drop low-signal items.
7. Write the briefing to `Work/reports/`.

**Output package:**
- File: `Work/reports/YYYY-MM-DD-morning-briefing.md`
- Competitive signals (with source URLs)
- Today's priorities (deadlines, standing orders, active campaigns)
- What's blocked + why
- What needs client input
- What ships today
- Gate verdict + score line

**Slack summary format:**
```
Morning briefing — [Date]
→ `Work/reports/YYYY-MM-DD-morning-briefing.md`
Today: [primary deliverable due] + [count] more
Blocked: [what's stuck and why]
Need from you: [decisions or missing info]
Gate: [verdict]
— Alex
```

---

# QUICK HITS (Light — Single Gate Pass, No Loop)

Quick hits load one skill, produce output, run the Gate once, attach the score.
No revision loop. Under 200 words where possible.

## `/caption`
**Skill:** `social-content.md`
**Context:** `Data/brand-voice.md`
**Gate mode:** `content`
**Instruction:** Write a platform-specific caption with hashtags for the user's
text. Gate once. Return caption + hashtags + verdict line.
**Output:** Caption + hashtags + `Gate: APPROVED ([score])`

## `/hook`
**Skill:** `social-content.md`
**Context:** `Data/brand-voice.md`
**Gate mode:** `content`
**Instruction:** Generate 5 video hook options with the first 2 seconds scripted.
Gate once. Return 5 hooks + verdict line.
**Output:** 5 hooks (first 2s scripted) + `Gate: APPROVED ([score])`

## `/headline`
**Skill:** `feature-writer.md` or `blog-writer.md` (match to content type)
**Context:** `Data/brand-voice.md`, `Data/style-guide.md`
**Gate mode:** `content`
**Instruction:** Generate 10 headline options for the user's topic. Gate once.
Return 10 headlines + verdict line.
**Output:** 10 headlines + `Gate: APPROVED ([score])`

## `/subject-line`
**Skill:** `newsletter-writer.md` or `email-copywriter.md`
**Context:** `Data/brand-voice.md`
**Gate mode:** `content`
**Instruction:** Generate 5 subject-line options, each with a one-line rationale.
Gate once. Return 5 subjects + rationale + verdict line.
**Output:** 5 subject lines + rationale + `Gate: APPROVED ([score])`

## `/reply`
**Skill:** `social-content.md`
**Context:** `Data/brand-voice.md`
**Gate mode:** `content`
**Instruction:** Generate 2–3 on-brand, tone-matched reply options to the user's
message or comment. Gate once. Return options + verdict line.
**Output:** 2–3 tone-matched replies + `Gate: APPROVED ([score])`

## `/outline`
**Skill:** `feature-writer.md` or `blog-writer.md` (match to content type)
**Context:** `Data/brand-voice.md`, `Data/content-pillars.md`
**Gate mode:** `content`
**Instruction:** Produce a structural outline with a one-line summary per section
for the user's topic. Gate once. Return outline + verdict line.
**Output:** Structural outline with section summaries + `Gate: APPROVED ([score])`

---

# DEFERRED (Not in v2.1 launch — paste here when ready)

These routines and quick hits are defined but held for future versions.

## `/content-audit` (Routine)
**Why deferred:** Needs a minimum of one week of real performance data and
approved content in `work/` to produce a meaningful audit.
**Skills:** `content-performance.md`, `content-strategist.md`, `seo-brief.md`, `editorial-gate.md`
**Gate mode:** `strategy`

## `/campaign-kit` (Routine)
**Why deferred:** Orchestrates other routines (`/brief` → `/draft` → `/social` →
`/newsletter`). Only valuable once individual routines are proven.
**Skills:** `campaign-producer.md`, `editorial-voice.md`, `editorial-gate.md` + all production skills
**Gate mode:** `content`

## `/quarterly-review` (Routine)
**Why deferred:** Needs 3+ months of performance data and content history.
**Skills:** `content-strategist.md`, `content-performance.md`, `editorial-voice.md`, `editorial-gate.md`
**Gate mode:** `strategy`

## Deferred Quick Hits
- `/hashtags` — needs social-content skill + hashtag research framework
- `/trending` — needs live trend data source (currently no Recon for trends)
- `/meta` — needs seo-brief skill + client's target keywords
- `/cta` — needs email-copywriter skill + CTA hierarchy framework

---

## How Alex Uses This File

1. Slash command arrives at the adapter (e.g. `/brief summer whale watching`).
2. Alex looks up the matching block in this registry.
3. Alex loads **only the listed skills** + `editorial-voice.md`.
4. Alex runs the **instruction** with the loaded skills and client context.
5. Alex applies the **Gate** per the block's mode + loop policy.
6. Alex writes the **output package** to the specified `Work/` folder.
7. Alex returns the **Slack summary** to the user, verdict line attached.

**If a command has no block in this registry:** Alex replies: *"No routine
registered for that command yet — want me to run `/brief` on it first?"*

`alex-routines.md` — v2.1 — Minimal OS Canonical
