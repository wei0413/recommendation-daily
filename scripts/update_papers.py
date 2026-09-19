#!/usr/bin/env python3
"""Fetch recent recommendation papers from the public arXiv API.

The script intentionally uses only Python's standard library so it can run in a
small GitHub Actions job without dependency installation.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "recommendations.json"
API = "https://export.arxiv.org/api/query"
NAMESPACE = {"atom": "http://www.w3.org/2005/Atom"}
USER_AGENT = "recommendation-daily/1.0 (https://github.com/wei0413/recommendation-daily)"

QUERY = (
    '(cat:cs.IR OR cat:cs.LG OR cat:cs.AI) AND '
    '(all:"recommender system" OR all:"recommendation system" OR '
    'ti:recommendation OR ti:recommender)'
)

STRONG_TERMS = (
    "recommender", "recommendation", "collaborative filtering",
    "sequential recommendation", "personalized ranking", "user preference",
)

TOPICS = [
    ("公平与安全", ("fairness", "bias", "privacy", "robust", "attack", "trustworthy", "safety")),
    ("多模态推荐", ("multimodal", "multi-modal", "vision-language", "visual recommendation")),
    ("图推荐", ("graph neural", "knowledge graph", "graph-based", "graph recommendation")),
    ("序列推荐", ("sequential", "session-based", "next item", "next-item", "user sequence")),
    ("强化学习", ("reinforcement learning", "bandit", "long-term reward", "policy learning")),
    ("LLM 推荐", ("large language model", " llm", "agentic", "agent-based", "generative recommendation")),
    ("评测与基准", ("benchmark", "evaluation", "reproducib", "survey", "dataset")),
    ("工业系统", ("industrial", "production", "online serving", "scalable", "large-scale")),
]


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def classify(title: str, abstract: str) -> str:
    haystack = f" {title} {abstract}".lower()
    for topic, terms in TOPICS:
        if any(term in haystack for term in terms):
            return topic
    return "其他"


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
        "LLM 推荐": "关注大模型或智能体如何改变推荐流程，适合跟踪新一代推荐范式。",
        "序列推荐": "聚焦用户行为序列与下一步偏好建模，和序列推荐主线直接相关。",
        "多模态推荐": "融合文本、图像或其他模态信息，有助于理解内容语义与用户兴趣。",
        "公平与安全": "讨论偏差、隐私、鲁棒性或可信问题，适合补齐推荐系统治理视角。",
        "图推荐": "利用图结构或知识图谱建模高阶关系，值得关注表示学习与传播机制。",
        "评测与基准": "提供评测、数据或综述视角，便于校准实验设计并定位研究空白。",
        "强化学习": "面向长期收益或交互式推荐，关注策略学习与离线评估的结合。",
        "工业系统": "强调规模、效率或线上部署，对工程落地和系统设计更有参考价值。",
        "其他": "与推荐系统研究直接相关，适合快速浏览其问题设定和实验结论。",
    }
    if "survey" in title.lower():
        return "综述型工作，适合快速建立主题全景、补齐代表方法和开放问题。"
    return reasons[topic]


def fetch_entries() -> list[dict]:
    params = urllib.parse.urlencode({
        "search_query": QUERY,
        "start": 0,
        "max_results": 150,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    })
    request = urllib.request.Request(f"{API}?{params}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        root = ET.fromstring(response.read())

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
        authors = [clean(author.findtext("atom:name", namespaces=NAMESPACE)) for author in entry.findall("atom:author", NAMESPACE)]
        categories = [node.attrib.get("term", "") for node in entry.findall("atom:category", NAMESPACE)]
        links = {node.attrib.get("title", node.attrib.get("rel", "")): node.attrib.get("href", "") for node in entry.findall("atom:link", NAMESPACE)}
        topic = classify(title, abstract)
        papers.append({
            "id": paper_id,
            "title": title,
            "authors": authors,
            "published": published,
            "categories": categories,
            "topic": topic,
            "score": score_paper(title, abstract, published),
            "reason": reason_for(topic, title),
            "abstract": abstract,
            "url": f"https://arxiv.org/abs/{paper_id}",
            "pdf_url": links.get("pdf", f"https://arxiv.org/pdf/{paper_id}"),
        })
    return papers


def main() -> None:
    old_papers: list[dict] = []
    if OUTPUT.exists():
        old_papers = json.loads(OUTPUT.read_text(encoding="utf-8")).get("papers", [])

    merged = {paper["id"]: paper for paper in old_papers}
    for paper in fetch_entries():
        merged[paper["id"]] = paper

    papers = sorted(merged.values(), key=lambda p: (p.get("published", ""), p.get("score", 0)), reverse=True)[:400]
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

