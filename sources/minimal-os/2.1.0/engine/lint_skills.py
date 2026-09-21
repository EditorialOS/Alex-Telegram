#!/usr/bin/env python3
"""Minimal AI OS — skill conformance linter (spec.md §3).
Checks every skills/*.md for: valid frontmatter, name==filename,
required keys, valid layer/gate values, dependencies key present,
and that every declared dependency exists in skills/."""
import re, sys, pathlib

REQUIRED = ["name", "description", "version", "author", "layer", "dependencies", "gate"]
LAYERS = {"production", "reference", "governance", "orchestration"}
GATES = {"full", "compressed", "none"}

def lint(skills_dir):
    skills_dir = pathlib.Path(skills_dir)
    files = sorted(skills_dir.glob("*.md"))
    names = {f.stem for f in files}
    errors = []
    for f in files:
        text = f.read_text()
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        if not m:
            errors.append(f"{f.name}: no frontmatter"); continue
        fm = m.group(1)
        keys = dict(re.findall(r"^([a-z_]+):\s*(.*)$", fm, re.M))
        for k in REQUIRED:
            if k not in fm.split("\n")[0:100].__str__() and k not in keys:
                errors.append(f"{f.name}: missing key '{k}'")
        if keys.get("name") != f.stem:
            errors.append(f"{f.name}: name '{keys.get('name')}' != filename '{f.stem}'")
        if keys.get("layer") not in LAYERS:
            errors.append(f"{f.name}: invalid layer '{keys.get('layer')}'")
        if keys.get("gate") not in GATES:
            errors.append(f"{f.name}: invalid gate '{keys.get('gate')}'")
        if "dependencies" not in fm:
            errors.append(f"{f.name}: no dependencies key")
        for dep in re.findall(r"^\s+-\s+(\S+\.md)\s*$", fm, re.M):
            if dep[:-3] not in names:
                errors.append(f"{f.name}: dependency '{dep}' not found in skills/")
    return files, errors

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent.parent / "skills"
    files, errors = lint(d)
    print(f"linted {len(files)} skills")
    if errors:
        print("FAIL:"); [print("  " + e) for e in errors]; sys.exit(1)
    print("PASS: all skills conform to spec.md §3")
