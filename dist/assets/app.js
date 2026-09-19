const TOPIC_ORDER = [
  "生成式推荐",
  "LLM 与 Agent",
  "序列与会话推荐",
  "多模态推荐",
  "联邦与隐私推荐",
  "图与知识增强",
  "跨域与冷启动",
  "对话与交互推荐",
  "公平、可信与安全",
  "强化学习与长期价值",
  "评测、数据与复现",
  "工业系统与效率",
  "其他",
];

const topicColors = {
  "生成式推荐": "#e94f64",
  "LLM 与 Agent": "#f97316",
  "序列与会话推荐": "#2563eb",
  "多模态推荐": "#7c3aed",
  "联邦与隐私推荐": "#0891b2",
  "图与知识增强": "#0f766e",
  "跨域与冷启动": "#4f46e5",
  "对话与交互推荐": "#c026d3",
  "公平、可信与安全": "#d97706",
  "强化学习与长期价值": "#db2777",
  "评测、数据与复现": "#16a34a",
  "工业系统与效率": "#475569",
  "其他": "#64748b",
};

const state = {
  papers: [],
  topic: "全部",
  search: "",
  startDate: "",
  endDate: "",
  sort: "score",
  savedOnly: false,
  interestOnly: false,
  saved: new Set(JSON.parse(localStorage.getItem("recsys-daily-saved") || "[]")),
  followedTopics: new Set(JSON.parse(localStorage.getItem("recsys-daily-followed-topics") || "[]")),
  customInterests: JSON.parse(localStorage.getItem("recsys-daily-custom-interests") || "[]"),
  availableDates: new Map(),
  calendarYear: null,
  calendarMonth: null,
  selectionState: "ready",
};

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]));
const formatDisplayDate = value => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value + "T00:00:00"))
  : "—";
const formatDate = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const parseDate = value => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

