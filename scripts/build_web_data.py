#!/usr/bin/env python3
"""Build lightweight browser data from the canonical recommendation archive.

The full archive remains in recommendations.json for automation and backups.
The browser downloads a small index first, then fetches one paper's long-form
abstract and AI note only when the reader expands that card.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "dist" / "data"
SOURCE = DATA_DIR / "recommendations.json"
INDEX = DATA_DIR / "recommendations-index.json"
DETAIL_DIR = DATA_DIR / "papers"

DETAIL_KEYS = (
    "abstract",
    "key_ideas",
    "analysis_summary",
    "personal_view",
    "reading_note",
)


def compact_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    papers = payload.get("papers", [])
    index_papers: list[dict] = []

    for paper in papers:
        paper_id = str(paper["id"])
        summary = {key: value for key, value in paper.items() if key not in DETAIL_KEYS}
        summary["has_full_text_note"] = bool(
            paper.get("note_basis") == "full_text_pdf"
            and paper.get("article_theme")
            and paper.get("research_question")
            and paper.get("main_contribution")
            and paper.get("key_ideas")
            and paper.get("analysis_summary")
            and paper.get("personal_view")
        )
        index_papers.append(summary)
        details = {"id": paper_id}
        details.update({key: paper[key] for key in DETAIL_KEYS if paper.get(key)})
        compact_write(DETAIL_DIR / f"{paper_id}.json", details)

    compact_write(
        INDEX,
        {
            "generated_at": payload.get("generated_at", ""),
            "source": payload.get("source", "arXiv"),
            "papers": index_papers,
        },
    )
    print(f"Built browser index for {len(index_papers)} papers at {INDEX}")


if __name__ == "__main__":
    main()
