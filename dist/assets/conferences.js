const conferenceState = {
  payload: null,
  papers: [],
  year: "",
  rank: "",
  conference: "",
  topic: "",
  search: "",
  yearCache: new Map(),
  savedOnly: false,
  saved: new Set(JSON.parse(localStorage.getItem("recsys-conference-saved") || "[]")),
  noteRequests: new Map(),
};

const cq = selector => document.querySelector(selector);
const conferenceEscape = (value = "") => String(value).replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]));

function readConferenceHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  conferenceState.year = params.get("year") || "";
  conferenceState.rank = params.get("rank") || "";
  conferenceState.conference = params.get("conference") || "";
  conferenceState.topic = params.get("topic") || "";
}

function writeConferenceHash() {
  const params = new URLSearchParams();
  ["year", "rank", "conference", "topic"].forEach(key => {
    if (conferenceState[key]) params.set(key, conferenceState[key]);
  });
  history.replaceState(null, "", `${location.pathname}${params.size ? `#${params}` : ""}`);
}

async function initConferencePage() {
  readConferenceHash();
  try {
    const response = await fetch("./data/conference-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    conferenceState.payload = await response.json();
    const availableYears = (conferenceState.payload.years || []).map(String);
    if (!availableYears.includes(conferenceState.year)) conferenceState.year = availableYears[0] || "";
    await loadConferenceYear(conferenceState.year);
    buildConferenceControls();
    bindConferenceEvents();
    renderConferencePage();
  } catch (error) {
    cq("#conferenceResults").innerHTML = `<div class="empty"><strong>会议数据加载失败</strong><span>${conferenceEscape(error.message)}。请稍后刷新页面。</span></div>`;
    cq("#conferenceResults").setAttribute("aria-busy", "false");
  }
}

async function loadConferenceYear(year) {
  const years = conferenceState.payload.years || [];
  const requested = year ? [Number(year)] : years;
  const missing = requested.filter(value => !conferenceState.yearCache.has(String(value)));
  if (missing.length) {
    cq("#conferenceResults").setAttribute("aria-busy", "true");
    const payloads = await Promise.all(missing.map(async value => {
      const response = await fetch(`./data/conferences/${value}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${value} 年数据 HTTP ${response.status}`);
      return response.json();
    }));
    payloads.forEach(payload => conferenceState.yearCache.set(String(payload.year), payload.papers || []));
  }
  conferenceState.papers = requested.flatMap(value => conferenceState.yearCache.get(String(value)) || []);
}

function uniqueSorted(values, numeric = false) {
  return [...new Set(values)].sort((a, b) => numeric ? Number(b) - Number(a) : String(a).localeCompare(String(b), "zh-CN"));
}

function buildConferenceControls() {
  const years = uniqueSorted(conferenceState.payload.years || [], true);
  cq("#yearSelect").insertAdjacentHTML("beforeend", years.map(year => `<option value="${year}">${year} 年</option>`).join(""));
  cq("#yearSelect").value = conferenceState.year;

  const ranks = ["A", "B", "领域旗舰"].filter(rank => conferenceState.payload.conferences.some(conf => conf.ccf_rank === rank));
  cq("#rankFilters").innerHTML = ranks.map(rank => `<button type="button" data-rank="${conferenceEscape(rank)}">${rank === "领域旗舰" ? rank : `CCF ${rank}`}</button>`).join("");

  cq("#conferenceFilters").innerHTML = conferenceState.payload.conferences.map(conf => `
    <button type="button" data-conference="${conferenceEscape(conf.id)}">
      <span><b>${conferenceEscape(conf.id)}</b><small>${conferenceEscape(conf.ccf_rank === "领域旗舰" ? conf.ccf_rank : `CCF ${conf.ccf_rank}`)}</small></span>
      <em data-conference-count="${conferenceEscape(conf.id)}">0</em>
    </button>`).join("");

  const topics = uniqueSorted(conferenceState.papers.map(paper => paper.topic));
  cq("#conferenceTopics").innerHTML = topics.map(topic => `<button type="button" data-topic="${conferenceEscape(topic)}"><span>${conferenceEscape(topic)}</span><em data-topic-count="${conferenceEscape(topic)}">0</em></button>`).join("");
}

function bindConferenceEvents() {
  cq("#yearSelect").addEventListener("change", async event => {
    conferenceState.year = event.target.value;
    await loadConferenceYear(conferenceState.year);
    renderConferencePage();
  });
  cq("#rankFilters").addEventListener("click", event => {
    const button = event.target.closest("[data-rank]");
    if (!button) return;
    conferenceState.rank = conferenceState.rank === button.dataset.rank ? "" : button.dataset.rank;
    conferenceState.conference = "";
    renderConferencePage();
  });
  cq("#conferenceFilters").addEventListener("click", event => {
    const button = event.target.closest("[data-conference]");
    if (!button) return;
    conferenceState.conference = conferenceState.conference === button.dataset.conference ? "" : button.dataset.conference;
    renderConferencePage();
  });
  cq("#conferenceTopics").addEventListener("click", event => {
    const button = event.target.closest("[data-topic]");
    if (!button) return;
    conferenceState.topic = conferenceState.topic === button.dataset.topic ? "" : button.dataset.topic;
    renderConferencePage();
  });
  cq("#conferenceSearch").addEventListener("input", event => { conferenceState.search = event.target.value.trim().toLowerCase(); renderConferencePage(); });
  cq("#conferenceSavedToggle").addEventListener("click", () => {
    conferenceState.savedOnly = !conferenceState.savedOnly;
    renderConferencePage();
  });
  cq("#conferenceResults").addEventListener("click", event => {
    const noteButton = event.target.closest("[data-conference-note]");
    if (noteButton) {
      toggleConferenceNote(noteButton);
      return;
    }
    const copyButton = event.target.closest("[data-copy-conference-note]");
    if (copyButton) {
      copyConferenceNote(copyButton.dataset.copyConferenceNote, copyButton);
      return;
    }
    const button = event.target.closest("[data-conference-save]");
    if (!button) return;
    const id = button.dataset.conferenceSave;
    if (conferenceState.saved.has(id)) conferenceState.saved.delete(id);
    else conferenceState.saved.add(id);
    localStorage.setItem("recsys-conference-saved", JSON.stringify([...conferenceState.saved]));
    renderConferencePage();
  });
  cq("#clearYear").addEventListener("click", async () => {
    conferenceState.year = "";
    cq("#yearSelect").value = "";
    await loadConferenceYear("");
    renderConferencePage();
  });
  cq("#clearRank").addEventListener("click", () => { conferenceState.rank = ""; renderConferencePage(); });
  cq("#clearConference").addEventListener("click", () => { conferenceState.conference = ""; renderConferencePage(); });
  cq("#clearConferenceTopic").addEventListener("click", () => { conferenceState.topic = ""; renderConferencePage(); });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      event.preventDefault(); cq("#conferenceSearch").focus();
    }
  });
}

