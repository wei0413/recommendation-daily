"""Build a browsable archive of recommender-system papers from major venues.

Crossref is used as the publication source because a DOI/proceedings record is
evidence of formal publication.  The output is intentionally lightweight and
contains bibliographic metadata only; it does not duplicate the arXiv notes.
"""

from __future__ import annotations

import html
import json
import os
import re
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "conference-index.json"
PAPER_DIR = ROOT / "dist" / "data" / "conferences"
CROSSREF_API = "https://api.crossref.org/works"

CONFERENCES = [
    {
        "id": "SIGIR",
        "name": "ACM SIGIR Conference on Research and Development in Information Retrieval",
        "ccf_rank": "A",
        "area": "数据库 / 数据挖掘 / 内容检索",
        "query": "SIGIR",
        "venue_needles": ["acm sigir conference on research and development in information retrieval"],
        "dblp": "https://dblp.org/db/conf/sigir/",
    },
    {
        "id": "KDD",
        "name": "ACM SIGKDD Conference on Knowledge Discovery and Data Mining",
        "ccf_rank": "A",
        "area": "数据库 / 数据挖掘 / 内容检索",
        "query": "SIGKDD Knowledge Discovery Data Mining",
        "venue_needles": [
            "acm sigkdd international conference on knowledge discovery and data mining",
            "acm sigkdd international conference on knowledge discovery & data mining",
            "acm sigkdd conference on knowledge discovery and data mining",
            "acm sigkdd conference on knowledge discovery & data mining",
        ],
        "dblp": "https://dblp.org/db/conf/kdd/",
    },
    {
        "id": "WWW",
        "name": "The Web Conference",
        "query_title": "ACM on Web Conference",
        "ccf_rank": "A",
        "area": "交叉 / 综合 / 新兴",
        "query": "The Web Conference WWW",
        "venue_needles": [
            "proceedings of the acm on web conference",
            "proceedings of the acm web conference",
            "proceedings of the web conference",
            "the world wide web conference",
        ],
        "dblp": "https://dblp.org/db/conf/www/",
    },
    {
        "id": "CIKM",
        "name": "ACM International Conference on Information and Knowledge Management",
        "ccf_rank": "B",
        "area": "数据库 / 数据挖掘 / 内容检索",
        "query": "CIKM Information Knowledge Management",
        "venue_needles": [
            "acm international conference on information and knowledge management",
            "acm international conference on information & knowledge management",
        ],
        "dblp": "https://dblp.org/db/conf/cikm/",
    },
    {
        "id": "WSDM",
        "name": "ACM International Conference on Web Search and Data Mining",
        "ccf_rank": "B",
        "area": "数据库 / 数据挖掘 / 内容检索",
        "query": "WSDM Web Search Data Mining",
        "venue_needles": [
            "acm international conference on web search and data mining",
            "international conference on web search and data mining",
        ],
        "dblp": "https://dblp.org/db/conf/wsdm/",
    },
    {
        "id": "ICDM",
        "name": "IEEE International Conference on Data Mining",
        "ccf_rank": "B",
        "area": "数据库 / 数据挖掘 / 内容检索",
        "query": "IEEE International Conference Data Mining ICDM",
        "venue_needles": ["ieee international conference on data mining"],
        "dblp": "https://dblp.org/db/conf/icdm/",
    },
    {
        "id": "RecSys",
        "name": "ACM Conference on Recommender Systems",
        "ccf_rank": "领域旗舰",
        "area": "推荐系统",
        "query": "ACM Conference Recommender Systems RecSys",
        "venue_needles": ["acm conference on recommender systems"],
        "dblp": "https://dblp.org/db/conf/recsys/",
    },
]

RELEVANCE_PATTERNS = [
    (r"\brecommender(?:s| system| systems)?\b", 6),
    (r"\brecommend(?:ation|ations|ing|ed)?\b", 5),
    (r"\bcollaborative filter", 5),
    (r"\bclick[- ]through rate\b|\bctr prediction\b", 4),
    (r"\bnext[- ]item\b|\bnext poi\b|\bpoi recommendation\b", 4),
    (r"\buser[- ]item\b|\bitem recommendation\b", 3),
    (r"\bpersonaliz(?:ed|ation|ing)\b", 3),
    (r"\buser preference", 2),
    (r"\bfeed ranking\b|\bnews ranking\b", 3),
]

ENRICHMENT_KEYS = (
    "institutions", "primary_institution", "institution_type", "organization_sector",
    "focus_label", "article_theme", "research_question", "main_contribution",
    "note_id", "note_model", "note_basis", "note_source", "note_source_url",
    "pdf_url", "full_text_pages", "has_full_text_note", "openalex_id",
    "conference_note_checked_at", "conference_note_error",
    "conference_pdf_candidates", "conference_pdf_status", "conference_pdf_checked_at",
)


