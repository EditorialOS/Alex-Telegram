#!/usr/bin/env python3
"""Minimal AI OS — runtime.py (spec.md §6)
The courier. Verifies the kernel, builds the queue from standing orders
(and/or an ad-hoc task), assembles prompts from kernel + userland, calls
the model, runs the gate loop, saves date-stamped deliverables, logs,
reports, exits. No persistent process. The filesystem is the memory.

Usage:
  python3 engine/runtime.py --client clients/Acme                 # standing orders due today
  python3 engine/runtime.py --client clients/Acme \
      --task "Blog post on rooftop gardens" --workflow /blog-post # ad-hoc
  python3 engine/runtime.py --client clients/Acme --dry-run       # assemble, don't call model

Cron (spec §6, Night Shift at 02:00):
  0 2 * * * cd /path/to/minimal-os && python3 engine/runtime.py --client clients/Acme

Config (.env at repo root or environment):
  ANTHROPIC_API_KEY=...        required for live runs
  MOS_MODEL=claude-sonnet-4-6  optional; the model-agnostic seam is call_model()
"""
import argparse, datetime, json, os, re, sys, urllib.request, hashlib, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"

# ---------------------------------------------------------------- routing
# Generated from Alex-Final.md v2.1.0 classification table.
# If Alex-Final's table changes, regenerate this dict (deliberate-change protocol).
WORKFLOWS = {
    "/editorial-calendar": {"skills": ["content-strategist"], "out": "strategy"},
    "/story-brief":        {"skills": ["story-commissioner", "editorial-voice"], "out": "strategy"},
    "/commission-batch":   {"skills": ["story-commissioner", "content-strategist"], "out": "strategy"},
    "/feature":            {"skills": ["editorial-voice", "feature-writer", "editorial-gate"], "out": "drafts"},
    "/blog-post":          {"skills": ["editorial-voice", "blog-writer", "editorial-gate", "seo-brief"], "out": "drafts"},
    "/newsletter":         {"skills": ["editorial-voice", "newsletter-writer", "editorial-gate"], "out": "drafts"},
    "/social-week":        {"skills": ["editorial-voice", "social-content", "editorial-gate"], "out": "social"},
    "/email-sequence":     {"skills": ["editorial-voice", "email-copywriter", "editorial-gate"], "out": "drafts"},
    "/video-script":       {"skills": ["editorial-voice", "video-scriptwriter", "editorial-gate"], "out": "drafts"},
    "/audio-script":       {"skills": ["editorial-voice", "audio-scriptwriter", "editorial-gate"], "out": "drafts"},
    "/campaign-kit":       {"skills": ["content-strategist", "channel-briefs", "editorial-voice", "editorial-gate"],
                            "out": "campaigns", "approval_pause": True},
    "/repurpose":          {"skills": ["content-repurposer", "editorial-voice", "editorial-gate"], "out": "social"},
    "/creative-brief":     {"skills": ["creative-brief", "editorial-voice"], "out": "strategy"},
    "/content-report":     {"skills": ["content-performance"], "out": "reports"},
    "/voice-guide":        {"skills": ["editorial-voice"], "out": "strategy"},
    "/content-audit":      {"skills": ["content-strategist", "content-performance", "seo-brief"], "out": "reports"},
    "/quarterly-review":   {"skills": ["content-strategist", "content-performance", "editorial-voice"], "out": "reports"},
}

_r = ROOT / "routing.json"
if _r.exists():
    import json as _j
    _loaded = _j.loads(_r.read_text())
    for _k, _v in _loaded.items():
        WORKFLOWS[_k] = {"skills": [s.split(" or ")[0] for s in _v["skills"]],
                         "out": WORKFLOWS.get(_k, {}).get("out", "drafts"),
                         "approval_pause": _v.get("approval_pause", False),
                         "model_class": _v.get("model_class", "implementation")}

DATA_FILES = ["brand-voice.md", "content-pillars.md", "audience-personas.md",
              "style-guide.md", "competitive-landscape.md", "standing_orders.md", "alex-log.md"]
PLACEHOLDER = "To be created during onboarding"


# ---------------------------------------------------------------- step 0: verify
def verify_kernel():
    manifest = json.loads((ROOT / "MANIFEST.json").read_text())
    bad = [e["path"] for e in manifest["files"]
           if not (ROOT / e["path"]).exists()
           or hashlib.sha256((ROOT / e["path"]).read_bytes()).hexdigest() != e["sha256"]]
    return manifest["os_version"], bad


# ---------------------------------------------------------------- steps 1-3: queue
def read_data(client):
    data = {}
    for f in DATA_FILES:
        p = client / "Data" / f
        data[f] = p.read_text() if p.exists() else ""
    m = re.search(r"Client name:\s*(\S+)", data.get("standing_orders.md", ""))
    data["_first_name"] = m.group(1) if m else "there"
    return data


