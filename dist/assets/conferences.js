const conferenceState = {
  payload: null,
  papers: [],
  year: "",
  rank: "",
  conference: "",
  topic: "",
  search: "",
  yearCache: new Map(),
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
  return `<article class="conference-paper">
    <div class="paper-venue-mark"><b>${conferenceEscape(paper.conference)}</b><small>${conferenceEscape(rank)}</small></div>
    <div class="conference-paper-body">
      <h4><a href="${conferenceEscape(paper.url)}" target="_blank" rel="noopener">${conferenceEscape(paper.title)}</a></h4>
      <p class="conference-authors">${conferenceEscape((paper.authors || []).join(", ") || "作者信息暂缺")}</p>
      <div class="conference-paper-meta"><span>${conferenceEscape(paper.topic)}</span><span>${paper.year}</span>${paper.doi ? `<a href="https://doi.org/${conferenceEscape(paper.doi)}" target="_blank" rel="noopener">DOI ${conferenceEscape(paper.doi)} ↗</a>` : ""}</div>
    </div>
  </article>`;
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
  const date = conferenceState.payload.generated_at ? new Date(conferenceState.payload.generated_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知";
  cq("#conferenceGenerated").textContent = `数据更新：${date} · ${conferenceState.payload.source}`;
  cq("#conferenceResults").setAttribute("aria-busy", "false");
}

initConferencePage();
