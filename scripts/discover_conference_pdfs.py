#!/usr/bin/env python3
"""Discover legal open-PDF locations for every conference paper via Unpaywall."""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from enrich_conference_papers import request_unpaywall, unpaywall_pdf_candidates


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "dist" / "data"
INDEX_FILE = DATA_DIR / "conference-index.json"
CONFERENCE_DIR = DATA_DIR / "conferences"
LIMIT = max(1, int(os.environ.get("CONFERENCE_DISCOVERY_LIMIT", "5000")))
WORKERS = max(1, min(6, int(os.environ.get("UNPAYWALL_WORKERS", "4"))))


def save_payload(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def status_totals(year_payloads: dict[int, tuple[Path, dict]]) -> dict[str, int]:
    totals = {"available": 0, "unavailable": 0, "error": 0, "pending": 0}
    for _, payload in year_payloads.values():
        for paper in payload.get("papers", []):
            if paper.get("has_full_text_note"):
                totals["available"] += 1
                continue
            status = paper.get("conference_pdf_status", "pending")
            totals[status if status in totals else "pending"] += 1
    return totals


def discover(paper: dict) -> tuple[str, list[str], str]:
    try:
        work = request_unpaywall(paper.get("doi", paper.get("id", "")))
        candidates = unpaywall_pdf_candidates(work)
        return ("available" if candidates else "unavailable", candidates, "")
    except HTTPError as exc:
        if exc.code == 404:
            return "unavailable", [], "DOI not indexed by Unpaywall"
        return "error", [], f"HTTP {exc.code} {exc.reason}"
    except Exception as exc:
        return "error", [], str(exc)[:300]


def main() -> None:
    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    year_payloads: dict[int, tuple[Path, dict]] = {}
    jobs: list[tuple[int, dict]] = []
    for year in index.get("years", []):
        year_file = CONFERENCE_DIR / f"{year}.json"
        payload = json.loads(year_file.read_text(encoding="utf-8"))
        year_payloads[int(year)] = (year_file, payload)
        for paper in payload.get("papers", []):
            if paper.get("has_full_text_note") or paper.get("conference_pdf_status") in {"available", "unavailable"}:
                continue
            jobs.append((int(year), paper))

    jobs = jobs[:LIMIT]
    if not jobs:
        index["pdf_discovery"] = status_totals(year_payloads)
        INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("All conference papers already have an open-PDF discovery result.")
        return

    now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()
    completed = 0
    counts = {"available": 0, "unavailable": 0, "error": 0}
    dirty_years: set[int] = set()
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(discover, paper): (year, paper) for year, paper in jobs}
        for future in as_completed(futures):
            year, paper = futures[future]
            status, candidates, error = future.result()
            paper["conference_pdf_status"] = status
            paper["conference_pdf_candidates"] = candidates
            paper["conference_pdf_checked_at"] = now
            if error:
                paper["conference_pdf_error"] = error
            else:
                paper.pop("conference_pdf_error", None)
            counts[status] += 1
            completed += 1
            dirty_years.add(year)
            if completed % 25 == 0:
                for dirty_year in list(dirty_years):
                    save_payload(*year_payloads[dirty_year])
                dirty_years.clear()
                print(f"Discovered {completed}/{len(jobs)} papers: {counts}", flush=True)

    for dirty_year in dirty_years:
        save_payload(*year_payloads[dirty_year])
    index["pdf_discovery"] = status_totals(year_payloads)
    index["pdf_discovery_checked_at"] = now
    INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Open-PDF discovery complete for {completed} papers: {counts}.")


if __name__ == "__main__":
    main()
