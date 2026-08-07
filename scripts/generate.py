#!/usr/bin/env python3
"""One-shot repair bootstrap. Replaced by the clean generator during this run."""
from __future__ import annotations

import base64
import io
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = sorted((ROOT / ".repair").glob("bundle.*"))
if not CHUNKS:
    raise SystemExit("repair bundle chunks are missing")

encoded = "".join(path.read_text(encoding="ascii") for path in CHUNKS)
archive = base64.b64decode(encoded, validate=True)
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
    bundle.extractall(ROOT, filter="data")

for relative in (
    "conversation-ui.js",
    "conversation-ui.css",
    "current-topics.js",
    "hotfix.css",
    "sw.js",
    "scripts/generate_v7.py.gz.b64",
    "scripts/generate_v5.py.gz.b64",
    "scripts/generate.v5.py.gz.b64",
    "scripts/generate.runtime.py.gz",
    "app.runtime.js.gz",
    ".github/workflows/apply-repair.yml",
):
    path = ROOT / relative
    if path.is_file() or path.is_symlink():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)

shutil.rmtree(ROOT / ".repair", ignore_errors=True)

checks = (
    [sys.executable, "-m", "py_compile", "scripts/generate.py"],
    [sys.executable, "scripts/generate.py", "--check"],
    ["node", "--check", "app.js"],
)
for command in checks:
    subprocess.run(command, cwd=ROOT, check=True)

subprocess.run(["git", "config", "user.name", "small-signals-repair[bot]"], cwd=ROOT, check=True)
subprocess.run(["git", "config", "user.email", "small-signals-repair[bot]@users.noreply.github.com"], cwd=ROOT, check=True)
subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
subprocess.run(["git", "commit", "-m", "Rebuild small-signals V9 cleanly"], cwd=ROOT, check=True)
subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=ROOT, check=True)
subprocess.run(["git", "push", "origin", "HEAD:main"], cwd=ROOT, check=True)
print("V9 repair applied and pushed")
