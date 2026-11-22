// Rutes de nedada: el recorregut es talla en trams de 250 m, es calcula a quina hora s'hi passarà segons el ritme
// i, per a cada tram i la seva hora, com estarà el mar (amb la línia de costa real: caps, cales, illes) i
// quant costarà nedar-hi (vent i corrent a favor o en contra).
import { analyze, fetchPlaces, localParts, nearBeach, swimWindow, windName } from './marine.js';
import { loadCoast, shelterAt, coastInfo, sectorText, inCoastArea } from './coast.js';
import * as store from './store.js';

export const SAMPLE_M = 250;     // m entre mostres
const WEATHER_EVERY = 3;         // una consulta de previsió cada 3 mostres (~750 m): els models no donen més detall
const DATA_TTL = 60 * 60 * 1000;
export const DEFAULT_PACE = 120; // s per 100 m (2:00 /100 m = 3 km/h)
// Corrent de superfície a prop de costa (estimació a calibrar): la meitat del corrent del model, que és de mar
// endins (cel·les de ~8 km), més un 2 % del vent local, que arrossega l'aigua de la superfície.
const CUR_MODEL = 0.5, CUR_WIND = 0.02;

const rad = (d) => (d * Math.PI) / 180;
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
export function distM(a, b) {
  const dy = (b[0] - a[0]) * 111320, dx = (b[1] - a[1]) * 111320 * Math.cos(rad((a[0] + b[0]) / 2));
  return Math.hypot(dx, dy);
}
export function bearing(a, b) {
  const dy = b[0] - a[0], dx = (b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + distM(pts[i - 1], p) : 0), 0);
/** Un recorregut que acaba a menys de 300 m d'on comença és un circuit: no cal tornar pel mateix camí. */
export const isLoop = (pts) => pts.length > 2 && distM(pts[0], pts.at(-1)) < 300;

// ---------- Ruta desada ----------
// { pts: [[lat, lon], ...], back: anada i tornada pel mateix camí, reverse: fer-la al revés, pace: s/100 m, start: hora (s) }
export const getRoute = () => store.get('route', null);
export function saveRoute(r) { store.set('route', r); }
export function deleteRoute() { store.set('route', undefined); store.set('routeData', undefined); }

// ---------- Geometria ----------
let geoCache = null;
/** Mostres cada 250 m sobre el recorregut dibuixat, amb la costa que veu cadascuna. */
export async function routeGeometry(pts) {
  const key = JSON.stringify(pts);
  if (geoCache?.key === key && !geoCache.noCoast) return geoCache;
  // Sense la línia de costa (no s'ha pogut carregar) la ruta es calcula igualment, com a mar obert.
  let noCoast = false;
  try { await loadCoast(); } catch { noCoast = true; }
  const pos = [];
  const total = pathLength(pts);
  const n = Math.max(1, Math.round(total / SAMPLE_M));
  const step = total / n;
  let seg = 0, segStart = 0;
  for (let i = 0; i <= n; i++) {
    const d = i * step;
    while (seg < pts.length - 2 && segStart + distM(pts[seg], pts[seg + 1]) < d) { segStart += distM(pts[seg], pts[seg + 1]); seg++; }
    const L = distM(pts[seg], pts[seg + 1]) || 1;
    const f = Math.max(0, Math.min(1, (d - segStart) / L));
    const p = [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f];
    pos.push({ lat: p[0], lon: p[1], d });
  }
  for (const p of pos) {
    p.sh = shelterAt(p.lat, p.lon);
    p.ci = coastInfo(p.lat, p.lon);
    p.land = p.ci ? !p.ci.sea && p.ci.dist > 15 : false; // 15 m de marge: el dibuix i la costa d'OSM no són exactes
    p.sector = sectorText(p.sh);
    p.near = nearBeach(p.lat, p.lon, 1.2)?.short ?? null;
  }
  // A tocar de la roca (menys de 25 m) o damunt de terra (dibuix poc precís), els raigs donen coses estranyes:
  // aquestes mostres agafen l'abric de la mostra bona més propera.
  const bad = (p) => !p.sh || p.land || (p.ci && p.ci.dist < 25);
  const good = pos.map((p) => !bad(p));
  pos.forEach((p, i) => {
    if (good[i]) return;
    for (let k = 1; k < pos.length; k++) {
      const q = good[i - k] ? pos[i - k] : good[i + k] ? pos[i + k] : null;
      if (q) { p.sh = q.sh; p.sector = q.sector; p.borrowed = true; break; }
    }
  });
  // Punts on es demana la previsió: un de cada 3 mostres, i l'últim.
  const wIdx = pos.map((_, i) => i).filter((i) => i % WEATHER_EVERY === 0);
  if (wIdx.at(-1) !== pos.length - 1) wIdx.push(pos.length - 1);
  const wOf = pos.map((_, i) => wIdx.reduce((best, w, j) => (Math.abs(w - i) < Math.abs(wIdx[best] - i) ? j : best), 0));
  const wlocs = wIdx.map((i) => [pos[i].lat, pos[i].lon]);
  geoCache = { key, pts, pos, wOf, wlocs, wkey: wlocs.map(([a, b]) => `${a.toFixed(4)},${b.toFixed(4)}`).join(';'), length: total,
    outside: pos.some((p) => !inCoastArea(p.lat, p.lon)), onLand: pos.filter((p) => p.land).length, noCoast };
  return geoCache;
}

