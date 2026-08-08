# Minimal AI OS — Morning Report & Status Board

## Purpose

The morning report is the product. If the AI works all night but does not tell anyone, it might as well not have happened.

This document moves the project from the AI's desk to the human's desk. It builds trust through transparency.

---

## Template: Morning Report (Night Shift)

File: `workspace/reports/YYYY-MM-DD-morning-report.md`

```markdown
# Morning Brief — YYYY-MM-DD

## Executive Logic
{One paragraph: why the AI did what it did tonight. Connect tonight's work to the standing orders and active projects.}

## Deliverables

### 1. {Deliverable Name}
→ `workspace/work/{subfolder}/{filename}`
{One line: what this is and why it matters}

### 2. {Deliverable Name}
→ `workspace/work/{subfolder}/{filename}`
{One line}

## Trajectory
{What the AI is doing next — which tasks are queued for the next run and why}

## Gaps & Blockers
- {Specific question or missing info}
- {Decision needed from human}

## Decisions Logged
{Any new entries added to decision_log.md}

— {agent_name}
```

**Rules:**
- Never post with zero deliverables. If nothing shipped, stay quiet and log why in the logbook.
- Always list file paths. The human must be able to click and open.
- Always end with what you need (if anything).
- Never mention skills, workflows, tools, or internal structure.
- Keep under 200 words.

---

## Template: Status Board (Day Shift)

File: `workspace/reports/status_board.md` (living document, updated throughout the day)

```markdown
# Status Board — Updated HH:MM

## Done
- [Task] → `workspace/work/{path}`

## Doing
- [Task] — est. complete HH:MM

## Blocked
- [Task]: [What is needed]

## Next
- [Task queued for next sprint]
```

**Rules:**
- Updated after every sprint cycle.
- Human checks this file instead of waiting for an email.
- If a task is blocked, the AI stops and logs the blocker. It does not guess.

---

## Human → AI Feedback Loop

The human talks back by editing files. No chat bubble needed.

**Three channels:**

1. **Edit `standing_orders.md`** — Add new tasks, change priorities, or update notes. The AI reads this on its next run.
2. **Drop a comment file in `workspace/data/`** — Create `YYYY-MM-DD-feedback.md` with notes. The AI reads all files in `/data` before acting.
3. **Reply to the morning email** — If using email delivery, the human's reply can be parsed into the decision_log or standing_orders by the runtime.

**Email delivery (optional):**
- **Option A (Direct):** The runtime sends the morning report via SendGrid/Postmark API at the end of the run.
- **Option B (Zero Code):** The AI writes the report to the folder; a Zapier or Google Apps Script watches the folder and emails the client.

---

## Decision Log

File: `workspace/data/decision_log.md`

When the AI hits a fork in the road, it parks the question here and stops.

```markdown
# Decision Log

## YYYY-MM-DD — {Task Name}
**Question:** {Exact question, phrased for a human to answer in one sentence}
**Context:** {Why this matters, what depends on it}
**Options:**
- A) {Option A}
- B) {Option B}
**Recommended:** {A or B, with brief rationale}
**Urgency:** {Blocks next run / Can wait until next review}
```

**Rule:** The AI never guesses when the stakes are high. It logs the decision and moves to the next task.

---

## Version

`morning_report_template.md` — v1.0 — Minimal AI OS Canonical
