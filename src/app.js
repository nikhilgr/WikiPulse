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
    flowCards: $("#flowCards"),
    controls: $("#controls"),
    legend: $(".legend"),
    regionPills: $("#regionPills"),
    viewName: $("#viewName"),
    resetView: $("#resetView"),
    contextLabel: $("#contextLabel"),
    gridStatus: $("#gridStatus"),
    articles: $("#articles"),
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
const articleTitle = (article) => (article || "").replace(/_/g, " ");
const articleUrl = (article) => `https://en.wikipedia.org/wiki/${encodeURIComponent(article).replace(/%2F/g, "/")}`;

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
        .filter((a) => a.article && !BAD_ARTICLE.test(a.article))
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
        .filter((a) => a.article && !BAD_ARTICLE.test(a.article))
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

async function fetchSeries(article) {
  if (state.seriesCache.has(article)) return state.seriesCache.get(article);

  if (state.mode === "live") {
    try {
      const end = new Date(Date.now() - 48 * 3600 * 1000);
      const start = new Date(end.getTime() - 31 * 24 * 3600 * 1000);
      const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}00`;
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${stamp(start)}/${stamp(end)}`;
      const data = await loadJSON(url, 5000);
      const series = (data.items || []).map((it) => ({ t: it.timestamp.slice(0, 8), v: it.views }));
      if (series.length) {
        state.seriesCache.set(article, series);
        return series;
      }
    } catch {
      // Snapshot fallback below.
    }
  }

  return state.seriesCache.get(article) || [];
}

function hydrateSnapshots(global, countries, daily) {
  for (const article of global.articles.map(normalizeTopArticle)) {
    state.summaryCache.set(article.article, article);
  }

  for (const [code, articles] of Object.entries(countries.countries || {})) {
    state.countryCache.set(code, articles.map(normalizeTopArticle));
  }

  for (const [article, series] of Object.entries(daily.series || {})) {
    state.seriesCache.set(article, series);
  }
}

function setEdition(mode, date) {
  state.mode = mode;
  state.reportDate = date;
  const d = new Date(`${date}T12:00:00Z`);
  els.modeLabel.textContent = mode === "live" ? "Live" : "Snapshot";
  els.dateLine.textContent = d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).toUpperCase();
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

function setBackground(el, url) {
  if (url) {
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
  } else {
    el.style.backgroundImage = "";
  }
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
  setBackground(image, initial.img || initial.thumb);
  if (initial.img || initial.thumb) node.querySelector(".placeholder-letter").hidden = true;
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
  const articles = (list || []).filter((a) => a.article && !BAD_ARTICLE.test(a.article)).slice(0, 50);
  state.currentList = articles;
  els.contextLabel.textContent = contextLabel;
  els.statTotal.textContent = shortNumber(articles.reduce((sum, a) => sum + (a.views || 0), 0));
  els.statArticles.textContent = String(articles.length || "-");
  els.gridStatus.textContent = articles.length ? `${articles.length} stories ranked` : "No data available";
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
  setBackground(image, summary.img || summary.thumb);
  if (summary.img || summary.thumb) letter.hidden = true;
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
  const projection = d3.geoNaturalEarth1().fitSize([width * .92, height * .96], { type: "Sphere" });
  projection.translate([width * (width > 900 ? .56 : .5), height / 2]);
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
  const cast = getFlowCast().slice(0, width > 700 ? 14 : 10);
  if (cast.length < 3) return;

  const keys = cast.map((a) => a.article);
  const dateSet = new Set();
  keys.forEach((key) => state.seriesCache.get(key).forEach((point) => dateSet.add(point.t)));
  const dates = [...dateSet].sort();
  const rawRows = dates.map((t) => {
    const row = { t };
    keys.forEach((key) => {
      row[key] = state.seriesCache.get(key).find((point) => point.t === t)?.v || 0;
    });
    return row;
  });
  const values = rawRows.flatMap((row) => keys.map((key) => row[key])).filter((value) => value > 0).sort((a, b) => a - b);
  const cap = Math.max(1, (d3.quantile(values, .92) || d3.max(values) || 1) * 1.35);
  const rows = rawRows.map((raw) => {
    const row = { t: raw.t };
    keys.forEach((key) => {
      row[key] = Math.pow(Math.min(raw[key], cap), .62);
    });
    return row;
  });

  const parse = (t) => new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8)));
  const margin = {
    top: width > 700 ? 92 : 44,
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
  const yPad = Math.max(1, (yDomain[1] - yDomain[0]) * .08);
  const y = d3.scaleLinear()
    .domain([yDomain[0] - yPad, yDomain[1] + yPad])
    .range([height - margin.bottom, margin.top]);
  const area = d3.area().x((_p, i) => x(parse(rows[i].t))).y0((p) => y(p[0])).y1((p) => y(p[1])).curve(d3.curveBasis);

  mount.replaceChildren();
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("aria-hidden", "true");
  const bisect = d3.bisector((r) => parse(r.t)).center;
  renderFlowCards(cast, rawRows);

  svg.append("g").selectAll("path")
    .data(layers)
    .enter()
    .append("path")
    .attr("d", area)
    .attr("fill", (_d, i) => PALETTE[i % PALETTE.length])
    .attr("opacity", .78)
    .on("mousemove", function (event, layer) {
      d3.select(this).attr("opacity", 1);
      const rect = mount.getBoundingClientRect();
      const idx = Math.max(0, Math.min(rows.length - 1, bisect(rows, x.invert(event.clientX - rect.left))));
      const row = rawRows[idx];
      const article = cast.find((a) => a.article === layer.key);
      const date = parse(row.t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      showTip(els.flowTip, mount, event, `<strong>${article.title || articleTitle(layer.key)}</strong><span>${date}</span>${shortNumber(row[layer.key])} views`);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", .78);
      els.flowTip.style.opacity = 0;
    })
    .on("click", (_event, layer) => openArticle(layer.key));

  renderFlowLabels(svg, layers, rows, cast, x, y, parse, width);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(width > 800 ? 8 : 4).tickSizeOuter(0))
    .call((g) => g.selectAll("text").attr("fill", "rgba(246,241,232,.64)").attr("font-size", 10).attr("font-weight", 700))
    .call((g) => g.selectAll("path,line").attr("stroke", "rgba(246,241,232,.18)"));

  state.flowReady = true;
}