function filteredConferencePapers({ ignoreConference = false, ignoreTopic = false } = {}) {
  return conferenceState.papers.filter(paper => {
    if (conferenceState.year && String(paper.year) !== conferenceState.year) return false;
    if (conferenceState.rank && paper.ccf_rank !== conferenceState.rank) return false;
    if (!ignoreConference && conferenceState.conference && paper.conference !== conferenceState.conference) return false;
    if (!ignoreTopic && conferenceState.topic && paper.topic !== conferenceState.topic) return false;
    if (conferenceState.savedOnly && !conferenceState.saved.has(paper.id)) return false;
    if (conferenceState.search) {
      const haystack = [paper.title, ...(paper.authors || []), paper.doi, paper.conference].join(" ").toLowerCase();
      if (!haystack.includes(conferenceState.search)) return false;
    }
    return true;
  });
}

function renderConferenceControls() {
  document.querySelectorAll("[data-rank]").forEach(button => button.classList.toggle("active", button.dataset.rank === conferenceState.rank));
  document.querySelectorAll("[data-conference]").forEach(button => button.classList.toggle("active", button.dataset.conference === conferenceState.conference));
  document.querySelectorAll("[data-topic]").forEach(button => button.classList.toggle("active", button.dataset.topic === conferenceState.topic));
  cq("#yearSelect").value = conferenceState.year;

  const conferencePool = filteredConferencePapers({ ignoreConference: true });
  document.querySelectorAll("[data-conference-count]").forEach(node => {
    node.textContent = conferencePool.filter(paper => paper.conference === node.dataset.conferenceCount).length;
  });
  const topicPool = filteredConferencePapers({ ignoreTopic: true });
  document.querySelectorAll("[data-topic-count]").forEach(node => {
    node.textContent = topicPool.filter(paper => paper.topic === node.dataset.topicCount).length;
  });
}

