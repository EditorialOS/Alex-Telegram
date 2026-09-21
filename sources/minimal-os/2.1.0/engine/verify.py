#!/usr/bin/env python3
"""Minimal AI OS — drift checker (spec.md §8; runtime step 0).
Recomputes every kernel hash and compares to MANIFEST.json.
Exit 0 = conforming instance. Exit 1 = DRIFT — halt production."""
import hashlib, json, sys, pathlib

def verify(root):
    root = pathlib.Path(root)
    manifest = json.loads((root / "MANIFEST.json").read_text())
    drift, missing = [], []
    for e in manifest["files"]:
        p = root / e["path"]
        if not p.exists():
            missing.append(e["path"]); continue
        if hashlib.sha256(p.read_bytes()).hexdigest() != e["sha256"]:
            drift.append(e["path"])
    return manifest, drift, missing

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent.parent
    manifest, drift, missing = verify(root)
    n = len(manifest["files"])
    if not drift and not missing:
        print(f"VERIFY PASS — {n}/{n} kernel files match MANIFEST.json (os {manifest['os_version']})")
        sys.exit(0)
    print(f"VERIFY FAIL — DRIFT DETECTED (os {manifest['os_version']})")
    for p in drift:   print(f"  MODIFIED: {p}")
    for p in missing: print(f"  MISSING:  {p}")
    print("Halt production. Restore the kernel or run the deliberate-change protocol.")
    sys.exit(1)
