#!/usr/bin/env python3
"""Minimal AI OS — client initializer (spec.md §8 install, step 2).
Stamps userland-template out as a new client folder."""
import shutil, sys, pathlib

def init(name, dest_root=None):
    root = pathlib.Path(__file__).parent.parent
    dest = pathlib.Path(dest_root or root / "clients") / name
    if dest.exists():
        print(f"ABORT: {dest} already exists"); sys.exit(1)
    shutil.copytree(root / "userland-template", dest)
    print(f"INITIALIZED {dest}")
    print("Next: fill Data/ (or leave molds — defaults apply and get flagged),")
    print("write Data/standing_orders.md, then run engine/verify.py before first run.")

if __name__ == "__main__":
    init(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
