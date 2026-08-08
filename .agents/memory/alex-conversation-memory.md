---
name: Alex memory — two coexisting systems
description: Alex has two distinct, additive memory mechanisms; what each is for and the rules governing them.
---

# Alex memory: two systems, do not conflate

Alex (`artifacts/api-server/src/lib/alex`) runs **two separate memory mechanisms**
that are both consulted per command. Don't assume one replaces the other.

1. **Context API "learnings"** — external HTTP service, scoped per workspace.
   Stores only **gate-approved** outputs as distilled learnings, injected into the
   *system prompt* as injection-guarded reference data. For cross-session brand
   consistency.

2. **DB-backed conversation history** — Postgres `conversations` + `messages`.
   Scoped per **(team_id, user_id)** (one thread per workspace user). Replays the
   recent literal user/assistant turns into Claude's `messages` array for
   continuity and to avoid repetition.

**Why both:** learnings = curated brand memory (approved only); conversation
history = raw recent turns. They are intentionally additive, not redundant.

**Key rules:**
- **Store every invocation, replay only good ones.** Each invocation (success,
  blocked, unknown, error) is persisted with an outcome status; only successful
  ("completed") exchanges are replayed back to the model — failures/blocked are
  audit-only and must stay out of the prompt.
- **Persist via a finally-style path**, not after the happy path, so early returns
  (unknown command, gate-blocked) and exceptions still record.
- **Fail-open everywhere:** memory reads return empty and writes are swallowed —
  memory must never block command processing.
- **Replay is capped** to bound token usage (last N exchanges, per-message
  truncation); history grows unbounded otherwise (pruning is a known gap).
- **Fail-open hides schema drift.** Because conversation writes swallow errors,
  the dev DB can silently lag the schema (e.g. `conversations` missing
  `team_id`/`user_id`, `messages` missing `status`) with no visible failure —
  until something *reads* those columns. Run `pnpm --filter @workspace/db run
  push` before relying on these columns in a new feature.
