// Capes del mapa a l'estil del Windy. Dos grups, una capa de cada a la vegada:
//  · Colors: l'alçada de l'onada (només al mar, amb fletxes de cap on va), les ratxes de vent o la pluja.
//  · Moviment: partícules animades que segueixen el vent o els corrents (aquests, només al mar).
// Les dades són una graella de punts d'Open-Meteo (onades i corrents: Marine; vent, ratxes i pluja: AROME) que es
// descarrega només si s'encén alguna capa, i segueixen l'hora de la barra de temps.
import * as store from './store.js';
import { TZ, windName } from './marine.js';
import { loadCoast, coastInfo, inCoastArea, coastReady } from './coast.js';

// ---------- Graella ----------
// De Barcelona al golf del Lleó, de Girona fins a ~100 km mar endins: 19 × 13 punts, cada 10-11 km (els models d'onades tenen
// cel·les d'uns 8 km). És més ampla que alta perquè la costa sencera hi càpiga també a les pantalles apaïsades:
// el mapa no deixa allunyar-se més enllà d'aquesta zona (GRID_BOUNDS), i així les capes la cobreixen sempre tota.
const G = { lat0: 41.45, dLat: 0.1, ny: 13, lon0: 2.1, dLon: 0.125, nx: 19 };
const NP = G.ny * G.nx;
const GRID_V = 5;
export const GRID_BOUNDS = [[G.lat0, G.lon0], [G.lat0 + (G.ny - 1) * G.dLat, G.lon0 + (G.nx - 1) * G.dLon]];
const GRID_KEY = 'mar.grid'; // a part de la resta de dades (fa uns quants centenars de kB)
const TTL = 60 * 60 * 1000;

export const COLOR_LAYERS = ['waves', 'gusts', 'rain'];
export const MOTION_LAYERS = ['wind', 'currents'];

let grid = null, loading = null, gridErr = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  return r.json();
}

function savedGrid() {
  try { const c = JSON.parse(localStorage.getItem(GRID_KEY)); return c?.v === GRID_V ? c : null; } catch { return null; }
}

/** Descarrega (o recupera de la memòria del mòbil) la graella dels pròxims 4 dies. */
function loadGrid() {
  if (!grid) grid = savedGrid();
  if (grid && Date.now() - grid.fetchedAt < TTL) return Promise.resolve(grid);
  if (!loading) {
    const lats = [], lons = [];
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { lats.push((G.lat0 + j * G.dLat).toFixed(3)); lons.push((G.lon0 + i * G.dLon).toFixed(3)); }
    const common = `latitude=${lats.join(',')}&longitude=${lons.join(',')}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=4`;
    loading = Promise.all([
      // Onades i corrents: els punts de terra agafen la cel·la de mar més propera (així el color arriba fins a la costa).
      getJson(`https://marine-api.open-meteo.com/v1/marine?${common}&cell_selection=sea&hourly=wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction`),
      getJson(`https://api.open-meteo.com/v1/forecast?${common}&cell_selection=nearest&wind_speed_unit=kmh&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation`),
    ]).then(([m, w]) => {
      const ma = [].concat(m), wa = [].concat(w);
      const pack = (arr, key, f) => {
        const T = arr[0].hourly.time.length, out = new Array(T * NP);
        arr.forEach((p, k) => { const v = p.hourly[key] ?? []; for (let t = 0; t < T; t++) out[t * NP + k] = v[t] == null ? null : Math.round(v[t] * f); });
        return out;
      };
      grid = {
        v: GRID_V, fetchedAt: Date.now(),
        wTimes: ma[0].hourly.time, vTimes: wa[0].hourly.time,
        hs: pack(ma, 'wave_height', 100), hd: pack(ma, 'wave_direction', 1), tp: pack(ma, 'wave_period', 10),
        cs: pack(ma, 'ocean_current_velocity', 100), cd: pack(ma, 'ocean_current_direction', 1),
        ws: pack(wa, 'wind_speed_10m', 1), wd: pack(wa, 'wind_direction_10m', 1),
        gs: pack(wa, 'wind_gusts_10m', 1), pr: pack(wa, 'precipitation', 10),
        land: wa.map((p) => ((p.elevation ?? 0) > 2 ? 1 : 0)),
      };
      gridErr = null;
      try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch { /* sense espai: només en memòria */ }
      return grid;
    }).catch((e) => { gridErr = e; throw e; }).finally(() => { loading = null; });
  }
  return loading;
}