async function init() {
  renderSkeletons();
  try {
    const response = await fetch("./data/recommendations.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.papers = payload.papers || [];
    state.papers.forEach(paper => {
      const date = paper.published;
      if (date) state.availableDates.set(date, (state.availableDates.get(date) || 0) + 1);
    });

    const dates = [...state.availableDates.keys()].sort();
    const latest = dates.at(-1) || "";
    if (latest) {
      const cutoff = parseDate(latest);
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffString = formatDate(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
      state.startDate = dates.find(date => date >= cutoffString) || latest;
      state.endDate = latest;
      const latestDate = parseDate(latest);
      state.calendarYear = latestDate.getFullYear();
      state.calendarMonth = latestDate.getMonth();
    }

    renderCalendar();
    renderRangeDisplay();
    renderTopicFilters();
    renderFollowedTopics();
    bindEvents();
    render();
  } catch {
    $("#papers").innerHTML = '<div class="empty"><strong>论文数据加载失败</strong><span>请稍后刷新页面。</span></div>';
    $("#papers").setAttribute("aria-busy", "false");
  }
}

function renderSkeletons() {
  const template = $("#skeletonTemplate");
  for (let i = 0; i < 4; i += 1) $("#papers").append(template.content.cloneNode(true));
}

function renderCalendar() {
  if (state.calendarYear == null) return;
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const startWeekDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  let html = `
    <div class="calendar-head">
      <button class="calendar-nav" type="button" data-calendar-nav="-1" aria-label="上个月">‹</button>
      <strong>${year} 年 ${month + 1} 月</strong>
      <button class="calendar-nav" type="button" data-calendar-nav="1" aria-label="下个月">›</button>
    </div>
    <div class="calendar-grid">
      ${weekdays.map(day => `<span class="calendar-dow">${day}</span>`).join("")}
      ${Array.from({ length: startWeekDay }, () => '<span class="calendar-day"></span>').join("")}
  `;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = formatDate(year, month, day);
    const available = state.availableDates.has(date);
    const classes = ["calendar-day"];
    if (available) classes.push("available");
    if (state.startDate && state.endDate && date > state.startDate && date < state.endDate) classes.push("in-range");
    if (date === state.startDate || date === state.endDate) classes.push("selected");
    const count = state.availableDates.get(date) || 0;
    html += `<button type="button" class="${classes.join(" ")}" ${available ? `data-date="${date}" title="${date} · ${count} 篇"` : "disabled"}>${day}</button>`;
  }
  html += "</div>";
  $("#datePicker").innerHTML = html;
}

function renderRangeDisplay() {
  const display = $("#dateRangeDisplay");
  if (!state.startDate) {
    display.textContent = "暂无日期数据";
  } else if (state.selectionState === "picking") {
    display.textContent = `当前 ${state.startDate} · 再点一个日期可选区间`;
  } else if (state.startDate === state.endDate) {
    display.textContent = `当前：${state.startDate}`;
  } else {
    display.textContent = `${state.startDate} → ${state.endDate}`;
  }
}

function handleDateClick(date) {
  if (state.selectionState === "ready") {
    state.startDate = date;
    state.endDate = date;
    state.selectionState = "picking";
  } else {
    if (date < state.startDate) {
      state.endDate = state.startDate;
      state.startDate = date;
    } else {
      state.endDate = date;
    }
    state.selectionState = "ready";
  }
  renderCalendar();
  renderRangeDisplay();
  render();
}

function renderTopicFilters() {
  const counts = state.papers.reduce((map, paper) => {
    const topic = paper.topic || "其他";
    map.set(topic, (map.get(topic) || 0) + 1);
    return map;
  }, new Map());
  const topics = ["全部", ...TOPIC_ORDER];
  $("#topicFilters").innerHTML = topics.map(topic => {
    const followed = state.followedTopics.has(topic);
    const count = topic === "全部" ? state.papers.length : (counts.get(topic) || 0);
    return `<div class="topic-row">
      <button class="topic-chip ${state.topic === topic ? "active" : ""}" type="button" data-topic="${escapeHtml(topic)}" title="${escapeHtml(topic)}">${escapeHtml(topic)} <small>${count}</small></button>
      ${topic === "全部" ? "<span></span>" : `<button class="topic-follow ${followed ? "followed" : ""}" type="button" data-follow-topic="${escapeHtml(topic)}" aria-label="${followed ? "取消关注" : "关注"}${escapeHtml(topic)}" aria-pressed="${followed}">${followed ? "★" : "☆"}</button>`}
    </div>`;
  }).join("");
}

function renderFollowedTopics() {
  const items = [
    ...[...state.followedTopics].map(value => ({ value, custom: false })),
    ...state.customInterests.map(value => ({ value, custom: true })),
  ];
  $("#followedTopics").innerHTML = items.length
    ? items.map(item => `<span class="followed-chip">${escapeHtml(item.value)}<button type="button" data-remove-interest="${escapeHtml(item.value)}" data-custom="${item.custom}" aria-label="移除 ${escapeHtml(item.value)}">×</button></span>`).join("")
    : '<span class="followed-empty">还没有关注方向</span>';
}

function persistInterests() {
  localStorage.setItem("recsys-daily-followed-topics", JSON.stringify([...state.followedTopics]));
  localStorage.setItem("recsys-daily-custom-interests", JSON.stringify(state.customInterests));
}

function toggleFollowedTopic(topic) {
  state.followedTopics.has(topic) ? state.followedTopics.delete(topic) : state.followedTopics.add(topic);
  persistInterests();
  renderTopicFilters();
  renderFollowedTopics();
  render();
}

function bindEvents() {
  $("#datePicker").addEventListener("click", event => {
    const nav = event.target.closest("[data-calendar-nav]");
    if (nav) {
      const next = new Date(state.calendarYear, state.calendarMonth + Number(nav.dataset.calendarNav), 1);
      state.calendarYear = next.getFullYear();
      state.calendarMonth = next.getMonth();
      renderCalendar();
      return;
    }
    const dateButton = event.target.closest("[data-date]");
    if (dateButton) handleDateClick(dateButton.dataset.date);
  });
  $("#resetDates").addEventListener("click", () => {
    const latest = [...state.availableDates.keys()].sort().at(-1) || "";
    state.startDate = latest;
    state.endDate = latest;
    state.selectionState = "ready";
    if (latest) {
      const date = parseDate(latest);
      state.calendarYear = date.getFullYear();
      state.calendarMonth = date.getMonth();
    }
    renderCalendar();
    renderRangeDisplay();
    render();
  });
  $("#topicFilters").addEventListener("click", event => {
    const follow = event.target.closest("[data-follow-topic]");
    if (follow) {
      toggleFollowedTopic(follow.dataset.followTopic);
      return;
    }
    const button = event.target.closest("[data-topic]");
    if (!button) return;
    state.topic = button.dataset.topic;
    renderTopicFilters();
    render();
  });
  $("#clearTopic").addEventListener("click", () => {
    state.topic = "全部";
    renderTopicFilters();
    render();
  });
  $("#customInterestForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#customInterestInput");
    const value = input.value.trim();
    if (!value || state.customInterests.some(item => item.toLowerCase() === value.toLowerCase())) return;
    state.customInterests.push(value);
    input.value = "";
    persistInterests();
    renderFollowedTopics();
    render();
  });
  $("#followedTopics").addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-interest]");
    if (!remove) return;
    const value = remove.dataset.removeInterest;
    if (remove.dataset.custom === "true") {
      state.customInterests = state.customInterests.filter(item => item !== value);
    } else {
      state.followedTopics.delete(value);
    }
    persistInterests();
    renderTopicFilters();
    renderFollowedTopics();
    render();
  });
  $("#interestOnly").addEventListener("click", () => {
    state.interestOnly = !state.interestOnly;
    $("#interestOnly").setAttribute("aria-pressed", String(state.interestOnly));
    render();
  });
  $("#searchInput").addEventListener("input", event => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });
  $("#sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    render();
  });
  $("#savedToggle").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    $("#savedToggle").setAttribute("aria-pressed", String(state.savedOnly));
    render();
  });
  $("#papers").addEventListener("click", handleCardClick);
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      event.preventDefault();
      $("#searchInput").focus();
    }
  });
}