def parse_ntsl(standing_orders, today):
    """Weekly tasks matched on weekday name. Biweekly/Monthly matched only on a
    literal weekday-name hit in Day:; otherwise skipped and flagged (v1 limits)."""
    tasks, skipped = [], []
    weekday = today.strftime("%A")
    blocks = re.findall(
        r"- Task:\s*(.+?)\n\s*Day:\s*(.+?)\n\s*Workflow:\s*(\S+)(?:\n\s*Notes:\s*(.+?))?(?=\n- Task:|\n#|\n\Z)",
        standing_orders, re.S)
    for task, day, wf, notes in blocks:
        if weekday.lower() in day.lower():
            tasks.append({"brief": task.strip(), "workflow": wf.strip(),
                          "notes": (notes or "").strip(), "source": "standing-order"})
        elif not any(d in day for d in
                     ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]):
            skipped.append(f"{task.strip()} (Day: {day.strip()} — pattern not yet parseable)")
    return tasks, skipped


# ---------------------------------------------------------------- step 5: pre-flight
def preflight(task, data):
    wf = WORKFLOWS.get(task["workflow"])
    if not wf:
        return "BLOCKED", f"no workflow registered for {task['workflow']}"
    missing = [s for s in wf["skills"] if not (SKILLS / f"{s}.md").exists()]
    if missing:
        return "BLOCKED", f"skill files missing: {missing}"
    stale = [f for f in ("brand-voice.md", "style-guide.md")
             if PLACEHOLDER in data.get(f, "")]
    if stale:
        return "PARTIAL", f"defaults in use for {stale} — inferences will be flagged"
    return "READY", ""


# ---------------------------------------------------------------- step 6: assemble + call
def assemble_prompt(task, data, orchestrator):
    wf = WORKFLOWS[task["workflow"]]
    skills_text = "\n\n".join(
        f"<skill file='{s}.md'>\n{(SKILLS / (s + '.md')).read_text()}\n</skill>"
        for s in wf["skills"])
    context = "\n\n".join(
        f"<data file='{f}'>\n{data[f]}\n</data>" for f in DATA_FILES if data.get(f))
    log_tail = "\n".join(data.get("alex-log.md", "").splitlines()[-40:])
    return f"""<orchestrator>
{orchestrator}
</orchestrator>

<client_context>
{context}
</client_context>

<recent_log>
{log_tail}
</recent_log>

<skills_loaded>
{skills_text}
</skills_loaded>

<task workflow="{task['workflow']}">
{task['brief']}
Notes: {task.get('notes', '')}
</task>

<instruction>
You are Alex, executing this single task per the orchestrator's reasoning loop
(steps 5-7). Apply the loaded skills. The client's Data/ files override any
defaults in the skills. Produce the complete deliverable in clean markdown.
If editorial-gate.md is loaded and the deliverable exceeds 200 words, run the
full 5-gate and append the '## QA' scorecard with 'Verdict: APPROVED' /
'REVISE' / 'KILL' exactly as the gate specifies. Do not mention skills,
workflows, or internal structure inside the deliverable body.
</instruction>"""


