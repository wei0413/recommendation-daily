#!/usr/bin/env python3
"""Create Chinese editorial notes through an Anthropic-compatible API.

The API token is read only from ANTHROPIC_AUTH_TOKEN. The script is safe to run
without a token: it exits successfully and leaves the paper data unchanged.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.request
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "data" / "recommendations.json"
BASE_URL = (os.environ.get("ANTHROPIC_BASE_URL", "").strip() or "https://open.bigmodel.cn/api/anthropic").rstrip("/")
MODEL = os.environ.get("ANTHROPIC_MODEL", "").strip() or "glm-4.5-air"
TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip()
LIMIT = max(1, int(os.environ.get("ENRICH_LIMIT", "30")))
MIN_PUBLISHED = os.environ.get("ENRICH_START_DATE", "2026-09-10").strip() or "2026-09-10"
DIRECT_TEXT_LIMIT = max(40000, int(os.environ.get("FULL_TEXT_DIRECT_LIMIT", "120000")))
CHUNK_CHARS = max(20000, int(os.environ.get("FULL_TEXT_CHUNK_CHARS", "45000")))
MAX_PDF_BYTES = max(5_000_000, int(os.environ.get("MAX_PDF_BYTES", "30000000")))
NOTE_KEYS = (
    "focus_label", "article_theme", "research_question", "main_contribution",
    "key_ideas", "analysis_summary", "personal_view", "reading_note",
    "note_model", "note_basis", "full_text_pages",
)
USER_AGENT = (
    "recommendation-daily/1.2 "
    "(+https://github.com/wei0413/recommendation-daily; "
    "mailto:wei0413@users.noreply.github.com)"
)


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


def utf8_safe(text: str) -> str:
    """Replace isolated PDF surrogate code points before JSON/HTTP encoding."""
    return text.encode("utf-8", errors="replace").decode("utf-8")


def call_model(prompt: str, max_tokens: int = 8192) -> str:
    payload = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": utf8_safe(prompt)}],
    }
    request = urllib.request.Request(
        f"{BASE_URL}/v1/messages",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": TOKEN,
            "anthropic-version": "2023-06-01",
            "user-agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        body = json.loads(response.read().decode("utf-8"))
    return "".join(block.get("text", "") for block in body.get("content", []) if block.get("type") == "text")


def download_pdf(url: str) -> bytes:
    url = url.replace("http://", "https://", 1)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.8"},
    )
    urllib_error = "unknown error"
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read(MAX_PDF_BYTES + 1)
        if len(data) > MAX_PDF_BYTES:
            raise RuntimeError(f"PDF exceeds {MAX_PDF_BYTES} bytes")
        if data.startswith(b"%PDF"):
            return data
        urllib_error = "response was not a PDF"
    except HTTPError as exc:
        urllib_error = f"HTTP {exc.code} {exc.reason}"
    except (URLError, TimeoutError, OSError, RuntimeError) as exc:
        urllib_error = str(exc)

    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [
                curl, "--fail", "--silent", "--show-error", "--location",
                "--retry", "3", "--retry-all-errors", "--retry-delay", "3",
                "--connect-timeout", "20", "--max-time", "180",
                "--max-filesize", str(MAX_PDF_BYTES),
                "--user-agent", USER_AGENT,
                "--header", "Accept: application/pdf,*/*;q=0.8",
                url,
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.startswith(b"%PDF"):
            return result.stdout
        curl_error = re.sub(r"\s+", " ", result.stderr.decode("utf-8", errors="replace")).strip()
    else:
        curl_error = "curl is not installed"
    raise RuntimeError(f"PDF download failed; urllib: {urllib_error}; curl: {curl_error or 'invalid PDF'}")


def extract_pdf_pages(pdf_data: bytes) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is not installed") from exc
    reader = PdfReader(BytesIO(pdf_data), strict=False)
    pages = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = utf8_safe(text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            pages.append(f"--- 第 {page_number} 页 ---\n{text}")
    if not pages:
        raise RuntimeError("no extractable text found in PDF")
    return pages


def chunk_pages(pages: list[str], limit: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_size = 0
    for page in pages:
        if current and current_size + len(page) > limit:
            chunks.append("\n\n".join(current))
            current = []
            current_size = 0
        current.append(page)
        current_size += len(page)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def condense_full_text(paper: dict, pages: list[str]) -> str:
    full_text = "\n\n".join(pages)
    if len(full_text) <= DIRECT_TEXT_LIMIT:
        return full_text

    evidence = []
    chunks = chunk_pages(pages, CHUNK_CHARS)
    for index, chunk in enumerate(chunks, start=1):
        prompt = f"""你正在通读论文《{paper.get('title', '')}》的全文。这是第 {index}/{len(chunks)} 个连续正文分段。
