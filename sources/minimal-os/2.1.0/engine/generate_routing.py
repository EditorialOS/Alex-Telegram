#!/usr/bin/env python3
"""Instance classification table -> routing.json. The markdown is the authored
source; this file is generated. Also the instance linter (--lint)."""
import json, re, sys, pathlib
VALID_CLASSES = {"reasoning", "implementation", "voice"}
VALID_GATES = {"full", "compressed", "none"}

def parse(instance_path, skills_dir):
    text = pathlib.Path(instance_path).read_text()
    skills_avail = {p.stem for p in pathlib.Path(skills_dir).glob("*.md")}
    routing, errors = {}, []
    # main table rows: | intents | /wf | skills | gate | class | pause |
    for m in re.finditer(r"^\|([^|]+)\|\s*(/[a-z-]+)\s*\|([^|]+)\|\s*(\w+)\s*\|\s*(\w+)\s*\|([^|]*)\|",
                         text, re.M):
        intents, wf, skills, gate, mclass, pause = [g.strip() for g in m.groups()]
        skills_l = [s.strip() for s in skills.split(",")]
        for s in skills_l:
            for alt in s.split(" or "):
                if alt.strip() not in skills_avail:
                    errors.append(f"{wf}: skill '{alt.strip()}' not in skills/")
        if mclass not in VALID_CLASSES: errors.append(f"{wf}: invalid model class '{mclass}'")
        if gate not in VALID_GATES: errors.append(f"{wf}: invalid gate '{gate}'")
        if wf in routing: errors.append(f"duplicate workflow {wf}")
        routing[wf] = {"skills": skills_l, "gate": gate, "model_class": mclass,
                       "approval_pause": pause.lower().startswith("yes"),
                       "intents": [i.strip() for i in intents.split(",")]}
    # quick hits: | /cmd | skill | class | output |
    for m in re.finditer(r"^\|\s*(/[a-z-]+)\s*\|([^|]+)\|\s*(\w+)\s*\|([^|]+)\|", text, re.M):
        cmd, skill, mclass, _ = [g.strip() for g in m.groups()]
        if cmd in routing: continue
        if mclass not in VALID_CLASSES: continue
        routing[cmd] = {"skills": [skill], "gate": "compressed",
                        "model_class": mclass, "quick_hit": True}
    return routing, errors

if __name__ == "__main__":
    root = pathlib.Path(__file__).parent.parent
    inst = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else root / "alex.md"
    routing, errors = parse(inst, root / "skills")
    if errors:
        print("LINT FAIL:"); [print(" ", e) for e in errors]; sys.exit(1)
    print(f"LINT PASS — {len(routing)} routes")
    if "--lint" not in sys.argv:
        (root / "routing.json").write_text(json.dumps(routing, indent=2) + "\n")
        print(f"routing.json written")
