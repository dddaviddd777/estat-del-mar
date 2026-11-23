// Capes del mapa a l'estil del Windy: l'alçada de l'onada pintada de colors sobre el mar (amb fletxes de cap on va)
// i el vent amb partícules animades. Les dades són una graella de punts d'Open-Meteo (onades: Marine; vent: AROME)
// que es descarrega només si s'encén alguna capa, i segueixen l'hora de la barra de temps.
import * as store from './store.js';
import { TZ, windName } from './marine.js';
import { loadCoast, coastInfo, inCoastArea, coastReady } from './coast.js';

// ---------- Graella ----------
// De Barcelona al golf del Lleó i fins a ~60 km mar endins (tot el que es veu amb el mapa sencer): 13 × 13 punts,
// cada 10-11 km (els models d'onades tenen cel·les d'uns 8 km).
const G = { lat0: 41.45, dLat: 0.1, ny: 13, lon0: 2.6, dLon: 0.125, nx: 13 };
const NP = G.ny * G.nx;
const GRID_V = 2;
const TTL = 60 * 60 * 1000;

let grid = null, loading = null, gridErr = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  return r.json();
}

/** Descarrega (o recupera de la memòria del mòbil) la graella d'onades i vent dels pròxims 4 dies. */
function loadGrid() {
  const c = store.get('grid', null);
  if (c && c.v === GRID_V && Date.now() - c.fetchedAt < TTL) grid = c;
  if (grid && Date.now() - grid.fetchedAt < TTL) return Promise.resolve(grid);
  if (!loading) {
    const lats = [], lons = [];
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { lats.push((G.lat0 + j * G.dLat).toFixed(3)); lons.push((G.lon0 + i * G.dLon).toFixed(3)); }
    const common = `latitude=${lats.join(',')}&longitude=${lons.join(',')}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=4`;
    loading = Promise.all([
      // Onades: els punts de terra agafen la cel·la de mar més propera (així el color arriba fins a la costa).
      getJson(`https://marine-api.open-meteo.com/v1/marine?${common}&cell_selection=sea&hourly=wave_height,wave_direction,wave_period`),
      getJson(`https://api.open-meteo.com/v1/forecast?${common}&cell_selection=nearest&wind_speed_unit=kmh&hourly=wind_speed_10m,wind_direction_10m`),
    ]).then(([m, w]) => {
      const ma = [].concat(m), wa = [].concat(w);
      const pack = (arr, key, f) => {
        const T = arr[0].hourly.time.length, out = new Array(T * NP);
        arr.forEach((p, k) => { const v = p.hourly[key]; for (let t = 0; t < T; t++) out[t * NP + k] = v[t] == null ? null : Math.round(v[t] * f); });
        return out;
      };
      grid = {
        v: GRID_V, fetchedAt: Date.now(),
        wTimes: ma[0].hourly.time, vTimes: wa[0].hourly.time,
        hs: pack(ma, 'wave_height', 100), hd: pack(ma, 'wave_direction', 1), tp: pack(ma, 'wave_period', 10),
        ws: pack(wa, 'wind_speed_10m', 1), wd: pack(wa, 'wind_direction_10m', 1),
        land: wa.map((p) => ((p.elevation ?? 0) > 2 ? 1 : 0)),
      };
      gridErr = null;
      store.set('grid', grid);
      return grid;
    }).catch((e) => { gridErr = e; throw e; }).finally(() => { loading = null; });
  }
  return loading;
}

/** Valors de la graella a una hora: onada (m, vector cap on va, període) i vent (km/h, vector cap on bufa). */
function frameAt(t) {
  if (!grid) return null;
  const near = (times) => { let k = times.findIndex((x) => x >= t); if (k < 0) k = times.length - 1; return k; };
  const kw = near(grid.wTimes), kv = near(grid.vTimes);
  const F = { hs: new Float32Array(NP), hx: new Float32Array(NP), hy: new Float32Array(NP), tp: new Float32Array(NP), ok: new Uint8Array(NP),
    ws: new Float32Array(NP), wx: new Float32Array(NP), wy: new Float32Array(NP), wok: new Uint8Array(NP) };
  for (let k = 0; k < NP; k++) {
    const hs = grid.hs[kw * NP + k], hd = grid.hd[kw * NP + k];
    if (hs != null && hd != null) {
      const a = (hd * Math.PI) / 180; // d'on ve → cap on va
      F.hs[k] = hs / 100; F.hx[k] = -Math.sin(a); F.hy[k] = -Math.cos(a); F.tp[k] = (grid.tp[kw * NP + k] ?? 0) / 10; F.ok[k] = 1;
    }
    const ws = grid.ws[kv * NP + k], wd = grid.wd[kv * NP + k];
    if (ws != null && wd != null) {
      const a = (wd * Math.PI) / 180;
      F.ws[k] = ws; F.wx[k] = -Math.sin(a) * ws; F.wy[k] = -Math.cos(a) * ws; F.wok[k] = 1;
    }
  }
  return F;
}

