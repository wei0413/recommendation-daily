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

const NOTE_START_DATE = "2026-09-10";
const COUNTER_API_BASE = "https://counterapi.com/api/recommendation-daily";
const DAILY_LIKE_KEY = "recsys-daily-liked-on";

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
  earliestDate: "",
  generatedAt: "",
  followLatest: true,
  calendarYear: null,
  calendarMonth: null,
  selectionState: "ready",
  pageSize: 30,
};

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]));
const normalizeBullets = value => String(value || "")
  .split(/\n+/)
  .map(line => line.trim().replace(/^(?:🔸|•|-)+\s*/, ""))
  .filter(Boolean)
  .map(line => `🔸${line}`);
const bulletHtml = value => normalizeBullets(value)
  .map(line => `<p>${escapeHtml(line)}</p>`)
  .join("");
const hasFullTextNote = paper => paper.published >= NOTE_START_DATE
  && paper.note_basis === "full_text_pdf"
  && Boolean(paper.article_theme && paper.research_question && paper.main_contribution
    && paper.key_ideas && paper.analysis_summary && paper.personal_view);
const paperNoteText = paper => [
  "📝 论文笔记",
  "",
  `📖标题：${paper.title}`,
  `🌐来源：arXiv, ${paper.id}`,
  "",
  `笔记标题：${paper.article_theme}`,
  "",
  "🛎️文章简介",
  `🔸研究问题：${paper.research_question}`,
  `🔸主要贡献：${paper.main_contribution}`,
  "",
  "📝重点思路",
  ...normalizeBullets(paper.key_ideas),
  "",
  "🔎分析总结",
  ...normalizeBullets(paper.analysis_summary),
  "",
  "💡个人观点",
  paper.personal_view,
].join("\n");
async function copyPaperNote(paper) {
  const text = paperNoteText(paper);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}
const formatDisplayDate = value => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value + "T00:00:00"))
  : "—";
