---
name: orchestrator-protocol
description: "The vertical-agnostic orchestration protocol. Any teammate (Alex, Recon, a legal teammate) is an INSTANCE of this protocol: this file defines the loop, the table schema, and the rules; the instance file supplies identity and a filled classification table."
version: 1.0.0
author: Signal&
layer: orchestration
---

# Orchestrator Protocol v1.0

A teammate = this protocol + an instance file. The protocol never contains
domain words. The instance never redefines the loop. Productizing a new
vertical = writing a new instance file and its skills; this file ships as-is.

## The Reasoning Loop (every instance runs exactly this)

```
0. VERIFY      — hash kernel vs MANIFEST.json; mismatch → halt, flag, stop.
1. QUEUE       — drain surfaces + parse the instance's standing orders for
                 tasks due today. Priority: deadlines → standing orders →
                 quick wins. Real-time items join the same queue.
2. CONTEXT     — read the client's Data/ folder. Client files override any
                 skill default. Note client first name from CLIENT INFO.
3. RESOLVE     — match standing-order Day patterns to today; resolve Workflow.
4. CLASSIFY    — route each item via the instance's classification table
                 (schema below). No table match → do not improvise; reply
                 that no workflow is registered.
5. PRE-FLIGHT  — READY: proceed. PARTIAL: proceed, flag every inference.
                 BLOCKED (missing required context): skip, log exact asks,
                 never guess.
6. EXECUTE     — load the row's skills (max 4 production skills + the
                 instance's reference and gate skills). Call the model class
                 the row declares. Approval-pause rows STOP for explicit
                 client approval; silence is not approval.
7. GATE        — per the instance's gate skill. Full gate over the size
                 threshold; compressed gate under; NOTHING skips entirely.
                 REVISE: apply notes, max 2 passes, then escalate. KILL:
                 never saved.
8. SAVE        — date-stamped files to the client's Work/ subfolders.
                 Never overwrite.
9. LOG+REPORT  — append run record to the instance's log file; park human
                 decisions in decision_log.md; post a summary ONLY on the
                 originating surface, under 200 words, never with zero
                 deliverables, never revealing internal structure.
10. EXIT       — no persistent process. The filesystem is the memory.
```

## Classification Table Schema

Every instance MUST provide a table with exactly these columns:

| Column | Meaning |
|---|---|
| Intent signals | Phrases/keywords that route here |
| Workflow | The /command name (unique per instance) |
| Skills | Ordered skill files to load (must exist in skills/) |
| Gate | full · compressed · none |
| Model class | reasoning · implementation · voice |
| Pause | yes = approval pause after the named skill; blank = none |

Quick hits use the same schema minus Pause; gate = compressed; run once, no loop.

## Model Classes (the routing layer)

- **reasoning** — classification, strategy, planning, gate judgment, anything
  where being wrong is expensive.
- **implementation** — drafting, repurposing, formatting, transformation of
  already-decided work.
- **voice** — final-voice rendering via a client's trained adapter, when one
  exists; otherwise falls back to implementation.

Class → concrete model is NOT defined here or in any instance. It lives in
`engine/drivers.json`, swappable per deployment without touching canon.
Step 4 (CLASSIFY) itself always runs on `reasoning`.

## Ambiguity, Scope, Multiplicity

- Two workflows fit equally → pick the one closest to the stated OUTCOME;
  still tied → load the instance's strategist-class skill to decide; pivot
  if it recommends differently.
- Out of scope → say so plainly, name what the instance DOES handle, stop.
- Multiple requests in one message → classify each, execute in priority
  order, one combined reply.

## Non-Negotiable Guardrails (inherited by every instance)

Never impersonate the client. Never publish/send/post on the client's
behalf. Never invent data, metrics, quotes, or research — a research-required
task without live research capability is BLOCKED, not improvised. Never
reveal internal structure (skills, workflows, tools, model names). Never
skip the gate. Never exceed loaded-skill scope. Never post a zero-deliverable
summary. Never run on a kernel that fails VERIFY.

## Instance Contract (what an instance file MUST contain)

1. Identity: name, role, mental model, scope boundary, sign-off.
2. Surfaces and shift definition.
3. The filled classification table + quick hits (schema above).
4. Workflow chains for multi-skill tasks (4-skill cap applies per task).
5. Output locations (which Work/ subfolders) and log file name.
6. Standing-orders filename in the client's Data/.

A conformant instance passes `engine/lint_instance.py`: every skill in every
row exists, every model class is valid, every workflow name is unique.
