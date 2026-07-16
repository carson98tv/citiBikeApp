"use strict";

const INFO_URL = "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_information.json";
const STATUS_URL = "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_status.json";
const INFO_TTL_MS = 24 * 60 * 60 * 1000;
const STATUS_REFRESH_MS = 60 * 1000;
const NEARBY_COUNT = 15;
const MATCH_COUNT = 20;
const RECENTS_MAX = 5;

const LS = {
  mapsApp: "csl.mapsApp",
  stations: "csl.stations",
  recents: "csl.recents",
  mode: "csl.mode", // "pickup" (walk there) | "dropoff" (ride there)
};

const $ = (id) => document.getElementById(id);

let stations = [];            // [{id, name, lat, lon, norm}]
let statusById = new Map();   // id -> {bikes, ebikes, docks, renting, returning}
let userPos = null;           // {lat, lon}
let statusFetchedAt = 0;

// ---------- storage helpers ----------

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* full/private mode */ }
}

// ---------- data loading ----------

async function loadStations() {
  const cached = lsGet(LS.stations);
  if (cached && Date.now() - cached.fetchedAt < INFO_TTL_MS && Array.isArray(cached.stations)) {
    stations = cached.stations;
    prepStations();
    return;
  }
  const res = await fetch(INFO_URL);
  const json = await res.json();
  stations = json.data.stations
    .map((s) => ({
      id: String(s.station_id),
      name: String(s.name),
      lat: Number(s.lat),
      lon: Number(s.lon),
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  lsSet(LS.stations, { fetchedAt: Date.now(), stations });
  prepStations();
}

function prepStations() {
  for (const s of stations) s.norm = normalize(s.name);
}

async function loadStatus() {
  const res = await fetch(STATUS_URL);
  const json = await res.json();
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  statusById = new Map(
    json.data.stations.map((s) => [
      String(s.station_id),
      {
        bikes: Math.max(0, num(s.num_bikes_available) - num(s.num_ebikes_available)),
        ebikes: num(s.num_ebikes_available),
        docks: num(s.num_docks_available),
        active: s.is_installed === 1 && (s.is_renting === 1 || s.is_returning === 1),
      },
    ])
  );
  statusFetchedAt = Date.now();
}

// ---------- search ----------

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Score: prefix of full name > prefix at a word boundary > substring anywhere.
function matchScore(station, qNorm, qTokensNorm) {
  const n = station.norm;
  if (!n) return 0;
  if (n.startsWith(qNorm)) return 100;
  // word-boundary start, e.g. "6av" matching "W 52 St & 6 Ave"
  const words = station.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (words.slice(i).join("").startsWith(qNorm)) return 80;
  }
  // all query tokens (split on spaces) appear in order as word prefixes: "w 52", "52 6"
  if (qTokensNorm.length > 1) {
    let wi = 0, ok = true;
    for (const t of qTokensNorm) {
      while (wi < words.length && !words[wi].startsWith(t)) wi++;
      if (wi === words.length) { ok = false; break; }
      wi++;
    }
    if (ok) return 65;
  }
  if (n.includes(qNorm)) return 50;
  return 0;
}

function searchStations(query) {
  const qNorm = normalize(query);
  if (!qNorm) return [];
  const qTokensNorm = query.toLowerCase().split(/\s+/).map(normalize).filter(Boolean);
  const scored = [];
  for (const s of stations) {
    const score = matchScore(s, qNorm, qTokensNorm);
    if (score > 0) scored.push([isActive(s) ? 1 : 0, score, s]);
  }
  // active stations first (offline ones aren't useful targets), then match quality
  scored.sort((a, b) => b[0] - a[0] || b[1] - a[1] || distanceOf(a[2]) - distanceOf(b[2]));
  return scored.slice(0, MATCH_COUNT).map((x) => x[2]);
}

// ---------- location ----------

function isActive(s) {
  const st = statusById.get(s.id);
  return !st || st.active; // unknown status → give benefit of the doubt
}

function distanceOf(s) {
  if (!userPos) return 0;
  return haversineMi(userPos.lat, userPos.lon, s.lat, s.lon);
}

function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function watchLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      render();
    },
    () => { /* denied — distances just won't show */ },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
  );
}

// ---------- navigation deep links ----------

function getMode() {
  return lsGet(LS.mode) === "pickup" ? "pickup" : "dropoff";
}