const formatDate = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const shiftDate = (value, days) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const parseDate = value => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const readDateHash = () => {
  const match = location.hash.match(/(?:^#|&)dates=(\d{4}-\d{2}-\d{2})(?:~(\d{4}-\d{2}-\d{2}))?/);
  return match ? { start: match[1], end: match[2] || match[1] } : null;
};
const updateDateHash = () => {
  if (!state.startDate) return;
  if (state.followLatest) {
    history.replaceState(null, "", `${location.pathname}${location.search}#latest`);
    return;
  }
  const range = state.startDate === state.endDate ? state.startDate : `${state.startDate}~${state.endDate}`;
  history.replaceState(null, "", `${location.pathname}${location.search}#dates=${range}`);
};
const resetPaging = () => { state.pageSize = 30; };

function setLatestWindow() {
  const today = beijingDateKey();
  state.startDate = shiftDate(today, -6);
  state.endDate = today;
  state.followLatest = true;
  state.selectionState = "ready";
  const date = parseDate(today);
  state.calendarYear = date.getFullYear();
  state.calendarMonth = date.getMonth();
}

async function init() {
  renderSkeletons();
  initEngagement();
  try {
    const response = await fetch("./data/recommendations.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.papers = payload.papers || [];
    state.generatedAt = payload.generated_at || "";
    state.papers.forEach(paper => {
      const date = paper.published;
      if (date) state.availableDates.set(date, (state.availableDates.get(date) || 0) + 1);
    });

    const dates = [...state.availableDates.keys()].sort();
    const latest = dates.at(-1) || "";
    if (latest) {
      state.earliestDate = dates[0];
      const hashRange = readDateHash();
      const legacyDefault = hashRange
        && hashRange.start === dates[Math.max(0, dates.length - 7)]
        && hashRange.end === latest;
      if (!hashRange || location.hash === "#latest" || legacyDefault) {
        setLatestWindow();
      } else {
        state.startDate = hashRange.start;
        state.endDate = hashRange.end;
        state.followLatest = false;
        if (state.startDate > state.endDate) [state.startDate, state.endDate] = [state.endDate, state.startDate];
        const calendarDate = parseDate(state.endDate);
        state.calendarYear = calendarDate.getFullYear();
        state.calendarMonth = calendarDate.getMonth();
      }
    }

    renderCalendar();
    renderRangeDisplay();
    updateDateHash();
    renderTopicFilters();
    renderFollowedTopics();
    bindEvents();
    render();
  } catch {
    $("#papers").innerHTML = '<div class="empty"><strong>论文数据加载失败</strong><span>请稍后刷新页面。</span></div>';
    $("#papers").setAttribute("aria-busy", "false");
  }
}

function beijingDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readCounter(action, key, increment = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const params = new URLSearchParams();
  if (!increment) params.set("readOnly", "true");
  try {
    const response = await fetch(`${COUNTER_API_BASE}/${action}/${key}?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const value = Number(payload.value);
    if (!Number.isFinite(value)) throw new Error("Invalid counter response");
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function formatCounter(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value) || 0));
}

function setLikedState(liked) {
  const button = $("#siteLikeButton");
  button.setAttribute("aria-pressed", String(liked));
  button.disabled = liked;
  $("#siteLikeHint").textContent = liked ? "今日已赞" : "点赞";
  button.title = liked ? "今天已经点过赞，明天可以再来" : "每天可以为网站点赞一次";
}

async function initEngagement() {
  const today = beijingDateKey();
  setLikedState(localStorage.getItem(DAILY_LIKE_KEY) === today);

  readCounter("view", "homepage", true)
    .then(value => { $("#pageViewCount").textContent = formatCounter(value); })
    .catch(() => { $("#pageViewCount").textContent = "—"; });

  let currentLikes = 0;
  readCounter("like", "homepage")
    .then(value => {
      currentLikes = value;
      $("#siteLikeCount").textContent = formatCounter(value);
    })
    .catch(() => { $("#siteLikeCount").textContent = "—"; });

  $("#siteLikeButton").addEventListener("click", async () => {
    if (localStorage.getItem(DAILY_LIKE_KEY) === beijingDateKey()) {
      setLikedState(true);
      return;
    }
    const button = $("#siteLikeButton");
    button.disabled = true;
    $("#siteLikeHint").textContent = "提交中…";
    try {
      const value = await readCounter("like", "homepage", true);
      currentLikes = Math.max(value, currentLikes + 1);
      $("#siteLikeCount").textContent = formatCounter(currentLikes);
      localStorage.setItem(DAILY_LIKE_KEY, beijingDateKey());
      setLikedState(true);
    } catch {
      button.disabled = false;
      $("#siteLikeHint").textContent = "重试点赞";
      button.title = "点赞服务暂时不可用，请稍后重试";
    }
  });
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
  const today = beijingDateKey();
  const todayDate = parseDate(today);
  const earliestDate = state.earliestDate ? parseDate(state.earliestDate) : null;
  const atEarliestMonth = earliestDate
    && year === earliestDate.getFullYear()
    && month === earliestDate.getMonth();
  const atLatestMonth = year === todayDate.getFullYear() && month === todayDate.getMonth();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  let html = `
    <div class="calendar-head">
      <button class="calendar-nav" type="button" data-calendar-nav="-1" aria-label="上个月" ${atEarliestMonth ? "disabled" : ""}>‹</button>
      <strong>${year} 年 ${month + 1} 月</strong>
      <button class="calendar-nav" type="button" data-calendar-nav="1" aria-label="下个月" ${atLatestMonth ? "disabled" : ""}>›</button>
    </div>
    <div class="calendar-grid">
      ${weekdays.map(day => `<span class="calendar-dow">${day}</span>`).join("")}
      ${Array.from({ length: startWeekDay }, () => '<span class="calendar-day"></span>').join("")}
  `;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = formatDate(year, month, day);
    const available = state.availableDates.has(date);
    const selectable = date <= today && (!state.earliestDate || date >= state.earliestDate);
    const classes = ["calendar-day"];
    if (selectable) classes.push("selectable");
    if (available) classes.push("available");
    if (state.startDate && state.endDate && date > state.startDate && date < state.endDate) classes.push("in-range");
    if (date === state.startDate || date === state.endDate) classes.push("selected");
    const count = state.availableDates.get(date) || 0;
    const title = available ? `${date} · ${count} 篇` : `${date} · 暂无论文`;
    html += `<button type="button" class="${classes.join(" ")}" ${selectable ? `data-date="${date}" title="${title}"` : "disabled"}>${day}</button>`;
  }
  html += "</div>";
  $("#datePicker").innerHTML = html;
}

function renderRangeDisplay() {
  const display = $("#dateRangeDisplay");
  if (!state.startDate) {
    display.textContent = "暂无日期数据";
  } else if (state.followLatest) {
    display.textContent = `${state.startDate} → ${state.endDate} · 跟随最新`;
  } else if (state.selectionState === "picking") {
    display.textContent = `当前 ${state.startDate} · 再点一个日期可选区间`;
  } else if (state.startDate === state.endDate) {
    display.textContent = `当前：${state.startDate}`;
  } else {
    display.textContent = `${state.startDate} → ${state.endDate}`;
  }
}

function handleDateClick(date) {
  state.followLatest = false;
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
  if (state.selectionState === "ready") updateDateHash();
  resetPaging();
  renderCalendar();
  renderRangeDisplay();
  render();
}

function renderTopicFilters() {
  const filterablePapers = state.papers.filter(matchesBaseFilters);
  const counts = filterablePapers.reduce((map, paper) => {
    const topic = paper.topic || "其他";
    map.set(topic, (map.get(topic) || 0) + 1);
    return map;
  }, new Map());
  const topics = ["全部", ...TOPIC_ORDER];
  $("#topicFilters").innerHTML = topics.map(topic => {
    const followed = state.followedTopics.has(topic);
    const count = topic === "全部" ? filterablePapers.length : (counts.get(topic) || 0);
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
    setLatestWindow();
    updateDateHash();
    resetPaging();
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
    resetPaging();
    renderTopicFilters();
    render();
  });
  $("#clearTopic").addEventListener("click", () => {
    state.topic = "全部";
    resetPaging();
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
    resetPaging();
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
    resetPaging();
    render();
  });
  $("#searchInput").addEventListener("input", event => {
    state.search = event.target.value.trim().toLowerCase();
    resetPaging();
    render();
  });
  $("#sortSelect").addEventListener("change", event => {
    state.sort = event.target.value;
    resetPaging();
    render();
  });
  $("#savedToggle").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    $("#savedToggle").setAttribute("aria-pressed", String(state.savedOnly));
    resetPaging();
    render();
  });
  $("#papers").addEventListener("click", handleCardClick);
  $("#loadMore").addEventListener("click", () => {
    state.pageSize += 30;
    render();
  });
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
  const haystack = [paper.title, paper.abstract, paper.reason, paper.article_theme, paper.research_question, paper.main_contribution, paper.key_ideas, paper.analysis_summary, paper.personal_view, ...(paper.authors || []), ...(paper.institutions || [])].join(" ").toLowerCase();
  return state.customInterests.some(interest => haystack.includes(interest.toLowerCase()));
}

function matchesBaseFilters(paper) {
    const inDate = (!state.startDate || paper.published >= state.startDate) && (!state.endDate || paper.published <= state.endDate);
    const inSaved = !state.savedOnly || state.saved.has(paper.id);
    const haystack = [paper.title, ...(paper.authors || []), ...(paper.institutions || []), paper.abstract, paper.reason, paper.article_theme, paper.research_question, paper.main_contribution, paper.key_ideas, paper.analysis_summary, paper.personal_view, paper.reading_note, paper.id].join(" ").toLowerCase();
    return inDate && inSaved && matchesInterest(paper) && (!state.search || haystack.includes(state.search));
}

function visiblePapers() {
  return state.papers.filter(paper => {
    const inTopic = state.topic === "全部" || (paper.topic || "其他") === state.topic;
    return inTopic && matchesBaseFilters(paper);
  }).sort((a, b) => {
    if (state.sort === "newest") return b.published.localeCompare(a.published) || b.score - a.score;
    if (state.sort === "saved") return Number(state.saved.has(b.id)) - Number(state.saved.has(a.id)) || b.score - a.score;
    return b.score - a.score || b.published.localeCompare(a.published);
  });
}

function render() {
  const allPapers = visiblePapers();
  renderTopicFilters();
  const papers = allPapers.slice(0, state.pageSize);
  const latest = state.papers.map(paper => paper.published).filter(Boolean).sort().at(-1);
  const checkedAt = state.generatedAt
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(state.generatedAt))
    : "—";
  $("#paperCount").textContent = allPapers.length;
  $("#topicCount").textContent = new Set(allPapers.map(paper => paper.topic)).size;
  $("#latestDate").textContent = checkedAt;
  $("#savedCount").textContent = state.saved.size;
  $("#dateSummary").textContent = latest ? `最新论文 ${latest} · ARXIV SIGNAL` : "ARXIV SIGNAL";
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
  const loadMore = $("#loadMore");
  loadMore.hidden = papers.length >= allPapers.length;
  loadMore.textContent = `再显示 ${Math.min(30, allPapers.length - papers.length)} 篇`;
}

function renderCard(paper) {
  const topic = paper.topic || "其他";
  const color = topicColors[topic] || topicColors["其他"];
  const saved = state.saved.has(paper.id);
  const followed = state.followedTopics.has(topic);
  const authors = (paper.authors || []).join(", ");
  const institutions = (paper.institutions || []).filter(Boolean);
  const hasEditorialNote = hasFullTextNote(paper);
  const focusLabel = hasEditorialNote ? (paper.focus_label || topic) : topic;
  const organizationSector = paper.organization_sector || paper.institution_type || "机构未公开";
  const primaryInstitution = paper.primary_institution_zh || paper.primary_institution || institutions[0] || "机构未公开";
  const noteSource = hasEditorialNote && paper.note_model
      ? `全文解读 · ${paper.note_model}`
      : "";
  const institutionHtml = institutions.length
    ? institutions.slice(0, 3).map(name => `<span class="institution-badge">${escapeHtml(name)}</span>`).join("") + (institutions.length > 3 ? `<span class="institution-empty">+${institutions.length - 3}</span>` : "")
    : '<span class="institution-empty">机构信息未公开</span>';
  const scoreHelp = `推荐分 ${paper.score}：用于阅读排序，综合推荐相关性、内容信号与新近程度；不等同于学术质量。`;
  const editorialHtml = hasEditorialNote ? `<dl class="editorial-summary">
      <div><dt>文章主题</dt><dd>${escapeHtml(paper.article_theme)}</dd></div>
      <div><dt>研究问题</dt><dd>${escapeHtml(paper.research_question)}</dd></div>
      <div><dt>主要贡献</dt><dd>${escapeHtml(paper.main_contribution)}</dd></div>
    </dl>` : "";
  const noteHtml = hasEditorialNote ? `<section class="full-note">
      <div class="full-note-heading"><h4>📝 论文笔记</h4><button type="button" data-action="copy-note">复制</button></div>
      <div class="note-identity"><p><b>📖 标题：</b>${escapeHtml(paper.title)}</p><p><b>🌐 来源：</b>arXiv, ${escapeHtml(paper.id)}</p></div>
      <h4>笔记标题</h4><p class="note-title">${escapeHtml(paper.article_theme)}</p>
      <h4>🛎️ 文章简介</h4>
      <p><b>🔸研究问题：</b>${escapeHtml(paper.research_question)}</p>
      <p><b>🔸主要贡献：</b>${escapeHtml(paper.main_contribution)}</p>
      <h4>📝 重点思路</h4><div class="note-bullets">${bulletHtml(paper.key_ideas)}</div>
      <h4>🔎 分析总结</h4><div class="note-bullets">${bulletHtml(paper.analysis_summary)}</div>
      <h4>💡 个人观点</h4><p>${escapeHtml(paper.personal_view)}</p>
      <p class="full-text-proof">基于 arXiv PDF 全文解读${paper.full_text_pages ? ` · ${paper.full_text_pages} 页` : ""}</p>
    </section>` : "";
  return `<article class="paper-card" style="--topic-color:${color};--score:${Number(paper.score) || 0}" data-id="${escapeHtml(paper.id)}">
    <div class="paper-card-head">
      <div class="score" aria-label="${escapeHtml(scoreHelp)}" title="${escapeHtml(scoreHelp)}"><b>${paper.score}</b><small>推荐分</small></div>
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
    <div class="paper-labels"><span>${escapeHtml(focusLabel)}</span><span>${escapeHtml(organizationSector)}</span><span>${escapeHtml(primaryInstitution)}</span>${noteSource && hasEditorialNote ? `<span class="note-source">${escapeHtml(noteSource)}</span>` : ""}</div>
    ${editorialHtml}
    <div class="card-actions"><button class="detail-button" type="button" data-action="abstract" aria-expanded="false">${hasEditorialNote ? "展开笔记" : "查看摘要"} ▼</button><a class="link-button" href="${escapeHtml(paper.pdf_url || paper.url.replace("/abs/", "/pdf/"))}" target="_blank" rel="noopener">PDF ↗</a></div>
    <div class="abstract-panel">
      ${noteHtml}
      <h4>${hasEditorialNote ? "论文原始摘要" : "摘要"}</h4><p>${escapeHtml(paper.abstract || "暂无摘要。")}</p>
      <h4>作者机构</h4><div class="institution-row"><span class="institution-type">${escapeHtml(organizationSector)}</span>${institutionHtml}</div>
    </div>
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
  if (action === "copy-note" && paper) {
    const button = event.target.closest("[data-action='copy-note']");
    copyPaperNote(paper).then(() => {
      button.textContent = "已复制 ✓";
      window.setTimeout(() => { button.textContent = "复制"; }, 1800);
    });
    return;
  }
  if (action === "abstract") {
    const panel = card.querySelector(".abstract-panel");
    const open = panel.classList.toggle("open");
    event.target.setAttribute("aria-expanded", String(open));
    const hasEditorialNote = paper ? hasFullTextNote(paper) : false;
    event.target.textContent = open
      ? (hasEditorialNote ? "收起笔记 ▲" : "收起摘要 ▲")
      : (hasEditorialNote ? "展开笔记 ▼" : "查看摘要 ▼");
  }
}

init();