/** Interpolació bilineal d'un camp de la graella (sense comptar els punts sense dada). null fora de la graella. */
function bil(arr, ok, lat, lon) {
  const fy = (lat - G.lat0) / G.dLat, fx = (lon - G.lon0) / G.dLon;
  if (fy < 0 || fx < 0 || fy > G.ny - 1 || fx > G.nx - 1) return null;
  const j = Math.min(G.ny - 2, Math.floor(fy)), i = Math.min(G.nx - 2, Math.floor(fx));
  const ty = fy - j, tx = fx - i;
  const k00 = j * G.nx + i, k01 = k00 + 1, k10 = k00 + G.nx, k11 = k10 + 1;
  const w00 = ok[k00] * (1 - ty) * (1 - tx), w01 = ok[k01] * (1 - ty) * tx, w10 = ok[k10] * ty * (1 - tx), w11 = ok[k11] * ty * tx;
  const w = w00 + w01 + w10 + w11;
  if (w < 1e-6) return null;
  return (arr[k00] * w00 + arr[k01] * w01 + arr[k10] * w10 + arr[k11] * w11) / w;
}
const gridLand = (lat, lon) => {
  const j = Math.round((lat - G.lat0) / G.dLat), i = Math.round((lon - G.lon0) / G.dLon);
  if (j < 0 || i < 0 || j >= G.ny || i >= G.nx) return false;
  return !!grid.land[j * G.nx + i];
};

// ---------- Colors ----------
export const WAVE_STOPS = [[0, '#1f4e9c'], [0.25, '#2a7fc1'], [0.5, '#2fb0b8'], [0.8, '#4cbf74'], [1.2, '#c4d33f'], [1.6, '#f2b33d'], [2.2, '#ef6b3a'], [3, '#d63a5a'], [4, '#8e3aa8']];
export const WIND_STOPS = [[0, '#3b6fb6'], [10, '#24978a'], [20, '#bf9a1c'], [30, '#e0662f'], [40, '#c2275a'], [55, '#7a1f8a']];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbStops = (S) => S.map(([v, c]) => [v, hex(c)]);
const WAVE_RGB = rgbStops(WAVE_STOPS), WIND_RGB = rgbStops(WIND_STOPS);
function ramp(S, v) {
  if (v <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) if (v <= S[i][0]) {
    const [a, ca] = S[i - 1], [b, cb] = S[i], f = (v - a) / (b - a);
    return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
  }
  return S.at(-1)[1];
}
const gradient = (S, max) => `linear-gradient(90deg, ${S.map(([v, c]) => `${c} ${((v / max) * 100).toFixed(0)}%`).join(', ')})`;

// ---------- Capa ----------
let map = null, ctx = null, frame = null, curT = null;
const on = { waves: false, wind: false };
let waveCv = null, windCv = null, ui = null;

const CELL = 4; // px: resolució del color de l'onada i de la màscara de terra

/**
 * Quines caselles de la pantalla són mar: prop de la costa ho diu la línia de costa real (`coastInfo`); la resta
 * s'omple des de les caselles conegudes (mar amb mar, terra amb terra). Fora de la zona de la costa, la graella.
 */
function seaMask(cw, ch) {
  const n = cw * ch;
  const m = new Int8Array(n), lat = new Float64Array(n), lon = new Float64Array(n);
  const c = map.getCenter();
  const mpp = (40075016.7 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
  const r = Math.max(25, CELL * mpp * 1.6);
  const coastOk = coastReady();
  const queue = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    const ll = map.containerPointToLatLng([x * CELL + CELL / 2, y * CELL + CELL / 2]);
    lat[k] = ll.lat; lon[k] = ll.lng;
    if (!coastOk || !inCoastArea(ll.lat, ll.lng)) { m[k] = 2; continue; } // fora: es decideix amb la graella
    const ci = coastInfo(ll.lat, ll.lng, r);
    if (ci && isFinite(ci.dist)) { m[k] = ci.sea ? 1 : -1; queue.push(k); }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], x = k % cw, v = m[k];
    if (x > 0 && m[k - 1] === 0) { m[k - 1] = v; queue.push(k - 1); }
    if (x < cw - 1 && m[k + 1] === 0) { m[k + 1] = v; queue.push(k + 1); }
    if (k >= cw && m[k - cw] === 0) { m[k - cw] = v; queue.push(k - cw); }
    if (k + cw < n && m[k + cw] === 0) { m[k + cw] = v; queue.push(k + cw); }
  }
  for (let k = 0; k < n; k++) if (m[k] === 0 || m[k] === 2) m[k] = gridLand(lat[k], lon[k]) ? -1 : 1;
  return { m, lat, lon, cw, ch };
}

