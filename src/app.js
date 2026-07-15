const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const REGION_LABELS = {
  ALL: "All",
  AM: "Americas",
  EU: "Europe",
  AS: "Asia",
  AF: "Africa",
  OC: "Oceania"
};

const PALETTE = ["#d6361b", "#c6953a", "#6b8e6a", "#2f5d62", "#a85c8a", "#e2a93d", "#88607b", "#3a6b8a", "#b25e2a", "#5d8a6f"];
const STOP = new Set(["about", "after", "also", "because", "between", "during", "from", "into", "over", "their", "there", "this", "that", "with", "were", "which", "while"]);
const BAD_ARTICLE = /^(Special:|Wikipedia:|Portal:|File:|Category:|Help:|Talk:|Template:|Main_Page$|-)/;
const SUPPRESSED_ARTICLE = /^\.?xxx$/i;
const FLOW_STORY_COUNT = 10;
const FLOW_LABEL_MIN = 12;

const state = {
  mode: "snapshot",
  reportDate: "",
  region: "ALL",
  selectedA2: null,
  selectedName: "Global",
  globalTop: [],
  currentList: [],
  countryCache: new Map(),
  summaryCache: new Map(),
  seriesCache: new Map(),
  countryNames: new Map(),
  topo: null,
  cardObserver: null,
  flowHydrating: false,
  flowHydratedThrough: "",
  mapReady: false,
  flowReady: false,
  heroView: "map"
};

const els = {};

function bindEls() {
  Object.assign(els, {
    modeLabel: $("#modeLabel"),
    dateLine: $("#dateLine"),
    statTotal: $("#statTotal"),
    statArticles: $("#statArticles"),
    mapMount: $("#mapMount"),
    flowMount: $("#flowMount"),
    mapTip: $("#mapTip"),
    flowTip: $("#flowTip"),
    mapTab: $("#mapTab"),
    flowTab: $("#flowTab"),
    heroCopy: $("#heroCopy"),
    flowCopy: $("#flowCopy"),
    controls: $("#controls"),
    regionPills: $("#regionPills"),
    viewName: $("#viewName"),
    resetView: $("#resetView"),
    contextLabel: $("#contextLabel"),
    gridStatus: $("#gridStatus"),
    articles: $("#articles"),
    storyJumpText: $("#storyJumpText"),
    panel: $("#panel"),
    closePanel: $("#closePanel"),
    panelContext: $("#panelContext"),
    panelImage: $("#panelImage"),
    panelLetter: $("#panelLetter"),
    panelKicker: $("#panelKicker"),
    panelTitle: $("#panelTitle"),
    panelDesc: $("#panelDesc"),
    panelWhy: $("#panelWhy"),
    panelViews: $("#panelViews"),
    panelRank: $("#panelRank"),
    panelTrend: $("#panelTrend"),
    spark: $("#spark"),
    sparkArea: $("#sparkArea"),
    sparkLine: $("#sparkLine"),
    sparkDot: $("#sparkDot"),
    storySectionsWrap: $("#storySectionsWrap"),
    storySections: $("#storySections"),
    relatedWrap: $("#relatedWrap"),
    related: $("#related"),
    panelExtract: $("#panelExtract"),
    panelLink: $("#panelLink"),
    toast: $("#toast")
  });
}