def call_model(prompt, config, model_class="implementation"):
    """Driver seam (spec §6 + protocol §Model Classes). Routing in engine/drivers.json."""
    import json as _j, pathlib as _p
    drv_path = _p.Path(__file__).parent / "drivers.json"
    drivers = _j.loads(drv_path.read_text()) if drv_path.exists() else {}
    d = drivers.get(model_class) or {"provider": "anthropic", "model": config["model"]}
    if d["provider"] == "openai_compatible":
        key = os.environ.get(d.get("api_key_env", ""), "")
        req = urllib.request.Request(
            d["base_url"].rstrip("/") + "/chat/completions",
            data=json.dumps({"model": d["model"], "max_tokens": 8000,
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"content-type": "application/json",
                     **({"Authorization": f"Bearer {key}"} if key else {})})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"]
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({"model": d.get("model", config["model"]), "max_tokens": 8000,
                         "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"x-api-key": config["key"], "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        body = json.loads(r.read())
    return "".join(b.get("text", "") for b in body.get("content", []))


# ---------------------------------------------------------------- step 7: gate loop
def gate_verdict(output):
    m = re.search(r"Verdict:\s*\**\s*(APPROVED|REVISE|KILL)", output)
    return m.group(1) if m else "UNGATED"


def run_task(task, data, orchestrator, config, dry_run, model_class="implementation"):
    prompt = assemble_prompt(task, data, orchestrator)
    if dry_run:
        return "DRY", prompt, None
    output = call_model(prompt, config, model_class)
    for attempt in range(2):                       # max 2 revise passes (spec §4)
        v = gate_verdict(output)
        if v != "REVISE":
            break
        output = call_model(
            prompt + f"\n\n<revision attempt='{attempt+1}'>\nThe gate returned "
            f"REVISE. Here is the draft with its scorecard — fix ONLY the flagged "
            f"issues, preserve everything that passed, re-run the gate:\n{output}\n</revision>",
            config, model_class)
    return gate_verdict(output), output, prompt


# ---------------------------------------------------------------- steps 8-9: save/log/report
def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "task"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True)
    ap.add_argument("--task"); ap.add_argument("--workflow")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    client = pathlib.Path(args.client).resolve()
    today = datetime.date.today()
    stamp = today.isoformat()
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # .env (repo root) — minimal parser
    env = {}
    envp = ROOT / ".env"
    if envp.exists():
        env = dict(l.split("=", 1) for l in envp.read_text().splitlines() if "=" in l and not l.startswith("#"))
    config = {"key": os.environ.get("ANTHROPIC_API_KEY", env.get("ANTHROPIC_API_KEY", "")),
              "model": os.environ.get("MOS_MODEL", env.get("MOS_MODEL", "claude-sonnet-4-6"))}

    # 0. VERIFY
    osv, drift = verify_kernel()
    if drift:
        report = f"# INTEGRITY FLAG — {stamp}\n\nKernel drift detected; production halted (spec §8):\n" + \
                 "\n".join(f"- {p}" for p in drift)
        (client / "Work" / "reports" / f"{stamp}-integrity-flag.md").write_text(report)
        print("VERIFY FAIL — halted. Integrity flag written to Work/reports/."); sys.exit(1)
    print(f"VERIFY PASS (os {osv})")

    # 1-3. QUEUE
    data = read_data(client)
    queue, skipped = parse_ntsl(data["standing_orders.md"], today)
    if args.task:
        queue.append({"brief": args.task, "workflow": args.workflow or "/blog-post",
                      "notes": "", "source": "ad-hoc"})
    if not queue:
        print("Queue empty — nothing due today, no ad-hoc task. Exiting quietly (spec §7: no zero-deliverable report).")
        return
    if not args.dry_run and not config["key"]:
        print("No ANTHROPIC_API_KEY — use --dry-run or set the key in .env."); sys.exit(1)

    orchestrator = (ROOT / "orchestrator-protocol.md").read_text() + "\n\n" + (ROOT / "alex.md").read_text()
    done, blocked, killed = [], list(skipped), []

    for task in queue:
        status, note = preflight(task, data)
        label = f"[{task['workflow']}] {task['brief'][:60]}"
        if status == "BLOCKED":
            blocked.append(f"{label} — {note}"); print(f"BLOCKED  {label} — {note}"); continue
        if WORKFLOWS[task["workflow"]].get("approval_pause"):
            note = (note + " | " if note else "") + "campaign workflow: runs to channel-briefs then pauses for approval"
        verdict, output, prompt = run_task(task, data, orchestrator, config, args.dry_run,
                                           WORKFLOWS[task["workflow"]].get("model_class", "implementation"))
        wf = WORKFLOWS[task["workflow"]]
        fname = f"{stamp}-{slug(task['brief'])}.md"
        outdir = client / "Work" / wf["out"]
        if verdict == "DRY":
            (outdir / f"{stamp}-DRYRUN-{slug(task['brief'])}.prompt.md").write_text(output)
            done.append(f"{label} → DRY RUN (assembled prompt saved, {len(output):,} chars)")
            print(f"DRY      {label} — prompt assembled, {len(output):,} chars")
        elif verdict == "KILL":
            killed.append(label); print(f"KILL     {label} — not saved (spec §4)")
        else:
            path = outdir / fname
            if path.exists():                      # never overwrite
                path = outdir / f"{stamp}-{slug(task['brief'])}-{datetime.datetime.now().strftime('%H%M')}.md"
            path.write_text(output)
            flag = f" ({note})" if status == "PARTIAL" else ""
            done.append(f"{label} → Work/{wf['out']}/{path.name} [{verdict}]{flag}")
            print(f"{verdict:8} {label} → {path.name}")

    # 9. LOG + REPORT
    log = (f"\n## Run — {ts}\n\n**Mode:** {'dry-run' if args.dry_run else 'cron/CLI'}\n"
           f"**Tasks queued:** {len(queue)}  **Completed:** {len(done)}  "
           f"**Blocked:** {len(blocked)}  **Killed:** {len(killed)}\n\n"
           + "".join(f"- {d}\n" for d in done)
           + ("".join(f"- BLOCKED: {b}\n" for b in blocked))
           + ("".join(f"- KILLED: {k}\n" for k in killed)))
    with open(client / "Data" / "alex-log.md", "a") as f:
        f.write(log)

    if done:
        first = data["_first_name"]
        report = (f"# Morning Brief — {stamp}\n\nHi {first},\n\n"
                  f"{len(done)} deliverable(s) in your Work folder this morning.\n\n"
                  + "".join(f"{i+1}. {d}\n" for i, d in enumerate(done))
                  + (("\nWhat I need from you:\n" + "".join(f"- {b}\n" for b in blocked)) if blocked else "")
                  + "\n— Alex\n")
        (client / "Work" / "reports" / f"{stamp}-morning-report.md").write_text(report)
        print(f"\nMorning report → Work/reports/{stamp}-morning-report.md")
    print("Run complete. Exiting — no persistent process.")


if __name__ == "__main__":
    main()
