#!/usr/bin/env python3
"""Load the natural conversation generator payload."""
from __future__ import annotations

import base64
import gzip
from pathlib import Path

SOURCE_FILE = Path(__file__).resolve()
PAYLOAD = SOURCE_FILE.with_name("generate.v5.py.gz.b64")
CODE = gzip.decompress(base64.b64decode(PAYLOAD.read_text(encoding="utf-8").strip()))
GLOBALS = {"__name__": "__main__", "__file__": str(SOURCE_FILE), "__package__": None}
exec(compile(CODE, str(PAYLOAD) + ":decoded", "exec"), GLOBALS)