function paperRow(paper) {
  const rank = paper.ccf_rank === "领域旗舰" ? paper.ccf_rank : `CCF ${paper.ccf_rank}`;
  const saved = conferenceState.saved.has(paper.id);
  const institutions = paper.institutions || [];
  const institutionHtml = institutions.length ? `<div class="conference-institutions"><span>机构</span>${institutions.slice(0, 4).map(name => `<b>${conferenceEscape(name)}</b>`).join("")}${paper.institution_type ? `<em>${conferenceEscape(paper.institution_type)}</em>` : ""}</div>` : "";
  const summaryHtml = paper.has_full_text_note ? `<dl class="conference-editorial">
    <div><dt>文章主题</dt><dd>${conferenceEscape(paper.article_theme || "等待补充")}</dd></div>
    <div><dt>研究问题</dt><dd>${conferenceEscape(paper.research_question || "等待补充")}</dd></div>
    <div><dt>主要贡献</dt><dd>${conferenceEscape(paper.main_contribution || "等待补充")}</dd></div>
  </dl>` : "";
  const noteUnavailable = paper.conference_pdf_status === "unavailable" || String(paper.conference_note_error || "").startsWith("no downloadable open PDF");
  const noteStatusHtml = noteUnavailable
    ? '<div class="conference-pdf-unavailable">暂无可合法获取的开放 PDF，暂不生成全文笔记</div>'
    : (paper.conference_note_error ? '<div class="conference-pdf-unavailable">全文已获取，AI 笔记生成失败，等待下次重试</div>' : "");
  const noteActions = paper.note_id ? `<div class="conference-note-actions">
    <button type="button" data-conference-note="${conferenceEscape(paper.note_id)}" aria-expanded="false">展开笔记 ▼</button>
    ${paper.pdf_url ? `<a href="${conferenceEscape(paper.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}
    <span>全文解读 · ${conferenceEscape(paper.note_model || "AI")}</span>
  </div><div class="conference-note-panel" id="conference-note-${conferenceEscape(paper.note_id)}" hidden></div>` : noteStatusHtml;
  return `<article class="conference-paper">
    <div class="paper-venue-mark"><b>${conferenceEscape(paper.conference)}</b><small>${conferenceEscape(rank)}</small></div>
    <div class="conference-paper-body">
      <h4><a href="${conferenceEscape(paper.url)}" target="_blank" rel="noopener">${conferenceEscape(paper.title)}</a></h4>
      <p class="conference-authors">${conferenceEscape((paper.authors || []).join(", ") || "作者信息暂缺")}</p>
      <div class="conference-paper-meta"><span>${conferenceEscape(paper.topic)}</span><span>${paper.year}</span>${paper.doi ? `<a href="https://doi.org/${conferenceEscape(paper.doi)}" target="_blank" rel="noopener">DOI ${conferenceEscape(paper.doi)} ↗</a>` : ""}</div>
    </div>
    <button class="conference-save ${saved ? "saved" : ""}" type="button" data-conference-save="${conferenceEscape(paper.id)}" aria-label="${saved ? "取消收藏" : "收藏"} ${conferenceEscape(paper.title)}" aria-pressed="${saved}">${saved ? "★" : "☆"}</button>
    <div class="conference-paper-details">${institutionHtml}${summaryHtml}${noteActions}</div>
  </article>`;
}

function conferenceBullets(value) {
  return String(value || "").split(/\n+/).map(line => line.trim().replace(/^(?:🔸|•|-)+\s*/, "")).filter(Boolean);
}

function conferenceNoteText(note) {
  return [
    "📝 论文笔记", "", `📖标题：${note.title || ""}`,
    `🌐来源：${note.conference || ""} ${note.year || ""}${note.doi ? `, ${note.doi}` : ""}`,
    "", `笔记标题：${note.article_theme || ""}`, "", "🛎️文章简介",
    `🔸研究问题：${note.research_question || ""}`, `🔸主要贡献：${note.main_contribution || ""}`,
    "", "📝重点思路", ...conferenceBullets(note.key_ideas).map(line => `🔸${line}`),
    "", "🔎分析总结", ...conferenceBullets(note.analysis_summary).map(line => `🔸${line}`),
    "", "💡个人观点", note.personal_view || "",
  ].join("\n");
}

async function copyConferenceNote(noteId, button) {
  const note = await loadConferenceNote(noteId);
  const text = conferenceNoteText(note);
  try { await navigator.clipboard.writeText(text); }
  catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => { button.textContent = original; }, 1400);
}

async function loadConferenceNote(noteId) {
  if (!conferenceState.noteRequests.has(noteId)) {
    conferenceState.noteRequests.set(noteId, fetch(`./data/conference-notes/${encodeURIComponent(noteId)}.json`, { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).catch(error => {
      conferenceState.noteRequests.delete(noteId);
      throw error;
    }));
  }
  return conferenceState.noteRequests.get(noteId);
}

function renderConferenceNote(note) {
  const ideas = conferenceBullets(note.key_ideas).map(line => `<p>🔸${conferenceEscape(line)}</p>`).join("");
  const analysis = conferenceBullets(note.analysis_summary).map(line => `<p>🔸${conferenceEscape(line)}</p>`).join("");
  return `<div class="conference-full-note">
    <div class="conference-note-heading"><div><b>📝 论文笔记</b><span>${conferenceEscape(note.note_basis === "full_text_pdf" ? `PDF 全文 · ${note.full_text_pages || "?"} 页` : "AI 解读")}</span></div><button type="button" data-copy-conference-note="${conferenceEscape(note.note_id || note.id)}">复制笔记</button></div>
    <h4>📝重点思路</h4><div class="conference-note-bullets">${ideas}</div>
    <h4>🔎分析总结</h4><div class="conference-note-bullets">${analysis}</div>
    <h4>💡个人观点</h4><p>${conferenceEscape(note.personal_view || "")}</p>
    <small>模型：${conferenceEscape(note.note_model || "AI")} · 来源：${conferenceEscape(note.note_source || "开放全文")}</small>
  </div>`;
}

async function toggleConferenceNote(button) {
  const noteId = button.dataset.conferenceNote;
  const panel = document.querySelector(`#conference-note-${CSS.escape(noteId)}`);
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.textContent = "展开笔记 ▼";
    return;
  }
  panel.hidden = false;
  button.disabled = true;
  button.textContent = "正在读取全文笔记…";
  panel.innerHTML = '<div class="detail-loading">正在加载笔记</div>';
  try {
    const note = await loadConferenceNote(noteId);
    note.note_id = noteId;
    panel.innerHTML = renderConferenceNote(note);
    button.setAttribute("aria-expanded", "true");
    button.textContent = "收起笔记 ▲";
  } catch {
    panel.innerHTML = '<div class="detail-error">笔记加载失败，请稍后重试。</div>';
    button.textContent = "重试展开";
  } finally {
    button.disabled = false;
  }
}

