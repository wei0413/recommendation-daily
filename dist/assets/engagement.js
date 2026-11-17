const SITE_COUNTER_API = "https://countapi.mileshilliard.com/api/v1";
const SITE_VIEW_COUNTER = "recommendation_daily_views_wei0413_20261118";
const SITE_LIKE_COUNTER = "recommendation_daily_likes_wei0413_20261118";
const SITE_LIKED_DATE_KEY = "recsys-daily-liked-on";
const SITE_PENDING_LIKES_KEY = "recsys-daily-pending-likes";
const SITE_COUNTER_CACHE_KEY = "recsys-daily-counter-cache-v2";

function siteBeijingDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function siteCounterCache() {
  try { return JSON.parse(localStorage.getItem(SITE_COUNTER_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function saveSiteCounterCache(cache) {
  localStorage.setItem(SITE_COUNTER_CACHE_KEY, JSON.stringify(cache));
}

function formatSiteCounter(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value) || 0));
}

async function requestSiteCounter(key, increment = false) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const action = increment ? "hit" : "get";
    const response = await fetch(`${SITE_COUNTER_API}/${action}/${encodeURIComponent(key)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!increment && response.status === 404) return 0;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const value = Number(payload.value);
    if (!Number.isFinite(value)) throw new Error("Invalid counter response");
    return value;
  } finally {
    window.clearTimeout(timeout);
  }
}

function setSiteLikedState(liked, hint = "") {
  const button = document.querySelector("#siteLikeButton");
  const label = document.querySelector("#siteLikeHint");
  if (!button || !label) return;
  button.setAttribute("aria-pressed", String(liked));
  button.disabled = liked;
  label.textContent = hint || (liked ? "今日已赞" : "点赞");
  button.title = liked ? "今天已经点过赞，明天可以再来" : "每天可以为网站点赞一次";
}

function pendingSiteLikes() {
  try { return [...new Set(JSON.parse(localStorage.getItem(SITE_PENDING_LIKES_KEY) || "[]"))]; }
  catch { return []; }
}

async function syncPendingSiteLikes() {
  const pending = pendingSiteLikes();
  if (!pending.length) return null;
  let latest = null;
  const remaining = [];
  for (const date of pending) {
    try { latest = await requestSiteCounter(SITE_LIKE_COUNTER, true); }
    catch { remaining.push(date); }
  }
  localStorage.setItem(SITE_PENDING_LIKES_KEY, JSON.stringify(remaining));
  return latest;
}

async function initSiteEngagement() {
  const viewNode = document.querySelector("#pageViewCount");
  const likeNode = document.querySelector("#siteLikeCount");
  const likeButton = document.querySelector("#siteLikeButton");
  if (!viewNode || !likeNode || !likeButton) return;

  const cache = siteCounterCache();
  viewNode.textContent = cache.views == null ? "统计中" : formatSiteCounter(cache.views);
  likeNode.textContent = cache.likes == null ? "0" : formatSiteCounter(cache.likes);
  const today = siteBeijingDateKey();
  const likedToday = localStorage.getItem(SITE_LIKED_DATE_KEY) === today || pendingSiteLikes().includes(today);
  setSiteLikedState(likedToday, likedToday && pendingSiteLikes().includes(today) ? "已记录，待同步" : "");

  requestSiteCounter(SITE_VIEW_COUNTER, true)
    .then(value => {
      cache.views = value;
      saveSiteCounterCache(cache);
      viewNode.textContent = formatSiteCounter(value);
    })
    .catch(() => {
      viewNode.textContent = cache.views == null ? "暂不可用" : formatSiteCounter(cache.views);
      viewNode.title = "计数服务暂时不可用，显示最近一次成功结果";
    });

  const synced = await syncPendingSiteLikes().catch(() => null);
  requestSiteCounter(SITE_LIKE_COUNTER)
    .then(value => {
      cache.likes = Math.max(value, synced || 0);
      saveSiteCounterCache(cache);
      likeNode.textContent = formatSiteCounter(cache.likes);
      if (localStorage.getItem(SITE_LIKED_DATE_KEY) === today) setSiteLikedState(true);
    })
    .catch(() => {
      likeNode.textContent = formatSiteCounter(cache.likes || 0);
      likeNode.title = "计数服务暂时不可用，显示本机缓存结果";
    });

  likeButton.addEventListener("click", async () => {
    if (localStorage.getItem(SITE_LIKED_DATE_KEY) === siteBeijingDateKey()) {
      setSiteLikedState(true);
      return;
    }
    setSiteLikedState(false, "提交中…");
    likeButton.disabled = true;
    try {
      const value = await requestSiteCounter(SITE_LIKE_COUNTER, true);
      cache.likes = Math.max(value, Number(cache.likes || 0) + 1);
      saveSiteCounterCache(cache);
      likeNode.textContent = formatSiteCounter(cache.likes);
      localStorage.setItem(SITE_LIKED_DATE_KEY, today);
      setSiteLikedState(true);
    } catch {
      const pending = [...new Set([...pendingSiteLikes(), today])];
      localStorage.setItem(SITE_PENDING_LIKES_KEY, JSON.stringify(pending));
      localStorage.setItem(SITE_LIKED_DATE_KEY, today);
      cache.likes = Number(cache.likes || 0) + 1;
      saveSiteCounterCache(cache);
      likeNode.textContent = formatSiteCounter(cache.likes);
      setSiteLikedState(true, "已记录，待同步");
    }
  });
}

initSiteEngagement();
