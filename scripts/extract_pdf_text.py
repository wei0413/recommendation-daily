#!/usr/bin/env python3
"""Extract PDF text in an isolated process with a bounded page count."""

from __future__ import annotations

import json
import re
import sys
from io import BytesIO

from pypdf import PdfReader


def main() -> None:
    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    data = sys.stdin.buffer.read()
    reader = PdfReader(BytesIO(data), strict=False)
    page_count = len(reader.pages)
    if page_count > max_pages:
        raise RuntimeError(
            f"PDF has {page_count} pages, above the {max_pages}-page single-paper limit"
        )

    pages: list[str] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = text.encode("utf-8", errors="replace").decode("utf-8")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            pages.append(f"--- 第 {page_number} 页 ---\n{text}")
    if not pages:
        raise RuntimeError("no extractable text found in PDF")
    sys.stdout.buffer.write(json.dumps(pages, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.buffer.write(str(exc).encode("utf-8", errors="replace"))
        raise SystemExit(1)
