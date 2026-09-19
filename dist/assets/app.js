const state = {
  papers: [],
  topic: "全部",
  search: "",
  startDate: "",
  endDate: "",
  sort: "score",
  savedOnly: false,
  saved: new Set(JSON.parse(localStorage.getItem("recsys-daily-saved") || "[]")),
};

const topicColors = {
  "LLM 推荐": "#e94f64",
  "序列推荐": "#2563eb",
  "多模态推荐": "#7c3aed",
  "公平与安全": "#d97706",
  "图推荐": "#0891b2",
  "评测与基准": "#16a34a",
  "强化学习": "#db2777",
  "工业系统": "#475569",
  "其他": "#64748b",
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const formatDate = value => value ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";

async function init() {
  renderSkeletons();
  try {
    const response = await fetch("./data/recommendations.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.papers = payload.papers || [];
    const dates = state.papers.map(p => p.published).filter(Boolean).sort();
    state.startDate = dates[0] || "";
    state.endDate = dates.at(-1) || "";
    $("#startDate").value = state.startDate;
    $("#endDate").value = state.endDate;
    setupTopics();
    bindEvents();
    render();
  } catch (error) {
    $("#papers").innerHTML = `<div class="empty"><strong>论文数据加载失败</strong><span>请通过本地服务器访问，或稍后刷新页面。</span></div>`;
    $("#papers").setAttribute("aria-busy", "false");
  }
}

function renderSkeletons() {
  const template = $("#skeletonTemplate");
  for (let i = 0; i < 4; i++) $("#papers").append(template.content.cloneNode(true));
}

function setupTopics() {
  const topics = ["全部", ...new Set(state.papers.map(p => p.topic || "其他"))];
  $("#topicFilters").innerHTML = topics.map(topic => `<button class="topic-chip ${topic === "全部" ? "active" : ""}" type="button" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join("");
}

function bindEvents() {
  $("#topicFilters").addEventListener("click", event => {
    const button = event.target.closest("[data-topic]");
    if (!button) return;
    state.topic = button.dataset.topic;
    document.querySelectorAll(".topic-chip").forEach(el => el.classList.toggle("active", el === button));
    render();
  });
  $("#searchInput").addEventListener("input", event => { state.search = event.target.value.trim().toLowerCase(); render(); });
  $("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; render(); });
  $("#startDate").addEventListener("change", event => { state.startDate = event.target.value; render(); });
  $("#endDate").addEventListener("change", event => { state.endDate = event.target.value; render(); });
  $("#resetDates").addEventListener("click", () => {
    const latest = state.papers.map(p => p.published).filter(Boolean).sort().at(-1) || "";
    state.startDate = state.papers.map(p => p.published).filter(Boolean).sort()[0] || "";
    state.endDate = latest;
    $("#startDate").value = state.startDate; $("#endDate").value = latest; render();
  });
  $("#savedToggle").addEventListener("click", () => { state.savedOnly = !state.savedOnly; $("#savedToggle").setAttribute("aria-pressed", String(state.savedOnly)); render(); });
  $("#papers").addEventListener("click", handleCardClick);
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); $("#searchInput").focus(); }
  });
}

function visiblePapers() {
  const filtered = state.papers.filter(paper => {
    const inTopic = state.topic === "全部" || (paper.topic || "其他") === state.topic;
    const inDate = (!state.startDate || paper.published >= state.startDate) && (!state.endDate || paper.published <= state.endDate);
    const inSaved = !state.savedOnly || state.saved.has(paper.id);
    const haystack = [paper.title, ...(paper.authors || []), paper.abstract, paper.reason, paper.id].join(" ").toLowerCase();
    return inTopic && inDate && inSaved && (!state.search || haystack.includes(state.search));
  });
  return filtered.sort((a, b) => {
    if (state.sort === "newest") return b.published.localeCompare(a.published) || b.score - a.score;
    if (state.sort === "saved") return Number(state.saved.has(b.id)) - Number(state.saved.has(a.id)) || b.score - a.score;
    return b.score - a.score || b.published.localeCompare(a.published);
  });
}

function render() {
  const papers = visiblePapers();
  const allTopics = new Set(papers.map(p => p.topic));
  const latest = state.papers.map(p => p.published).filter(Boolean).sort().at(-1);
  $("#paperCount").textContent = papers.length;
  $("#topicCount").textContent = allTopics.size;
  $("#latestDate").textContent = formatDate(latest);
  $("#savedCount").textContent = state.saved.size;
  $("#dateSummary").textContent = latest ? `${latest} · ARXIV SIGNAL` : "ARXIV SIGNAL";
  $("#resultCopy").textContent = state.savedOnly ? "仅显示已收藏论文" : state.search ? `检索“${state.search}”` : "按推荐度排列";
  $("#papers").setAttribute("aria-busy", "false");
  $("#papers").innerHTML = papers.length ? papers.map(renderCard).join("") : `<div class="empty"><strong>没有找到匹配论文</strong><span>试试放宽日期范围或清除筛选条件。</span></div>`;
}

function renderCard(paper) {
  const topic = paper.topic || "其他";
  const color = topicColors[topic] || topicColors["其他"];
  const saved = state.saved.has(paper.id);
  const authors = (paper.authors || []).join(", ");
  return `<article class="paper-card" style="--topic-color:${color};--score:${Number(paper.score) || 0}" data-id="${escapeHtml(paper.id)}">
    <div class="paper-card-head">
      <div class="score" aria-label="推荐分 ${paper.score}"><b>${paper.score}</b><small>signal</small></div>
      <div><h3 class="paper-title">${escapeHtml(paper.title)}</h3><p class="authors" title="${escapeHtml(authors)}">${escapeHtml(authors)}</p></div>
      <button class="save-button ${saved ? "saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}">${saved ? "★" : "☆"}</button>
    </div>
    <div class="paper-meta"><span class="tag">${escapeHtml(topic)}</span><span>${escapeHtml(paper.published)}</span><span class="meta-sep">·</span><a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">arXiv:${escapeHtml(paper.id)}</a>${paper.categories?.length ? `<span class="meta-sep">·</span><span>${escapeHtml(paper.categories.join(" / "))}</span>` : ""}</div>
    <p class="reason"><b>推荐理由：</b>${escapeHtml(paper.reason || "与推荐系统研究直接相关，值得快速浏览。")}</p>
    <div class="card-actions"><button class="detail-button" type="button" data-action="abstract" aria-expanded="false">展开摘要</button><a class="link-button" href="${escapeHtml(paper.pdf_url || paper.url.replace("/abs/", "/pdf/"))}" target="_blank" rel="noopener">PDF ↗</a></div>
    <div class="abstract-panel"><p>${escapeHtml(paper.abstract || "暂无摘要。")}</p></div>
  </article>`;
}

function handleCardClick(event) {
  const card = event.target.closest(".paper-card");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!card || !action) return;
  if (action === "save") {
    state.saved.has(card.dataset.id) ? state.saved.delete(card.dataset.id) : state.saved.add(card.dataset.id);
    localStorage.setItem("recsys-daily-saved", JSON.stringify([...state.saved]));
    render();
  }
  if (action === "abstract") {
    const panel = card.querySelector(".abstract-panel");
    const open = panel.classList.toggle("open");
    event.target.setAttribute("aria-expanded", String(open));
    event.target.textContent = open ? "收起摘要" : "展开摘要";
  }
}

init();