function matchesInterest(paper) {
  if (!state.interestOnly) return true;
  if (state.followedTopics.has(paper.topic || "其他")) return true;
  const haystack = [paper.title, paper.abstract, paper.reason, ...(paper.authors || []), ...(paper.institutions || [])].join(" ").toLowerCase();
  return state.customInterests.some(interest => haystack.includes(interest.toLowerCase()));
}

function visiblePapers() {
  return state.papers.filter(paper => {
    const inTopic = state.topic === "全部" || (paper.topic || "其他") === state.topic;
    const inDate = (!state.startDate || paper.published >= state.startDate) && (!state.endDate || paper.published <= state.endDate);
    const inSaved = !state.savedOnly || state.saved.has(paper.id);
    const haystack = [paper.title, ...(paper.authors || []), ...(paper.institutions || []), paper.abstract, paper.reason, paper.id].join(" ").toLowerCase();
    return inTopic && inDate && inSaved && matchesInterest(paper) && (!state.search || haystack.includes(state.search));
  }).sort((a, b) => {
    if (state.sort === "newest") return b.published.localeCompare(a.published) || b.score - a.score;
    if (state.sort === "saved") return Number(state.saved.has(b.id)) - Number(state.saved.has(a.id)) || b.score - a.score;
    return b.score - a.score || b.published.localeCompare(a.published);
  });
}

function render() {
  const papers = visiblePapers();
  const latest = state.papers.map(paper => paper.published).filter(Boolean).sort().at(-1);
  $("#paperCount").textContent = papers.length;
  $("#topicCount").textContent = new Set(papers.map(paper => paper.topic)).size;
  $("#latestDate").textContent = formatDisplayDate(latest);
  $("#savedCount").textContent = state.saved.size;
  $("#dateSummary").textContent = latest ? `${latest} · ARXIV SIGNAL` : "ARXIV SIGNAL";
  $("#resultCopy").textContent = state.interestOnly
    ? "只显示我的关注方向"
    : state.savedOnly
      ? "仅显示已收藏论文"
      : state.search
        ? `检索“${state.search}”`
        : `${state.startDate} 至 ${state.endDate}`;
  $("#papers").setAttribute("aria-busy", "false");
  $("#papers").innerHTML = papers.length
    ? papers.map(renderCard).join("")
    : '<div class="empty"><strong>没有找到匹配论文</strong><span>试试换一个日期、方向或清除“只看关注”。</span></div>';
}

