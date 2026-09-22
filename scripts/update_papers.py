#!/usr/bin/env python3
"""Fetch recent recommendation papers from the public arXiv API.

The script intentionally uses only Python's standard library so it can run in a
small GitHub Actions job without dependency installation.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "recommendations.json"
EDITORIAL_OVERRIDES = ROOT / "scripts" / "editorial_overrides.json"
API = "https://export.arxiv.org/api/query"
NAMESPACE = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}
USER_AGENT = (
    "recommendation-daily/1.1 "
    "(+https://github.com/wei0413/recommendation-daily; "
    "mailto:wei0413@users.noreply.github.com)"
)
ACCEPT = "application/atom+xml, application/xml;q=0.9, */*;q=0.8"

QUERY = (
    '(cat:cs.IR OR cat:cs.LG OR cat:cs.AI OR cat:cs.CL OR cat:cs.CV OR cat:stat.ML) AND '
    '(all:"recommender system" OR all:"recommendation system" OR '
    'ti:recommendation OR ti:recommender)'
)

STRONG_TERMS = (
    "recommender", "recommendation", "collaborative filtering",
    "sequential recommendation", "personalized ranking", "user preference",
)

TOPICS = [
    ("联邦与隐私推荐", ("federated", "privacy-preserving", "differential privacy", "decentralized", "secure aggregation")),
    ("公平、可信与安全", ("fairness", "bias", "robust", "attack", "trustworthy", "safety", "unwanted recommendation", "conformal risk")),
    ("生成式推荐", ("generative recommendation", "generative recommender", "semantic id", "semantic identifier", "item token", "diffusion recommender", "autoregressive recommendation")),
    ("LLM 与 Agent", ("large language model", " llm", "agentic", "agent-based", "foundation model", "rag recommendation", "retrieval-augmented generation")),
    ("对话与交互推荐", ("conversational", "dialogue", "dialog system", "interactive recommendation", "preference elicitation", "human-in-the-loop", "explainable")),
    ("多模态推荐", ("multimodal", "multi-modal", "vision-language", "visual recommendation", "audio recommendation")),
    ("跨域与冷启动", ("cross-domain", "cold-start", "cold start", "zero-shot", "few-shot", "transfer recommendation")),
    ("图与知识增强", ("graph neural", "knowledge graph", "graph-based", "graph recommendation", "knowledge-aware")),
    ("序列与会话推荐", ("sequential", "session-based", "next item", "next-item", "user sequence", "interest shift")),
    ("强化学习与长期价值", ("reinforcement learning", "bandit", "long-term reward", "policy learning", "counterfactual")),
    ("评测、数据与复现", ("benchmark", "evaluation", "reproducib", "survey", "dataset", "metric")),
    ("工业系统与效率", ("industrial", "production", "online serving", "scalable", "large-scale", "latency", "efficiency", "retrieval system", "ranking system")),
]

INDUSTRY_TERMS = (
    "corporation", " corp", "company", " inc", " ltd", " llc", "platforms", "google", "microsoft", "amazon", "meta ",
    "alibaba", "tencent", "bytedance", "netflix", "spotify", "kuaishou", "meituan",
)
ACADEMIC_TERMS = (
    "university", "institute", "school", "college", "academy", "laboratory", "laboratoire",
)
CHINA_TERMS = (
    "china", "chinese", "hong kong", "macau", "tsinghua", "peking", "fudan",
    "zhejiang", "renmin", "shanghai", "nanjing", "wuhan", "harbin", "cuhk",
    "ustc", "sjtu", "hkust", "huawei", "alibaba", "tencent", "bytedance",
    "kuaishou", "meituan", "baidu", "xiaomi",
)
ENRICHMENT_KEYS = (
    "focus_label", "article_theme", "research_question", "main_contribution",
    "key_ideas", "analysis_summary", "personal_view", "reading_note",
    "note_model", "note_basis", "full_text_pages",
)
AFFILIATION_KEYS = (
    "institutions", "institution_type", "organization_sector", "primary_institution", "affiliation_checked",
)


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def matches_query_scope(title: str, abstract: str) -> bool:
    title_l = title.lower()
    haystack = f"{title} {abstract}".lower()
    return (
        "recommendation" in title_l
        or "recommender" in title_l
        or "recommender system" in haystack
        or "recommendation system" in haystack
    )


def classify(title: str, abstract: str) -> str:
    haystack = f" {title} {abstract}".lower()
    for topic, terms in TOPICS:
        if any(term in haystack for term in terms):
            return topic
    return "其他"


def classify_institution_type(institutions: list[str]) -> str:
    if not institutions:
        return "机构未公开"
    text = " ".join(institutions).lower()
    has_industry = any(term in text for term in INDUSTRY_TERMS)
    has_academia = any(term in text for term in ACADEMIC_TERMS)
    if has_industry and has_academia:
        return "产学合作"
    if has_industry:
        return "工业界"
    if has_academia:
        return "学术界"
    return "研究机构"


def organization_sector(institutions: list[str], institution_type: str) -> str:
    if not institutions:
        return "机构未公开"
    text = " ".join(institutions).lower()
    is_china = any(term in text for term in CHINA_TERMS)
    if institution_type == "产学合作":
        return "产学合作"
    if institution_type == "工业界":
        return "国内工业界" if is_china else "海外工业界"
    if institution_type == "学术界":
        return "国内学术界" if is_china else "海外学术界"
    return "国内研究机构" if is_china else "海外研究机构"


def score_paper(title: str, abstract: str, published: str) -> int:
    title_l = title.lower()
    body_l = abstract.lower()
    score = 54
    for term in STRONG_TERMS:
        if term in title_l:
            score += 8
        elif term in body_l:
            score += 3
    for term in ("survey", "benchmark", "framework", "dataset", "industrial", "agentic"):
        if term in title_l:
            score += 3
    try:
        age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(published).date()).days
        score += max(0, 12 - max(0, age) // 3)
    except ValueError:
        pass
    return max(60, min(99, score))


def reason_for(topic: str, title: str) -> str:
    reasons = {
        "生成式推荐": "关注生成式建模、语义标识或物品生成，适合跟踪端到端推荐新范式。",
        "LLM 与 Agent": "关注大模型或智能体如何改变推荐流程，适合跟踪新一代推荐范式。",
        "序列与会话推荐": "聚焦用户行为序列与下一步偏好建模，和序列推荐主线直接相关。",
        "多模态推荐": "融合文本、图像或其他模态信息，有助于理解内容语义与用户兴趣。",
        "联邦与隐私推荐": "聚焦分布式协同、隐私保护与安全聚合，适合跟踪合规场景下的推荐方法。",
        "跨域与冷启动": "关注知识迁移与稀疏反馈，适合研究新用户、新物品和跨场景泛化。",
        "图与知识增强": "利用图结构或知识图谱建模高阶关系，值得关注表示学习与传播机制。",
        "对话与交互推荐": "强调自然语言交互、偏好获取与可解释反馈，适合研究主动式推荐体验。",
        "公平、可信与安全": "讨论偏差、鲁棒性或可信问题，适合补齐推荐系统治理视角。",
        "强化学习与长期价值": "面向长期收益或交互式推荐，关注策略学习与离线评估的结合。",
        "评测、数据与复现": "提供评测、数据或综述视角，便于校准实验设计并定位研究空白。",
        "工业系统与效率": "强调规模、效率或线上部署，对工程落地和系统设计更有参考价值。",
        "其他": "与推荐系统研究直接相关，适合快速浏览其问题设定和实验结论。",
    }
    if "survey" in title.lower():
        return "综述型工作，适合快速建立主题全景、补齐代表方法和开放问题。"
    return reasons[topic]


def download_feed(url: str) -> bytes:
    """Download an Atom feed, with curl as a compatibility fallback.

    arXiv's edge occasionally returns HTTP 406 to Python's urllib client on
    GitHub-hosted runners even though the same request is accepted from curl.
    Trying both clients keeps the scheduled update reliable without adding a
    Python dependency.
    """
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": ACCEPT,
            "Cache-Control": "no-cache",
        },
    )
    urllib_error = "unknown error"
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.read()
    except HTTPError as exc:
        urllib_error = f"HTTP {exc.code} {exc.reason}"
    except (URLError, TimeoutError, OSError) as exc:
        urllib_error = str(exc)

    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [
                curl,
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--retry",
                "4",
                "--retry-all-errors",
                "--retry-delay",
                "3",
                "--connect-timeout",
                "20",
                "--max-time",
                "120",
                "--user-agent",
                USER_AGENT,
                "--header",
                f"Accept: {ACCEPT}",
                url,
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout
        curl_error = clean(result.stderr.decode("utf-8", errors="replace"))
    else:
        curl_error = "curl is not installed"

    raise RuntimeError(
        "arXiv feed download failed; "
        f"urllib: {urllib_error}; curl: {curl_error or 'empty response'}"
    )


def parse_atom_root(root: ET.Element) -> list[dict]:
    papers = []
    for entry in root.findall("atom:entry", NAMESPACE):
        title = clean(entry.findtext("atom:title", namespaces=NAMESPACE))
        abstract = clean(entry.findtext("atom:summary", namespaces=NAMESPACE))
        haystack = f"{title} {abstract}".lower()
        if not any(term in haystack for term in STRONG_TERMS):
            continue

        raw_id = clean(entry.findtext("atom:id", namespaces=NAMESPACE)).rsplit("/", 1)[-1]
        paper_id = re.sub(r"v\d+$", "", raw_id)
        published = clean(entry.findtext("atom:published", namespaces=NAMESPACE))[:10]
        author_nodes = entry.findall("atom:author", NAMESPACE)
        authors = [clean(author.findtext("atom:name", namespaces=NAMESPACE)) for author in author_nodes]
        institutions = []
        for author in author_nodes:
            for affiliation in author.findall("arxiv:affiliation", NAMESPACE):
                value = clean(affiliation.text)
                if value and value not in institutions:
                    institutions.append(value)
        categories = [node.attrib.get("term", "") for node in entry.findall("atom:category", NAMESPACE)]
        links = {node.attrib.get("title", node.attrib.get("rel", "")): node.attrib.get("href", "") for node in entry.findall("atom:link", NAMESPACE)}
        topic = classify(title, abstract)
        institution_type = classify_institution_type(institutions)
        papers.append({
            "id": paper_id,
            "title": title,
            "authors": authors,
            "published": published,
            "categories": categories,
            "topic": topic,
            "institutions": institutions,
            "institution_type": institution_type,
            "organization_sector": organization_sector(institutions, institution_type),
            "primary_institution": institutions[0] if institutions else "机构未公开",
            "score": score_paper(title, abstract, published),
            "reason": reason_for(topic, title),
            "abstract": abstract,
            "url": f"https://arxiv.org/abs/{paper_id}",
            "pdf_url": links.get("pdf", f"https://arxiv.org/pdf/{paper_id}"),
        })
    return papers


def parse_xml_feed(url: str) -> ET.Element:
    try:
        return ET.fromstring(download_feed(url))
    except ET.ParseError as exc:
        raise RuntimeError(f"arXiv returned invalid XML from {url}: {exc}") from exc


def rss_published_date(paper_id: str, rss_date: str) -> str:
    fallback = ""
    try:
        fallback = parsedate_to_datetime(rss_date).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        page = download_feed(f"https://arxiv.org/abs/{paper_id}").decode("utf-8", errors="replace")
    except RuntimeError as exc:
        print(f"::warning::Could not read citation date for {paper_id}: {exc}")
        return fallback
    match = re.search(r'<meta[^>]+name=["\']citation_date["\'][^>]+content=["\'](\d{4}/\d{2}/\d{2})["\']', page, re.I)
    return match.group(1).replace("/", "-") if match else fallback


def fetch_entries_from_rss() -> list[dict]:
    categories = ("cs.IR", "cs.LG", "cs.AI", "cs.CL", "cs.CV", "stat.ML")
    candidates: dict[str, dict] = {}
    creator_tag = "{http://purl.org/dc/elements/1.1/}creator"
    for category in categories:
        root = parse_xml_feed(f"https://rss.arxiv.org/rss/{category}")
        for item in root.findall("./channel/item"):
            title = clean(item.findtext("title"))
            description = clean(re.sub(r"<[^>]+>", " ", item.findtext("description") or ""))
            abstract = clean(re.sub(r"^arXiv:.*?Abstract:\s*", "", description, flags=re.I | re.S))
            announce_match = re.search(r"Announce Type:\s*([a-z]+)", description, re.I)
            if not announce_match or announce_match.group(1).lower() not in {"new", "cross"}:
                continue
            if not matches_query_scope(title, abstract):
                continue
            link = clean(item.findtext("link"))
            match = re.search(r"/abs/([^/?#]+)", link)
            if not match:
                continue
            paper_id = re.sub(r"v\d+$", "", match.group(1))
            if paper_id not in candidates:
                candidates[paper_id] = {
                    "title": title,
                    "abstract": abstract,
                    "authors": [clean(name) for name in clean(item.findtext(creator_tag)).split(",") if clean(name)],
                    "categories": [clean(node.text) for node in item.findall("category") if clean(node.text)],
                    "rss_date": clean(item.findtext("pubDate")),
                }

    print(f"RSS discovered {len(candidates)} recommendation candidates across {len(categories)} categories.")
    lookback_days = max(1, int(os.environ.get("ARXIV_RSS_LOOKBACK_DAYS", "10")))
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=lookback_days)
    papers: list[dict] = []
    for paper_id, item in candidates.items():
        title = item["title"]
        abstract = item["abstract"]
        published = rss_published_date(paper_id, item["rss_date"])
        try:
            published_date = datetime.fromisoformat(published).date()
        except ValueError:
            print(f"::warning::Skipping {paper_id}; no valid publication date was available.")
            continue
        if published_date < cutoff:
            print(f"Skipping old RSS item {paper_id} published {published}.")
            continue
        topic = classify(title, abstract)
        papers.append({
            "id": paper_id,
            "title": title,
            "authors": item["authors"],
            "published": published,
            "categories": item["categories"],
            "topic": topic,
            "institutions": [],
            "institution_type": "机构未公开",
            "organization_sector": "机构未公开",
            "primary_institution": "机构未公开",
            "score": score_paper(title, abstract, published),
            "reason": reason_for(topic, title),
            "abstract": abstract,
            "url": f"https://arxiv.org/abs/{paper_id}",
            "pdf_url": f"https://arxiv.org/pdf/{paper_id}",
        })
    return papers


def fetch_entries() -> list[dict]:
    if os.environ.get("ARXIV_FORCE_RSS", "").strip() == "1":
        return fetch_entries_from_rss()

    max_results = int(os.environ.get("ARXIV_MAX_RESULTS", "300"))
    params = urllib.parse.urlencode({
        "search_query": QUERY,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    })
    local_feed = os.environ.get("ARXIV_XML_PATH", "").strip()
    if local_feed:
        try:
            root = ET.fromstring(Path(local_feed).read_bytes())
        except ET.ParseError as exc:
            raise RuntimeError(f"local arXiv XML is invalid: {exc}") from exc
    else:
        root = parse_xml_feed(f"{API}?{params}")
    return parse_atom_root(root)


def main() -> None:
    old_papers: list[dict] = []
    if OUTPUT.exists():
        old_papers = json.loads(OUTPUT.read_text(encoding="utf-8")).get("papers", [])

    try:
        fetched_papers = fetch_entries()
    except RuntimeError as primary_exc:
        print(f"::warning::Primary arXiv query failed: {primary_exc}")
        try:
            fetched_papers = fetch_entries_from_rss()
        except RuntimeError as fallback_exc:
            if old_papers:
                print(f"::warning::arXiv RSS fallback failed: {fallback_exc}")
                print(f"Keeping {len(old_papers)} existing papers; the next run will retry arXiv.")
                return
            raise RuntimeError(
                f"primary arXiv query failed ({primary_exc}); RSS fallback failed ({fallback_exc})"
            ) from fallback_exc
        print("Recovered with arXiv RSS discovery and batched Atom metadata lookup.")

    merged = {paper["id"]: paper for paper in old_papers}
    for paper in fetched_papers:
        previous = merged.get(paper["id"], {})
        for key in ENRICHMENT_KEYS:
            if previous.get(key):
                paper[key] = previous[key]
        if previous.get("institutions") and not paper.get("institutions"):
            for key in AFFILIATION_KEYS:
                if key in previous:
                    paper[key] = previous[key]
        elif previous.get("affiliation_checked"):
            paper["affiliation_checked"] = True
        merged[paper["id"]] = paper

    for paper in merged.values():
        institutions = paper.get("institutions") or []
        if institutions:
            institution_type = classify_institution_type(institutions)
            paper["institution_type"] = institution_type
            paper["organization_sector"] = organization_sector(institutions, institution_type)
            paper["primary_institution"] = institutions[0]
    papers = sorted(merged.values(), key=lambda p: (p.get("published", ""), p.get("score", 0)), reverse=True)[:1200]
    if EDITORIAL_OVERRIDES.exists():
        overrides = json.loads(EDITORIAL_OVERRIDES.read_text(encoding="utf-8"))
        by_id = {paper["id"]: paper for paper in papers}
        for paper_id, values in overrides.items():
            if paper_id in by_id and by_id[paper_id].get("note_basis") != "full_text_pdf":
                by_id[paper_id].update(values)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "arXiv",
        "papers": papers,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(papers)} recommendation papers to {OUTPUT}")


if __name__ == "__main__":
    main()
