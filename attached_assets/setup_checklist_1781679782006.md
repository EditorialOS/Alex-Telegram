# Minimal AI OS — Setup Checklist

## Purpose

One-page checklist for spinning up a new AI teammate. No theory. Just boxes to tick.

---

## Pre-Flight

- [ ] Google Drive folder created: `Editorial OS / Clients / {client_name}`
- [ ] Hostinger VPS (or local machine) has sync client installed (rclone / Drive sync)
- [ ] API key for chosen model provider (Claude, Kimi, OpenAI, or local endpoint)
- [ ] Cron job configured (or task scheduler for Day Shift)

---

## Step 1: Create the Folder Structure

Create these folders in the client's Drive:

```
{client_name}/
├── Data/
│   ├── brand-voice.md
│   ├── audience-personas.md
│   ├── content-pillars.md
│   ├── competitive-landscape.md
│   ├── style-guide.md
│   ├── standing_orders.md
│   └── alex-log.md
├── Work/
│   ├── drafts/
│   ├── social/
│   ├── campaigns/
│   ├── strategy/
│   └── reports/
└── Assets/
    ├── photos/
    ├── brand/
    └── references/
```

- [ ] Folders created
- [ ] Sync verified (file appears on VPS within 60 seconds)

---

## Step 2: Populate the Data Folder

Fill each file or mark "To be created by AI during onboarding."

- [ ] `brand-voice.md` — Voice attributes, tone scale, vocabulary rules, examples/anti-examples
- [ ] `audience-personas.md` — 2-3 segments with demographics, psychographics, channel preferences
- [ ] `content-pillars.md` — 3-5 pillars with definitions, topic clusters, seasonal peaks
- [ ] `competitive-landscape.md` — 3-5 named competitors with positioning, pricing, strengths/weaknesses
- [ ] `style-guide.md` — Spelling, punctuation, formatting, naming conventions
- [ ] `standing_orders.md` — Weekly rhythm, recurring tasks, active projects (use NTSL template)
- [ ] `alex-log.md` — Create empty; AI will populate

---

## Step 3: Write the Teammate Protocol

- [ ] Open `teammate_protocol.md` template
- [ ] Fill: agent name, client name, role description, mental model, scope boundary
- [ ] Fill: client first name (for address), agent sign-off name
- [ ] Adjust voice attributes if client's brand-voice.md overrides defaults
- [ ] Save as `teammate.md` in the ai_os root

---

## Step 4: Install Skills

- [ ] Copy `skill_template.md` to `skills/skill_template.md`
- [ ] Copy `editorial-voice.md` to `skills/editorial-voice.md`
- [ ] Copy `editorial-gate.md` to `skills/editorial-gate.md`
- [ ] Copy each production skill (blog-writer, newsletter-writer, social-content, etc.) to `skills/`
- [ ] Verify every skill has YAML frontmatter with dependencies listed
- [ ] Verify every skill follows the 7-section format

---

## Step 5: Write Standing Orders

- [ ] Open `ntsl_spec.md` template
- [ ] Fill client info block
- [ ] Assign one "flavor" per weekday (Monday=Strategist, Tuesday=Producer, etc.)
- [ ] List recurring tasks with Day + Skill + Notes
- [ ] List active projects with Priority + Skill + Deadline
- [ ] Add NOTES section with channel focus, seasonal hooks, constraints
- [ ] Save as `standing_orders.md` in root and mirror to `workspace/data/standing_orders.md`

---

## Step 6: Configure the Runtime

- [ ] Copy `runtime_spec.md` logic into `runtime.py` (or use provided script)
- [ ] Set model provider and API key in `.env`
- [ ] Set folder path to client's workspace
- [ ] Configure cron: `0 2 * * * python /path/to/runtime.py` (Night Shift)
- [ ] OR configure sprint schedule (Day Shift)
- [ ] Test run: execute `runtime.py` manually, verify it reads files and produces output

---

## Step 7: Verify the First Run

- [ ] Check `workspace/data/alex-log.md` — run logged with timestamp
- [ ] Check `workspace/work/` — deliverables present with date-stamped filenames
- [ ] Check `workspace/reports/` — morning report present
- [ ] Open deliverable — verify it references client's actual brand, not generic placeholders
- [ ] Verify no banned terms, no invented data, no [TBD] markers

---

## Step 8: Human Review & Calibration

- [ ] Human reads morning report and opens deliverables
- [ ] Human leaves feedback in `workspace/data/` or edits `standing_orders.md`
- [ ] AI runs again; verify it incorporates human feedback
- [ ] Calibrate: if 50%+ outputs get REVISE on first pass, gate is too strict; if 80%+ pass, gate is too loose
- [ ] Lock configuration after 3 successful runs

---

## Step 9: Hand Off to Client (if applicable)

Send the client:
- [ ] Link to their Google Drive folder
- [ ] One-page quick reference: "How to talk to your AI teammate"
  - Drop files in `Data/` to give context
  - Edit `standing_orders.md` to change priorities
  - Read `reports/` to see what was produced
  - Reply by editing files — no special software needed
- [ ] Note: "All deliverables are in `Work/`. All strategy is in `standing_orders.md`."

---

## Step 10: Ongoing Maintenance

- [ ] Weekly: Review `decision_log.md` and answer parked questions
- [ ] Monthly: Review `content-pillars.md` and `competitive-landscape.md` for freshness
- [ ] Quarterly: Review `standing_orders.md` rhythm — adjust days, add/remove skills
- [ ] As needed: Add new skills to `skills/` following the template

---

## Version

`setup_checklist.md` — v1.0 — Minimal AI OS Canonical