function navUrl(station) {
  const app = lsGet(LS.mapsApp) || "google";
  const walking = getMode() === "pickup"; // walk to grab a bike, ride to drop off
  const lat = Number(station.lat), lon = Number(station.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "#";
  if (app === "apple") {
    return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=${walking ? "w" : "c"}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=${walking ? "walking" : "bicycling"}`;
}

function recordRecent(id) {
  const recents = (lsGet(LS.recents) || []).filter((r) => r !== id);
  recents.unshift(id);
  lsSet(LS.recents, recents.slice(0, RECENTS_MAX));
}

// ---------- rendering ----------

function fmtDist(s) {
  if (!userPos) return "";
  const mi = distanceOf(s);
  return mi < 0.1 ? "right here" : `${mi.toFixed(1)} mi`;
}

function badgeClass(count) {
  if (count <= 0) return "bad";
  if (count <= 3) return "warn";
  return "good";
}

function stationRow(s) {
  const st = statusById.get(s.id);
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "station";
  a.href = navUrl(s);
  a.addEventListener("click", () => recordRecent(s.id));

  const top = document.createElement("div");
  top.className = "toprow";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = s.name;
  const dist = document.createElement("span");
  dist.className = "dist";
  dist.textContent = fmtDist(s);
  top.append(name, dist);

  const badges = document.createElement("div");
  badges.className = "badges";
  if (st && st.active) {
    const pickup = getMode() === "pickup";
    for (const [cls, text, key] of [
      [badgeClass(st.bikes), `🚲 ${st.bikes}`, pickup],
      [badgeClass(st.ebikes), `⚡ ${st.ebikes}`, pickup],
      [badgeClass(st.docks), `🅿 ${st.docks} docks`, !pickup],
    ]) {
      const span = document.createElement("span");
      span.className = key ? `${cls} key` : cls;
      span.textContent = text;
      badges.appendChild(span);
    }
  } else if (st) {
    badges.textContent = "station offline";
  } else {
    badges.textContent = "availability unknown";
  }

  a.append(top, badges);
  li.appendChild(a);
  return li;
}

function render() {
  const query = $("search").value.trim();
  const results = $("results");
  const label = $("listLabel");
  results.replaceChildren();

  let list;
  if (query) {
    list = searchStations(query);
    label.textContent = list.length ? "Matches" : "";
    if (!list.length) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = "No station matches — try fewer letters, e.g. “w52” or “bedford”.";
      results.appendChild(div);
    }
  } else {
    list = stations
      .filter(isActive)
      .sort((a, b) => distanceOf(a) - distanceOf(b))
      .slice(0, NEARBY_COUNT);
    label.textContent = userPos ? "Nearest stations" : "Stations";
  }
  for (const s of list) results.appendChild(stationRow(s));

  renderRecents(query);
  renderStatusLine();
}

function renderRecents(query) {
  const wrap = $("recents");
  const ids = lsGet(LS.recents) || [];
  if (query || !ids.length || !stations.length) {
    wrap.hidden = true;
    return;
  }
  const byId = new Map(stations.map((s) => [s.id, s]));
  const chips = $("recentChips");
  chips.replaceChildren();
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const a = document.createElement("a");
    a.className = "chip";
    a.href = navUrl(s);
    a.textContent = s.name;
    a.addEventListener("click", () => recordRecent(s.id));
    chips.appendChild(a);
  }
  wrap.hidden = chips.children.length === 0;
}

function renderStatusLine() {
  const el = $("statusLine");
  if (!statusFetchedAt) {
    el.textContent = "Loading live availability…";
    return;
  }
  const secs = Math.round((Date.now() - statusFetchedAt) / 1000);
  const ago = secs < 5 ? "just now" : secs < 90 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  const app = (lsGet(LS.mapsApp) || "google") === "apple" ? "Apple Maps" : "Google Maps";
  const trip = getMode() === "pickup" ? "walking directions" : "cycling directions";
  el.textContent = `Updated ${ago} · ${trip} via ${app}`;
}

// ---------- mode toggle ----------

function updateModeButtons() {
  const mode = getMode();
  for (const btn of document.querySelectorAll(".modebtn")) {
    btn.classList.toggle("selected", btn.dataset.mode === mode);
    btn.setAttribute("aria-checked", String(btn.dataset.mode === mode));
  }
}

function initModeToggle() {
  for (const btn of document.querySelectorAll(".modebtn")) {
    btn.addEventListener("click", () => {
      lsSet(LS.mode, btn.dataset.mode);
      updateModeButtons();
      render();
    });
  }
  updateModeButtons();
}

// ---------- settings modal ----------

function openModal() {
  const current = lsGet(LS.mapsApp);
  for (const input of document.querySelectorAll('input[name="mapsApp"]')) {
    input.checked = input.value === current;
  }
  $("modalDone").disabled = !current;
  $("modal").hidden = false;
}

function initModal() {
  for (const input of document.querySelectorAll('input[name="mapsApp"]')) {
    input.addEventListener("change", () => {
      lsSet(LS.mapsApp, input.value);
      $("modalDone").disabled = false;
    });
  }
  $("modalDone").addEventListener("click", () => {
    $("modal").hidden = true;
    render();
  });
  $("settingsBtn").addEventListener("click", openModal);
  if (!lsGet(LS.mapsApp)) openModal();
}

// ---------- boot ----------

async function refreshStatus() {
  try {
    await loadStatus();
  } catch { /* offline — keep stale data */ }
  render();
}

async function main() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works without */ });
  }
  initModal();
  initModeToggle();
  $("search").addEventListener("input", render);
  $("refreshBtn").addEventListener("click", refreshStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - statusFetchedAt > STATUS_REFRESH_MS) refreshStatus();
  });
  setInterval(() => {
    renderStatusLine();
    if (!document.hidden && Date.now() - statusFetchedAt > STATUS_REFRESH_MS) refreshStatus();
  }, 15000);

  const preset = new URLSearchParams(location.search).get("q");
  if (preset) $("search").value = preset;

  watchLocation();
  try {
    await loadStations();
  } catch {
    $("statusLine").textContent = "Couldn't load station list — check connection and refresh.";
    return;
  }
  render();
  refreshStatus();
}

main();