function renderConferenceResults(papers) {
  if (!papers.length) {
    cq("#conferenceResults").innerHTML = '<div class="empty"><strong>当前条件下没有论文</strong><span>可以放宽年份、会议、主题或搜索条件。</span></div>';
    return;
  }
  const years = uniqueSorted(papers.map(paper => paper.year), true);
  cq("#conferenceResults").innerHTML = years.map(year => {
    const yearPapers = papers.filter(paper => paper.year === year);
    const conferenceIds = conferenceState.payload.conferences.map(conf => conf.id).filter(id => yearPapers.some(paper => paper.conference === id));
    return `<section class="conference-year-block">
      <div class="conference-year-heading"><h3>${year}</h3><span>${yearPapers.length} 篇</span></div>
      ${conferenceIds.map(id => {
        const conf = conferenceState.payload.conferences.find(item => item.id === id);
        const venuePapers = yearPapers.filter(paper => paper.conference === id);
        const rank = conf.ccf_rank === "领域旗舰" ? conf.ccf_rank : `CCF ${conf.ccf_rank}`;
        return `<section class="venue-group">
          <header><div><span class="venue-rank rank-${conferenceEscape(conf.ccf_rank)}">${conferenceEscape(rank)}</span><h3>${conferenceEscape(conf.id)}</h3></div><p>${conferenceEscape(conf.name)}</p><b>${venuePapers.length} 篇</b></header>
          <div class="venue-papers">${venuePapers.map(paperRow).join("")}</div>
        </section>`;
      }).join("")}
    </section>`;
  }).join("");
}

function renderActiveConferenceFilters() {
  const labels = [];
  if (conferenceState.year) labels.push(`${conferenceState.year} 年`);
  if (conferenceState.rank) labels.push(conferenceState.rank === "领域旗舰" ? conferenceState.rank : `CCF ${conferenceState.rank}`);
  if (conferenceState.conference) labels.push(conferenceState.conference);
  if (conferenceState.topic) labels.push(conferenceState.topic);
  if (conferenceState.search) labels.push(`搜索：${conferenceState.search}`);
  cq("#activeConferenceFilters").innerHTML = labels.length ? `<span>当前筛选</span>${labels.map(label => `<b>${conferenceEscape(label)}</b>`).join("")}` : "";
}

function renderConferencePage() {
  const papers = filteredConferencePapers();
  renderConferenceControls();
  renderActiveConferenceFilters();
  renderConferenceResults(papers);
  writeConferenceHash();
  cq("#conferencePaperCount").textContent = papers.length;
  cq("#conferenceVenueCount").textContent = new Set(papers.map(paper => paper.conference)).size;
  cq("#conferenceYearCount").textContent = new Set(papers.map(paper => paper.year)).size;
  cq("#conferenceNoteCount").textContent = conferenceState.payload.note_count || 0;
  const date = conferenceState.payload.generated_at ? new Date(conferenceState.payload.generated_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知";
  cq("#conferenceGenerated").textContent = `数据更新：${date} · ${conferenceState.payload.source}`;
  cq("#conferenceSavedCount").textContent = conferenceState.saved.size;
  cq("#conferenceSavedToggle").setAttribute("aria-pressed", String(conferenceState.savedOnly));
  cq("#conferenceResults").setAttribute("aria-busy", "false");
}

initConferencePage();