请只依据本分段，提取可供最终论文笔记使用的证据，覆盖：问题设定、方法机制、实验设置、定量结果、消融、局限和结论。保留重要数字及其比较对象；没有出现的内容不要猜测。输出精炼中文纯文本，不要 JSON，不要写总体评价。

正文分段：
{chunk}"""
        evidence.append(f"【全文分段 {index}/{len(chunks)} 的证据】\n{call_model(prompt, max_tokens=1800).strip()}")
    return "\n\n".join(evidence)


def request_note(paper: dict, full_text: str) -> dict:
    metadata = {
        "id": paper["id"],
        "title": paper.get("title", ""),
        "topic": paper.get("topic", "其他"),
        "authors": paper.get("authors", []),
        "institutions": paper.get("institutions", []),
    }
    prompt = f"""你是推荐系统论文的中文编辑。下面提供的是论文全文，或由论文所有连续正文分段逐段提取出的证据。必须依据全文内容写作，不得只根据标题或摘要推断，也不得补充全文中没有的数字、机构、实验结果或结论。

请返回只含一个对象的 JSON 数组。对象字段必须为：
- id：原样返回；
- focus_label：4—8 个中文字符的细分主题标签，例如“Agent技能优化”；
- article_theme：18—34 个中文字符，作为通俗、准确的“笔记标题”；
- research_question：1—2 句中文，具体说明论文试图解决的研究问题及其难点；
- main_contribution：2—3 句中文，说明框架、关键机制和贡献；
- key_ideas：3—5 条中文要点，用换行分隔，每条以“🔸”开头，解释方法流程与关键技术；
- analysis_summary：3—5 条中文要点，用换行分隔，每条以“🔸”开头，概括实验表现、成本/效率、鲁棒性、消融或局限。定量数字只有在正文明确给出时才能使用；
- personal_view：一段 120—220 字中文编辑观点，明确这是基于全文的分析，讨论创新性、实用价值与可能局限，不得伪装成论文原结论。

元数据：
{json.dumps(metadata, ensure_ascii=False)}

论文全文/全篇分段证据：
{full_text}"""
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            notes = extract_json(call_model(prompt))
            if not notes:
                raise ValueError("model returned an empty JSON array")
            if not isinstance(notes[0], dict):
                raise ValueError("model response first array item was not an object")
            return notes[0]
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            last_error = exc
            if attempt == 0:
                prompt += "\n\n上一轮响应格式无效。请严格只返回一个 JSON 数组，数组中只能有一个对象，不要输出解释、NaN 或 Markdown。"
    raise ValueError(f"model returned invalid JSON twice: {last_error}")


def save_payload(payload: dict) -> None:
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
            save_payload(payload)
        print("ANTHROPIC_AUTH_TOKEN is not configured; skipping AI notes.")
        return

    required = ("article_theme", "research_question", "main_contribution", "key_ideas", "analysis_summary", "personal_view")
    pending = [
        paper for paper in papers
        if paper.get("published", "") >= MIN_PUBLISHED
        and (paper.get("note_basis") != "full_text_pdf" or not all(paper.get(key) for key in required))
    ][:LIMIT]
    if not pending:
        print(f"All papers published since {MIN_PUBLISHED} already have editorial notes.")
        return

    completed = 0
    for index, paper in enumerate(pending, start=1):
        try:
            pdf_data = download_pdf(paper.get("pdf_url") or paper["url"].replace("/abs/", "/pdf/"))
            pages = extract_pdf_pages(pdf_data)
            full_text = condense_full_text(paper, pages)
            note = request_note(paper, full_text)
        except Exception as exc:
            print(f"Full-text note failed for {paper.get('id')} ({index}/{len(pending)}): {exc}")
            continue
        if str(note.get("id", "")) != paper["id"]:
            print(f"Full-text note returned a mismatched id for {paper['id']}; skipping.")
            continue
        for key in required + ("focus_label",):
            value = str(note.get(key, "")).strip()
            if value:
                paper[key] = value
        paper.pop("reading_note", None)
        paper["note_model"] = MODEL
        paper["note_basis"] = "full_text_pdf"
        paper["full_text_pages"] = len(pages)
        completed += 1
        save_payload(payload)
        print(f"Generated full-text note for {paper['id']} from {len(pages)} PDF pages ({index}/{len(pending)}).")

    save_payload(payload)
    print(f"Generated full-text editorial notes for {completed} papers with {MODEL}.")


if __name__ == "__main__":
    main()