def clean_text(value: object) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    text = re.sub(r"<[^>]+>", "", html.unescape(str(value or "")))
    return re.sub(r"\s+", " ", text).strip().rstrip(".")


def relevance_score(title: str) -> int:
    lowered = title.lower()
    return sum(weight for pattern, weight in RELEVANCE_PATTERNS if re.search(pattern, lowered))


def topic_for(title: str) -> str:
    text = title.lower()
    rules = [
        ("LLM 与生成式推荐", r"large language|\bllm\b|generative|diffusion|agent"),
        ("序列与会话推荐", r"sequential|session|next[- ]item|next poi|lifelong behavior"),
        ("多模态推荐", r"multimodal|multi-modal|vision-language|visual"),
        ("可信、公平与隐私", r"fairness|fair |bias|privacy|federated|robust|attack"),
        ("图与知识增强", r"graph|knowledge graph|knowledge-aware"),
        ("因果、去偏与反事实", r"causal|counterfactual|debias|de-bias"),
        ("排序、重排与检索", r"rank|re-rank|rerank|retriev|click-through|ctr"),
        ("跨域与冷启动", r"cross-domain|cold-start|cold start|zero-shot"),
    ]
    return next((topic for topic, pattern in rules if re.search(pattern, text)), "推荐模型与学习")


def request_json(params: dict[str, str]) -> dict:
    url = f"{CROSSREF_API}?{urlencode(params)}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "recommendation-daily/1.0 (https://github.com/wei0413/recommendation-daily)",
        },
    )
    context = None
    if os.getenv("CONFERENCE_ALLOW_INSECURE_SSL") == "1":
        context = ssl._create_unverified_context()  # Local debugging only; CI uses verified TLS.
    for attempt in range(4):
        delay = 2 ** attempt
        try:
            with urlopen(request, timeout=75, context=context) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After", "")
                try:
                    delay = max(delay, int(retry_after))
                except (TypeError, ValueError):
                    delay = max(delay, 15 * (attempt + 1))
        except URLError:
            if attempt == 3:
                raise
        time.sleep(delay)
    raise RuntimeError("Crossref request failed")


def venue_matches(container: str, conference: dict) -> bool:
    value = container.lower()
    return any(needle in value for needle in conference["venue_needles"])


def authors_for(item: dict) -> list[str]:
    authors = []
    for author in item.get("author", []):
        name = " ".join(part for part in [author.get("given", ""), author.get("family", "")] if part).strip()
        if name:
            authors.append(name)
    return authors


def institutions_for(item: dict) -> list[str]:
    institutions: list[str] = []
    for author in item.get("author", []):
        for affiliation in author.get("affiliation", []):
            name = clean_text(affiliation.get("name", ""))
            if name and name not in institutions:
                institutions.append(name)
    return institutions


def institution_labels(institutions: list[str]) -> tuple[str, str]:
    text = " ".join(institutions).lower()
    academic = any(word in text for word in ("university", "college", "academy", "institute of technology", "school"))
    industry = any(word in text for word in ("google", "microsoft", "meta", "amazon", "alibaba", "tencent", "bytedance", "spotify", "netflix"))
    if academic and industry:
        return "产学合作", "学术界 × 工业界"
    if academic:
        return "高校/科研机构", "学术界"
    if industry:
        return "企业研究团队", "工业界"
    return ("机构已识别", "其他机构") if institutions else ("机构未公开", "机构未公开")


def item_year(item: dict) -> int | None:
    for key in ("published-print", "published-online", "published", "issued"):
        parts = item.get(key, {}).get("date-parts", [])
        if parts and parts[0]:
            try:
                return int(parts[0][0])
            except (TypeError, ValueError):
                pass
    return None