function renderCard(paper) {
  const topic = paper.topic || "其他";
  const color = topicColors[topic] || topicColors["其他"];
  const saved = state.saved.has(paper.id);
  const followed = state.followedTopics.has(topic);
  const authors = (paper.authors || []).join(", ");
  const institutions = (paper.institutions || []).filter(Boolean);
  const institutionHtml = institutions.length
    ? institutions.slice(0, 3).map(name => `<span class="institution-badge">${escapeHtml(name)}</span>`).join("") + (institutions.length > 3 ? `<span class="institution-empty">+${institutions.length - 3}</span>` : "")
    : '<span class="institution-empty">机构信息未公开</span>';
  return `<article class="paper-card" style="--topic-color:${color};--score:${Number(paper.score) || 0}" data-id="${escapeHtml(paper.id)}">
    <div class="paper-card-head">
      <div class="score" aria-label="推荐分 ${paper.score}"><b>${paper.score}</b><small>signal</small></div>
      <div><h3 class="paper-title">${escapeHtml(paper.title)}</h3><p class="authors" title="${escapeHtml(authors)}">${escapeHtml(authors)}</p></div>
      <button class="save-button ${saved ? "saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}">${saved ? "★" : "☆"}</button>
    </div>
    <div class="paper-meta">
      <span class="tag">${escapeHtml(topic)}</span>
      <button class="topic-save ${followed ? "followed" : ""}" type="button" data-action="follow-topic" aria-label="${followed ? "取消关注" : "关注"}${escapeHtml(topic)}" aria-pressed="${followed}">${followed ? "★" : "☆"}</button>
      <span>${escapeHtml(paper.published)}</span><span class="meta-sep">·</span>
      <a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">arXiv:${escapeHtml(paper.id)}</a>
      ${paper.categories?.length ? `<span class="meta-sep">·</span><span>${escapeHtml(paper.categories.join(" / "))}</span>` : ""}
    </div>
    <div class="institution-row"><span class="institution-label">机构</span>${paper.institution_type ? `<span class="institution-type">${escapeHtml(paper.institution_type)}</span>` : ""}${institutionHtml}</div>
    <p class="reason"><b>推荐理由：</b>${escapeHtml(paper.reason || "与推荐系统研究直接相关，值得快速浏览。")}</p>
    <div class="card-actions"><button class="detail-button" type="button" data-action="abstract" aria-expanded="false">展开摘要</button><a class="link-button" href="${escapeHtml(paper.pdf_url || paper.url.replace("/abs/", "/pdf/"))}" target="_blank" rel="noopener">PDF ↗</a></div>
    <div class="abstract-panel"><p>${escapeHtml(paper.abstract || "暂无摘要。")}</p></div>
  </article>`;
}

function handleCardClick(event) {
  const card = event.target.closest(".paper-card");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!card || !action) return;
  const paper = state.papers.find(item => item.id === card.dataset.id);
  if (action === "save") {
    state.saved.has(card.dataset.id) ? state.saved.delete(card.dataset.id) : state.saved.add(card.dataset.id);
    localStorage.setItem("recsys-daily-saved", JSON.stringify([...state.saved]));
    render();
  }
  if (action === "follow-topic" && paper) toggleFollowedTopic(paper.topic || "其他");
  if (action === "abstract") {
    const panel = card.querySelector(".abstract-panel");
    const open = panel.classList.toggle("open");
    event.target.setAttribute("aria-expanded", String(open));
    event.target.textContent = open ? "收起摘要" : "展开摘要";
  }
}

init();
