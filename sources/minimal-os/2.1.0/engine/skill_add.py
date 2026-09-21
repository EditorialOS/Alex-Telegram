#!/usr/bin/env python3
"""Minimal AI OS — thin skill installer (spec.md §3, §8).
Installs a skill file into skills/, lints it, and regenerates the manifest.
The ONLY legal way to add a skill to a kernel."""
import shutil, sys, pathlib
import lint_skills, generate_manifest

def add(skill_path, root=None):
    root = pathlib.Path(root or pathlib.Path(__file__).parent.parent)
    src = pathlib.Path(skill_path)
    dst = root / "skills" / src.name
    shutil.copy2(src, dst)
    files, errors = lint_skills.lint(root / "skills")
    if errors:
        dst.unlink()
        print(f"REJECTED {src.name} — lint failed:")
        [print("  " + e) for e in errors]; sys.exit(1)
    generate_manifest.generate(root, input_version(root))
    print(f"INSTALLED {src.name} — lint passed, manifest regenerated")

def input_version(root):
    import json
    return json.loads((root / "MANIFEST.json").read_text())["os_version"]

if __name__ == "__main__":
    add(sys.argv[1])