// ---------- Previsió ----------
export function cachedRouteData(geo) {
  const c = store.get('routeData', null);
  return c && c.key === geo.wkey ? c : null;
}
export async function fetchRouteData(geo, { force = false } = {}) {
  const c = cachedRouteData(geo);
  if (!force && c && Date.now() - c.fetchedAt < DATA_TTL) return c;
  const { times, places } = await fetchPlaces(geo.wlocs.map((p) => p[0]), geo.wlocs.map((p) => p[1]));
  const d = { key: geo.wkey, fetchedAt: Date.now(), times, places };
  store.set('routeData', d);
  return d;
}

// ---------- Càlcul ----------
/** Ordre en què es passa per les mostres: anada (i tornada pel mateix camí), o al revés. */
function sequence(geo, { back, reverse }) {
  const ids = geo.pos.map((_, i) => i);
  const go = back ? ids : reverse ? ids.slice().reverse() : ids;
  const seq = go.map((i) => ({ pos: i, leg: 'anada' }));
  if (back) for (let i = ids.length - 2; i >= 0; i--) seq.push({ pos: i, leg: 'tornada' });
  let d = 0;
  seq.forEach((s, k) => {
    if (k) d += distM(pt(geo, seq[k - 1].pos), pt(geo, s.pos));
    s.d = d;
    const a = pt(geo, s.pos), b = pt(geo, (seq[k + 1] ?? seq[k - 1]).pos);
    s.heading = seq[k + 1] ? bearing(a, b) : bearing(b, a);
  });
  return seq;
}
const pt = (geo, i) => [geo.pos[i].lat, geo.pos[i].lon];

const hourIdx = (times, t) => Math.max(0, Math.min(times.length - 1, Math.round((t - times[0]) / 3600)));

/** Recorre la ruta des de l'hora de sortida: a cada mostra, el mar d'aquella hora i quant costa nedar. */
export function runRoute(geo, data, { start, pace = DEFAULT_PACE, back = true, reverse = false }) {
  const seq = sequence(geo, { back, reverse });
  const v0 = 360 / pace; // km/h
  let t = start;
  const out = [];
  let beyond = false;
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i], p = geo.pos[s.pos];
    const k = hourIdx(data.times, t);
    if (t > data.times.at(-1) + 1800) beyond = true;
    const h = data.places[geo.wOf[s.pos]].hours[k];
    // L'orientació surt de la costa real; si no n'hi ha (fora de la zona), es calcula com a mar obert.
    const b = { facing: p.sh?.facing ?? null, open: 90, shelter: p.sh };
    const a = analyze(b, h);
    const windAlong = h.wind == null ? 0 : h.wind * Math.cos(rad((h.windDir + 180) - s.heading)); // + = d'esquena
    const curModel = h.cur ? h.cur[0] * Math.cos(rad(h.cur[1] - s.heading)) : 0;
    const curAlong = CUR_MODEL * curModel + CUR_WIND * windAlong; // km/h, + = a favor
    const vg = Math.max(0.4 * v0, v0 + curAlong);
    const windRel = h.windDir == null ? null : angDiff(h.windDir, s.heading) <= 45 ? 'cara' : angDiff(h.windDir, s.heading) >= 135 ? 'esquena' : 'costat';
    const ratio = curAlong / v0;
    let effort = 'neutre';
    if (ratio >= 0.06 || windAlong >= 15) effort = 'favor';
    if (ratio <= -0.06 || windAlong <= -15) effort = 'contra';
    out.push({ ...s, lat: p.lat, lon: p.lon, t, h, a, windAlong, curAlong, curModel, vg, windRel, effort, ratio,
      sector: p.sector, span: p.sh?.span ?? null, near: p.near, land: p.land, facing: b.facing });
    if (i < seq.length - 1) t += ((seq[i + 1].d - s.d) / 1000 / vg) * 3600;
  }
  return summarize(out, { start, v0, back, beyond });
}