const shortNumber = (n) => {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const pad = (n) => String(n).padStart(2, "0");
function decodeHtml(value = "") {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

const articleTitle = (article) => decodeHtml(article || "").replace(/_/g, " ");
const articleUrl = (article) => `https://en.wikipedia.org/wiki/${encodeURIComponent(article).replace(/%2F/g, "/")}`;
const isRenderableArticle = (article) => article && !BAD_ARTICLE.test(article) && !SUPPRESSED_ARTICLE.test(articleTitle(article).trim());

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

async function loadJSON(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} failed with ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getReportCandidates() {
  return [36, 60, 84].map((hours) => {
    const d = new Date(Date.now() - hours * 3600 * 1000);
    return {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      y: d.getUTCFullYear(),
      m: pad(d.getUTCMonth() + 1),
      d: pad(d.getUTCDate())
    };
  });
}

function normalizeTopArticle(item, index) {
  return {
    article: item.article,
    views: Number(item.views || 0),
    rank: Number(item.rank || index + 1),
    title: item.title || articleTitle(item.article),
    desc: item.desc || "",
    extract: item.extract || "",
    thumb: item.thumb || "",
    img: item.img || item.thumb || "",
    url: item.url || articleUrl(item.article)
  };
}

async function fetchLiveGlobal() {
  for (const r of getReportCandidates()) {
    try {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${r.y}/${r.m}/${r.d}`;
      const data = await loadJSON(url, 4500);
      const articles = (data.items?.[0]?.articles || [])
        .filter((a) => isRenderableArticle(a.article))
        .slice(0, 50)
        .map(normalizeTopArticle);
      if (articles.length) return { date: r.date, articles };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchCountryTop(code) {
  if (state.countryCache.has(code)) return state.countryCache.get(code);

  if (state.mode === "live") {
    const [y, m, d] = state.reportDate.split("-");
    try {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${code}/all-access/${y}/${m}/${d}`;
      const data = await loadJSON(url, 5000);
      const articles = (data.items?.[0]?.articles || [])
        .filter((a) => isRenderableArticle(a.article))
        .slice(0, 40)
        .map(normalizeTopArticle);
      if (articles.length) {
        state.countryCache.set(code, articles);
        return articles;
      }
    } catch {
      // Snapshot fallback below.
    }
  }

  return state.countryCache.get(code) || null;
}

async function fetchSummary(article) {
  if (state.summaryCache.has(article)) return state.summaryCache.get(article);

  const cached = state.globalTop.find((a) => a.article === article) || state.currentList.find((a) => a.article === article);
  if (cached?.extract && cached?.thumb) {
    state.summaryCache.set(article, cached);
    return cached;
  }

  try {
    const summary = await loadJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}?redirect=true`, 5000);
    const out = {
      article,
      title: summary.title || articleTitle(article),
      desc: summary.description || cached?.desc || "",
      extract: summary.extract || cached?.extract || "",
      thumb: summary.thumbnail?.source || cached?.thumb || "",
      img: summary.originalimage?.source || summary.thumbnail?.source || cached?.img || "",
      url: summary.content_urls?.desktop?.page || cached?.url || articleUrl(article)
    };
    state.summaryCache.set(article, out);
    return out;
  } catch {
    const fallback = cached || { article, title: articleTitle(article), desc: "", extract: "", url: articleUrl(article) };
    state.summaryCache.set(article, fallback);
    return fallback;
  }
}

async function fetchSeries(article, options = {}) {
  if (state.seriesCache.has(article) && !options.forceLive) return state.seriesCache.get(article);

  if (state.mode === "live") {
    try {
      const end = flowEndDate();
      const start = new Date(end.getTime() - 31 * 24 * 3600 * 1000);
      const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}00`;
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${stamp(start)}/${stamp(end)}`;
      const data = await loadJSON(url, 5000);
      const series = (data.items || []).map((it) => ({ t: it.timestamp.slice(0, 8), v: it.views }));
      if (series.length) {
        const merged = mergeFlowSeries(state.seriesCache.get(article) || [], series);
        state.seriesCache.set(article, merged);
        return merged;
      }
    } catch {
      // Snapshot fallback below.
    }
  }

  return state.seriesCache.get(article) || [];
}

function mergeFlowSeries(base, incoming) {
  const byDate = new Map();
  base.forEach((point) => byDate.set(point.t, point));
  incoming.forEach((point) => byDate.set(point.t, point));
  return [...byDate.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function flowEndDate() {
  return new Date(Date.now() - 48 * 3600 * 1000);
}

function hydrateSnapshots(global, countries, daily) {
  for (const article of global.articles.filter((item) => isRenderableArticle(item.article)).map(normalizeTopArticle)) {
    state.summaryCache.set(article.article, article);
  }

  for (const [code, articles] of Object.entries(countries.countries || {})) {
    state.countryCache.set(code, articles.filter((item) => isRenderableArticle(item.article)).map(normalizeTopArticle));
  }

  for (const [article, series] of Object.entries(daily.series || {})) {
    state.seriesCache.set(article, series);
  }
}

function setEdition(mode, date) {
  state.mode = mode;
  state.reportDate = date;
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(day % 10, 4)] || "th";
  const label = d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  if (mode === "live") {
    const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
    els.modeLabel.textContent = `UPDATED ${month} ${day}${suffix}, ${d.getUTCFullYear()}`;
    els.dateLine.textContent = "";
    els.dateLine.hidden = true;
    return;
  }

  els.modeLabel.textContent = "Snapshot";
  els.dateLine.textContent = label;
  els.dateLine.hidden = false;
}

function categoryOf(desc = "") {
  const d = desc.toLowerCase();
  if (/football|soccer|tennis|basketball|baseball|cricket|player|athlete|club|team|sport|world cup/.test(d)) return "Sport";
  if (/film|television|actor|actress|singer|album|song|series|music|rapper|band/.test(d)) return "Culture";
  if (/politic|president|minister|election|party|government|king|queen|prince|princess/.test(d)) return "Power";
  if (/city|country|island|river|mountain|province|state|region|capital/.test(d)) return "Place";
  if (/war|battle|attack|disaster|earthquake|accident|hurricane/.test(d)) return "Event";
  return "Article";
}

function setBackground(el, url, fallback) {
  const showFallback = () => {
    el.style.backgroundImage = "";
    if (fallback) fallback.hidden = false;
  };

  if (!url) {
    showFallback();
    return;
  }

  if (!fallback) {
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    return;
  }

  fallback.hidden = false;
  el.dataset.imageUrl = url;
  const img = new Image();
  img.onload = () => {
    if (el.dataset.imageUrl !== url) return;
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    fallback.hidden = true;
  };
  img.onerror = () => {
    if (el.dataset.imageUrl !== url) return;
    showFallback();
  };
  img.src = url;
}

function cardTemplate(article, index, feature = false) {
  const cached = state.summaryCache.get(article.article);
  const initial = cached ? { ...article, ...cached, views: article.views, rank: article.rank } : article;
  const node = document.createElement("article");
  node.className = feature ? "card feature" : "card";
  node.tabIndex = 0;
  node.dataset.article = article.article;
  node.innerHTML = `
    <div class="card__image">
      <span class="placeholder-letter">${(initial.title || initial.article || "W").charAt(0).toUpperCase()}</span>
      <span class="rank">No. ${initial.rank || index + 1}</span>
    </div>
    <div class="card__body">
      <div class="card__kicker">${categoryOf(initial.desc)}${feature ? " - Most read" : ""}</div>
      <div class="card__title"></div>
      <div class="card__desc"></div>
      <div class="card__views"><b>${shortNumber(initial.views)}</b> views in 24h</div>
    </div>
  `;
  node.querySelector(".card__title").textContent = initial.title || articleTitle(initial.article);
  node.querySelector(".card__desc").textContent = feature ? (initial.extract || initial.desc || "").slice(0, 220) : initial.desc || initial.extract || "";
  const image = node.querySelector(".card__image");
  const letter = node.querySelector(".placeholder-letter");
  setBackground(image, initial.img || initial.thumb, letter);
  node.addEventListener("click", () => openArticle(article.article));
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openArticle(article.article);
    }
  });
  return node;
}

function renderCards(list, contextLabel) {
  const articles = (list || []).filter((a) => isRenderableArticle(a.article)).slice(0, 50);
  state.currentList = articles;
  els.contextLabel.textContent = contextLabel;
  els.statTotal.textContent = shortNumber(articles.reduce((sum, a) => sum + (a.views || 0), 0));
  els.statArticles.textContent = String(articles.length || "-");
  els.gridStatus.textContent = articles.length ? `${articles.length} stories ranked` : "No data available";
  els.storyJumpText.textContent = "Top Ranked Stories";
  els.articles.replaceChildren();

  if (!articles.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Wikipedia does not expose a readable top list for this view yet.";
    els.articles.append(empty);
    return;
  }

  articles.forEach((article, index) => {
    els.articles.append(cardTemplate(article, index, index === 0));
  });

  observeCardHydration();
}

function observeCardHydration() {
  state.cardObserver?.disconnect();
  const cards = $$(".card");

  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => hydrateCard(card));
    return;
  }

  state.cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      state.cardObserver.unobserve(entry.target);
      hydrateCard(entry.target);
    });
  }, { rootMargin: "900px 0px", threshold: 0.01 });

  cards.forEach((card) => state.cardObserver.observe(card));
}

async function hydrateCard(card) {
  if (!card?.isConnected || card.dataset.hydrating === "true" || card.dataset.hydrated === "true") return;
  card.dataset.hydrating = "true";
  const articleId = card.dataset.article;
  const article = state.currentList.find((a) => a.article === articleId) || state.globalTop.find((a) => a.article === articleId) || { article: articleId };
  const summary = await fetchSummary(articleId);
  if (!card.isConnected || card.dataset.article !== articleId) return;

  const image = card.querySelector(".card__image");
  const letter = card.querySelector(".placeholder-letter");
  setBackground(image, summary.img || summary.thumb, letter);
  card.querySelector(".card__kicker").textContent = `${categoryOf(summary.desc || article.desc)}${card.classList.contains("feature") ? " - Most read" : ""}`;
  card.querySelector(".card__title").textContent = summary.title || article.title || articleTitle(article.article);
  card.querySelector(".card__desc").textContent = card.classList.contains("feature")
    ? (summary.extract || summary.desc || article.extract || "").slice(0, 220)
    : (summary.desc || article.desc || summary.extract || "");
  card.dataset.hydrated = "true";
  card.dataset.hydrating = "false";
}

function renderRegionPills() {
  els.regionPills.replaceChildren();
  for (const [id, label] of Object.entries(REGION_LABELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.region = id;
    btn.className = id === state.region ? "active" : "";
    btn.textContent = label;
    btn.addEventListener("click", () => setRegion(id));
    els.regionPills.append(btn);
  }
}

function countryName(a2) {
  const geo = window.WIKIPULSE_GEO;
  for (const [num, code] of Object.entries(geo.NUM_TO_A2)) {
    if (code === a2 && state.countryNames.has(num)) return state.countryNames.get(num);
  }
  return a2 || "Global";
}

function setViewGlobal() {
  state.selectedA2 = null;
  state.selectedName = "Global";
  document.body.classList.remove("has-selection");
  els.viewName.textContent = "Global";
  paintMap();
  renderCards(state.globalTop, "globally");
}

async function selectCountry(a2, numericId, fallbackName) {
  if (!a2) {
    showToast("No country code is mapped for this geography.");
    return;
  }
  state.selectedA2 = a2;
  state.selectedName = countryName(a2) || fallbackName || a2;
  document.body.classList.add("has-selection");
  els.viewName.textContent = state.selectedName;
  paintMap(numericId);
  showToast(`Loading what ${state.selectedName} is reading...`);
  const articles = await fetchCountryTop(a2);
  renderCards(articles, `in ${state.selectedName}`);
}

function setRegion(region) {
  state.region = region;
  $$(".pills button").forEach((button) => button.classList.toggle("active", button.dataset.region === region));
  paintMap();
}

async function renderMap() {
  const d3 = window.d3;
  const topojson = window.topojson;
  const geo = window.WIKIPULSE_GEO;

  if (!state.topo) state.topo = await loadJSON("/data/countries-110m.json");
  const countries = topojson.feature(state.topo, state.topo.objects.countries).features;
  countries.forEach((country) => state.countryNames.set(String(country.id).padStart(3, "0"), country.properties.name));

  const mount = els.mapMount;
  const rect = mount.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(420, rect.height);
  const projection = d3.geoNaturalEarth1().fitSize([width * (width > 900 ? .86 : .92), height * .94], { type: "Sphere" });
  projection.translate([width * (width > 900 ? .62 : .5), height / 2]);
  const path = d3.geoPath(projection);

  mount.replaceChildren();
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-hidden", "true");
  svg.append("path").attr("d", path({ type: "Sphere" })).attr("fill", "none").attr("stroke", "rgba(246,241,232,.14)").attr("stroke-width", 1);
  svg.append("path").attr("d", path(d3.geoGraticule10())).attr("fill", "none").attr("stroke", "rgba(246,241,232,.05)").attr("stroke-width", .3);

  svg.selectAll("path.country")
    .data(countries)
    .enter()
    .append("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("data-num", (d) => String(d.id).padStart(3, "0"))
    .attr("stroke", "rgba(246,241,232,.10)")
    .attr("stroke-width", .5)
    .on("mousemove", function (event, d) {
      const num = this.dataset.num;
      const a2 = geo.NUM_TO_A2[num];
      const cached = a2 ? state.countryCache.get(a2) : null;
      const top = cached?.slice(0, 3).map((a, i) => `${i + 1}. ${articleTitle(a.article)}`).join("<br>") || `Click to load what ${d.properties.name} is reading.`;
      showTip(els.mapTip, mount, event, `<strong>${d.properties.name}</strong><span>${cached ? "Top three articles" : "Available on click"}</span>${top}`);
      if (a2 !== state.selectedA2) d3.select(this).attr("fill", "#f0a48a").attr("stroke", "#f6f1e8");
    })
    .on("mouseleave", function () {
      els.mapTip.style.opacity = 0;
      paintMap();
    })
    .on("click", function (_event, d) {
      const num = this.dataset.num;
      selectCountry(geo.NUM_TO_A2[num], num, d.properties.name);
    });

  state.mapReady = true;
  paintMap();
}

function paintMap() {
  if (!state.mapReady) return;
  const geo = window.WIKIPULSE_GEO;
  const d3 = window.d3;

  d3.selectAll(".country")
    .attr("fill", function () {
      const a2 = geo.NUM_TO_A2[this.dataset.num];
      if (a2 && a2 === state.selectedA2) return "#d6361b";
      return a2 && state.countryCache.has(a2) ? "rgba(246,241,232,.16)" : "rgba(246,241,232,.05)";
    })
    .attr("opacity", function () {
      if (state.region === "ALL") return 1;
      const a2 = geo.NUM_TO_A2[this.dataset.num];
      return a2 && geo.A2_TO_REGION[a2] === state.region ? 1 : .26;
    })
    .attr("stroke", function () {
      const a2 = geo.NUM_TO_A2[this.dataset.num];
      return a2 && a2 === state.selectedA2 ? "#f6f1e8" : "rgba(246,241,232,.10)";
    })
    .attr("stroke-width", function () {
      const a2 = geo.NUM_TO_A2[this.dataset.num];
      return a2 && a2 === state.selectedA2 ? 1.2 : .5;
    });
}

function showTip(tip, mount, event, html) {
  tip.innerHTML = html;
  const rect = mount.getBoundingClientRect();
  let left = event.clientX - rect.left + 16;
  let top = event.clientY - rect.top - 20;
  if (left + 300 > rect.width) left = event.clientX - rect.left - 316;
  if (top < 16) top = event.clientY - rect.top + 24;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.style.opacity = 1;
}

function renderFlow() {
  const d3 = window.d3;
  const mount = els.flowMount;
  const rect = mount.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(360, rect.height);
  const cast = getFlowCast().slice(0, FLOW_STORY_COUNT);
  if (cast.length < 3) return;

  const keys = cast.map((a) => a.article);
  const seriesByKey = Object.fromEntries(keys.map((key) => [key, state.seriesCache.get(key) || []]));
  const dateSet = new Set();
  keys.forEach((key) => seriesByKey[key].forEach((point) => dateSet.add(point.t)));
  const dates = [...dateSet].sort();
  const flowStats = Object.fromEntries(keys.map((key) => [key, flowSeriesStats(seriesByKey[key])]));
  const rawRows = dates.map((t) => {
    const row = { t };
    keys.forEach((key) => {
      row[key] = flowValueAt(seriesByKey[key], t);
    });
    return row;
  });
  const values = rawRows.flatMap((row) => keys.map((key) => row[key])).filter((value) => value > 0).sort((a, b) => a - b);
  const cap = Math.max(1, (d3.quantile(values, .985) || d3.max(values) || 1) * 1.08);
  const displayFloors = Object.fromEntries(keys.map((key) => {
    const stats = flowStats[key];
    const floorBase = Math.min(cap, Math.max(stats.median, stats.latest * .16, stats.peak * .08, 1));
    return [key, Math.pow(floorBase, .72) * .38];
  }));
  const rows = rawRows.map((raw, index) => {
    const row = { t: raw.t };
    const progress = index / Math.max(rawRows.length - 1, 1);
    const floorRamp = .66 + Math.min(1, Math.pow(progress / .095, .72)) * .34;
    const leftExpansion = floorRamp * (1 + Math.pow(Math.max(0, 1 - progress), 1.55) * .48);
    keys.forEach((key) => {
      const rawValue = raw[key];
      const stats = flowStats[key];
      const ratio = Math.min(8, rawValue / Math.max(stats.median, 1));
      const surgeLift = .74 + Math.pow(Math.max(ratio, .05), .52) * .24;
      const shaped = Math.pow(Math.min(rawValue, cap), .72) * surgeLift;
      row[key] = (displayFloors[key] + shaped * .88) * leftExpansion;
    });
    return row;
  });

  const parse = (t) => new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8)));
  const margin = {
    top: width > 700 ? 72 : 38,
    right: width > 700 ? 44 : 18,
    bottom: 42,
    left: width > 700 ? 32 : 18
  };
  const stack = d3.stack().keys(keys).order(d3.stackOrderInsideOut).offset(d3.stackOffsetWiggle);
  const layers = stack(rows);
  const x = d3.scaleUtc().domain([parse(dates[0]), parse(dates[dates.length - 1])]).range([margin.left, width - margin.right]);
  const yDomain = [
    d3.min(layers, (l) => d3.min(l, (p) => p[0])),
    d3.max(layers, (l) => d3.max(l, (p) => p[1]))
  ];
  const yPad = Math.max(1, (yDomain[1] - yDomain[0]) * .025);
  const y = d3.scaleLinear()
    .domain([yDomain[0] - yPad, yDomain[1] + yPad])
    .range([height - margin.bottom + (width > 700 ? 34 : 12), margin.top]);
  const area = d3.area().x((_p, i) => x(parse(rows[i].t))).y0((p) => y(p[0])).y1((p) => y(p[1])).curve(d3.curveBasis);

  mount.replaceChildren();
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-hidden", "true");
  const bisect = d3.bisector((r) => parse(r.t)).center;

  svg.append("g").selectAll("path")
    .data(layers)
    .enter()
    .append("path")
    .attr("class", "flow-layer")
    .attr("data-key", (layer) => layer.key)
    .attr("d", area)
    .attr("fill", (_d, i) => PALETTE[i % PALETTE.length])
    .attr("opacity", .84)
    .attr("stroke", "rgba(12,10,8,.42)")
    .attr("stroke-width", .65)
    .style("cursor", "pointer")
    .on("mousemove", function (event, layer) {
      setFlowFocus(svg, layer.key);
      const rect = mount.getBoundingClientRect();
      const idx = Math.max(0, Math.min(rows.length - 1, bisect(rows, x.invert(event.clientX - rect.left))));
      const row = rawRows[idx];
      const article = cast.find((a) => a.article === layer.key);
      const date = parse(row.t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      showTip(els.flowTip, mount, event, `<strong>${article.title || articleTitle(layer.key)}</strong><span>${date}</span>${shortNumber(row[layer.key])} views`);
    })
    .on("mouseleave", function () {
      clearFlowFocus(svg);
      els.flowTip.style.opacity = 0;
    })
    .on("click", (_event, layer) => openArticle(layer.key));

  renderFlowLabels(svg, layers, rows, cast, x, y, parse, width);

  const endDate = parse(dates[dates.length - 1]);
  const endLabel = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  svg.append("text")
    .attr("x", width - margin.right)
    .attr("y", margin.top - 36)
    .attr("text-anchor", "end")
    .attr("fill", "#d6361b")
    .attr("font-family", "Inter, sans-serif")
    .attr("font-size", 10)
    .attr("font-weight", 800)
    .attr("letter-spacing", ".18em")
    .text(`THROUGH ${endLabel} ->`);

  const ticks = x.ticks(width > 800 ? 8 : 4);
  if (!ticks.some((tick) => Math.abs(tick - endDate) < 12 * 3600 * 1000)) ticks.push(endDate);
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.utcFormat("%b %d")).tickSizeOuter(0))
    .call((g) => g.selectAll("text").attr("fill", "rgba(246,241,232,.64)").attr("font-size", 10).attr("font-weight", 700))
    .call((g) => g.selectAll("path,line").attr("stroke", "rgba(246,241,232,.18)"));

  state.flowReady = true;
  hydrateLiveFlowSeries();
}

function flowValueAt(series, t) {
  if (!series.length) return 0;
  const exact = series.find((point) => point.t === t);
  if (exact) return exact.v;
  if (t <= series[0].t) return series[0].v;
  if (t >= series[series.length - 1].t) return series[series.length - 1].v;
  const nextIndex = series.findIndex((point) => point.t > t);
  const before = series[nextIndex - 1];
  const after = series[nextIndex];
  if (!before || !after) return before?.v || after?.v || 0;
  const span = Math.max(1, flowDateMs(after.t) - flowDateMs(before.t));
  const ratio = Math.max(0, Math.min(1, (flowDateMs(t) - flowDateMs(before.t)) / span));
  return before.v + (after.v - before.v) * ratio;
}

function flowDateMs(t) {
  return Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8));
}

function flowSeriesStats(series) {
  const values = series.map((point) => point.v).filter((value) => value > 0).sort((a, b) => a - b);
  if (!values.length) return { median: 1, peak: 0, latest: 0, volatility: 0, surge: 1 };
  const median = values[Math.floor(values.length / 2)] || 1;
  const peak = values[values.length - 1] || 0;
  const latest = series[series.length - 1]?.v || 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const volatility = Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length) / Math.max(mean, 1);
  const recentPeak = Math.max(...series.slice(-6).map((point) => point.v), latest);
  const surge = recentPeak / Math.max(median, 1);
  return { median, peak, latest, volatility, surge };
}

function setFlowFocus(svg, key) {
  svg.classed("has-flow-focus", true);
  svg.selectAll(".flow-layer")
    .attr("opacity", (layer) => layer.key === key ? .98 : .14)
    .attr("stroke", (layer) => layer.key === key ? "rgba(246,241,232,.78)" : "rgba(12,10,8,.25)")
    .attr("stroke-width", (layer) => layer.key === key ? 1.35 : .45);
  svg.selectAll(".flow-label")
    .attr("opacity", (label) => label.key === key ? 1 : .18);
}

function clearFlowFocus(svg) {
  svg.classed("has-flow-focus", false);
  svg.selectAll(".flow-layer")
    .attr("opacity", .84)
    .attr("stroke", "rgba(12,10,8,.42)")
    .attr("stroke-width", .65);
  svg.selectAll(".flow-label")
    .attr("opacity", 1);
}

async function hydrateLiveFlowSeries() {
  if (state.mode !== "live" || state.flowHydrating) return;
  const through = flowEndKey();
  if (state.flowHydratedThrough === through) return;
  const targets = state.globalTop.slice(0, 18).filter((article) => isRenderableArticle(article.article));
  if (!targets.length) return;

  state.flowHydrating = true;
  try {
    for (let i = 0; i < targets.length; i += 4) {
      await Promise.all(targets.slice(i, i + 4).map((article) => fetchSeries(article.article, { forceLive: true }).catch(() => [])));
    }
    state.flowHydratedThrough = through;
    state.flowReady = false;
    if (state.heroView === "flow") renderFlow();
  } finally {
    state.flowHydrating = false;
  }
}

function flowEndKey() {
  const d = flowEndDate();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function getFlowCast() {
  const liveOverlap = state.globalTop.slice(0, 24).filter((article) => state.seriesCache.has(article.article));
  const fallback = [...state.seriesCache.entries()]
    .map(([article, series], index) => {
      const summary = state.summaryCache.get(article) || {};
      const stats = flowSeriesStats(series);
      return {
        article,
        rank: index + 1,
        views: stats.latest,
        flowScore: flowStoryScore(stats),
        title: summary.title || articleTitle(article),
        desc: summary.desc || "",
        extract: summary.extract || "",
        thumb: summary.thumb || "",
        img: summary.img || ""
      };
    })
    .sort((a, b) => b.flowScore - a.flowScore);

  const seen = new Set(liveOverlap.map((article) => article.article));
  const blended = [
    ...liveOverlap,
    ...fallback.filter((article) => !seen.has(article.article))
  ].map((article) => {
    const stats = flowSeriesStats(state.seriesCache.get(article.article) || []);
    return {
      ...article,
      flowScore: article.flowScore || flowStoryScore(stats)
    };
  }).sort((a, b) => b.flowScore - a.flowScore);

  return blended.length >= 5 ? blended : fallback;
}

function flowStoryScore(stats) {
  return (stats.latest * .72) + (stats.peak * .54) + (Math.min(stats.surge, 12) * 42000) + (Math.min(stats.volatility, 3) * 65000);
}

function renderFlowLabels(svg, layers, rows, cast, x, y, parse, width) {
  const minIndex = Math.max(1, Math.floor(rows.length * .14));
  const maxIndex = Math.max(minIndex + 1, Math.floor(rows.length * .84));
  const maxLabels = Math.min(cast.length, width > 900 ? FLOW_STORY_COUNT : 6);
  const placed = [];
  const candidates = layers.map((layer) => {
    const perLayer = [];
    for (let i = minIndex; i <= maxIndex; i++) {
      const point = layer[i];
      const thickness = Math.abs(y(point[0]) - y(point[1]));
      perLayer.push({
        key: layer.key,
        x: x(parse(rows[i].t)),
        y: (y(point[0]) + y(point[1])) / 2,
        thickness
      });
    }
    return perLayer.sort((a, b) => b.thickness - a.thickness).slice(0, 8);
  }).filter(Boolean).sort((a, b) => (b[0]?.thickness || 0) - (a[0]?.thickness || 0));

  const labels = [];
  for (const choices of candidates) {
    if (labels.length >= maxLabels) break;
    const candidate = choices.find((choice) => {
      const article = cast.find((item) => item.article === choice.key);
      const title = article?.title || articleTitle(choice.key);
      const fontSize = Math.max(FLOW_LABEL_MIN, Math.min(23, choice.thickness * .38));
      const textWidth = Math.min(width * .28, title.length * fontSize * .54);
      const box = {
        x0: choice.x - textWidth / 2 - 8,
        x1: choice.x + textWidth / 2 + 8,
        y0: choice.y - fontSize,
        y1: choice.y + fontSize
      };
      const inBounds = box.x0 > 16 && box.x1 < width - 16 && box.y0 > 16;
      const collides = placed.some((other) => !(box.x1 < other.x0 || box.x0 > other.x1 || box.y1 < other.y0 || box.y0 > other.y1));
      if (!inBounds || collides) return false;
      choice.title = title;
      choice.fontSize = fontSize;
      choice.box = box;
      return true;
    }) || choices[0];
    if (!candidate) continue;
    const article = cast.find((item) => item.article === candidate.key);
    const title = candidate.title || article?.title || articleTitle(candidate.key);
    const fontSize = candidate.fontSize || FLOW_LABEL_MIN;
    const textWidth = Math.min(width * .24, title.length * fontSize * .5);
    const box = candidate.box || {
      x0: candidate.x - textWidth / 2 - 6,
      x1: candidate.x + textWidth / 2 + 6,
      y0: candidate.y - fontSize,
      y1: candidate.y + fontSize
    };
    placed.push(box);
    labels.push({ ...candidate, title, fontSize });
  }

  svg.append("g")
    .selectAll("text")
    .data(labels)
    .enter()
    .append("text")
    .attr("class", "flow-label")
    .attr("data-key", (d) => d.key)
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", "#f6f1e8")
    .attr("stroke", "rgba(12,10,8,.72)")
    .attr("stroke-width", 5)
    .attr("paint-order", "stroke")
    .attr("font-family", "Fraunces, Georgia, serif")
    .attr("font-weight", 750)
    .attr("font-size", (d) => d.fontSize)
    .style("cursor", "pointer")
    .text((d) => d.title)
    .on("mousemove", function (_event, d) { setFlowFocus(svg, d.key); })
    .on("mouseleave", function () { clearFlowFocus(svg); })
    .on("click", (_event, d) => openArticle(d.key));
}

function setHeroView(view) {
  state.heroView = view;
  const flow = view === "flow";
  els.mapMount.hidden = flow;
  els.flowMount.hidden = !flow;
  els.heroCopy.hidden = flow;
  els.flowCopy.hidden = !flow;
  els.controls.hidden = flow;
  els.mapTab.classList.toggle("active", !flow);
  els.flowTab.classList.toggle("active", flow);
  els.mapTab.setAttribute("aria-selected", String(!flow));
  els.flowTab.setAttribute("aria-selected", String(flow));
  if (flow && !state.flowReady) renderFlow();
  if (flow) hydrateLiveFlowSeries();
}

function relatedArticles(article) {
  const me = state.globalTop.find((a) => a.article === article);
  if (!me) return [];
  const myTokens = new Set(tokens(me.title || articleTitle(article)));
  const myCategory = categoryOf(me.desc);
  return state.globalTop
    .filter((a) => a.article !== article)
    .map((a) => {
      const shared = tokens(a.title || articleTitle(a.article)).filter((t) => myTokens.has(t)).length;
      const category = categoryOf(a.desc) === myCategory ? .4 : 0;
      return { article: a, score: shared + category };
    })
    .filter((entry) => entry.score >= 1)
    .sort((a, b) => b.score - a.score || a.article.rank - b.article.rank)
    .slice(0, 4)
    .map((entry) => entry.article);
}

function tokens(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
}

function sparkPaths(series) {
  const d3 = window.d3;
  const width = 440;
  const height = 96;
  const padPx = 4;
  const xs = d3.scaleLinear().domain([0, series.length - 1]).range([padPx, width - padPx]);
  const ys = d3.scaleLinear().domain([0, d3.max(series, (p) => p.v) || 1]).range([height - padPx, padPx + 6]);
  const line = d3.line().x((_p, i) => xs(i)).y((p) => ys(p.v)).curve(d3.curveMonotoneX);
  const area = d3.area().x((_p, i) => xs(i)).y0(height - padPx).y1((p) => ys(p.v)).curve(d3.curveMonotoneX);
  const last = series[series.length - 1];
  return {
    line: line(series),
    area: area(series),
    dot: { x: xs(series.length - 1), y: ys(last?.v || 0) }
  };
}

function panelChartSeries(series, views) {
  const clean = (series || []).filter((point) => Number.isFinite(point.v) && point.v >= 0);
  if (clean.length >= 3) return clean;

  const peak = Math.max(Number(views) || 1, 1);
  return Array.from({ length: 30 }, (_unused, index) => {
    const progress = index / 29;
    const pulse = 1 + Math.sin(index * .72) * .18 + Math.cos(index * .31) * .08;
    const lift = progress > .78 ? Math.pow((progress - .78) / .22, 2.2) * .72 : 0;
    return {
      t: "",
      v: Math.max(1, Math.round(peak * (.08 + progress * .04 + lift) * pulse))
    };
  });
}

function renderPanelChart(series) {
  const paths = sparkPaths(series);
  els.sparkArea.setAttribute("d", paths.area);
  els.sparkLine.setAttribute("d", paths.line);
  els.sparkDot.setAttribute("cx", paths.dot.x);
  els.sparkDot.setAttribute("cy", paths.dot.y);
  els.spark.hidden = false;
}

function trendCopy(series, views) {
  if (!series || series.length < 10) return { why: "Breaking story with sparse historical data.", trend: "NEW" };
  const values = series.map((p) => p.v);
  const base = values.slice(0, Math.max(5, values.length - 5)).sort((a, b) => a - b);
  const median = base[Math.floor(base.length / 2)] || 1;
  const max = Math.max(...values);
  const recent = Math.max(...values.slice(-4));
  const ratio = recent / Math.max(median, 1);
  if (views > max * 3 && views > 20000) {
    return { why: "Latest readership is well above its recent 30-day pattern.", trend: "NEW" };
  }
  const r = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  if (ratio >= 4) return { why: `Elevated - about ${r}x its 30-day norm.`, trend: `${r}x` };
  if (ratio >= 2) return { why: `Rising - about ${r}x its 30-day norm.`, trend: `${r}x` };
  if (ratio >= 1.3) return { why: `Slightly elevated - about ${r}x its 30-day norm.`, trend: `${r}x` };
  return { why: "Near its recent 30-day norm.", trend: `${r}x` };
}

function titleCaseSection(section) {
  const small = new Set(["and", "or", "of", "the", "a", "an", "to", "in", "on", "for", "with", "at", "by", "from", "vs"]);
  return section.split(/\s+/).map((word, index) => {
    if (index > 0 && small.has(word.toLowerCase())) return word.toLowerCase();
    if (/^[A-Z0-9].*[A-Z]/.test(word) || /^\d/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

async function fetchArticleActivity(article) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(article)}&rvlimit=200&rvprop=timestamp|comment&format=json&origin=*`;
    const data = await loadJSON(url, 4500);
    const page = Object.values(data.query?.pages || {})[0];
    const revisions = page?.revisions || [];
    if (!revisions.length) return [];

    const newest = new Date(revisions[0].timestamp).getTime();
    let windowed = [];
    for (const days of [2, 4, 7]) {
      windowed = revisions.filter((revision) => newest - new Date(revision.timestamp).getTime() <= days * 864e5);
      if (windowed.length >= 6) break;
    }

    const skip = /^(references|external links|sources|further reading|notes|bibliography|see also|top|infobox|in popular culture|popular culture|name|honou?rs|career statistics|statistics|club statistics|filmography|discography|images?|gallery|external media|contents?)$/i;
    const sections = new Map();
    windowed.forEach((revision) => {
      const match = (revision.comment || "").match(/\/\*\s*([^*|]+?)\s*(\|[^*]*)?\*\//);
      if (!match) return;
      const raw = match[1].trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+\d+$/, "").trim();
      if (!raw || raw.length > 46 || skip.test(raw)) return;
      const key = raw.toLowerCase();
      const current = sections.get(key) || { label: titleCaseSection(raw), count: 0 };
      current.count += 1;
      sections.set(key, current);
    });

    const ranked = [...sections.values()].sort((a, b) => b.count - a.count);
    if (ranked.length < 2 && !(ranked[0] && ranked[0].count >= 3)) return [];
    const max = ranked[0].count || 1;
    return ranked.slice(0, 5).map((section) => ({
      label: section.label,
      value: Math.max(14, Math.round((section.count / max) * 100))
    }));
  } catch {
    return [];
  }
}

function movementSections(article, summary, activity, series) {
  if (activity.length) return activity;
  const fallback = fallbackSections(article, summary).slice(0, 8);
  const stats = flowSeriesStats(series || []);
  const extractTokens = new Set(tokens(`${summary?.title || ""} ${summary?.desc || ""} ${summary?.extract || ""}`));
  return fallback
    .map((label, index) => {
      const labelTokens = tokens(label);
      const relevance = labelTokens.filter((token) => extractTokens.has(token)).length;
      const nameScore = sectionIntentScore(label);
      const rankScore = Math.max(0, 8 - index) * 5;
      const surgeScore = Math.min(38, Math.log2(Math.max(stats.surge, 1)) * 16);
      const value = Math.max(12, Math.min(100, Math.round(22 + relevance * 10 + nameScore + rankScore + surgeScore)));
      return { label, value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function sectionIntentScore(label) {
  const text = label.toLowerCase();
  if (/(death|breaking|incident|attack|announcement|controversy|reaction|aftermath|election|trial|ranking|final|match|season|film|release)/.test(text)) return 28;
  if (/(career|political|personal|international|background|history|early life|public image)/.test(text)) return 18;
  return 8;
}

function fallbackSections(article, summary) {
  const category = categoryOf(summary?.desc || "");
  const context = `${summary?.title || articleTitle(article)} ${summary?.desc || ""} ${summary?.extract || ""}`.toLowerCase();
  if (/(death|died|dies|passed away|assassinated|killed|1955[–-]2026|1930[–-]2026|2026 death)/.test(context)) {
    return ["Death", "Political Implications", "Electoral Implications", "Personal Life", "International"];
  }
  if (category === "Sport") return ["Latest matches", "Career", "International play", "Records", "Public reaction"];
  if (category === "Power" || /politic/i.test(summary?.desc || "")) return ["Latest developments", "Political implications", "Career", "Public reaction", "Background"];
  if (/film|television|series|album|song|music/i.test(summary?.desc || "")) return ["Release", "Cast and production", "Reception", "Plot", "Background"];
  const title = summary?.title || articleTitle(article);
  return [`Latest updates on ${title}`, "Background", "Public attention", "Related events", "Reception"];
}

function renderMovementSections(items) {
  els.storySections.replaceChildren();
  els.storySectionsWrap.hidden = items.length === 0;
  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="story-sections__rank">${pad(index + 1)}</span>
      <span class="story-sections__label"></span>
      <span class="story-sections__bar"><i style="width:${item.value}%"></i></span>
    `;
    li.querySelector(".story-sections__label").textContent = item.label;
    els.storySections.append(li);
  });
}

async function openArticle(article) {
  const hit = state.currentList.find((a) => a.article === article) || state.globalTop.find((a) => a.article === article) || { article, views: 0, rank: "-" };
  const title = hit.title || articleTitle(article);

  els.panel.classList.add("open");
  els.panel.setAttribute("aria-hidden", "false");
  els.panelTitle.textContent = title;
  els.panelDesc.textContent = "Loading...";
  els.panelExtract.textContent = "";
  els.panelContext.textContent = state.selectedA2 ? state.selectedName.toUpperCase() : "";
  els.panelContext.hidden = !state.selectedA2;
  els.panelViews.textContent = shortNumber(hit.views);
  els.panelRank.textContent = hit.rank ? `#${hit.rank}` : "-";
  els.panelTrend.textContent = "-";
  els.panelWhy.textContent = "Reading the pulse...";
  els.storySectionsWrap.hidden = true;
  els.storySections.replaceChildren();
  els.panelLetter.textContent = title.charAt(0).toUpperCase();
  els.panelLetter.hidden = false;
  setBackground(els.panelImage, "", els.panelLetter);
  renderPanelChart(panelChartSeries([], hit.views || 0));

  const [summary, series, activity] = await Promise.all([
    fetchSummary(article),
    fetchSeries(article),
    fetchArticleActivity(article)
  ]);
  const finalTitle = summary.title || title;
  els.panelTitle.textContent = finalTitle;
  els.panelDesc.textContent = summary.desc || "";
  els.panelKicker.textContent = `${categoryOf(summary.desc)} - Trending`;
  els.panelExtract.textContent = summary.extract || "Wikipedia has not published a summary for this article yet.";
  els.panelLink.href = summary.url || articleUrl(article);
  els.panelLetter.textContent = finalTitle.charAt(0).toUpperCase();
  setBackground(els.panelImage, summary.img || summary.thumb, els.panelLetter);

  const chartSeries = panelChartSeries(series, hit.views || 0);
  const trend = trendCopy(series, hit.views || 0);
  els.panelWhy.textContent = trend.why;
  els.panelTrend.textContent = trend.trend;
  renderPanelChart(chartSeries);

  renderMovementSections(movementSections(article, summary, activity, series));
  renderRelated(article);
}

function renderRelated(article) {
  const related = relatedArticles(article);
  els.related.replaceChildren();
  els.relatedWrap.hidden = related.length === 0;
  for (const item of related) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title || articleTitle(item.article);
    button.addEventListener("click", () => openArticle(item.article));
    els.related.append(button);
  }
}

function closePanel() {
  els.panel.classList.remove("open");
  els.panel.setAttribute("aria-hidden", "true");
}

function bindEvents() {
  els.mapTab.addEventListener("click", () => setHeroView("map"));
  els.flowTab.addEventListener("click", () => setHeroView("flow"));
  els.resetView.addEventListener("click", setViewGlobal);
  els.closePanel.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderMap().catch(console.error);
      if (state.heroView === "flow") renderFlow();
    }, 220);
  });
}

