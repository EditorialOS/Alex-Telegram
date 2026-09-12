---
name: editorial-gate-story-desk
description: "Named Editorial Gate mode for Alex Story Desk commissioning decisions."
version: 1.0.0
source_skill: editorial-gate.md@1.1.0
mode: story_desk_commissioning
---

# Editorial Gate — Story Desk Commissioning Mode

Use this mode only for complete Story Desk commission briefs. It supplements the
verified `editorial-gate.md` contract and does not change that skill's default
five-gate or compressed-gate behaviour for any other Alex workflow.

## Input boundary

Evaluate only:

- the exact stored brief version; and
- the frozen, authenticated client-context snapshot used by the job.

Do not receive or consider Story Commissioner's private reasoning or
self-assessment. Structural validation happens before this evaluation. If any of
angle, audience, sources, format, channel, deadline or success criteria is empty,
the brief is not scoreable and must return to development without a Gate score.

## Criteria

Score each criterion from 1 to 5:

1. **Audience fit** — the named audience is specific, grounded in the context
   snapshot and has a credible reason to care.
2. **Editorial distinctiveness** — the angle has clear stakes and is meaningfully
   differentiated from generic or competitor coverage.
3. **Brand fit** — the brief serves a declared content pillar and follows the
   client's voice, style and relevant standing orders.
4. **Source sufficiency** — listed sources are real, accessible enough to
   commission and adequate for the claims and reporting burden. Never reward
   invented or merely hypothetical sources.
5. **Channel fit** — format, length, channel, deadline and success criteria form
   a coherent, achievable commission.

The runtime sums the five returned integer scores. That total is the only score
that determines disposition:

- 0–16: `do_not_commission`
- 17–19: `commission_with_review`
- 20–25: `ready_to_commission`

There is exactly one Editorial Gate evaluation per structurally complete brief.
Do not run a second scoring pass.

## Output contract

Return only valid JSON with this shape:

```json
{
  "criteria": {
    "audience_fit": { "score": 1, "notes": "Specific evidence." },
    "editorial_distinctiveness": { "score": 1, "notes": "Specific evidence." },
    "brand_fit": { "score": 1, "notes": "Specific evidence." },
    "source_sufficiency": { "score": 1, "notes": "Specific evidence." },
    "channel_fit": { "score": 1, "notes": "Specific evidence." }
  },
  "notes": "Concise commissioning guidance."
}
```

The runtime validates the five scores and derives the total and disposition. The
model must not supply an alternate total or disposition.
