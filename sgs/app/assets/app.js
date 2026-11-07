/* 三国杀·台词研习册
 * 纯静态前端：hash 路由 + fetch JSON + localStorage。
 * 数据由 tools/build_db.mjs 生成；素材由 app/server.mjs 本地优先、远程兜底。
 */
const CFG = window.SGS_CONFIG || {};
const appEl = document.getElementById("app");
const audioEl = document.getElementById("player");
const toastEl = document.getElementById("toast");

const STORE_KEY = "sgs-study:v1";
const PAGE_SIZE = 60;
const LINE_PAGE_SIZE = 100;

const FACTION_ORDER = ["wei", "shu", "wu", "qun", "shen", "jin", "key"];
const FACTION_CLASS = { wei: "wei", shu: "shu", wu: "wu", qun: "qun", shen: "shen", jin: "jin", key: "qun" };

const state = {
  index: null,
  search: null,
  searchMap: new Map(),
  heroMap: new Map(),
  heroCache: new Map(),
  linesData: null,
  store: null,
  view: { name: "today", id: null },
  filters: { q: "", faction: "", pack: "", status: "" },
  browseLimit: PAGE_SIZE,
  browseListLength: 0,
  browseScrollY: 0,
  restoreBrowseScroll: false,
  lineFilters: { q: "", faction: "", pack: "" },
  lineLimit: LINE_PAGE_SIZE,
  lineListLength: 0,
  skinByHero: {},
  renderToken: 0,
  lastAudioBtn: null,
};

/* ---------------- 基础工具 ---------------- */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function debounce(fn, wait = 250) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayNumber(key = dateKey()) {
  const [y, m, d] = key.split("-").map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(2000, 0, 1);
  return Math.floor((a - b) / 86400000);
}

function fmt(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

function loadingHtml(text = "正在展开竹简……") {
  return `<section class="skeleton-page" aria-busy="true" aria-label="${escAttr(text)}">
    <div class="skeleton-hero">
      <div class="skeleton-art"></div>
      <div>
        <div class="skeleton-pill"></div>
        <div class="skeleton-title"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>
    <p class="small muted" style="text-align:center;margin-top:16px">${esc(text)}</p>
  </section>`;
}

let bootTimer = null;
function setBoot(status, detail) {
  const s = document.getElementById("boot-status");
  const d = document.getElementById("boot-detail");
  if (s && status) s.textContent = status;
  if (d && detail) d.textContent = detail;
}
function hideBoot() {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.classList.add("hide");
    setTimeout(() => {
      if (typeof boot.remove === "function") boot.remove();
    }, 350);
  }
  clearTimeout(bootTimer);
}
function bootFail(message) {
  const boot = document.getElementById("boot");
  setBoot("加载失败", message || "请检查数据文件是否完整");
  if (boot) boot.classList.add("boot-error");
  clearTimeout(bootTimer);
}

// 图片加载失败时：先尝试远程兜底，再显示占位。
function sgsImgError(img) {
  const remote = img.dataset.remote;
  if (remote && img.dataset.remoteTried !== "1") {
    img.dataset.remoteTried = "1";
    img.src = remote;
    return;
  }
  const box = img.parentElement;
  if (box) box.classList.add("img-error");
  img.style.display = "none";
  const ph = img.nextElementSibling;
  if (ph && ph.classList.contains("hero-art-placeholder")) ph.style.display = "grid";
  const cardPh = img.nextElementSibling;
  if (cardPh && cardPh.classList.contains("ph")) cardPh.style.display = "grid";
}
// app.js 在服务器版里是 ES module，内联 onerror 只能访问 window 上的函数。
window.sgsImgError = sgsImgError;

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

/* ---------------- 本地存储 ---------------- */

function defaultStore() {
  return {
    version: 1,
    studied: {},
    notes: {},
    daily: {},
    favorites: { heroes: [], lines: [] },
    settings: { volume: 0.9 },
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    const base = defaultStore();
    return {
      ...base,
      ...parsed,
      studied: parsed.studied && typeof parsed.studied === "object" ? parsed.studied : {},
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
      favorites: {
        heroes: Array.isArray(parsed.favorites?.heroes) ? parsed.favorites.heroes : [],
        lines: Array.isArray(parsed.favorites?.lines) ? parsed.favorites.lines : [],
      },
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return defaultStore();
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.store));
    return true;
  } catch {
    toast("本地存储失败：可能空间不足或浏览器禁用了 localStorage");
    return false;
  }
}

function todayState() {
  const key = dateKey();
  if (!state.store.daily[key]) {
    state.store.daily[key] = { hero: null, salt: 0, studied: false };
  }
  return state.store.daily[key];
}

function hasStudyOn(key) {
  return Object.values(state.store.studied).some((s) => s && s.last === key);
}

