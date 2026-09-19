#!/usr/bin/env python3
"""Create Chinese editorial notes through an Anthropic-compatible API.

The API token is read only from ANTHROPIC_AUTH_TOKEN. The script is safe to run
without a token: it exits successfully and leaves the paper data unchanged.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "recommendations.json"
BASE_URL = (os.environ.get("ANTHROPIC_BASE_URL", "").strip() or "https://open.bigmodel.cn/api/anthropic").rstrip("/")
MODEL = os.environ.get("ANTHROPIC_MODEL", "").strip() or "glm-4.5-air"
TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip()
LIMIT = max(1, int(os.environ.get("ENRICH_LIMIT", "24")))
BATCH_SIZE = max(1, min(6, int(os.environ.get("ENRICH_BATCH_SIZE", "4"))))
MIN_PUBLISHED = os.environ.get("ENRICH_START_DATE", "2026-09-11").strip() or "2026-09-11"
NOTE_KEYS = ("focus_label", "article_theme", "research_question", "main_contribution", "reading_note", "note_model")


def extract_json(text: str) -> list[dict]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I | re.S)
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start < 0 or end < start:
        raise ValueError("model response did not contain a JSON array")
    value = json.loads(cleaned[start:end + 1])
    if not isinstance(value, list):
        raise ValueError("model response JSON was not an array")
    return value


def request_notes(papers: list[dict]) -> list[dict]:
    source = [{
        "id": paper["id"],
        "title": paper.get("title", ""),
        "abstract": paper.get("abstract", ""),
        "topic": paper.get("topic", "其他"),
        "authors": paper.get("authors", []),
        "institutions": paper.get("institutions", []),
    } for paper in papers]
    prompt = f"""你是推荐系统论文的中文编辑。请严格依据输入的标题、摘要和公开机构信息生成阅读卡片，不补充输入中没有的实验数字、机构或结论。

为每篇论文返回一个 JSON 对象，字段必须为：
- id：原样返回；
- focus_label：4—8 个中文字符的细分主题标签，例如“Agent技能优化”；
- article_theme：18—34 个中文字符，像新闻标题一样概括文章主题；
- research_question：一句中文，说明论文要解决的问题；
- main_contribution：1—2 句中文，说明核心方法和贡献，不夸大；
- reading_note：3 条简短中文要点，用换行分隔，每条以“• ”开头。

只返回 JSON 数组，不要 Markdown，不要额外解释。输入如下：
{json.dumps(source, ensure_ascii=False)}"""
    payload = {
        "model": MODEL,
        "max_tokens": 4096,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}],
    }
    request = urllib.request.Request(
        f"{BASE_URL}/v1/messages",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": TOKEN,
            "anthropic-version": "2023-06-01",
            "user-agent": "recommendation-daily/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))
    text = "".join(block.get("text", "") for block in body.get("content", []) if block.get("type") == "text")
    return extract_json(text)


def main() -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    papers = payload.get("papers", [])
    removed = 0
    for paper in papers:
        if paper.get("published", "") < MIN_PUBLISHED:
            for key in NOTE_KEYS:
                if key in paper:
                    paper.pop(key, None)
                    removed += 1

    if not TOKEN:
        if removed:
            OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("ANTHROPIC_AUTH_TOKEN is not configured; skipping AI notes.")
        return

    pending = [
        paper for paper in papers
        if paper.get("published", "") >= MIN_PUBLISHED and not paper.get("article_theme")
    ][:LIMIT]
    if not pending:
        print(f"All papers published since {MIN_PUBLISHED} already have editorial notes.")
        return

    by_id = {paper["id"]: paper for paper in papers}
    completed = 0
    for offset in range(0, len(pending), BATCH_SIZE):
        batch = pending[offset:offset + BATCH_SIZE]
        try:
            notes = request_notes(batch)
        except Exception as exc:
            print(f"Note generation failed for batch {offset // BATCH_SIZE + 1}: {exc}")
            continue
        for note in notes:
            paper = by_id.get(str(note.get("id", "")))
            if not paper:
                continue
            for key in ("focus_label", "article_theme", "research_question", "main_contribution", "reading_note"):
                value = str(note.get(key, "")).strip()
                if value:
                    paper[key] = value
            paper["note_model"] = MODEL
            completed += 1

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated editorial notes for {completed} papers with {MODEL}.")


if __name__ == "__main__":
    main()