/**
 * Valors de la graella a una hora: onada (m, vector cap on va, període), corrent (km/h, vector cap on va),
 * vent (km/h, vector cap on bufa), ratxes (km/h) i pluja (mm en l'hora).
 */
function frameAt(t) {
  if (!grid) return null;
  const near = (times) => { let k = times.findIndex((x) => x >= t); if (k < 0) k = times.length - 1; return k; };
  const kw = near(grid.wTimes), kv = near(grid.vTimes);
  const f32 = () => new Float32Array(NP);
  const F = { hs: f32(), hx: f32(), hy: f32(), tp: f32(), ok: new Uint8Array(NP),
    cx: f32(), cy: f32(), cok: new Uint8Array(NP),
    ws: f32(), wx: f32(), wy: f32(), gs: f32(), pr: f32(), wok: new Uint8Array(NP) };
  for (let k = 0; k < NP; k++) {
    const iw = kw * NP + k, iv = kv * NP + k;
    const hs = grid.hs[iw], hd = grid.hd[iw];
    if (hs != null && hd != null) {
      const a = (hd * Math.PI) / 180; // d'on ve → cap on va
      F.hs[k] = hs / 100; F.hx[k] = -Math.sin(a); F.hy[k] = -Math.cos(a); F.tp[k] = (grid.tp[iw] ?? 0) / 10; F.ok[k] = 1;
    }
    const cs = grid.cs[iw], cd = grid.cd[iw];
    if (cs != null && cd != null) {
      const a = (cd * Math.PI) / 180; // els corrents ja diuen cap on van
      F.cx[k] = Math.sin(a) * cs / 100; F.cy[k] = Math.cos(a) * cs / 100; F.cok[k] = 1;
    }
    const ws = grid.ws[iv], wd = grid.wd[iv];
    if (ws != null && wd != null) {
      const a = (wd * Math.PI) / 180;
      F.ws[k] = ws; F.wx[k] = -Math.sin(a) * ws; F.wy[k] = -Math.cos(a) * ws; F.wok[k] = 1;
      F.gs[k] = grid.gs[iv] ?? ws; F.pr[k] = (grid.pr[iv] ?? 0) / 10;
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
export const GUST_STOPS = [[0, '#3b6fb6'], [15, '#24978a'], [30, '#9fb83a'], [40, '#e3b23c'], [50, '#e0662f'], [65, '#c2275a'], [80, '#7a1f8a']];
export const RAIN_STOPS = [[0.1, '#a8dcf7'], [0.5, '#5fb2ea'], [1, '#2f7fd6'], [2, '#3a4fc4'], [4, '#7a3ab8'], [8, '#c23a9a'], [16, '#e0475a']];
export const CUR_STOPS = [[0, '#b9a6e8'], [0.5, '#9b7be8'], [1, '#7a4fe0'], [1.5, '#5c2fc8'], [2.5, '#3e1a96']];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbStops = (S) => S.map(([v, c]) => [v, hex(c)]);
const WAVE_RGB = rgbStops(WAVE_STOPS), WIND_RGB = rgbStops(WIND_STOPS), GUST_RGB = rgbStops(GUST_STOPS), RAIN_RGB = rgbStops(RAIN_STOPS), CUR_RGB = rgbStops(CUR_STOPS);
function ramp(S, v) {
  if (v <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) if (v <= S[i][0]) {
    const [a, ca] = S[i - 1], [b, cb] = S[i], f = (v - a) / (b - a);
    return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
  }
  return S.at(-1)[1];
}
const rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;

/** Valor i color (rgb, alfa 0-255) de la capa de colors en un punt; null si no n'hi ha. */
function colorAt(kind, lat, lon) {
  if (kind === 'waves') {
    const v = bil(frame.hs, frame.ok, lat, lon);
    return v == null ? null : { v, c: ramp(WAVE_RGB, v), a: 150 };
  }
  if (kind === 'gusts') {
    const v = bil(frame.gs, frame.wok, lat, lon);
    return v == null ? null : { v, c: ramp(GUST_RGB, v), a: 125 };
  }
  const v = bil(frame.pr, frame.wok, lat, lon);
  if (v == null) return null;
  // Pluja: transparent si no plou; com més plou, més opac.
  return { v, c: ramp(RAIN_RGB, v), a: v < 0.1 ? 0 : Math.min(210, 90 + v * 30) };
}

// ---------- Capa ----------
let map = null, ctx = null, frame = null, curT = null;
const on = { color: null, motion: null };
let colorCv = null, motionCv = null, ui = null;
const any = () => !!(on.color || on.motion);

const CELL = 4; // px: resolució del color i de la màscara de terra

/**
 * Quines caselles de la pantalla (de `cell` px) són mar: prop de la costa ho diu la línia de costa real
 * (`coastInfo`); la resta s'omple des de les caselles conegudes (mar amb mar, terra amb terra). Fora de la zona de
 * la costa, la graella.
 */
function seaMask(cw, ch, cell = CELL) {
  const n = cw * ch;
  const m = new Int8Array(n), lat = new Float64Array(n), lon = new Float64Array(n);
  const c = map.getCenter();
  const mpp = (40075016.7 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
  const r = Math.max(25, cell * mpp * 1.6);
  const coastOk = coastReady();
  const queue = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    const ll = map.containerPointToLatLng([x * cell + cell / 2, y * cell + cell / 2]);
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

/** Capa de colors: onada (només al mar, amb una fletxa de cap on va cada ~70 px), ratxes o pluja (a tot arreu). */
function drawColor() {
  const kind = on.color;
  const s = map.getSize();
  if (!kind || !frame || s.x < 1 || s.y < 1) { colorCv.hidden = true; return; } // mapa sense mida (pantalla amagada)
  placeCanvas(colorCv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  colorCv.width = Math.round(s.x * dpr); colorCv.height = Math.round(s.y * dpr);
  colorCv.style.width = `${s.x}px`; colorCv.style.height = `${s.y}px`;
  const g = colorCv.getContext('2d');
  const cw = Math.ceil(s.x / CELL), ch = Math.ceil(s.y / CELL);
  const M = kind === 'waves' ? seaMask(cw, ch) : null;
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  const og = off.getContext('2d');
  const img = og.createImageData(cw, ch);
  const val = new Float32Array(cw * ch).fill(NaN);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    if (M && M.m[k] !== 1) continue;
    const ll = M ? { lat: M.lat[k], lng: M.lon[k] } : map.containerPointToLatLng([x * CELL + CELL / 2, y * CELL + CELL / 2]);
    const r = colorAt(kind, ll.lat, ll.lng);
    if (!r) continue;
    val[k] = r.v;
    img.data[k * 4] = r.c[0]; img.data[k * 4 + 1] = r.c[1]; img.data[k * 4 + 2] = r.c[2]; img.data[k * 4 + 3] = r.a;
  }
  og.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(off, 0, 0, colorCv.width, colorCv.height);
  colorCv.hidden = false;
  if (kind !== 'waves') return;
  // Fletxes de direcció de l'onada
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const STEP = 72;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let y = STEP / 2; y < s.y; y += STEP) for (let x = STEP / 2; x < s.x; x += STEP) {
    const k = Math.floor(y / CELL) * cw + Math.floor(x / CELL);
    if (!(val[k] >= 0)) continue;
    // Que no caigui just a la vora de terra.
    const k2 = [k - 2, k + 2, k - 2 * cw, k + 2 * cw];
    if (k2.some((q) => q >= 0 && q < M.m.length && M.m[q] !== 1)) continue;
    const ux = bil(frame.hx, frame.ok, M.lat[k], M.lon[k]), uy = bil(frame.hy, frame.ok, M.lat[k], M.lon[k]);
    if (ux == null) continue;
    const a = Math.atan2(ux, uy); // 0 = cap al N
    const len = 9 + Math.min(9, val[k] * 6);
    const dx = Math.sin(a), dy = -Math.cos(a);
    const x0 = x - (dx * len) / 2, y0 = y - (dy * len) / 2, x1 = x + (dx * len) / 2, y1 = y + (dy * len) / 2;
    const head = (sx) => { g.moveTo(x1 - dx * 5 + sx * -dy * 4, y1 - dy * 5 + sx * dx * 4); g.lineTo(x1, y1); };
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); head(1); g.moveTo(x1, y1); head(-1);
    g.strokeStyle = 'rgba(11,29,44,.45)'; g.lineWidth = 3.2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.5; g.stroke();
  }
}

// ---------- Moviment: partícules (vent o corrents) ----------
let particles = [], vfield = null, raf = 0, wdpr = 1;
const VSTEP = 8; // px: resolució del camp de velocitats a la pantalla
// Velocitat de les partícules (px per fotograma) per cada km/h. Els corrents van a 0,5-2 km/h: s'acceleren molt
// perquè es vegin, i no es poden comparar amb el vent.
const MOTION = {
  wind: { speed: 0.045, maxAge: 90, stops: WIND_STOPS, rgb: WIND_RGB, x: 'wx', y: 'wy', ok: 'wok', sea: false, over: 'rgba(255,255,255,.92)' },
  currents: { speed: 0.7, maxAge: 110, stops: CUR_STOPS, rgb: CUR_RGB, x: 'cx', y: 'cy', ok: 'cok', sea: true, over: 'rgba(236,224,255,.95)' },
};

/** Camp de velocitats a la pantalla (px/fotograma) a partir de la graella, per moure les partícules de pressa. */
function buildVField(M) {
  const s = map.getSize();
  const cw = Math.ceil(s.x / VSTEP) + 1, ch = Math.ceil(s.y / VSTEP) + 1;
  const vx = new Float32Array(cw * ch), vy = new Float32Array(cw * ch), sp = new Float32Array(cw * ch), ok = new Uint8Array(cw * ch);
  // Corrents: només al mar (amb una casella de marge, perquè les partícules no es fiquin terra endins).
  const sea = M.sea ? seaMask(cw, ch, VSTEP) : null;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    if (sea && sea.m[k] !== 1) continue;
    const ll = map.containerPointToLatLng([x * VSTEP, y * VSTEP]);
    const u = bil(frame[M.x], frame[M.ok], ll.lat, ll.lng), v = bil(frame[M.y], frame[M.ok], ll.lat, ll.lng);
    if (u == null || v == null) continue;
    vx[k] = u * M.speed; vy[k] = -v * M.speed; sp[k] = Math.hypot(u, v); ok[k] = 1;
  }
  // Llocs on es poden fer néixer partícules (al mar, si són corrents).
  const spots = [];
  for (let k = 0; k < cw * ch; k++) if (ok[k]) spots.push(k);
  vfield = { cw, ch, vx, vy, sp, ok, w: s.x, h: s.y, spots };
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
function spawn(p, maxAge) {
  const f = vfield;
  if (f.spots.length) {
    const k = f.spots[Math.floor(Math.random() * f.spots.length)];
    p.x = ((k % f.cw) + Math.random()) * VSTEP; p.y = (Math.floor(k / f.cw) + Math.random()) * VSTEP;
  } else { p.x = Math.random() * f.w; p.y = Math.random() * f.h; }
  p.age = Math.floor(Math.random() * maxAge);
  return p;
}

function startMotion() {
  stopMotion();
  const kind = on.motion;
  const s = map.getSize();
  if (!kind || !frame || s.x < 1 || s.y < 1) { motionCv.hidden = true; return; }
  const M = MOTION[kind];
  placeCanvas(motionCv);
  wdpr = Math.min(2, window.devicePixelRatio || 1);
  motionCv.width = Math.round(s.x * wdpr); motionCv.height = Math.round(s.y * wdpr);
  motionCv.style.width = `${s.x}px`; motionCv.style.height = `${s.y}px`;
  buildVField(M);
  if (!vfield.spots.length) { motionCv.hidden = true; return; }
  const area = (s.x * s.y * vfield.spots.length) / (vfield.cw * vfield.ch);
  const n = Math.round(Math.min(1400, Math.max(150, area / 420)));
  particles = Array.from({ length: n }, () => spawn({}, M.maxAge));
  motionCv.hidden = false;
  const g = motionCv.getContext('2d');
  g.setTransform(wdpr, 0, 0, wdpr, 0, 0);
  g.lineCap = 'round';
  const cuts = M.stops.map(([v]) => v), cols = M.stops.map(([, c]) => c);
  const bucketOf = (sp) => { let b = 0; for (let i = 0; i < cuts.length; i++) if (sp >= cuts[i] - (cuts[1] - cuts[0]) / 2) b = i; return b; };
  const paths = cols.map(() => []);
  const step = () => {
    // Esvaeix el que hi havia: deixa una cua darrere de cada partícula.
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, 0, s.x, s.y);
    g.globalCompositeOperation = 'source-over';
    for (const a of paths) a.length = 0;
    for (const p of particles) {
      const v = p.age < M.maxAge ? vAt(p.x, p.y) : null;
      if (!v) { spawn(p, M.maxAge); p.age = 0; continue; }
      const nx = p.x + v[0], ny = p.y + v[1];
      paths[bucketOf(v[2])].push(p.x, p.y, nx, ny);
      p.x = nx; p.y = ny; p.age++;
    }
    // Sobre una capa de colors, partícules clares (com al Windy); sobre el mapa sol, del color de la força.
    g.lineWidth = on.color ? 1.4 : 1.7;
    paths.forEach((a, b) => {
      if (!a.length) return;
      g.strokeStyle = on.color ? M.over : cols[b];
      g.beginPath();
      for (let i = 0; i < a.length; i += 4) { g.moveTo(a[i], a[i + 1]); g.lineTo(a[i + 2], a[i + 3]); }
      g.stroke();
    });
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stopMotion() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (motionCv) motionCv.getContext('2d').clearRect(0, 0, motionCv.width, motionCv.height);
}

// ---------- Lectura del punt (passant el ratolí o tocant el mapa) ----------
const nf1 = (v) => v.toFixed(1).replace('.', ',');
const fromDeg = (u, v) => ((Math.atan2(u, v) * 180) / Math.PI + 180 + 360) % 360; // d'on ve un vector cap on va
const toDeg = (u, v) => ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
const dot = (c) => `<i style="background:${rgb(c)}"></i>`;

function readAt(ll) {
  if (!frame || !any()) { ui.read.hidden = true; return; }
  const { lat, lng } = ll;
  const parts = [];
  if (on.color === 'waves') {
    const hs = bil(frame.hs, frame.ok, lat, lng);
    if (hs != null) {
      const from = fromDeg(bil(frame.hx, frame.ok, lat, lng), bil(frame.hy, frame.ok, lat, lng));
      const tp = bil(frame.tp, frame.ok, lat, lng);
      parts.push(`<span>${dot(ramp(WAVE_RGB, hs))}Onada <b>${nf1(hs)} m</b> del ${windName(from)}${tp ? ` · ${Math.round(tp)} s` : ''}</span>`);
    }
  } else if (on.color === 'gusts') {
    const gs = bil(frame.gs, frame.wok, lat, lng);
    if (gs != null) parts.push(`<span>${dot(ramp(GUST_RGB, gs))}Ratxes <b>${Math.round(gs)} km/h</b></span>`);
  } else if (on.color === 'rain') {
    const pr = bil(frame.pr, frame.wok, lat, lng);
    if (pr != null) parts.push(`<span>${pr < 0.1 ? '<i style="background:transparent;border:1px solid #9aa9b5"></i>No plou' : `${dot(ramp(RAIN_RGB, pr))}Pluja <b>${nf1(pr)} mm</b> en una hora`}</span>`);
  }
  if (on.motion === 'wind') {
    const u = bil(frame.wx, frame.wok, lat, lng), v = bil(frame.wy, frame.wok, lat, lng);
    if (u != null) {
      const sp = Math.hypot(u, v);
      parts.push(`<span>${dot(ramp(WIND_RGB, sp))}Vent <b>${Math.round(sp)} km/h</b> del ${windName(fromDeg(u, v))}</span>`);
    }
  } else if (on.motion === 'currents') {
    const u = bil(frame.cx, frame.cok, lat, lng), v = bil(frame.cy, frame.cok, lat, lng);
    if (u != null) {
      const sp = Math.hypot(u, v);
      parts.push(`<span>${dot(ramp(CUR_RGB, sp))}Corrent <b>${nf1(sp)} km/h</b> cap al ${windName(toDeg(u, v))}</span>`);
    }
  }
  ui.read.innerHTML = parts.length ? parts.join('') : '<span>Fora de la zona de les capes</span>';
  ui.read.style.bottom = `${ui.legend.hidden ? 22 : 28 + ui.legend.offsetHeight}px`; // just a sobre de la llegenda
  ui.read.hidden = false;
}

// ---------- Mira central (com al Windy) ----------
// L'usuari, 25/11/2026: "un marcador central al qual sempre estigui apuntant, que doni l'alçada de les onades i el vent
// en aquell punt; al mòbil arrossegues el mapa i el centre és el punt". Una creu fixa al centre del mapa i, a sota, una
// pastilla amb l'onada de mar obert i el vent d'aquell punt (de la mateixa graella que les capes, interpolada), que canvia
// mentre s'arrossega i segueix l'hora de la barra. Un toc a la pastilla obre la fitxa del punt. Es recorda (`centerRead`).
let center = store.get('centerRead', true);
export const centerOn = () => center;
export function setCenterRead(v) {
  center = !!v;
  store.set('centerRead', center);
  refresh();
}
// Lectura minimalista (proposta B, triada per l'usuari el 25/11/2026): a la dreta de la creu (la costa queda a l'esquerra),
// onada a dalt i vent a sota, només el número amb les unitats i una fletxeta cap on va. El detall, a la fitxa (un toc).
const ARROW = (to) => `<svg viewBox="0 0 12 12" style="transform:rotate(${Math.round(to) % 360}deg)" aria-hidden="true"><path d="M6 11V1.5M2.5 5 6 1.5 9.5 5"/></svg>`;
/** Mar o terra: amb la línia de costa real on n'hi ha; si no (o lluny de la costa), l'elevació de la graella. */
function isSea(lat, lon) {
  if (coastReady() && inCoastArea(lat, lon)) {
    const c = coastInfo(lat, lon, 3000);
    if (c && Number.isFinite(c.dist)) return c.sea;
  }
  return !gridLand(lat, lon);
}
function renderCenter() {
  if (!ui?.ctr) return;
  ui.cross.hidden = ui.ctr.hidden = !center;
  if (!center) return;
  const set = (html, label) => { ui.ctr.innerHTML = html; ui.ctr.setAttribute('aria-label', label); ui.ctr.title = label; };
  if (!frame) { set(`<span>${gridErr ? 'Sense dades' : '…'}</span>`, gridErr ? "No s'han pogut carregar les dades" : 'Carregant…'); return; }
  const { lat, lng } = map.getCenter();
  const hs = bil(frame.hs, frame.ok, lat, lng);
  const u = bil(frame.wx, frame.wok, lat, lng), v = bil(frame.wy, frame.wok, lat, lng);
  if (hs == null && u == null) { set('<span>Fora de zona</span>', 'Fora de la zona de la previsió'); return; }
  const rows = [], said = [];
  if (!isSea(lat, lng)) { rows.push('<span class="land">Terra</span>'); said.push('Terra'); }
  else if (hs != null) {
    const from = fromDeg(bil(frame.hx, frame.ok, lat, lng), bil(frame.hy, frame.ok, lat, lng));
    rows.push(`<span>${ARROW(from + 180)}${nf1(hs)} m</span>`);
    said.push(`Onada de ${nf1(hs)} m del ${windName(from)}`);
  }
  if (u != null) {
    const sp = Math.round(Math.hypot(u, v)), from = fromDeg(u, v);
    rows.push(`<span>${ARROW(from + 180)}${sp} km/h</span>`);
    said.push(`vent de ${sp} km/h del ${windName(from)}`);
  }
  set(rows.join(''), said.join(', ') + ' · toca per veure el detall');
}

// ---------- Avisos de les capes, a baix a l'esquerra (el botó és al panell del mapa, js/mappanel.js) ----------
// Sense escala de colors (l'usuari, 25/11/2026: «aquest termòmetre és irrellevant»; la lectura del punt ja dona el valor).
// Només surt mentre es carrega, si falla o amb els corrents (nota sobre la resolució del model).
function renderUi() {
  const lg = [];
  if (on.motion === 'currents') lg.push('<p>Corrents: model mar endins (~8 km). A tocar de la costa, més febles i canviants.</p>');
  const status = loading && any() ? '<p>Carregant les capes…</p>' : gridErr && any() ? `<p class="err">No s'han pogut carregar les capes (${gridErr.message}).</p>` : '';
  ui.legend.innerHTML = lg.join('') + status;
  ui.legend.hidden = !lg.length && !status;
  if (!any()) ui.read.hidden = true;
}

async function refresh() {
  renderUi();
  if (!any()) { colorCv.hidden = true; stopMotion(); motionCv.hidden = true; }
  // La graella cal per a les capes i per a la mira central.
  if (!any() && !center) { renderCenter(); return; }
  renderCenter();
  try {
    await Promise.all([loadGrid(), loadCoast().catch(() => null)]);
  } catch { renderUi(); renderCenter(); return; }
  frame = frameAt(curT ?? ctx.time());
  renderUi();
  drawColor();
  startMotion();
  renderCenter();
}

/** Capes enceses ara mateix: { waves, gusts, rain, wind, currents } (bool). */
export const layersOn = () => Object.fromEntries([...COLOR_LAYERS, ...MOTION_LAYERS].map((k) => [k, on.color === k || on.motion === k]));
/** Encén o apaga una capa. Dins de cada grup (colors, moviment), encendre'n una apaga l'altra. Es recorda. */
export function setLayer(k, v) {
  const grp = COLOR_LAYERS.includes(k) ? 'color' : MOTION_LAYERS.includes(k) ? 'motion' : null;
  if (!grp) return;
  if (v) on[grp] = k;
  else if (on[grp] === k) on[grp] = null;
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
  colorCv = L.DomUtil.create('canvas', 'fld-waves leaflet-zoom-hide', map.getPane('fieldPane'));
  motionCv = L.DomUtil.create('canvas', 'fld-wind leaflet-zoom-hide', map.getPane('windPane'));
  colorCv.hidden = motionCv.hidden = true;

  ui = {};
  ui.legend = L.DomUtil.create('div', 'fld-legend', map.getContainer());
  ui.read = L.DomUtil.create('div', 'fld-read', map.getContainer());
  ui.legend.hidden = ui.read.hidden = true;
  L.DomEvent.disableClickPropagation(ui.legend);

  map.on('zoomstart', () => { colorCv.hidden = true; stopMotion(); motionCv.hidden = true; });
  map.on('movestart', () => { stopMotion(); });
  map.on('moveend resize', () => { if (on.color) drawColor(); if (on.motion) startMotion(); });
  let pending = null;
  map.on('mousemove', (e) => { if (!pending) pending = requestAnimationFrame(() => { pending = null; readAt(e.latlng); }); });
  map.on('mouseout', () => { ui.read.hidden = true; });
  // Amb la mira encesa, al mòbil (sense ratolí) la lectura és la del centre: tocar el mapa no en treu una altra.
  map.on('click', (e) => { if (!(center && matchMedia('(pointer: coarse)').matches)) readAt(e.latlng); });

  ui.cross = L.DomUtil.create('div', 'ctr-cross', map.getContainer());
  ui.cross.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke-linecap="round"><path d="M16 3v8M16 21v8M3 16h8M21 16h8" stroke="#fff" stroke-width="4.5"/><path d="M16 3v8M16 21v8M3 16h8M21 16h8" stroke="#0b1d2c" stroke-width="2.2"/></g><circle cx="16" cy="16" r="2.6" fill="#0b1d2c" stroke="#fff" stroke-width="1.4"/></svg>';
  ui.ctr = L.DomUtil.create('button', 'ctr-read', map.getContainer());
  ui.ctr.type = 'button';
  L.DomEvent.disableClickPropagation(ui.ctr);
  L.DomEvent.disableScrollPropagation(ui.ctr);
  L.DomEvent.on(ui.ctr, 'click', () => { if (frame) ctx.consult?.(map.getCenter()); });
  let pendingC = null;
  map.on('move zoomend resize', () => { if (!pendingC) pendingC = requestAnimationFrame(() => { pendingC = null; renderCenter(); }); });

  // Abans la graella es desava amb la resta de dades: ara va a part.
  if (store.get('grid', null)) store.set('grid', undefined);
  const saved = store.get('mapLayers', null);
  if (saved) {
    if ('color' in saved || 'motion' in saved) {
      on.color = COLOR_LAYERS.includes(saved.color) ? saved.color : null;
      on.motion = MOTION_LAYERS.includes(saved.motion) ? saved.motion : null;
    } else { on.color = saved.waves ? 'waves' : null; on.motion = saved.wind ? 'wind' : null; } // format antic
  }
  refresh();
}

/** L'hora de la barra de temps ha canviat. */
export function setLayersTime(t) {
  curT = t;
  if (!grid || (!any() && !center)) return;
  // Dades velles (l'app ha estat oberta més d'una hora): es tornen a baixar.
  if (Date.now() - grid.fetchedAt > TTL) { refresh(); return; }
  frame = frameAt(t);
  drawColor();
  startMotion();
  renderCenter();
}
