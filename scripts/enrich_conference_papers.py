#!/usr/bin/env python3
"""Generate incremental conference-paper notes from openly accessible PDFs.

The model token is never stored in the repository. It is read from the same
ANTHROPIC_AUTH_TOKEN secret used by the daily arXiv workflow.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from enrich_papers import (
    MODEL,
    TOKEN,
    condense_full_text,
    download_pdf,
    extract_pdf_pages,
    request_note,
)


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "dist" / "data"
INDEX_FILE = DATA_DIR / "conference-index.json"
CONFERENCE_DIR = DATA_DIR / "conferences"
NOTE_DIR = DATA_DIR / "conference-notes"
LIMIT = max(1, int(os.environ.get("CONFERENCE_ENRICH_LIMIT", "12")))
RETRY_DAYS = max(1, int(os.environ.get("CONFERENCE_RETRY_DAYS", "30")))
UNPAYWALL_EMAIL = os.environ.get("UNPAYWALL_EMAIL", "wei0413@users.noreply.github.com")
USER_AGENT = "recommendation-daily/1.3 (+https://github.com/wei0413/recommendation-daily)"
SUMMARY_KEYS = ("focus_label", "article_theme", "research_question", "main_contribution")
DETAIL_KEYS = ("key_ideas", "analysis_summary", "personal_view")


def note_id_for(paper_id: str) -> str:
    return hashlib.sha1(paper_id.encode("utf-8")).hexdigest()[:20]


def request_unpaywall(doi: str) -> dict:
    encoded = urllib.parse.quote(doi, safe="/")
    query = urllib.parse.urlencode({"email": UNPAYWALL_EMAIL})
    url = f"https://api.unpaywall.org/v2/{encoded}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def unpaywall_pdf_candidates(work: dict) -> list[str]:
    candidates: list[str] = []
    locations = [work.get("best_oa_location"), *work.get("oa_locations", [])]
    for location in locations:
        if not isinstance(location, dict):
            continue
        for key in ("url_for_pdf", "url"):
            value = str(location.get(key, "") or "").strip()
            if not value:
                continue
            if "arxiv.org/abs/" in value:
                value = value.replace("/abs/", "/pdf/")
            if key == "url" and "doi.org/" in value and "arxiv" not in value.lower():
                continue
            if value not in candidates:
                candidates.append(value)
    return candidates


def retry_due(paper: dict, now: datetime) -> bool:
    value = str(paper.get("conference_note_checked_at", "")).strip()
    if not value:
        return True
    try:
        checked = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return checked <= now - timedelta(days=RETRY_DAYS)
    except ValueError:
        return True


def save_year(year_file: Path, payload: dict) -> None:
    year_file.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    if not TOKEN:
        print("ANTHROPIC_AUTH_TOKEN is not configured; skipping conference AI notes.")
        return

    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    year_payloads: dict[int, tuple[Path, dict]] = {}
    pending: list[tuple[int, dict]] = []
    for year in index.get("years", []):
        year_file = CONFERENCE_DIR / f"{year}.json"
        payload = json.loads(year_file.read_text(encoding="utf-8"))
        year_payloads[int(year)] = (year_file, payload)
        for paper in payload.get("papers", []):
            if not paper.get("has_full_text_note") and retry_due(paper, now):
                pending.append((int(year), paper))

    pending.sort(key=lambda item: (-item[0], -int(item[1].get("relevance_score", 0)), item[1].get("conference", ""), item[1].get("title", "")))
    pending = pending[:LIMIT]
    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    completed = 0

    for position, (year, paper) in enumerate(pending, start=1):
        paper_id = paper.get("id", "")
        paper["conference_note_checked_at"] = now.isoformat()
        try:
            work = request_unpaywall(paper.get("doi", paper_id))
            pdf_candidates = unpaywall_pdf_candidates(work)
            institutions = paper.get("institutions", [])

            pdf_data = None
            pdf_url = ""
            pdf_errors = []
            for candidate in pdf_candidates:
                try:
                    pdf_data = download_pdf(candidate)
                    pdf_url = candidate
                    break
                except Exception as exc:
                    pdf_errors.append(f"{candidate}: {exc}")
            if pdf_data is None:
                raise RuntimeError("no downloadable open PDF; " + " | ".join(pdf_errors[:3]))

            pages = extract_pdf_pages(pdf_data)
            paper_for_model = {**paper, "institutions": institutions}
            full_text = condense_full_text(paper_for_model, pages)
            note = request_note(paper_for_model, full_text)
            if str(note.get("id", "")) != paper_id:
                raise ValueError("model returned a mismatched paper id")

            note_id = note_id_for(paper_id)
            for key in SUMMARY_KEYS:
                value = str(note.get(key, "")).strip()
                if value:
                    paper[key] = value
            paper.update({
                "note_id": note_id,
                "has_full_text_note": True,
                "note_model": MODEL,
                "note_basis": "full_text_pdf",
                "note_source": "Unpaywall open-access location",
                "note_source_url": work.get("doi_url", paper.get("url", "")),
                "pdf_url": pdf_url,
                "full_text_pages": len(pages),
            })
            paper.pop("conference_note_error", None)
            detail = {key: paper.get(key) for key in (
                "id", "title", "conference", "year", "doi", "authors", "institutions",
                "primary_institution", "institution_type", "organization_sector", "pdf_url",
                "note_model", "note_basis", "note_source", "note_source_url", "full_text_pages",
                *SUMMARY_KEYS,
            )}
            for key in DETAIL_KEYS:
                detail[key] = str(note.get(key, "")).strip()
            (NOTE_DIR / f"{note_id}.json").write_text(
                json.dumps(detail, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            completed += 1
            print(f"Generated conference note for {paper_id} from {len(pages)} pages ({position}/{len(pending)}).")
        except Exception as exc:
            paper["conference_note_error"] = re.sub(r"\s+", " ", str(exc)).strip()[:500]
            print(f"Conference note failed for {paper_id} ({position}/{len(pending)}): {paper['conference_note_error']}")
        save_year(*year_payloads[year])
        time.sleep(0.5)

    note_count = 0
    for _, payload in year_payloads.values():
        note_count += sum(1 for paper in payload.get("papers", []) if paper.get("has_full_text_note"))
    index["note_count"] = note_count
    INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {completed} new conference notes with {MODEL}; total available: {note_count}.")


if __name__ == "__main__":
    main()