function placeCanvas(cv) {
  const s = map.getSize();
  L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
  return s;
}

/** Color de l'onada (només al mar) i una fletxa de cap on va cada ~70 px. */
function drawWaves() {
  if (!on.waves || !frame) { waveCv.hidden = true; return; }
  const s = placeCanvas(waveCv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  waveCv.width = Math.round(s.x * dpr); waveCv.height = Math.round(s.y * dpr);
  waveCv.style.width = `${s.x}px`; waveCv.style.height = `${s.y}px`;
  const g = waveCv.getContext('2d');
  const cw = Math.ceil(s.x / CELL), ch = Math.ceil(s.y / CELL);
  const M = seaMask(cw, ch);
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  const og = off.getContext('2d');
  const img = og.createImageData(cw, ch);
  const hsAt = new Float32Array(cw * ch).fill(NaN);
  for (let k = 0; k < cw * ch; k++) {
    if (M.m[k] !== 1) continue;
    const hs = bil(frame.hs, frame.ok, M.lat[k], M.lon[k]);
    if (hs == null) continue;
    hsAt[k] = hs;
    const c = ramp(WAVE_RGB, hs);
    img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = 150;
  }
  og.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(off, 0, 0, waveCv.width, waveCv.height);
  // Fletxes de direcció
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const STEP = 72;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let y = STEP / 2; y < s.y; y += STEP) for (let x = STEP / 2; x < s.x; x += STEP) {
    const k = Math.floor(y / CELL) * cw + Math.floor(x / CELL);
    if (!(hsAt[k] >= 0)) continue;
    // Que no caigui just a la vora de terra.
    const k2 = [k - 2, k + 2, k - 2 * cw, k + 2 * cw];
    if (k2.some((q) => q >= 0 && q < M.m.length && M.m[q] !== 1)) continue;
    const ux = bil(frame.hx, frame.ok, M.lat[k], M.lon[k]), uy = bil(frame.hy, frame.ok, M.lat[k], M.lon[k]);
    if (ux == null) continue;
    const a = Math.atan2(ux, uy); // 0 = cap al N
    const len = 9 + Math.min(9, hsAt[k] * 6);
    const dx = Math.sin(a), dy = -Math.cos(a);
    const x0 = x - (dx * len) / 2, y0 = y - (dy * len) / 2, x1 = x + (dx * len) / 2, y1 = y + (dy * len) / 2;
    const head = (sx) => { g.moveTo(x1 - dx * 5 + sx * -dy * 4, y1 - dy * 5 + sx * dx * 4); g.lineTo(x1, y1); };
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); head(1); g.moveTo(x1, y1); head(-1);
    g.strokeStyle = 'rgba(11,29,44,.45)'; g.lineWidth = 3.2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.5; g.stroke();
  }
  waveCv.hidden = false;
}

// ---------- Vent: partícules ----------
let particles = [], vfield = null, raf = 0, wdpr = 1;
const VSTEP = 8;        // px: resolució del camp de velocitats a la pantalla
const SPEED = 0.045;    // px per fotograma per cada km/h
const MAX_AGE = 90;

