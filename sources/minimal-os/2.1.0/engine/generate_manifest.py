#!/usr/bin/env python3
"""Minimal AI OS — manifest generator (spec.md §8).
Hashes every kernel file and writes MANIFEST.json at the repo root.
Run at commit time. Never hand-edit the manifest."""
import hashlib, json, re, sys, pathlib
from datetime import datetime, timezone

KERNEL = ["spec.md", "orchestrator-protocol.md", "alex.md", "routing.json", "CLAUDE.md", "README.md", "ROADMAP.md",
          "skills", "engine", "templates"]

def file_version(p):
    m = re.search(r"^version:\s*([0-9.]+)\s*$", p.read_text(errors="ignore"), re.M)
    if m: return m.group(1)
    m = re.search(r"\*\*Version:\*\*\s*([0-9.]+)", p.read_text(errors="ignore"))
    return m.group(1) if m else "-"

def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def generate(root, os_version):
    root = pathlib.Path(root)
    entries = []
    for item in KERNEL:
        p = root / item
        targets = sorted(p.rglob("*")) if p.is_dir() else [p]
        for t in targets:
            if t.is_file() and t.name != "MANIFEST.json":
                entries.append({
                    "path": str(t.relative_to(root)),
                    "version": file_version(t) if t.suffix == ".md" else "-",
                    "sha256": sha256(t),
                })
    manifest = {
        "os_version": os_version,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": entries,
    }
    (root / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"MANIFEST.json written — {len(entries)} kernel files hashed, os_version {os_version}")

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent.parent
    ver = sys.argv[2] if len(sys.argv) > 2 else "2.0.0"
    generate(root, ver)
