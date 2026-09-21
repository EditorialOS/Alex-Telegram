# Minimal AI OS — Roadmap

version: 1.0.0
status: Committed. Kernel file — changes via deliberate-change protocol only.

## Operating rule

Every version ships as the thing Alex runs for real client work. Validation is
never a benchmark — it is a week of client deliverables passing the gate, the
drift check, and operator review. Each version ends with a kill-or-continue
checkpoint against its exit criteria before the next begins.

Scope decision (locked): one client, one brand voice. The Signal&/The Desk
instance runs in Alex's voice only (Desk Blog). Founder-voice channels
(LinkedIn/X/Substack) are written by the founder and are out of scope for the
OS. There is no two-voice case anywhere in this roadmap.

---

## v2.0 — SHIPPED

Kernel/userland partition. spec.md consolidation. 17 skills on the §3 schema.
MANIFEST.json + verify.py (drift = boot failure). lint, skill_add, init_client.
Two adapters over one kernel: Cowork (CLAUDE.md) and cron/CLI (runtime.py).

## v2.1 — Syscall boundary + gates in kernel space (~2–3 weeks)

- Skills interact only through kernel calls: read_context, write_deliverable,
  load_skill, call_model, log, ask_human, schedule. No direct file or model access.
- Context assembly gains provenance labels: userland text enters marked
  client-supplied and subordinate to kernel guardrails (closes the injection hole).
- Deterministic checks run BEFORE model self-review, in kernel space, no opt-out:
  banned-terms lint, placeholder regex, length bounds, date-stamp validation,
  brand-mention frequency (max 3 per 500 words).
- Permissions enforced physically: a skill cannot write to Data/ because it
  holds no file handle.

Exit criteria: a full client week runs through syscalls only; kernel gate stats
appear in the wind-down report; a deliberately poisoned Data/ file fails to
alter behavior.

Open canon call (owner: Raj, due before build): where machine-readable gate
rules live. Recommendation: machine-readable block in skill frontmatter (one
source). Check against the classification table before canonizing.

## v2.2 — Scheduler + process model (~3–4 weeks)

- NTSL becomes a real scheduler: calendar math ("First Wednesday" means first),
  event triggers (file drop, Asana state change), priority, preemption.
- Tasks become processes: per-task context budget, timeout, isolation, kill signal.
- The approval pause becomes a true interrupt: campaign state serialized,
  suspended, resumed on approval (/campaign-kit's missing half).
- Memory manager: log compaction + retrieval replaces the 40-line tail.
- ContextStore seam ships as FileContextStore; interface designed so the
  Context API (Postgres) can implement it later without kernel changes.

Exit criteria: a month of standing orders executes with zero manual scheduling;
an Asana state change wakes Alex without cron; a suspended campaign resumes
cleanly after approval.

Publication gate: the NTSL spec publishes only after this ships — as the
scheduler specification of a running system.

## v3 — Driver layer (~4–6 weeks + training cycles)

- call_model becomes a driver registry. Three driver classes:
  frontier (reasoning, strategy, gate judgment), local (MLX on existing Mac
  first — mechanical transforms, repurposing, formatting), and voice
  (VoiceKit LoRA adapters, one per client, loaded like a device driver).
- Scheduler gains a routing policy: task class → driver. Reasoning routed
  narrowly to frontier; execution routed to owned compute.
- Driver code is kernel (hashed in MANIFEST.json). Adapter weights are
  userland, declared in a per-client manifest with their own hash — a client's
  voice is verifiable without being global.
- VoiceKit fuses with the OS: service tiers become tiers of driver
  (trained / tuned / maintained). The Desk is the machine they install into.

Exit criteria: one real deliverable produced end-to-end with strategy on
frontier, drafting on a client voice adapter, deterministic gates in kernel
space — with the cost delta vs. all-frontier measured and recorded.

Pre-build spike (small, before pricing is promised): LoRA quality bar. A voice
adapter scoring 3/5 on Voice Compliance is a driver that cannot ship. Evaluate
Tinker vs. Axolotl/MLX on one voice before committing tiers.

---

## Standing risks

- ~3 months solo engineering, zero paying clients: every checkpoint weighs
  "does this make The Desk sellable sooner," not just cleaner.
- v2.1 is the only version addressing live vulnerabilities (self-graded gate,
  injection); if anything ships out of order, it ships first.