def fetch_conference_year(conference: dict, year: int) -> list[dict]:
    params = {
        "query.container-title": f"Proceedings {conference.get('query_title', conference['name'])} {year}",
        "filter": f"from-pub-date:{year}-01-01,until-pub-date:{year}-12-31",
        "rows": "1000",
        "select": "DOI,title,author,published,container-title,URL",
    }
    payload = request_json(params)
    results = []
    for item in payload.get("message", {}).get("items", []):
        title = clean_text(item.get("title"))
        container = clean_text(item.get("container-title"))
        score = relevance_score(title)
        if not title or score < 3 or not venue_matches(container, conference):
            continue
        published_year = item_year(item) or year
        if published_year != year:
            continue
        doi = clean_text(item.get("DOI"))
        institutions = institutions_for(item)
        institution_type, organization_sector = institution_labels(institutions)
        paper = {
                "id": doi.lower() or f"{conference['id'].lower()}-{year}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:80]}",
                "title": title,
                "authors": authors_for(item),
                "year": year,
                "conference": conference["id"],
                "conference_name": conference["name"],
                "ccf_rank": conference["ccf_rank"],
                "area": conference["area"],
                "topic": topic_for(title),
                "doi": doi,
                "url": f"https://doi.org/{doi}" if doi else clean_text(item.get("URL")),
                "source": "Crossref",
                "relevance_score": score,
        }
        if institutions:
            paper.update({
                "institutions": institutions,
                "primary_institution": institutions[0],
                "institution_type": institution_type,
                "organization_sector": organization_sector,
            })
        results.append(paper)
    return results


def main() -> None:
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    start_year = int(os.getenv("CONFERENCE_START_YEAR", "2024"))
    end_year = int(os.getenv("CONFERENCE_END_YEAR", str(now.year)))
    selected = {value.strip() for value in os.getenv("CONFERENCE_IDS", "").split(",") if value.strip()}
    conferences = [conf for conf in CONFERENCES if not selected or conf["id"] in selected]

    existing_by_job: dict[tuple[int, str], list[dict]] = {}
    for year in range(start_year, end_year + 1):
        year_file = PAPER_DIR / f"{year}.json"
        if not year_file.exists():
            continue
        try:
            existing = json.loads(year_file.read_text(encoding="utf-8")).get("papers", [])
        except (OSError, json.JSONDecodeError):
            continue
        for paper in existing:
            conference_id = str(paper.get("conference", ""))
            if conference_id:
                existing_by_job.setdefault((year, conference_id), []).append(paper)

    papers: list[dict] = []
    errors: list[dict] = []
    jobs = [(year, conference) for year in range(start_year, end_year + 1) for conference in conferences]
    workers = max(1, min(4, int(os.getenv("CROSSREF_WORKERS", "3"))))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(fetch_conference_year, conference, year): (year, conference) for year, conference in jobs}
        for future in as_completed(futures):
            year, conference = futures[future]
            try:
                found = future.result()
                previous_by_id = {paper.get("id"): paper for paper in existing_by_job.get((year, conference["id"]), [])}
                for paper in found:
                    previous = previous_by_id.get(paper.get("id"), {})
                    for key in ENRICHMENT_KEYS:
                        if key in previous:
                            paper[key] = previous[key]
                papers.extend(found)
                print(f"{year} {conference['id']}: {len(found)} recommendation papers", flush=True)
            except Exception as exc:  # Keep a partial archive usable when one venue fails.
                preserved = existing_by_job.get((year, conference["id"]), [])
                papers.extend(preserved)
                errors.append({
                    "year": year,
                    "conference": conference["id"],
                    "error": str(exc)[:240],
                    "preserved_previous_records": len(preserved),
                })
                print(f"WARNING {year} {conference['id']}: {exc}; preserved {len(preserved)} previous records", flush=True)

    deduplicated = {}
    for paper in papers:
        deduplicated[paper["id"]] = paper
    papers = sorted(
        deduplicated.values(),
        key=lambda paper: (-paper["year"], paper["conference"].lower(), paper["title"].lower()),
    )

    counts: dict[str, dict[str, int]] = {}
    for paper in papers:
        counts.setdefault(str(paper["year"]), {})
        counts[str(paper["year"])][paper["conference"]] = counts[str(paper["year"])].get(paper["conference"], 0) + 1

    years = sorted({paper["year"] for paper in papers}, reverse=True)
    output = {
        "generated_at": now.isoformat(),
        "source": "Crossref formal proceedings metadata",
        "method": "Title-based high-precision recommendation-system screening",
        "start_year": start_year,
        "end_year": end_year,
        "years": years,
        "paper_count": len(papers),
        "conferences": [{key: value for key, value in conf.items() if key not in {"query", "query_title", "venue_needles"}} for conf in CONFERENCES],
        "counts": counts,
        "errors": errors,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PAPER_DIR.mkdir(parents=True, exist_ok=True)
    for year in years:
        year_papers = [paper for paper in papers if paper["year"] == year]
        year_output = {"year": year, "generated_at": now.isoformat(), "papers": year_papers}
        (PAPER_DIR / f"{year}.json").write_text(
            json.dumps(year_output, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    print(f"Wrote {len(papers)} papers across {len(years)} year files; index: {OUTPUT}")


if __name__ == "__main__":
    main()