async function boot() {
  bindEls();
  bindEvents();
  renderRegionPills();

  const [snapshotGlobal, snapshotCountries, snapshotDaily] = await Promise.all([
    loadJSON("/data/snapshot-global.json"),
    loadJSON("/data/snapshot-countries.json"),
    loadJSON("/data/snapshot-daily.json")
  ]);
  hydrateSnapshots(snapshotGlobal, snapshotCountries, snapshotDaily);

  setEdition("snapshot", snapshotGlobal.date);
  state.globalTop = snapshotGlobal.articles.filter((item) => isRenderableArticle(item.article)).map(normalizeTopArticle);
  renderCards(state.globalTop, "globally");
  showToast("Showing the saved Wikipedia snapshot.");

  try {
    await renderMap();
  } catch (error) {
    console.error(error);
    showToast("Map data could not load.");
  }

  fetchLiveGlobal().then((global) => {
    if (!global) return;
    setEdition("live", global.date);
    state.globalTop = global.articles;
    if (!state.selectedA2) renderCards(state.globalTop, "globally");
    state.flowReady = false;
    if (state.heroView === "flow") renderFlow();
    hydrateLiveFlowSeries();
    showToast("Live Wikimedia data loaded.");
  }).catch(() => {});
}

boot().catch((error) => {
  console.error(error);
  bindEls();
  if (els.gridStatus) els.gridStatus.textContent = "App failed to start";
  showToast("WikiPulse could not start. Check the console for details.");
});