function computeStreak() {
  let cursor = new Date();
  if (!hasStudyOn(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    if (!hasStudyOn(dateKey(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function studiedCount() {
  return Object.keys(state.store.studied).length;
}

function markStudied(heroId, setDaily = false) {
  const key = dateKey();
  const prev = state.store.studied[heroId] || { first: key, last: key, count: 0 };
  state.store.studied[heroId] = {
    first: prev.first || key,
    last: key,
    count: (prev.count || 0) + 1,
  };
  if (setDaily) {
    const daily = todayState();
    daily.hero = heroId;
    daily.studied = true;
  }
  saveStore();
  toast(setDaily ? "已记下今日研习" : "已标记为研习过");
}

function getNote(heroId) {
  return state.store.notes[heroId] || "";
}

function setNote(heroId, text) {
  if (text.trim()) state.store.notes[heroId] = text;
  else delete state.store.notes[heroId];
  saveStore();
}

const saveNoteDebounced = debounce((heroId, text) => setNote(heroId, text), 350);

/* ---------------- 路由 ---------------- */

function route() {
  const raw = location.hash.replace(/^#/, "") || "/today";
  const [pathPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const name = parts[0] || "today";
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;

  state.view = { name, id };
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
  window.scrollTo({ top: 0, behavior: "auto" });

  if (name === "today") renderToday();
  else if (name === "browse") renderBrowse();
  else if (name === "hero" && id) renderHero(id);
  else if (name === "lines") renderLines();
  else if (name === "stats") renderStats();
  else if (name === "about") renderAbout();
  else renderNotFound();
}

function refreshCurrent() {
  if (state.view.name === "today") renderToday();
  else if (state.view.name === "hero" && state.view.id) renderHero(state.view.id, true);
  else if (state.view.name === "stats") renderStats();
}

/* ---------------- 数据 ---------------- */

async function fetchHero(id) {
  if (state.heroCache.has(id)) return state.heroCache.get(id);
  const data = await fetchJson(`data/heroes/${encodeURIComponent(id)}.json`);
  state.heroCache.set(id, data);
  return data;
}

async function fetchLines() {
  if (state.linesData) return state.linesData;
  const data = await fetchJson("data/lines.json");
  state.linesData = data.lines || [];
  return state.linesData;
}

function remoteMediaUrl(path) {
  if (!path || /^https?:\/\//i.test(path) || path.startsWith("bwiki/") || path.startsWith("thumbs/")) {
    return "";
  }
  const template = CFG.remoteTemplate || "";
  const commit = CFG.remoteCommit || state.index?.commit || "main";
  return template.replace("{commit}", commit) + path;
}

function mediaUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("bwiki/") || path.startsWith("thumbs/")) {
    return `${CFG.mediaBase || "/media/"}${path}`;
  }
  if (CFG.mediaMode === "local-first") {
    return `${CFG.mediaBase || "/media/"}${CFG.nonamePrefix || "noname/"}${path}`;
  }
  if (CFG.mediaMode === "remote") {
    return remoteMediaUrl(path);
  }
  return `${CFG.mediaBase || "/media/"}${CFG.nonamePrefix || "noname/"}${path}`;
}

function heroImage(hero, skin) {
  if (skin) {
    // APK 轻量版不带 1.5GB 全量皮肤图；详情直接用已内置的皮肤缩略图。
    if (CFG.mediaMode === "remote" && skin.thumb) return mediaUrl(skin.thumb);
    if (skin.image && !skin.imageMissing) return mediaUrl(skin.image);
    if (skin.thumb) return mediaUrl(skin.thumb);
    return "";
  }
  if (hero.image && !hero.imageMissing) return mediaUrl(hero.image);
  return "";
}

function artHtml(hero, skin, cls = "hero-art") {
  const rawPath = skin
    ? skin.image && !skin.imageMissing
      ? skin.image
      : ""
    : hero.image && !hero.imageMissing
    ? hero.image
    : "";
  const src = mediaUrl(rawPath);
  const remote = remoteMediaUrl(rawPath);
  const name = skin?.name ? `${skin.name}·${hero.name}` : hero.name;
  const fallbackChar = skin ? (skin.imageMissing ? "缺" : skin.name.slice(0, 1)) : hero.name.slice(0, 1);
  if (src) {
    return `<img class="${cls}" src="${escAttr(src)}" data-remote="${escAttr(remote)}" alt="${escAttr(name)}"
      loading="lazy" decoding="async"
      onload="this.parentElement.classList.add('loaded')"
      onerror="sgsImgError(this)" />
      <div class="hero-art-placeholder" style="display:none">${esc(fallbackChar)}</div>`;
  }
  return `<div class="hero-art-placeholder">${esc(fallbackChar)}</div>`;
}

/* ---------------- 片段 ---------------- */

function factionBadge(hero) {
  const cls = FACTION_CLASS[hero.faction] || "qun";
  return `<span class="badge ${cls}">${esc(hero.factionName || hero.faction)}</span>`;
}

function heroBadges(hero) {
  return [
    factionBadge(hero),
    `<span class="badge">${esc(hero.packName || hero.pack)}</span>`,
    hero.hp != null ? `<span class="badge">${hero.hp} 体力</span>` : "",
    hero.sex ? `<span class="badge">${hero.sex === "male" ? "男" : hero.sex === "female" ? "女" : esc(hero.sex)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function audioButton(line, extraClass = "") {
  if (!line.audio) {
    return `<button class="audio-btn ${extraClass}" disabled title="暂无语音"><span class="audio-icon">♪</span></button>`;
  }
  if (line.audioMissing) {
    return `<button class="audio-btn ${extraClass}" disabled title="音频文件缺失"><span class="audio-icon">♪</span></button>`;
  }
  const remote = remoteMediaUrl(line.audio);
  return `<button class="audio-btn ${extraClass}" data-audio="${escAttr(line.audio)}"
    data-remote-audio="${escAttr(remote)}" title="播放这句" aria-label="播放语音"><span class="audio-icon">♪</span></button>`;
}

function lineList(lines) {
  if (!lines || !lines.length) {
    return `<p class="small muted" style="margin:6px 0 0">暂无台词</p>`;
  }
  return `<ul class="line-list">${lines
    .map(
      (line) => `<li class="line-row"><span class="line-text">${esc(line.text)}</span>${audioButton(line)}</li>`
    )
    .join("")}</ul>`;
}

function skillBlock(skill) {
  return `<section class="skill-block">
    <div class="skill-head"><span class="skill-name">${esc(skill.name || skill.id)}</span></div>
    ${skill.description ? `<p class="skill-desc">${esc(skill.description)}</p>` : ""}
    ${lineList(skill.lines)}
  </section>`;
}

function dieBlock(hero) {
  const lines = hero.die?.lines || [];
  if (!lines.length) return `<p class="small muted">暂无阵亡台词</p>`;
  return `<ul class="line-list">${lines
    .map(
      (line) =>
        `<li class="line-row"><span class="line-text"><span class="die">${esc(line.text)}</span></span>${audioButton(line)}</li>`
    )
    .join("")}</ul>`;
}

function extraBlock(hero) {
  const lines = hero.extraLines || [];
  if (!lines.length) return "";
  return `<div class="detail-section"><h3>其他相关台词</h3>${lineList(lines)}</div>`;
}

function noteCard(heroId, idPrefix = "note") {
  return `<div class="side-card card">
    <h3>研习笔记</h3>
    <p class="small muted" style="margin:0 0 6px">只保存在本机浏览器，可导出备份。</p>
    <textarea class="textarea note-area" id="${idPrefix}-${escAttr(heroId)}" data-note-id="${escAttr(heroId)}"
      placeholder="记下容易混淆的台词、典故、配音细节……">${esc(getNote(heroId))}</textarea>
  </div>`;
}

/* ---------------- 今日 ---------------- */

function pickDailyHero(salt) {
  const pool = state.index.heroes;
  let idx = ((dayNumber() + salt) % pool.length + pool.length) % pool.length;
  let guard = 0;
  while (state.store.studied[pool[idx].id] && guard < pool.length) {
    idx = (idx + 1) % pool.length;
    guard++;
  }
  return pool[idx];
}

function reviewList() {
  const today = dateKey();
  return Object.entries(state.store.studied)
    .filter(([id, s]) => s && s.last && s.last < today && state.heroMap.has(id))
    .sort((a, b) => (a[1].count || 0) - (b[1].count || 0) || String(a[1].last).localeCompare(String(b[1].last)))
    .slice(0, 5)
    .map(([id]) => state.heroMap.get(id));
}

async function renderToday() {
  const token = ++state.renderToken;
  appEl.innerHTML = loadingHtml();
  const daily = todayState();
  let meta = daily.hero ? state.heroMap.get(daily.hero) : null;
  if (meta && !state.heroMap.has(meta.id)) meta = null;
  if (!meta) {
    meta = pickDailyHero(daily.salt || 0);
    daily.hero = meta.id;
    saveStore();
  }
  const hero = await fetchHero(meta.id);
  if (token !== state.renderToken) return;

  const studied = !!state.store.studied[hero.id];
  const total = state.index.counts.heroes;
  const learned = studiedCount();
  const pct = total ? Math.min(100, (learned / total) * 100) : 0;
  const streak = computeStreak();
  const reviews = reviewList();

  appEl.innerHTML = `<div class="page-head">
      <div><h1>今日一将</h1><p>${esc(dateKey())} · 第 ${dayNumber() + 1} 天 · 按日期固定推荐</p></div>
      <div class="chip-row">
        <span class="chip">已研习 ${fmt(learned)} / ${fmt(total)}</span>
        <span class="chip">连续 ${streak} 天</span>
      </div>
    </div>
    <div class="today-wrap">
      <article class="card today-hero">
        <div class="hero-art-wrap">${artHtml(hero)}<div class="hero-art-fade"></div></div>
        <div class="hero-info">
          <div class="hero-kicker"><span>今日一将</span><span>·</span><span>${esc(hero.packName || hero.pack)}</span></div>
          <div class="hero-name-row">
            <h2 class="hero-name">${esc(hero.name)}</h2>
            ${hero.title ? `<span class="hero-title">${esc(hero.title)}</span>` : ""}
          </div>
          <div class="hero-meta">${heroBadges(hero)}</div>
          ${hero.intro ? `<p class="hero-intro">${esc(hero.intro)}</p>` : ""}
          <div class="detail-section"><h3>技能与台词</h3>${hero.skills.map(skillBlock).join("")}</div>
          <div class="detail-section"><h3>阵亡</h3>${dieBlock(hero)}</div>
          ${extraBlock(hero)}
          <div class="hero-actions">
            <button class="btn primary" data-action="mark" data-id="${escAttr(hero.id)}">${studied ? "今日已研习" : "标记为已研习"}</button>
            <button class="btn" data-action="change-daily">换一将</button>
            <a class="btn ghost" href="#/hero/${encodeURIComponent(hero.id)}">完整详情</a>
          </div>
        </div>
      </article>
      <aside class="today-side">
        <div class="side-card card">
          <h3>修习进度</h3>
          <div class="progress-line"><span>已研习武将</span><span>${fmt(learned)} / ${fmt(total)}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct.toFixed(2)}%"></div></div>
          <div class="progress-line"><span>连续研习</span><span>${streak} 天</span></div>
        </div>
        <div class="side-card card">
          <h3>今日复习</h3>
          ${
            reviews.length
              ? `<ul class="review-list">${reviews
                  .map(
                    (h) =>
                      `<li><a href="#/hero/${encodeURIComponent(h.id)}"><span>${esc(h.name)}</span><span class="small muted">${esc(h.packName || h.pack)}</span></a></li>`
                  )
                  .join("")}</ul>`
              : `<p class="small muted">还没有需要复习的武将。先标记今日一将，明天这里就会出现。</p>`
          }
        </div>
        ${noteCard(hero.id, "today-note")}
      </aside>
    </div>`;
}

/* ---------------- 浏览 ---------------- */

function factionOptions(selected) {
  const values = [...new Set(state.index.heroes.map((h) => h.faction))];
  values.sort((a, b) => {
    const ia = FACTION_ORDER.indexOf(a);
    const ib = FACTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return `<option value="">全部势力</option>${values
    .map((f) => {
      const label = state.index.heroes.find((h) => h.faction === f)?.factionName || f;
      return `<option value="${escAttr(f)}" ${selected === f ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("")}`;
}

function packOptions(selected) {
  return `<option value="">全部版本</option>${state.index.packs
    .map(
      (p) =>
        `<option value="${escAttr(p.pack)}" ${selected === p.pack ? "selected" : ""}>${esc(p.packName)}（${p.count}）</option>`
    )
    .join("")}`;
}

function heroCard(hero) {
  const thumbPath = hero.thumb || (hero.image && !hero.imageMissing ? hero.image : "");
  const src = mediaUrl(thumbPath);
  const remote = remoteMediaUrl(hero.image);
  return `<a class="hero-card" href="#/hero/${encodeURIComponent(hero.id)}">
    <div class="hero-card-art">
      ${
        src
          ? `<img src="${escAttr(src)}" data-remote="${escAttr(remote)}" alt="${escAttr(hero.name)}"
              loading="lazy" decoding="async"
              onload="this.parentElement.classList.add('loaded')"
              onerror="sgsImgError(this)" />
             <div class="ph" style="display:none">${esc(hero.name.slice(0, 1))}</div>`
          : `<div class="ph">${esc(hero.name.slice(0, 1))}</div>`
      }
    </div>
    <div class="hero-card-body">
      <div class="hero-card-name"><span>${esc(hero.name)}</span>${factionBadge(hero)}</div>
      <div class="hero-card-title">${esc(hero.title || hero.packName || "")}</div>
      <div class="hero-card-tags">
        <span class="badge">${esc(hero.packName || hero.pack)}</span>
        ${hero.lineCount ? `<span class="badge">${hero.lineCount} 句</span>` : ""}
        ${state.store.studied[hero.id] ? `<span class="badge">已研习</span>` : ""}
      </div>
    </div>
  </a>`;
}

function browseFiltered() {
  const q = state.filters.q.trim().toLowerCase();
  let arr = state.index.heroes;
  if (q) {
    arr = arr.filter((h) => (state.searchMap.get(h.id) || "").includes(q));
  }
  if (state.filters.faction) arr = arr.filter((h) => h.faction === state.filters.faction);
  if (state.filters.pack) arr = arr.filter((h) => h.pack === state.filters.pack);
  if (state.filters.status === "studied") arr = arr.filter((h) => state.store.studied[h.id]);
  if (state.filters.status === "unstudied") arr = arr.filter((h) => !state.store.studied[h.id]);
  if (state.filters.status === "audio") arr = arr.filter((h) => h.lineCount > 0);
  if (state.filters.status === "skins") arr = arr.filter((h) => h.hasSkins);
  return arr;
}

function updateBrowseResults() {
  const list = browseFiltered();
  const shown = list.slice(0, state.browseLimit);
  const grid = document.getElementById("hero-grid");
  if (grid) grid.innerHTML = shown.map(heroCard).join("");
  const count = document.getElementById("browse-count");
  if (count) count.textContent = `命中 ${fmt(list.length)} 名武将，显示 ${fmt(shown.length)} 名`;
  const more = document.getElementById("browse-more");
  state.browseListLength = list.length;
  if (more) {
    const expanded = shown.length >= list.length;
    more.innerHTML =
      list.length === 0
        ? ""
        : expanded
        ? `<span class="small muted">已全部展开（${fmt(list.length)} 名）</span>
           ${list.length > PAGE_SIZE ? `<button class="btn sm" data-action="collapse-browse">收起</button>` : ""}`
        : `<button class="btn" data-action="more-browse">加载更多（还剩 ${fmt(list.length - shown.length)}）</button>
           <button class="btn primary" data-action="expand-browse">全部展开（共 ${fmt(list.length)} 名）</button>`;
  }
  const empty = document.getElementById("browse-empty");
  if (empty) {
    empty.innerHTML = list.length
      ? ""
      : `<div class="empty"><strong>没有匹配的武将</strong>试试清空搜索或换一个势力/版本。</div>`;
  }
  setupBrowseObserver();
}

let browseObserver = null;
function setupBrowseObserver() {
  if (browseObserver) {
    browseObserver.disconnect();
    browseObserver = null;
  }
  if (typeof IntersectionObserver !== "function") return;
  if (state.browseLimit >= state.browseListLength) return;
  const sentinel = document.getElementById("browse-more");
  if (!sentinel) return;
  browseObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (state.browseLimit >= state.browseListLength) return;
      state.browseLimit = Math.min(state.browseListLength, state.browseLimit + PAGE_SIZE);
      updateBrowseResults();
    },
    { rootMargin: "700px 0px" }
  );
  browseObserver.observe(sentinel);
}

function renderBrowse() {
  state.renderToken++;
  appEl.innerHTML = `<div class="page-head">
      <div><h1>武将</h1><p>全量 ${fmt(state.index.counts.heroes)} 名 · 按版本包与势力筛选</p></div>
      <span class="chip">已研习 ${fmt(studiedCount())}</span>
    </div>
    <div class="filters">
      <div class="search-wrap"><span class="search-icon">⌕</span>
        <input class="input" id="search-input" type="search" placeholder="搜武将名、称号、技能、台词……" value="${escAttr(state.filters.q)}" autocomplete="off" />
      </div>
      <select class="select" id="faction-filter" aria-label="势力">${factionOptions(state.filters.faction)}</select>
      <select class="select" id="pack-filter" aria-label="版本">${packOptions(state.filters.pack)}</select>
      <select class="select" id="status-filter" aria-label="状态">
        <option value="">全部状态</option>
        <option value="studied" ${state.filters.status === "studied" ? "selected" : ""}>只看已研习</option>
        <option value="unstudied" ${state.filters.status === "unstudied" ? "selected" : ""}>只看未研习</option>
        <option value="audio" ${state.filters.status === "audio" ? "selected" : ""}>只看有台词</option>
        <option value="skins" ${state.filters.status === "skins" ? "selected" : ""}>只看有皮肤</option>
      </select>
    </div>
    <div class="result-meta"><span id="browse-count"></span><span>点击卡片进入详情</span></div>
    <div class="hero-grid" id="hero-grid"></div>
    <div id="browse-empty"></div>
    <div class="load-more" id="browse-more"></div>`;
  updateBrowseResults();
  const restore = state.restoreBrowseScroll;
  const y = state.browseScrollY || 0;
  state.restoreBrowseScroll = false;
  const applyScroll = () => {
    try {
      window.scrollTo({ top: restore ? y : 0, behavior: "auto" });
    } catch {
      // 老 WebView 不支持 options，退化为两个参数。
      window.scrollTo(0, restore ? y : 0);
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(applyScroll);
  else setTimeout(applyScroll, 0);
}

/* ---------------- 详情 ---------------- */

function skinStrip(hero) {
  if (!hero.skins || !hero.skins.length) return "";
  const current = state.skinByHero[hero.id] ?? -1;
  const originalSrc = hero.thumb ? mediaUrl(hero.thumb) : hero.image && !hero.imageMissing ? mediaUrl(hero.image) : "";
  const thumbImg = (src, alt) =>
    src
      ? `<img src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy" decoding="async"
          onload="this.parentElement.classList.add('loaded')"
          onerror="sgsImgError(this)" />`
      : "";
  return `<div class="skin-strip" aria-label="皮肤切换">
    <button class="skin-thumb ${current === -1 ? "active" : ""}" data-action="select-skin" data-hero="${escAttr(hero.id)}" data-skin="-1">
      ${thumbImg(originalSrc, "原画") || `<span style="display:grid;place-items:center;aspect-ratio:3/4">原</span>`}
      <span>原画</span>
    </button>
    ${hero.skins
      .map((skin, i) => {
        const src = skin.thumb ? mediaUrl(skin.thumb) : skin.image && !skin.imageMissing ? mediaUrl(skin.image) : "";
        return `<button class="skin-thumb ${current === i ? "active" : ""}" data-action="select-skin" data-hero="${escAttr(hero.id)}" data-skin="${i}" title="${escAttr(skin.name)}">
          ${thumbImg(src, skin.name) || `<span style="display:grid;place-items:center;aspect-ratio:3/4">${skin.imageMissing ? "缺" : "皮"}</span>`}
          <span>${esc(skin.name)}</span>
        </button>`;
      })
      .join("")}
  </div>`;
}

function skinInfoHtml(skin) {
  if (!skin) return "";
  const lineHtml = (line) =>
    `<li class="line-row"><span class="line-text">${esc(line.text)}</span>${audioButton(line)}</li>`;
  const dieHtml = (line) =>
    `<li class="line-row"><span class="line-text"><span class="die">${esc(line.text)}</span></span>${audioButton(line)}</li>`;

  const groups = new Map();
  for (const line of skin.lines || []) {
    const label = line.label || "皮肤台词";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(line);
  }
  const blocks = [...groups.entries()].map(
    ([label, lines]) =>
      `<div class="small muted" style="margin:8px 0 2px">${esc(label)}</div><ul class="line-list">${lines.map(lineHtml).join("")}</ul>`
  );
  if ((skin.die || []).length) {
    blocks.push(
      `<div class="small muted" style="margin:8px 0 2px">阵亡</div><ul class="line-list">${skin.die.map(dieHtml).join("")}</ul>`
    );
  }
  return `<div class="skin-info">
    <h4>${esc(skin.name)}</h4>
    ${skin.imageMissing ? `<p class="small muted" style="margin:0 0 6px">该皮肤暂无立绘，以下为文字资料。</p>` : ""}
    <div class="kv">
      <div class="item"><div class="k">品质</div><div class="v">${esc(skin.quality || "未收录")}</div></div>
      <div class="item"><div class="k">画师</div><div class="v">${esc(skin.artist || "未收录")}</div></div>
      <div class="item"><div class="k">收藏册</div><div class="v">${esc(skin.pack || "未收录")}</div></div>
      <div class="item"><div class="k">语音</div><div class="v">${skin.audioCount ? `${skin.audioCount} 条` : "暂无"}</div></div>
    </div>
    ${skin.story ? `<p class="skin-story">${esc(skin.story)}</p>` : ""}
    ${blocks.join("") || `<p class="small muted">该皮肤暂无专属台词。可展开下方“经典形象技能与台词”查看原台词。</p>`}
  </div>`;
}

function classicSections(hero) {
  return `<div class="detail-section"><h3>技能与台词</h3>${hero.skills.map(skillBlock).join("")}</div>
    <div class="detail-section"><h3>阵亡</h3>${dieBlock(hero)}</div>
    ${extraBlock(hero)}`;
}

async function renderHero(id, keepScroll = false) {
  const token = ++state.renderToken;
  const scrollY = window.scrollY;
  if (!keepScroll) appEl.innerHTML = loadingHtml("正在取武将牌……");
  let hero;
  try {
    hero = await fetchHero(id);
  } catch (err) {
    if (token === state.renderToken) renderNotFound(err.message);
    return;
  }
  if (token !== state.renderToken) return;

  // 皮肤状态优先取 URL 的 ?skin=，其次取内存里的选择。
  const query = new URLSearchParams((location.hash.split("?")[1] || ""));
  const qSkin = Number(query.get("skin"));
  if (query.has("skin") && Number.isInteger(qSkin) && qSkin >= 0 && hero.skins?.[qSkin]) {
    state.skinByHero[id] = qSkin;
  }
  // 不在这里因为“URL 没有 ?skin=”就把选择重置为原画：
  // Android WebView 的 file:// 可能禁止 replaceState，URL 不会带上参数，
  // 但 state.skinByHero 已经由 select-skin 设置，必须保留，否则会退回原皮语音/原画。

  const index = state.index.heroes.findIndex((h) => h.id === id);
  const prev = index > 0 ? state.index.heroes[index - 1] : null;
  const next = index >= 0 && index < state.index.heroes.length - 1 ? state.index.heroes[index + 1] : null;
  const currentSkinIdx = state.skinByHero[id] ?? -1;
  const skin = currentSkinIdx >= 0 ? hero.skins?.[currentSkinIdx] : null;
  const studied = !!state.store.studied[hero.id];
  const displayName = skin ? `${hero.name} · ${skin.name}` : hero.name;

  appEl.innerHTML = `<div class="page-head">
      <div><h1>${esc(displayName)}</h1><p>${esc(hero.title || "")} · ${esc(hero.packName || hero.pack)}${skin ? ` · ${esc(skin.name)}` : ""}</p></div>
      <div class="chip-row">
        <a class="btn sm" href="#/browse">返回列表</a>
        <button class="btn sm ${studied ? "primary" : ""}" data-action="mark" data-id="${escAttr(hero.id)}">${studied ? "已研习" : "标记研习"}</button>
      </div>
    </div>
    <div class="detail-layout">
      <aside class="detail-side">
        <div class="detail-art">${artHtml(hero, skin, "hero-art")}</div>
        ${skinStrip(hero)}
        <div class="hero-actions">
          ${prev ? `<a class="btn sm" href="#/hero/${encodeURIComponent(prev.id)}">← ${esc(prev.name)}</a>` : ""}
          ${next ? `<a class="btn sm" href="#/hero/${encodeURIComponent(next.id)}">${esc(next.name)} →</a>` : ""}
        </div>
      </aside>
      <article class="card detail-main">
        <div class="detail-head">
          <div>
            <h2 class="detail-name">${esc(displayName)}</h2>
            ${hero.title ? `<p class="detail-title">${esc(hero.title)}</p>` : ""}
            <div class="hero-meta">${heroBadges(hero)}</div>
          </div>
        </div>
        ${hero.intro ? `<p class="hero-intro" style="max-height:none">${esc(hero.intro)}</p>` : ""}
        ${skin ? skinInfoHtml(skin) : ""}
        ${
          skin
            ? `<details class="classic-block">
                 <summary>经典形象技能与台词（与当前皮肤无关）</summary>
                 ${classicSections(hero)}
               </details>`
            : classicSections(hero)
        }
        <div class="detail-section"><h3>研习笔记</h3>
          <textarea class="textarea note-area" id="hero-note-${escAttr(hero.id)}" data-note-id="${escAttr(hero.id)}"
            placeholder="记下容易混淆的台词、典故、配音细节……">${esc(getNote(hero.id))}</textarea>
        </div>
        <div class="source-line">数据来源：${esc(hero.source?.repo || "libnoname/noname")} @ ${esc((hero.source?.commit || "").slice(0, 7))} · ${esc(hero.source?.path || "")}</div>
      </article>
    </div>`;
  if (keepScroll) window.scrollTo({ top: scrollY, behavior: "auto" });
}

/* ---------------- 台词本 ---------------- */

function linesFiltered() {
  const q = state.lineFilters.q.trim().toLowerCase();
  let arr = state.linesData || [];
  if (q) {
    arr = arr.filter(
      (line) =>
        line.text.toLowerCase().includes(q) ||
        line.heroName.toLowerCase().includes(q) ||
        line.skill.toLowerCase().includes(q)
    );
  }
  if (state.lineFilters.faction) arr = arr.filter((line) => line.faction === state.lineFilters.faction);
  if (state.lineFilters.pack) arr = arr.filter((line) => line.pack === state.lineFilters.pack);
  return arr;
}

function updateLinesResults() {
  const list = linesFiltered();
  const shown = list.slice(0, state.lineLimit);
  const box = document.getElementById("lines-list");
  if (box) {
    box.innerHTML = shown
      .map(
        (line) => `<div class="line-item">
          <a class="who" href="#/hero/${encodeURIComponent(line.heroId)}">${esc(line.heroName)}</a>
          <span class="txt">${esc(line.text)}</span>
          <span class="what">${esc(line.skill)} · ${esc(line.packName)}</span>
          <span>${audioButton(line)}</span>
        </div>`
      )
      .join("");
  }
  const count = document.getElementById("lines-count");
  if (count) count.textContent = `命中 ${fmt(list.length)} 句，显示 ${fmt(shown.length)} 句`;
  state.lineListLength = list.length;
  const more = document.getElementById("lines-more");
  if (more) {
    const expanded = shown.length >= list.length;
    more.innerHTML =
      list.length === 0
        ? ""
        : expanded
        ? `<span class="small muted">已全部展开（${fmt(list.length)} 句）</span>
           ${list.length > LINE_PAGE_SIZE ? `<button class="btn sm" data-action="collapse-lines">收起</button>` : ""}`
        : `<button class="btn" data-action="more-lines">加载更多（还剩 ${fmt(list.length - shown.length)}）</button>
           <button class="btn primary" data-action="expand-lines">全部展开（共 ${fmt(list.length)} 句）</button>`;
  }
  setupLinesObserver();
}

let linesObserver = null;
function setupLinesObserver() {
  if (linesObserver) {
    linesObserver.disconnect();
    linesObserver = null;
  }
  if (typeof IntersectionObserver !== "function") return;
  if (state.lineLimit >= state.lineListLength) return;
  const sentinel = document.getElementById("lines-more");
  if (!sentinel) return;
  linesObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (state.lineLimit >= state.lineListLength) return;
      state.lineLimit = Math.min(state.lineListLength, state.lineLimit + LINE_PAGE_SIZE);
      updateLinesResults();
    },
    { rootMargin: "700px 0px" }
  );
  linesObserver.observe(sentinel);
}

async function renderLines() {
  const token = ++state.renderToken;
  if (!state.linesData) appEl.innerHTML = loadingHtml("正在整理台词……");
  try {
    await fetchLines();
  } catch (err) {
    if (token === state.renderToken) renderError("台词数据加载失败", err.message);
    return;
  }
  if (token !== state.renderToken) return;

  appEl.innerHTML = `<div class="page-head">
      <div><h1>台词本</h1><p>共 ${fmt(state.linesData.length)} 句 · 点右侧 ♪ 逐句播放</p></div>
      <span class="chip">来自无名杀 voices.js</span>
    </div>
    <div class="lines-toolbar">
      <div class="search-wrap"><span class="search-icon">⌕</span>
        <input class="input" id="lines-search" type="search" placeholder="搜台词、武将、技能……" value="${escAttr(state.lineFilters.q)}" autocomplete="off" />
      </div>
      <select class="select" id="lines-faction" aria-label="势力">${factionOptions(state.lineFilters.faction)}</select>
      <select class="select" id="lines-pack" aria-label="版本">${packOptions(state.lineFilters.pack)}</select>
    </div>
    <div class="result-meta"><span id="lines-count"></span><span>同名台词可能来自不同版本</span></div>
    <div class="line-table" id="lines-list"></div>
    <div class="load-more" id="lines-more"></div>`;
  updateLinesResults();
}

/* ---------------- 统计 ---------------- */

function renderStats() {
  state.renderToken++;
  const total = state.index.counts.heroes;
  const learned = studiedCount();
  const streak = computeStreak();
  const byFaction = new Map();
  for (const h of state.index.heroes) {
    if (!byFaction.has(h.faction)) byFaction.set(h.faction, { name: h.factionName || h.faction, total: 0, learned: 0 });
    const item = byFaction.get(h.faction);
    item.total++;
    if (state.store.studied[h.id]) item.learned++;
  }
  const factionRows = [...byFaction.entries()]
    .sort((a, b) => {
      const ia = FACTION_ORDER.indexOf(a[0]);
      const ib = FACTION_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([, v]) => {
      const pct = v.total ? (v.learned / v.total) * 100 : 0;
      return `<div class="pack-progress"><span>${esc(v.name)}</span><div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div><span class="small muted">${v.learned}/${v.total}</span></div>`;
    })
    .join("");
  const packRows = state.index.packs
    .map((p) => {
      const learnedInPack = state.index.heroes.filter((h) => h.pack === p.pack && state.store.studied[h.id]).length;
      const pct = p.count ? (learnedInPack / p.count) * 100 : 0;
      return `<div class="pack-progress"><span title="${escAttr(p.packName)}">${esc(p.packName)}</span><div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div><span class="small muted">${learnedInPack}/${p.count}</span></div>`;
    })
    .join("");

  appEl.innerHTML = `<div class="page-head">
      <div><h1>学习统计</h1><p>数据只保存在本机 localStorage；换浏览器/清缓存会丢，记得导出。</p></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card card"><div class="num">${fmt(learned)}</div><div class="label">已研习武将</div></div>
      <div class="stat-card card"><div class="num">${fmt(total)}</div><div class="label">全量武将</div></div>
      <div class="stat-card card"><div class="num">${streak}</div><div class="label">连续研习天数</div></div>
      <div class="stat-card card"><div class="num">${fmt(state.index.counts.lines)}</div><div class="label">台词总行数</div></div>
      <div class="stat-card card"><div class="num">${fmt(state.index.counts.withImage)}</div><div class="label">有原画</div></div>
      <div class="stat-card card"><div class="num">${fmt(state.index.counts.withAudio)}</div><div class="label">有语音</div></div>
    </div>
    <div class="card" style="padding:18px;margin-bottom:16px">
      <h3 style="margin:0 0 10px;font-family:var(--serif);color:var(--gold-2)">按势力</h3>
      ${factionRows}
    </div>
    <div class="card" style="padding:18px;margin-bottom:16px">
      <h3 style="margin:0 0 10px;font-family:var(--serif);color:var(--gold-2)">按版本包</h3>
      ${packRows}
    </div>
    <div class="card" style="padding:18px">
      <h3 style="margin:0 0 10px;font-family:var(--serif);color:var(--gold-2)">备份</h3>
      <div class="chip-row">
        <button class="btn" data-action="export">导出学习记录 JSON</button>
        <button class="btn" data-action="import">导入 JSON</button>
        <button class="btn danger" data-action="reset">清空学习记录</button>
      </div>
      <input id="import-file" type="file" accept="application/json,.json" style="display:none" />
      <p class="small muted" style="margin:12px 0 0">导出内容：已研习武将、日期、次数、笔记、每日推荐。不含素材。</p>
    </div>`;
}

/* ---------------- 关于 ---------------- */

function renderAbout() {
  state.renderToken++;
  const c = state.index.counts;
  appEl.innerHTML = `<div class="page-head"><div><h1>关于</h1><p>数据从哪里来、怎么更新、有什么边界</p></div></div>
    <article class="card" style="padding:24px">
      <div class="prose">
        <p>这是一个本地优先的“每日一将”研习站。它把无名杀的武将/技能/台词/原画/语音，和 BWiki 的皮肤数据拼在一起，按日期固定推荐一名武将，供逐日查看与学习。</p>
        <h2>数据来源</h2>
        <ul>
          <li><a href="https://github.com/libnoname/noname" target="_blank" rel="noreferrer">无名杀 libnoname/noname</a>（GPL-3.0）：武将、技能、台词、原画、语音路径。当前导入 ${fmt(c.heroes)} 名武将、${fmt(c.lines)} 句台词、${fmt(c.withImage)} 张原画路径、${fmt(c.withAudio)} 名有语音的武将。</li>
          <li><a href="https://github.com/5244DragonLin/sgs_bwiki_skins" target="_blank" rel="noreferrer">sgs_bwiki_skins</a> / <a href="https://wiki.biligame.com/sgs" target="_blank" rel="noreferrer">BWiki 三国杀 WIKI</a>：皮肤图、画师、品质、皮肤故事、皮肤台词、官方语音直链。</li>
          <li><a href="https://gitee.com/qsgs-fans" target="_blank" rel="noreferrer">FreeKill / 太阳神三国杀 Gitee 分包</a>：手杀/OL/十周年精确台词与画师，作为后续补充。</li>
        </ul>
        <h2>更新数据</h2>
        <pre>node tools/fetch_noname.mjs
node tools/build_db.mjs
node tools/fetch_media.mjs --heroes=pilot
node app/server.mjs</pre>
        <p>全量素材下载：<code>node tools/fetch_media.mjs --all</code>。皮肤试点见 <code>docs/资源索引.md</code>。</p>
        <h2>素材与版权</h2>
        <p>武将原画、皮肤、语音、台词版权归杭州游卡及相关创作者所有。本项目默认只供个人本地学习；公开部署时请不要托管全量美术/音频，或只展示文本与元数据。</p>
        <h2>技术</h2>
        <p>纯静态 HTML/CSS/ES Module，无构建步骤；<code>app/server.mjs</code> 是零依赖 Node 服务器，负责静态文件、Range 音频、<code>/media/</code> 本地优先与 jsDelivr 兜底。学习记录存在 <code>localStorage</code> 的 <code>${STORE_KEY}</code>。</p>
        <p class="small muted">数据版本：${esc(state.index.commit || "unknown")} · 生成于 ${esc(state.index.generatedAt || "")}</p>
      </div>
    </article>`;
}

/* ---------------- 错误页 ---------------- */

function renderNotFound(detail = "") {
  appEl.innerHTML = `<div class="empty">
    <strong>没有找到这个页面</strong>
    ${detail ? `<p class="small muted">${esc(detail)}</p>` : ""}
    <p><a class="btn" href="#/today">回到今日</a> <a class="btn" href="#/browse">浏览武将</a></p>
  </div>`;
}

function renderError(title, detail) {
  appEl.innerHTML = `<div class="empty">
    <strong>${esc(title)}</strong>
    <p class="small muted">${esc(detail || "")}</p>
    <p class="small muted">请先运行 <code>更新数据.bat</code>，再双击 <code>启动研习册.bat</code> 打开。</p>
  </div>`;
}

function renderBootError(err) {
  bootFail(err?.message || String(err));
  appEl.innerHTML = `<div class="empty">
    <strong>数据还没准备好</strong>
    <p class="small muted">${esc(err?.message || String(err))}</p>
    <p class="small">如果是离线版，先运行 <code>node tools/build_standalone.mjs</code> 重新生成。</p>
    <p class="small">如果是服务器版，依次运行：</p>
    <pre class="prose" style="text-align:left;display:inline-block">node tools/fetch_noname.mjs
node tools/build_db.mjs
node app/server.mjs</pre>
  </div>`;
  setTimeout(hideBoot, 1200);
}

/* ---------------- 音频 ---------------- */

function setAudioLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle("loading", !!on);
}

function audioFail(message) {
  toast(message || "语音加载失败，可能是文件缺失或网络不可达");
  setAudioLoading(state.lastAudioBtn, false);
  document.querySelectorAll(".line-row.playing").forEach((el) => el.classList.remove("playing"));
  state.lastAudioBtn = null;
}

function tryRemoteAudio() {
  const btn = state.lastAudioBtn;
  const remote = btn?.dataset.remoteAudio;
  if (remote && audioEl.dataset.fallback !== "1") {
    audioEl.dataset.fallback = "1";
    audioEl.src = remote;
    setAudioLoading(btn, true);
    audioEl.play().catch(() => audioFail("语音加载失败：远程地址也不可达"));
    return true;
  }
  return false;
}

async function playAudio(path, btn) {
  if (!path) {
    toast("这句暂无语音");
    return;
  }
  clearPlaying();
  const url = mediaUrl(path);
  if (audioEl.dataset.current === path && !audioEl.paused) {
    audioEl.pause();
    return;
  }
  state.lastAudioBtn = btn || null;
  audioEl.dataset.current = path;
  audioEl.dataset.fallback = "0";
  audioEl.pause();
  audioEl.src = url;
  audioEl.volume = Number(state.store.settings.volume ?? 0.9);
  setAudioLoading(btn, true);
  if (btn) btn.closest(".line-row")?.classList.add("playing");
  try {
    await audioEl.play();
  } catch {
    if (!tryRemoteAudio()) audioFail();
  }
}

function clearPlaying() {
  document.querySelectorAll(".line-row.playing").forEach((el) => el.classList.remove("playing"));
  document.querySelectorAll(".audio-btn.loading").forEach((el) => el.classList.remove("loading"));
  state.lastAudioBtn = null;
}

audioEl.addEventListener("waiting", () => setAudioLoading(state.lastAudioBtn, true));
audioEl.addEventListener("canplay", () => setAudioLoading(state.lastAudioBtn, false));
audioEl.addEventListener("playing", () => {
  setAudioLoading(state.lastAudioBtn, false);
  state.lastAudioBtn?.closest(".line-row")?.classList.add("playing");
});
audioEl.addEventListener("ended", clearPlaying);
audioEl.addEventListener("error", () => {
  if (!audioEl.dataset.current) return;
  if (tryRemoteAudio()) return;
  audioFail();
});

/* ---------------- 事件 ---------------- */

appEl.addEventListener("click", (event) => {
  // 从浏览页点进武将时记住列表滚动位置；返回时恢复。
  const heroLink = event.target.closest("a.hero-card");
  if (heroLink && (heroLink.getAttribute("href") || "").startsWith("#/hero/")) {
    state.browseScrollY = window.scrollY || 0;
    state.restoreBrowseScroll = true;
  }
  const audioBtn = event.target.closest("[data-audio]");
  if (audioBtn) {
    playAudio(audioBtn.dataset.audio, audioBtn);
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "mark") {
    markStudied(actionEl.dataset.id, state.view.name === "today");
    refreshCurrent();
  } else if (action === "change-daily") {
    const daily = todayState();
    daily.salt = (daily.salt || 0) + 1;
    daily.hero = null;
    saveStore();
    renderToday();
  } else if (action === "select-skin") {
    const heroId = actionEl.dataset.hero;
    const skinIdx = Number(actionEl.dataset.skin);
    state.skinByHero[heroId] = skinIdx;
    const base = `#/hero/${encodeURIComponent(heroId)}`;
    const target = skinIdx >= 0 ? `${base}?skin=${skinIdx}` : base;
    try {
      history.replaceState(null, "", target);
    } catch {
      // file:// 下 WebView 可能禁止 replaceState；退化为改 hash，
      // 让 URL 仍然带着 ?skin=，刷新/返回也能恢复这套皮肤。
      try {
        location.hash = target;
        return;
      } catch {
        // 两种都失败时仍用内存里的选择重绘。
      }
    }
    renderHero(heroId, true);
  } else if (action === "more-browse") {
    state.browseLimit = Math.min(state.browseListLength || state.browseLimit + PAGE_SIZE, state.browseLimit + PAGE_SIZE);
    updateBrowseResults();
  } else if (action === "expand-browse") {
    state.browseLimit = state.browseListLength || 1e9;
    updateBrowseResults();
    toast(`已全部展开：${fmt(state.browseLimit)} 名武将`);
  } else if (action === "collapse-browse") {
    state.browseLimit = PAGE_SIZE;
    updateBrowseResults();
    window.scrollTo({ top: 0, behavior: "auto" });
  } else if (action === "more-lines") {
    state.lineLimit = Math.min(state.lineListLength || state.lineLimit + LINE_PAGE_SIZE, state.lineLimit + LINE_PAGE_SIZE);
    updateLinesResults();
  } else if (action === "expand-lines") {
    state.lineLimit = state.lineListLength || 1e9;
    updateLinesResults();
    toast(`已全部展开：${fmt(state.lineLimit)} 句台词`);
  } else if (action === "collapse-lines") {
    state.lineLimit = LINE_PAGE_SIZE;
    updateLinesResults();
    window.scrollTo({ top: 0, behavior: "auto" });
  } else if (action === "export") {
    exportStore();
  } else if (action === "import") {
    document.getElementById("import-file")?.click();
  } else if (action === "reset") {
    if (confirm("确定清空全部学习记录和笔记？此操作不可撤销。建议先导出备份。")) {
      localStorage.removeItem(STORE_KEY);
      state.store = defaultStore();
      renderStats();
      toast("已清空学习记录");
    }
  }
});

appEl.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-note-id]")) {
    saveNoteDebounced(target.dataset.noteId, target.value);
    return;
  }
  if (target.id === "search-input") {
    state.filters.q = target.value;
    state.browseLimit = PAGE_SIZE;
    state.restoreBrowseScroll = false;
    debounce(updateBrowseResults, 160)();
    return;
  }
  if (target.id === "lines-search") {
    state.lineFilters.q = target.value;
    state.lineLimit = LINE_PAGE_SIZE;
    debounce(updateLinesResults, 160)();
  }
});

appEl.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "faction-filter") {
    state.filters.faction = target.value;
    state.browseLimit = PAGE_SIZE;
    state.restoreBrowseScroll = false;
    updateBrowseResults();
  } else if (target.id === "pack-filter") {
    state.filters.pack = target.value;
    state.browseLimit = PAGE_SIZE;
    state.restoreBrowseScroll = false;
    updateBrowseResults();
  } else if (target.id === "status-filter") {
    state.filters.status = target.value;
    state.browseLimit = PAGE_SIZE;
    state.restoreBrowseScroll = false;
    updateBrowseResults();
  } else if (target.id === "lines-faction") {
    state.lineFilters.faction = target.value;
    state.lineLimit = LINE_PAGE_SIZE;
    updateLinesResults();
  } else if (target.id === "lines-pack") {
    state.lineFilters.pack = target.value;
    state.lineLimit = LINE_PAGE_SIZE;
    updateLinesResults();
  } else if (target.id === "import-file" && target.files?.[0]) {
    importStore(target.files[0]);
    target.value = "";
  }
});

