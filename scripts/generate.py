#!/usr/bin/env python3
"""Run the version 7 natural-conversation generator."""
from __future__ import annotations

import base64
import gzip
from pathlib import Path

SOURCE_FILE = Path(__file__).resolve()
PAYLOAD = SOURCE_FILE.with_name("generate_v7.py.gz.b64")
CODE = gzip.decompress(base64.b64decode(PAYLOAD.read_text(encoding="ascii")))
GLOBALS = {"__name__": "__main__", "__file__": str(SOURCE_FILE), "__package__": None}
exec(compile(CODE, str(PAYLOAD) + ":decoded", "exec"), GLOBALS)
