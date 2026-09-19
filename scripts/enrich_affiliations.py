#!/usr/bin/env python3
"""Fill missing public affiliations from arXiv HTML pages."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from update_papers import classify_institution_type, organization_sector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "recommendations.json"
LIMIT = max(1, int(os.environ.get("AFFILIATION_LIMIT", "24")))
USER_AGENT = "recommendation-daily/1.0 (https://github.com/wei0413/recommendation-daily)"


class AffiliationParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.parts: list[str] = []
        self.affiliations: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.depth:
            self.depth += 1
            return
        classes = dict(attrs).get("class", "") or ""
        if tag == "span" and "ltx_role_affiliation" in classes.split():
            self.depth = 1
            self.parts = []

    def handle_endtag(self, tag: str) -> None:
        if not self.depth:
            return
        self.depth -= 1
        if self.depth == 0:
            value = " ".join("".join(self.parts).replace("Affiliation:", "").split())
            if value and value not in self.affiliations:
                self.affiliations.append(value)
            self.parts = []

    def handle_data(self, data: str) -> None:
        if self.depth:
            self.parts.append(data)


def fetch_html(paper_id: str) -> str:
    url = f"https://arxiv.org/html/{paper_id}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        if "unknown url type: https" not in str(exc):
            raise
        result = subprocess.run(
            ["curl", "-L", "--fail", "--silent", "--show-error", "--user-agent", USER_AGENT, url],
            check=True,
            capture_output=True,
        )
        return result.stdout.decode("utf-8", errors="replace")


def main() -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    papers = payload.get("papers", [])
    pending = [paper for paper in papers if not paper.get("institutions") and not paper.get("affiliation_checked")][:LIMIT]
    enriched = 0
    for paper in pending:
        try:
            parser = AffiliationParser()
            parser.feed(fetch_html(paper["id"]))
            institutions = parser.affiliations
            if institutions:
                institution_type = classify_institution_type(institutions)
                paper["institutions"] = institutions
                paper["institution_type"] = institution_type
                paper["organization_sector"] = organization_sector(institutions, institution_type)
                paper["primary_institution"] = institutions[0]
                enriched += 1
        except Exception as exc:
            print(f"Could not read affiliations for {paper['id']}: {exc}")
        paper["affiliation_checked"] = True
        time.sleep(0.35)

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Checked {len(pending)} arXiv pages; added affiliations to {enriched} papers.")


if __name__ == "__main__":
    main()