/* ---------------- 导入导出 ---------------- */

function exportStore() {
  const blob = new Blob([JSON.stringify(state.store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `三国杀研习记录-${dateKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("已导出 JSON");
}

async function importStore(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || typeof parsed.studied !== "object") {
      throw new Error("不是有效的学习记录文件");
    }
    if (!confirm(`将用这份记录覆盖当前记录：已研习 ${Object.keys(parsed.studied || {}).length} 名，笔记 ${Object.keys(parsed.notes || {}).length} 条。继续？`)) {
      return;
    }
    const base = defaultStore();
    state.store = {
      ...base,
      ...parsed,
      studied: parsed.studied || {},
      notes: parsed.notes || {},
      daily: parsed.daily || {},
      favorites: {
        heroes: Array.isArray(parsed.favorites?.heroes) ? parsed.favorites.heroes : [],
        lines: Array.isArray(parsed.favorites?.lines) ? parsed.favorites.lines : [],
      },
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
    saveStore();
    renderStats();
    toast("导入成功");
  } catch (err) {
    toast(`导入失败：${err.message}`);
  }
}

/* ---------------- 启动 ---------------- */

async function init() {
  setBoot("正在加载武将数据……", "首次加载可能需要几秒，请稍候");
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    const boot = document.getElementById("boot");
    if (boot && !boot.classList.contains("hide")) {
      setBoot("加载较慢……", "如果长时间没有反应，请按 F12 查看控制台，或重新运行 build_standalone");
    }
  }, 20000);
  try {
    const [index, search] = await Promise.all([
      fetchJson("data/index.json"),
      fetchJson("data/search.json").catch(() => ({ entries: [] })),
    ]);
    state.index = index;
    state.search = search;
    state.searchMap = new Map((search.entries || []).map((e) => [e.id, e.text]));
    state.heroMap = new Map(index.heroes.map((h) => [h.id, h]));
    state.store = loadStore();
    const commitEl = document.getElementById("footer-commit");
    if (commitEl && index.commit) commitEl.textContent = `数据 ${index.commit.slice(0, 7)}`;
    window.addEventListener("hashchange", route);
    route();
    setTimeout(hideBoot, 120);
  } catch (err) {
    renderBootError(err);
  }
}

init();
