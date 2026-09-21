# Minimal AI OS — v2.0.0

The intelligence lives in markdown. The runtime is a courier. The filesystem is the brain.

- `spec.md` — the canonical specification (start here)
- `Alex-Final.md` — the governing orchestrator (alex-nightly v2.1.0)
- `skills/` — 17 hash-locked skill files (kernel; never edit in a deployed instance)
- `engine/` — verify.py (drift checker), lint_skills.py, generate_manifest.py, skill_add.py
- `templates/` — kernel molds for standing orders, teammates, reports
- `userland-template/` — stamped out per client at init (Data/, Work/, Assets/)
- `MANIFEST.json` — SHA-256 for every kernel file; generated, never hand-edited

Deploy a client: clone → copy userland-template to ClientName/ → fill Data/ →
`python engine/verify.py` must pass → first run.

Change the kernel: edit in this repo → bump version → `python engine/generate_manifest.py` →
commit. There is no other path. (spec.md §8)
