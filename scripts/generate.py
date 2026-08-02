#!/usr/bin/env python3
"""Load the compressed social-thread generator."""
from __future__ import annotations

import gzip
from pathlib import Path

SOURCE_FILE = Path(__file__).resolve()
PAYLOAD = SOURCE_FILE.with_name("generate.v3.py.gz")
CODE = gzip.decompress(PAYLOAD.read_bytes())
GLOBALS = {"__name__": "__main__", "__file__": str(SOURCE_FILE), "__package__": None}
exec(compile(CODE, str(PAYLOAD) + ":decoded", "exec"), GLOBALS)