/** Camp de velocitats a la pantalla (px/fotograma) a partir de la graella, per moure les partícules de pressa. */
function buildVField() {
  const s = map.getSize();
  const cw = Math.ceil(s.x / VSTEP) + 1, ch = Math.ceil(s.y / VSTEP) + 1;
  const vx = new Float32Array(cw * ch), vy = new Float32Array(cw * ch), sp = new Float32Array(cw * ch), ok = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const ll = map.containerPointToLatLng([x * VSTEP, y * VSTEP]);
    const u = bil(frame.wx, frame.wok, ll.lat, ll.lng), v = bil(frame.wy, frame.wok, ll.lat, ll.lng);
    if (u == null || v == null) continue;
    const k = y * cw + x;
    vx[k] = u * SPEED; vy[k] = -v * SPEED; sp[k] = Math.hypot(u, v); ok[k] = 1;
  }
  vfield = { cw, ch, vx, vy, sp, ok, w: s.x, h: s.y };
}
function vAt(px, py) {
  const f = vfield, fx = px / VSTEP, fy = py / VSTEP;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= f.cw - 1 || j >= f.ch - 1) return null;
  const k = j * f.cw + i;
  if (!f.ok[k] || !f.ok[k + 1] || !f.ok[k + f.cw] || !f.ok[k + f.cw + 1]) return null;
  const tx = fx - i, ty = fy - j;
  const L2 = (a) => (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + f.cw] * (1 - tx) + a[k + f.cw + 1] * tx) * ty;
  return [L2(f.vx), L2(f.vy), L2(f.sp)];
}
const spawn = (p) => { p.x = Math.random() * vfield.w; p.y = Math.random() * vfield.h; p.age = Math.floor(Math.random() * MAX_AGE); return p; };

const BUCKETS = WIND_STOPS.map(([v]) => v);
const bucketOf = (sp) => { let b = 0; for (let i = 0; i < BUCKETS.length; i++) if (sp >= BUCKETS[i] - 5) b = i; return b; };
const BUCKET_COL = WIND_STOPS.map(([, c]) => c);

function startWind() {
  stopWind();
  if (!on.wind || !frame) { windCv.hidden = true; return; }
  const s = placeCanvas(windCv);
  wdpr = Math.min(2, window.devicePixelRatio || 1);
  windCv.width = Math.round(s.x * wdpr); windCv.height = Math.round(s.y * wdpr);
  windCv.style.width = `${s.x}px`; windCv.style.height = `${s.y}px`;
  buildVField();
  const n = Math.round(Math.min(1400, Math.max(250, (s.x * s.y) / 420)));
  particles = Array.from({ length: n }, () => spawn({}));
  windCv.hidden = false;
  const g = windCv.getContext('2d');
  g.setTransform(wdpr, 0, 0, wdpr, 0, 0);
  g.lineCap = 'round';
  const paths = BUCKET_COL.map(() => []);
  const step = () => {
    // Esvaeix el que hi havia: deixa una cua darrere de cada partícula.
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, 0, s.x, s.y);
    g.globalCompositeOperation = 'source-over';
    for (const a of paths) a.length = 0;
    for (const p of particles) {
      const v = p.age < MAX_AGE ? vAt(p.x, p.y) : null;
      if (!v) { spawn(p); p.age = 0; continue; }
      const nx = p.x + v[0], ny = p.y + v[1];
      paths[bucketOf(v[2])].push(p.x, p.y, nx, ny);
      p.x = nx; p.y = ny; p.age++;
    }
    // Sobre el color de l'onada, partícules blanques (com al Windy); sobre el mapa sol, del color de la força del vent.
    g.lineWidth = on.waves ? 1.4 : 1.7;
    paths.forEach((a, b) => {
      if (!a.length) return;
      g.strokeStyle = on.waves ? 'rgba(255,255,255,.92)' : BUCKET_COL[b];
      g.beginPath();
      for (let i = 0; i < a.length; i += 4) { g.moveTo(a[i], a[i + 1]); g.lineTo(a[i + 2], a[i + 3]); }
      g.stroke();
    });
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stopWind() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (windCv) windCv.getContext('2d').clearRect(0, 0, windCv.width, windCv.height);
}

// ---------- Lectura del punt (passant el ratolí o tocant el mapa) ----------
function readAt(ll) {
  if (!frame || (!on.waves && !on.wind)) { ui.read.hidden = true; return; }
  const parts = [];
  if (on.waves) {
    const hs = bil(frame.hs, frame.ok, ll.lat, ll.lng);
    if (hs != null) {
      const ux = bil(frame.hx, frame.ok, ll.lat, ll.lng), uy = bil(frame.hy, frame.ok, ll.lat, ll.lng);
      const from = ((Math.atan2(ux, uy) * 180) / Math.PI + 180 + 360) % 360;
      const tp = bil(frame.tp, frame.ok, ll.lat, ll.lng);
      parts.push(`<span><i style="background:rgb(${ramp(WAVE_RGB, hs).map(Math.round).join(',')})"></i>Onada <b>${nf1(hs)} m</b> del ${windName(from)}${tp ? ` · ${Math.round(tp)} s` : ''}</span>`);
    }
  }
  if (on.wind) {
    const u = bil(frame.wx, frame.wok, ll.lat, ll.lng), v = bil(frame.wy, frame.wok, ll.lat, ll.lng);
    if (u != null) {
      const sp = Math.hypot(u, v), from = ((Math.atan2(u, v) * 180) / Math.PI + 180 + 360) % 360;
      parts.push(`<span><i style="background:rgb(${ramp(WIND_RGB, sp).map(Math.round).join(',')})"></i>Vent <b>${Math.round(sp)} km/h</b> del ${windName(from)}</span>`);
    }
  }
  ui.read.innerHTML = parts.length ? parts.join('') : '<span>Fora de la zona de les capes</span>';
  ui.read.style.bottom = `${ui.legend.hidden ? 22 : 28 + ui.legend.offsetHeight}px`; // just a sobre de la llegenda
  ui.read.hidden = false;
}
const nf1 = (v) => v.toFixed(1).replace('.', ',');