function renderFlowCards(cast, rawRows) {
  els.flowCards.replaceChildren();
  const latest = rawRows[rawRows.length - 1] || {};
  cast.slice(0, 10).forEach((article, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "flow-card";
    card.style.setProperty("--flow-color", PALETTE[index % PALETTE.length]);
    card.innerHTML = `
      <span class="flow-card__rank">${String(index + 1).padStart(2, "0")}</span>
      <span class="flow-card__title"></span>
      <span class="flow-card__views">${shortNumber(latest[article.article] || article.views || 0)}</span>
    `;
    card.querySelector(".flow-card__title").textContent = article.title || articleTitle(article.article);
    card.addEventListener("click", () => openArticle(article.article));
    els.flowCards.append(card);
  });
}

function getFlowCast() {
  const liveOverlap = state.globalTop.slice(0, 24).filter((article) => state.seriesCache.has(article.article));
  const fallback = [...state.seriesCache.entries()]
    .map(([article, series], index) => {
      const summary = state.summaryCache.get(article) || {};
      const last = series[series.length - 1]?.v || 0;
      const peak = Math.max(...series.map((point) => point.v));
      return {
        article,
        rank: index + 1,
        views: last,
        flowScore: peak + last,
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
  ];

  return blended.length >= 5 ? blended : fallback;
}

function renderFlowLabels(svg, layers, rows, cast, x, y, parse, width) {
  const minIndex = Math.max(1, Math.floor(rows.length * .14));
  const maxIndex = Math.max(minIndex + 1, Math.floor(rows.length * .84));
  const maxLabels = width > 900 ? 10 : 5;
  const placed = [];
  const candidates = layers.map((layer) => {
    let best = null;
    for (let i = minIndex; i <= maxIndex; i++) {
      const point = layer[i];
      const thickness = Math.abs(y(point[0]) - y(point[1]));
      if (!best || thickness > best.thickness) {
        best = {
          key: layer.key,
          x: x(parse(rows[i].t)),
          y: (y(point[0]) + y(point[1])) / 2,
          thickness
        };
      }
    }
    return best;
  }).filter(Boolean).sort((a, b) => b.thickness - a.thickness);

  const labels = [];
  for (const candidate of candidates) {
    if (labels.length >= maxLabels) break;
    const article = cast.find((item) => item.article === candidate.key);
    const title = article?.title || articleTitle(candidate.key);
    const fontSize = Math.max(11, Math.min(24, candidate.thickness * .42));
    const textWidth = Math.min(width * .34, title.length * fontSize * .55);
    const box = {
      x0: candidate.x - textWidth / 2 - 8,
      x1: candidate.x + textWidth / 2 + 8,
      y0: candidate.y - fontSize,
      y1: candidate.y + fontSize
    };
    const inBounds = box.x0 > 16 && box.x1 < width - 16 && box.y0 > 16;
    const collides = placed.some((other) => !(box.x1 < other.x0 || box.x0 > other.x1 || box.y1 < other.y0 || box.y0 > other.y1));
    if (!inBounds || collides) continue;
    placed.push(box);
    labels.push({ ...candidate, title, fontSize });
  }

  svg.append("g")
    .selectAll("text")
    .data(labels)
    .enter()
    .append("text")
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
    .text((d) => d.title);
}

function setHeroView(view) {
  state.heroView = view;
  const flow = view === "flow";
  els.mapMount.hidden = flow;
  els.flowMount.hidden = !flow;
  els.heroCopy.hidden = flow;
  els.flowCopy.hidden = !flow;
  els.flowCards.hidden = !flow;
  els.controls.hidden = flow;
  els.legend.hidden = flow;
  els.mapTab.classList.toggle("active", !flow);
  els.flowTab.classList.toggle("active", flow);
  els.mapTab.setAttribute("aria-selected", String(!flow));
  els.flowTab.setAttribute("aria-selected", String(flow));
  if (flow && !state.flowReady) renderFlow();
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
  const height = 72;
  const padPx = 3;
  const xs = d3.scaleLinear().domain([0, series.length - 1]).range([padPx, width - padPx]);
  const ys = d3.scaleLinear().domain([0, d3.max(series, (p) => p.v) || 1]).range([height - padPx, padPx + 6]);
  const line = d3.line().x((_p, i) => xs(i)).y((p) => ys(p.v)).curve(d3.curveMonotoneX);
  const area = d3.area().x((_p, i) => xs(i)).y0(height - padPx).y1((p) => ys(p.v)).curve(d3.curveMonotoneX);
  return { line: line(series), area: area(series) };
}

function trendCopy(series, views) {
  if (!series || series.length < 10) return { why: "This page has no local readership history yet.", trend: "-" };
  const values = series.map((p) => p.v);
  const base = values.slice(0, Math.max(5, values.length - 5)).sort((a, b) => a - b);
  const median = base[Math.floor(base.length / 2)] || 1;
  const max = Math.max(...values);
  const recent = Math.max(...values.slice(-4));
  const ratio = recent / Math.max(median, 1);
  if (views > max * 3 && views > 20000) {
    return { why: "Breaking now - today's readership is beyond anything in its 30-day history.", trend: "NEW" };
  }
  const r = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  if (ratio >= 4) return { why: `Surging - ${r}x its 30-day norm.`, trend: `${r}x` };
  if (ratio >= 2) return { why: `Climbing - ${r}x its 30-day norm.`, trend: `${r}x` };
  if (ratio >= 1.3) return { why: `Warming up - ${r}x its 30-day norm.`, trend: `${r}x` };
  return { why: "Steady - holding near its 30-day norm.", trend: `${r}x` };
}

async function openArticle(article) {
  const hit = state.currentList.find((a) => a.article === article) || state.globalTop.find((a) => a.article === article) || { article, views: 0, rank: "-" };
  const title = hit.title || articleTitle(article);

  els.panel.classList.add("open");
  els.panel.setAttribute("aria-hidden", "false");
  els.panelTitle.textContent = title;
  els.panelDesc.textContent = "Loading...";
  els.panelExtract.textContent = "";
  els.panelContext.textContent = state.selectedA2 ? state.selectedName.toUpperCase() : `GLOBAL - ${state.mode.toUpperCase()}`;
  els.panelViews.textContent = shortNumber(hit.views);
  els.panelRank.textContent = hit.rank ? `#${hit.rank}` : "-";
  els.panelTrend.textContent = "-";
  els.panelWhy.textContent = "Reading the pulse...";
  els.panelLetter.textContent = title.charAt(0).toUpperCase();
  els.panelLetter.hidden = false;
  setBackground(els.panelImage, "");
  els.spark.hidden = true;

  const [summary, series] = await Promise.all([fetchSummary(article), fetchSeries(article)]);
  const finalTitle = summary.title || title;
  els.panelTitle.textContent = finalTitle;
  els.panelDesc.textContent = summary.desc || "";
  els.panelKicker.textContent = `${categoryOf(summary.desc)} - Trending`;
  els.panelExtract.textContent = summary.extract || "Wikipedia has not published a summary for this article yet.";
  els.panelLink.href = summary.url || articleUrl(article);
  els.panelLetter.textContent = finalTitle.charAt(0).toUpperCase();
  setBackground(els.panelImage, summary.img || summary.thumb);
  els.panelLetter.hidden = !!(summary.img || summary.thumb);

  const trend = trendCopy(series, hit.views || 0);
  els.panelWhy.textContent = trend.why;
  els.panelTrend.textContent = trend.trend;
  if (series?.length >= 3) {
    const paths = sparkPaths(series);
    els.sparkArea.setAttribute("d", paths.area);
    els.sparkLine.setAttribute("d", paths.line);
    els.spark.hidden = false;
  }

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
  state.globalTop = snapshotGlobal.articles.map(normalizeTopArticle);
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
    showToast("Live Wikimedia data loaded.");
  }).catch(() => {});
}

boot().catch((error) => {
  console.error(error);
  bindEls();
  if (els.gridStatus) els.gridStatus.textContent = "App failed to start";
  showToast("WikiPulse could not start. Check the console for details.");
});