function summarize(S, { start, v0, back, beyond }) {
  const last = S.at(-1);
  const worst = S.reduce((w, s) => (s.a.score < w.a.score ? s : w), S[0]);
  const mean = S.reduce((acc, s) => acc + s.a.score, 0) / S.length;
  const leg = (name) => {
    const L = S.filter((s) => s.leg === name);
    if (!L.length) return null;
    const avg = (f) => L.reduce((acc, s) => acc + f(s), 0) / L.length;
    return { n: L.length, from: L[0].t, to: L.at(-1).t, cur: avg((s) => s.curAlong), wind: avg((s) => s.windAlong),
      head: Math.min(...L.map((s) => s.windAlong)), worst: L.reduce((w, s) => (s.a.score < w.a.score ? s : w), L[0]), mean: avg((s) => s.a.score) };
  };
  return {
    samples: S, start, end: last.t, duration: last.t - start, length: last.d,
    plain: (last.d / 1000 / v0) * 3600, // durada sense vent ni corrent
    worst, mean, level: worst.a.level, beyond, back,
    out: leg('anada'), ret: back ? leg('tornada') : null,
    trams: trams(S),
  };
}

/** Trams per a la llista: uns 12 com a molt, cadascun amb la seva pitjor mostra. */
function trams(S) {
  const per = Math.max(2, Math.ceil(S.length / 12));
  const out = [];
  for (let i = 0; i < S.length - 1; i += per) {
    const G = S.slice(i, Math.min(S.length, i + per + 1));
    const worst = G.reduce((w, s) => (s.a.score < w.a.score ? s : w), G[0]);
    const mid = G[Math.floor(G.length / 2)];
    const avg = (f) => G.reduce((acc, s) => acc + f(s), 0) / G.length;
    const ratio = avg((s) => s.ratio), wind = avg((s) => s.windAlong);
    out.push({ from: G[0], to: G.at(-1), worst, mid, leg: G[0].leg,
      hs: Math.max(...G.map((s) => s.a.beachHs ?? 0)),
      effort: ratio <= -0.06 || wind <= -15 ? 'contra' : ratio >= 0.06 || wind >= 15 ? 'favor' : 'neutre',
      cur: avg((s) => s.curAlong), windAlong: wind, cape: G.some((s) => s.span >= 220), land: G.some((s) => s.land) });
  }
  return out;
}

/** Nom del lloc d'una mostra: la platja a prop o el km del recorregut. */
export const placeName = (s) => s.near ?? `km ${(s.d / 1000).toFixed(1).replace('.', ',')}`;
export const headingName = (deg) => `cap al ${windName(deg)}`;

// ---------- Millor hora i sentit ----------
/**
 * Prova de sortir cada 30 min dins la franja de bany del dia triat (i, si la ruta no és d'anada i tornada,
 * també en sentit contrari) i tria la que té el pitjor tram més bo; a igualtat, més nota i menys esforç.
 */
export function recommend(geo, data, route) {
  const day = localParts(route.start).day;
  const sw = swimWindow();
  const now = Date.now() / 1000;
  const base = data.times.filter((t) => localParts(t).day === day && localParts(t).hour >= sw.from && localParts(t).hour < sw.to);
  const starts = base.flatMap((t) => [t, t + 1800]).filter((t) => t >= now - 600);
  const dirs = route.back ? [false] : [false, true];
  const rank = (r) => r.worst.a.level * 100 - (0.6 * r.worst.a.score + 0.4 * r.mean) + (r.duration / r.plain - 1) * 4;
  let best = null;
  for (const start of starts) for (const reverse of dirs) {
    const r = runRoute(geo, data, { ...route, start, reverse });
    if (!best || rank(r) < rank(best.r) - 0.05) best = { start, reverse, r };
  }
  if (!best) return null;
  const cur = runRoute(geo, data, route);
  const same = best.start === route.start && best.reverse === !!route.reverse;
  // Només ho recomanem si és clarament millor que el que hi ha triat.
  const better = !same && rank(best.r) < rank(cur) - 0.3;
  return { ...best, cur, better, window: sw };
}
