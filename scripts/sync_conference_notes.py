#!/usr/bin/env python3
"""Reuse existing arXiv full-text notes for matching conference papers."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "dist" / "data"
ARXIV_DATA = DATA_DIR / "recommendations.json"
INDEX_FILE = DATA_DIR / "conference-index.json"
CONFERENCE_DIR = DATA_DIR / "conferences"
NOTE_DIR = DATA_DIR / "conference-notes"

SUMMARY_KEYS = (
    "focus_label", "article_theme", "research_question", "main_contribution",
    "institutions", "primary_institution", "institution_type", "organization_sector",
    "note_model", "note_basis", "full_text_pages",
)
DETAIL_KEYS = ("key_ideas", "analysis_summary", "personal_view")


def normalize_title(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).lower()
    return re.sub(r"[^a-z0-9]+", "", value)


def note_id_for(paper_id: str) -> str:
    return hashlib.sha1(paper_id.encode("utf-8")).hexdigest()[:20]


def main() -> None:
    arxiv_payload = json.loads(ARXIV_DATA.read_text(encoding="utf-8"))
    arxiv_notes = {
        normalize_title(paper.get("title", "")): paper
        for paper in arxiv_payload.get("papers", [])
        if paper.get("note_basis") == "full_text_pdf"
        and all(paper.get(key) for key in ("article_theme", "research_question", "main_contribution", *DETAIL_KEYS))
    }
    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    matched = 0
    total_notes = 0

    for year in index.get("years", []):
        year_file = CONFERENCE_DIR / f"{year}.json"
        payload = json.loads(year_file.read_text(encoding="utf-8"))
        for paper in payload.get("papers", []):
            if paper.get("has_full_text_note") and paper.get("note_id"):
                total_notes += 1
                continue
            arxiv = arxiv_notes.get(normalize_title(paper.get("title", "")))
            if not arxiv:
                continue
            note_id = note_id_for(paper["id"])
            for key in SUMMARY_KEYS:
                if key in arxiv:
                    paper[key] = arxiv[key]
            paper.update({
                "note_id": note_id,
                "has_full_text_note": True,
                "note_basis": "full_text_pdf",
                "note_source": f"arXiv:{arxiv['id']}",
                "note_source_url": arxiv.get("url", ""),
                "pdf_url": arxiv.get("pdf_url", ""),
            })
            detail = {
                "id": paper["id"],
                "title": paper.get("title", ""),
                "conference": paper.get("conference", ""),
                "year": paper.get("year"),
                "doi": paper.get("doi", ""),
                "authors": paper.get("authors", []),
                "pdf_url": paper.get("pdf_url", ""),
                "note_source": paper["note_source"],
                "note_source_url": paper["note_source_url"],
            }
            for key in SUMMARY_KEYS + DETAIL_KEYS:
                if key in arxiv:
                    detail[key] = arxiv[key]
            (NOTE_DIR / f"{note_id}.json").write_text(
                json.dumps(detail, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            matched += 1
            total_notes += 1
        year_file.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

    index["note_count"] = total_notes
    INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Reused {matched} arXiv full-text notes; conference notes available: {total_notes}.")


if __name__ == "__main__":
    main()