// ---------- Llegenda (el botó és al panell del mapa, js/mappanel.js) ----------
function renderUi() {
  const lg = [];
  if (on.waves) lg.push(`<div><span>Onada</span><i style="background:${gradient(WAVE_STOPS, 4)}"></i><small><em>0</em><em>1</em><em>2</em><em>3</em><em>4 m</em></small></div>`);
  if (on.wind && !on.waves) lg.push(`<div><span>Vent</span><i style="background:${gradient(WIND_STOPS, 55)}"></i><small><em>0</em><em>20</em><em>40</em><em>55 km/h</em></small></div>`);
  const status = loading ? '<p>Carregant les capes…</p>' : gridErr && (on.waves || on.wind) ? `<p class="err">No s'han pogut carregar les capes (${gridErr.message}).</p>` : '';
  ui.legend.innerHTML = lg.join('') + status;
  ui.legend.hidden = !lg.length;
  if (!on.waves && !on.wind) ui.read.hidden = true;
}

async function refresh() {
  renderUi();
  if (!on.waves && !on.wind) { waveCv.hidden = true; stopWind(); windCv.hidden = true; return; }
  try {
    await Promise.all([loadGrid(), loadCoast().catch(() => null)]);
  } catch { renderUi(); return; }
  frame = frameAt(curT ?? ctx.time());
  renderUi();
  drawWaves();
  startWind();
}

/** Capes enceses ara mateix: { waves, wind }. */
export const layersOn = () => ({ ...on });
/** Encén o apaga una capa ('waves' o 'wind') i ho recorda. */
export function setLayer(k, v) {
  on[k] = v;
  store.set('mapLayers', { ...on });
  refresh();
}

/** Crea les capes i la llegenda. */
export function initLayers(m, c) {
  map = m; ctx = c;
  map.createPane('fieldPane').style.zIndex = 350; // sota la ruta (400) i les etiquetes (600)
  map.createPane('windPane').style.zIndex = 360;
  map.getPane('windPane').style.pointerEvents = 'none';
  map.getPane('fieldPane').style.pointerEvents = 'none';
  waveCv = L.DomUtil.create('canvas', 'fld-waves leaflet-zoom-hide', map.getPane('fieldPane'));
  windCv = L.DomUtil.create('canvas', 'fld-wind leaflet-zoom-hide', map.getPane('windPane'));
  waveCv.hidden = windCv.hidden = true;

  ui = {};
  ui.legend = L.DomUtil.create('div', 'fld-legend', map.getContainer());
  ui.read = L.DomUtil.create('div', 'fld-read', map.getContainer());
  ui.legend.hidden = ui.read.hidden = true;
  L.DomEvent.disableClickPropagation(ui.legend);

  map.on('zoomstart', () => { waveCv.hidden = true; stopWind(); windCv.hidden = true; });
  map.on('movestart', () => { stopWind(); });
  map.on('moveend resize', () => { if (on.waves) drawWaves(); if (on.wind) startWind(); });
  let pending = null;
  map.on('mousemove', (e) => { if (!pending) pending = requestAnimationFrame(() => { pending = null; readAt(e.latlng); }); });
  map.on('mouseout', () => { ui.read.hidden = true; });
  map.on('click', (e) => readAt(e.latlng));

  const saved = store.get('mapLayers', null);
  if (saved) { on.waves = !!saved.waves; on.wind = !!saved.wind; }
  refresh();
}

/** L'hora de la barra de temps ha canviat. */
export function setLayersTime(t) {
  curT = t;
  if (!grid || (!on.waves && !on.wind)) return;
  // Dades velles (l'app ha estat oberta més d'una hora): es tornen a baixar.
  if (Date.now() - grid.fetchedAt > TTL) { refresh(); return; }
  frame = frameAt(t);
  drawWaves();
  startWind();
}
