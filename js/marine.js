// Dades del mar per a nedadors: onades (Open-Meteo Marine) + vent (Open-Meteo, AROME)
// i un índex de nedada corregit segons cap on mira cada platja.
import * as store from './store.js';

/**
 * Platges. `facing`: direcció (graus) cap on mira la platja, és a dir, d'on li pot arribar el mar.
 * `open`: mitja obertura del sector de mar obert (graus). Valors aproximats, a calibrar.
 * `sea`: punt on es dibuixa al mapa, uns 150 m mar endins.
 */
export const BEACHES = [
  // Cap de Creus i Cap Norfeu: punts de bany de l'usuari (22/11/2026), en mar obert prop del cap; el cap els tapa de l'oest i del nord.
  { id: 'capcreus', name: 'Cap de Creus', short: 'Cap de Creus', town: 'Cadaqués', lat: 42.315, lon: 3.321, facing: 130, open: 100, sea: [42.315, 3.321] },
  { id: 'norfeu', name: 'Cap Norfeu', short: 'Cap Norfeu', town: 'Roses', lat: 42.236, lon: 3.249, facing: 170, open: 90, sea: [42.236, 3.249] },
  { id: 'montgo', name: 'Cala Montgó', short: 'Montgó', town: "L'Escala", lat: 42.1074, lon: 3.1685, facing: 100, open: 30, sea: [42.1071, 3.1706] },
  { id: 'estartit', name: "L'Estartit", short: "L'Estartit", town: 'Torroella de Montgrí', lat: 42.0558, lon: 3.2143, facing: 95, open: 75, sea: [42.0558, 3.2143] },
  { id: 'sariera', name: 'Sa Riera', short: 'Sa Riera', town: 'Begur', lat: 41.973, lon: 3.2109, facing: 35, open: 50, sea: [41.9739, 3.2123] },
  { id: 'satuna', name: 'Sa Tuna', short: 'Sa Tuna', town: 'Begur', lat: 41.9588, lon: 3.2324, facing: 55, open: 40, sea: [41.9614, 3.2318] },
  { id: 'aiguablava', name: 'Aiguablava', short: 'Aiguablava', town: 'Begur', lat: 41.9341, lon: 3.2161, facing: 15, open: 30, sea: [41.9351, 3.2165] },
  { id: 'tamariu', name: 'Tamariu', short: 'Tamariu', town: 'Palafrugell', lat: 41.917, lon: 3.209, facing: 120, open: 50, sea: [41.917, 3.209] },
  { id: 'llafranc', name: 'Llafranc', short: 'Llafranc', town: 'Palafrugell', lat: 41.8935, lon: 3.1936, facing: 165, open: 45, sea: [41.8927, 3.1953] },
  { id: 'calella', name: 'Calella de Palafrugell', short: 'Calella', town: 'Palafrugell', lat: 41.887, lon: 3.183, facing: 125, open: 50, sea: [41.887, 3.1835] },
  { id: 'fosca', name: 'La Fosca', short: 'La Fosca', town: 'Palamós', lat: 41.857, lon: 3.1428, facing: 125, open: 45, sea: [41.8574, 3.1445] },
  { id: 'palamos', name: 'Platja Gran', short: 'Palamós', town: 'Palamós', lat: 41.8475, lon: 3.1251, facing: 200, open: 50, sea: [41.8475, 3.1211] },
  { id: 'santantoni', name: 'Sant Antoni de Calonge', short: 'Sant Antoni', town: 'Calonge', lat: 41.8355, lon: 3.0957, facing: 115, open: 80, sea: [41.8355, 3.0957] },
  { id: 'santfeliu', name: 'Sant Feliu de Guíxols', short: 'Sant Feliu', town: 'Sant Feliu de Guíxols', lat: 41.7792, lon: 3.0292, facing: 150, open: 45, sea: [41.7792, 3.0317] },
  { id: 'tossa', name: 'Platja Gran de Tossa', short: 'Tossa', town: 'Tossa de Mar', lat: 41.7185, lon: 2.9325, facing: 120, open: 50, sea: [41.7187, 2.9356] },
  { id: 'lloret', name: 'Platja de Lloret', short: 'Lloret', town: 'Lloret de Mar', lat: 41.6975, lon: 2.8455, facing: 155, open: 55, sea: [41.6974, 2.8501] },
];

/** Punt del mapa: uns 150 m mar endins davant de la platja (`sea`, revisat sobre el mapa). */
export function seaPoint(b) {
  if (b.sea) return b.sea;
  const f = (b.facing * Math.PI) / 180;
  return [b.lat + (150 * Math.cos(f)) / 111320, b.lon + (150 * Math.sin(f)) / (111320 * Math.cos((b.lat * Math.PI) / 180))];
}

export const TZ = 'Europe/Madrid';

/** Distància aproximada (km) entre dos punts. */
export function distKm(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111.32, dx = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Platja més propera a un punt, si n'és a menys de `maxKm`. */
export function nearBeach(lat, lon, maxKm = 1.5) {
  let best = null;
  for (const b of BEACHES) {
    const d = distKm(lat, lon, b.lat, b.lon);
    if (d <= maxKm && (!best || d < best.d)) best = { b, d };
  }
  return best?.b ?? null;
}

/** Nom curt d'una direcció en graus (N, NE, E…). */
export function windName(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}
const TTL = 60 * 60 * 1000; // els models d'onades s'actualitzen poques vegades al dia: n'hi ha prou amb 1 h

const MARINE = ['wave_height', 'wave_direction', 'wave_period', 'wind_wave_height', 'wind_wave_direction',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period', 'sea_surface_temperature',
  // Període de pic (el que més s'assembla al que mesura una boia) i segon mar de fons (per detectar mar creuada).
  'wind_wave_period', 'wind_wave_peak_period', 'swell_wave_peak_period',
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period'];
// Pressió, CAPE (energia per a tempestes) i pluja: per als avisos de temps (weatherAlerts).
const WIND = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code', 'temperature_2m', 'pressure_msl', 'cape', 'precipitation'];

/**
 * Altres models d'onades, per contrastar-los amb el principal (best_match, ~Météo-France).
 * ECMWF WAM és el que el Windy ensenya per defecte a la capa d'onades.
 */
export const WAVE_MODELS = [
  { id: 'ecmwf', api: 'ecmwf_wam', name: 'ECMWF', note: 'mapa del Windy' },
  { id: 'gfs', api: 'ncep_gfswave025', name: 'GFS Wave', note: 'EUA · també al Windy' },
  { id: 'dwd', api: 'dwd_ewam', name: 'DWD EWAM', note: 'Alemanya · més fi' },
];
const DATA_VERSION = 6; // apujar-ho si canvia el format de les dades desades

// ---------- Descàrrega ----------
export function cachedMarine() {
  const c = store.get('marine', null);
  // Si la llista de platges o el format han canviat, les dades desades no serveixen.
  return c && c.v === DATA_VERSION && BEACHES.every((b) => c.beaches?.[b.id]) ? c : null;
}

/** Les tres crides (onades, vent, altres models) per a una llista de punts. Les rutes demanen també els corrents. */
async function download(lats, lons, { models = true, currents = false } = {}) {
  const common = `latitude=${lats.join(',')}&longitude=${lons.join(',')}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=4&cell_selection=sea`;
  const [m, w, x, c] = await Promise.all([
    getJson(`https://marine-api.open-meteo.com/v1/marine?${common}&hourly=${MARINE.join(',')}`),
    getJson(`https://api.open-meteo.com/v1/forecast?${common}&wind_speed_unit=kmh&hourly=${WIND.join(',')}`),
    // El contrast de models és opcional: si falla, l'app funciona igual.
    models ? getJson(`https://marine-api.open-meteo.com/v1/marine?${common}&hourly=wave_height,wave_direction&models=${WAVE_MODELS.map((o) => o.api).join(',')}`).catch(() => null) : null,
    // Corrents (Mercator SMOC, cel·les de ~8 km): direcció cap on va el corrent, velocitat en km/h. També opcional.
    currents ? getJson(`https://marine-api.open-meteo.com/v1/marine?${common}&hourly=ocean_current_velocity,ocean_current_direction`).catch(() => null) : null,
  ]);
  return { ma: [].concat(m), wa: [].concat(w), xa: x ? [].concat(x) : null, ca: c ? [].concat(c) : null };
}

/**
 * Previsió per a molts punts alhora (rutes de nedada): les mateixes hores que una platja, més el corrent
 * del model (`cur`: [km/h, graus cap on va]) i a quina distància queda la cel·la del model de corrents.
 */
export async function fetchPlaces(lats, lons) {
  const { ma, wa, ca } = await download(lats.map((v) => v.toFixed(4)), lons.map((v) => v.toFixed(4)), { models: false, currents: true });
  return {
    times: ma[0].hourly.time,
    places: ma.map((M, i) => ({
      hours: toHours(M.hourly, wa[i].hourly, null, ca?.[i]?.hourly),
      waveKm: distKm(lats[i], lons[i], M.latitude, M.longitude),
      curKm: ca?.[i] ? distKm(lats[i], lons[i], ca[i].latitude, ca[i].longitude) : null,
    })),
  };
}

export async function fetchMarine({ force = false } = {}) {
  const cached = cachedMarine();
  if (!force && cached && Date.now() - cached.fetchedAt < TTL) return cached;
  const lats = BEACHES.map((b) => b.lat), lons = BEACHES.map((b) => b.lon);
  const [{ ma, wa, xa }, rain] = await Promise.all([download(lats, lons), fetchRain(lats, lons)]);
  const times = ma[0].hourly.time;
  const beaches = {};
  BEACHES.forEach((b, i) => { beaches[b.id] = toHours(ma[i].hourly, wa[i].hourly, xa?.[i]?.hourly); });
  const data = { v: DATA_VERSION, fetchedAt: Date.now(), source: 'Open-Meteo Marine + AROME', times, beaches, rain };
  store.set('marine', data);
  return data;
}

/**
 * Pluja a terra (AROME) des de dos dies enrere fins al final de la previsió, per a l'avís de les desembocadures:
 * { t0 (s), b: { id: [mm per hora] } }. És opcional: si falla, no hi ha avís.
 */
async function fetchRain(lats, lons) {
  try {
    const r = [].concat(await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&past_days=2&forecast_days=4&hourly=precipitation&cell_selection=land`));
    return { t0: r[0].hourly.time[0], b: Object.fromEntries(BEACHES.map((b, i) => [b.id, r[i].hourly.precipitation.map((v) => (v == null ? 0 : Math.round(v * 10) / 10))])) };
  } catch { return null; }
}

/** Pluja acumulada (mm) les `hrs` hores abans de `t` a la platja més propera al punt (null si no hi ha dades). */
export function rainBefore(data, lat, lon, t, hrs = 48) {
  const R = data?.rain;
  if (!R) return null;
  const b = BEACHES.reduce((a, x) => (distKm(lat, lon, x.lat, x.lon) < distKm(lat, lon, a.lat, a.lon) ? x : a));
  const s = R.b[b.id];
  const k1 = Math.min(s?.length ?? 0, Math.floor((t - R.t0) / 3600) + 1);
  if (k1 <= 0) return null;
  let sum = 0;
  for (let k = Math.max(0, k1 - hrs); k < k1; k++) sum += s[k];
  return sum;
}

/**
 * Previsió d'un punt qualsevol del mapa (mateix format que una platja). Es desa només en memòria, 1 h.
 * `land`: el punt és a terra (alçada del terreny > 2 m); llavors l'onada és la del mar més proper.
 */
const pointCache = new Map();
export async function fetchPoint(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const c = pointCache.get(key);
  if (c && Date.now() - c.fetchedAt < TTL) return c;
  const { ma, wa, xa } = await download([lat.toFixed(4)], [lon.toFixed(4)]);
  // El model d'onades té cel·les de diversos km i agafa la de mar més propera: diem a quina distància és.
  const cellKm = distKm(lat, lon, ma[0].latitude, ma[0].longitude);
  const p = { fetchedAt: Date.now(), hours: toHours(ma[0].hourly, wa[0].hourly, xa?.[0]?.hourly), land: (wa[0].elevation ?? 0) > 2, cellKm };
  pointCache.set(key, p);
  return p;
}

function toHours(M, W, X, C = null) {
  return M.time.map((t, k) => ({
      t,
      hs: M.wave_height[k], dir: M.wave_direction[k], per: M.wave_period[k],
      ww: M.wind_wave_height[k], wwDir: M.wind_wave_direction[k],
      sw: M.swell_wave_height[k], swDir: M.swell_wave_direction[k], swPer: M.swell_wave_period[k],
      wwPer: M.wind_wave_period?.[k] ?? null, wwTp: M.wind_wave_peak_period?.[k] ?? null, swTp: M.swell_wave_peak_period?.[k] ?? null,
      s2: M.secondary_swell_wave_height?.[k] ?? null, s2Dir: M.secondary_swell_wave_direction?.[k] ?? null, s2Per: M.secondary_swell_wave_period?.[k] ?? null,
      sst: M.sea_surface_temperature[k],
      wind: W.wind_speed_10m[k], windDir: W.wind_direction_10m[k], gust: W.wind_gusts_10m[k],
      code: W.weather_code[k], air: W.temperature_2m[k],
      p: W.pressure_msl?.[k] ?? null, cape: W.cape?.[k] ?? null, pr: W.precipitation?.[k] ?? null,
      mod: X ? Object.fromEntries(WAVE_MODELS.map((o) => [o.id, [X[`wave_height_${o.api}`]?.[k] ?? null, X[`wave_direction_${o.api}`]?.[k] ?? null]])) : null,
      ...(C ? { cur: C.ocean_current_velocity?.[k] == null ? null : [C.ocean_current_velocity[k], C.ocean_current_direction[k]] } : {}),
  }));
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ha respost ${r.status}`);
  return r.json();
}

// ---------- Anàlisi ----------
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

/**
 * Quina part de l'onada que ve de `fromDir` entra a la platja (1 = de ple, 0,1 = molt arrecerada).
 * Amb període llarg (`T`, s) l'onada "gira" més en arribar a poca fondària (refracció) i entra a cales
 * que una onada curta no toca: el sector obert s'eixampla fins a 20° i la part que s'escola puja.
 */
export function exposure(beach, fromDir, T = null) {
  if (beach.shelter && fromDir != null) return shelterExposure(beach.shelter, fromDir, T);
  if (fromDir == null || beach.facing == null) return 1; // punt sense orientació: mar obert, entra tot
  const d = angDiff(fromDir, beach.facing);
  const open = beach.open + (T ? Math.max(0, Math.min(20, (T - 6) * 5)) : 0);
  const leak = T >= 9 ? 0.2 : 0.1;
  if (d <= open) return 1;
  if (d >= open + 45) return leak;
  return 1 - (1 - leak) * ((d - open) / 45);
}

/**
 * Exposició calculada amb la línia de costa real (rutes de nedada, js/coast.js): `open` diu, cada 10°,
 * com d'obert és el mar en aquella direcció (0 = terra a prop, 1 = quilòmetres de mar). Amb període llarg,
 * l'onada gira (refracció) i també entra per direccions veïnes fins a 20°, com a les platges.
 */
function shelterExposure(sh, fromDir, T) {
  const n = sh.open.length, step = 360 / n;
  const at = (d) => {
    const f = ((((d % 360) + 360) % 360) / step), i = Math.floor(f) % n, j = (i + 1) % n, w = f - Math.floor(f);
    return sh.open[i] * (1 - w) + sh.open[j] * w;
  };
  const widen = T ? Math.max(0, Math.min(20, (T - 6) * 5)) : 0;
  let o = at(fromDir);
  for (let d = 5; d <= widen; d += 5) o = Math.max(o, at(fromDir - d), at(fromDir + d));
  const leak = T >= 9 ? 0.2 : 0.1;
  return leak + (1 - leak) * o;
}

/**
 * Tipus de mar per a qui neda. El període (segons entre dues crestes) diu com és l'onada:
 * curt = onades seguides i punxegudes (picada, "choppy"); llarg = onades espaiades que es veuen venir.
 * Si arriben dos trens d'onades de direccions diferents, la mar és creuada ("rentadora").
 * `factor`: quant pesa l'onada a l'índex de nedada respecte de la seva alçada (1 = el que mesura).
 */
export const SEA_KINDS = {
  plana: { label: 'Plana', factor: 1, tip: 'Pràcticament sense onada.' },
  picada: { label: 'Picada (choppy)', factor: 1.25, tip: 'Onades curtes, seguides i desordenades: et sacsegen i costa agafar ritme. Compta com un 25 % més alta.' },
  curta: { label: 'Curta', factor: 1, tip: 'La més habitual a la Costa Brava: onades properes però regulars.' },
  mitjana: { label: 'Mitjana', factor: 0.95, tip: 'Onades més espaiades: es poden anticipar i molesten menys.' },
  llarga: { label: 'Llarga (mar de fons)', factor: 0.9, tip: 'Onades amples i suaus que es veuen venir; nedant mar endins es passen bé, però a la vora rompen amb més força.' },
  creuada: { label: 'Creuada (rentadora)', factor: 1.2, tip: 'Dos trens d\x27onades de direccions diferents es barregen: mar confusa que et mou per tots costats. Compta com un 20 % més alta.' },
};
// Llindars del període de pic (s), pensats per al Mediterrani, on el mar sol tenir períodes curts.
export const PERIOD_LIMITS = { picada: 4, curta: 6, mitjana: 8 };

const wavelength = (T) => (T ? 1.56 * T * T : null); // aigües fondes: distància entre crestes (m) ≈ 1,56 · T²

export function seaState(beach, h) {
  const comps = [];
  const add = (H, dir, T, src) => {
    if (H == null) return;
    const d = dir ?? h.dir;
    comps.push({ h: H * exposure(beach, d, T), off: H, dir: d, T, src });
  };
  if (h.ww != null || h.sw != null) {
    // El període de pic del model de vegades surt absurd (1,5 s per a mig metre): el de pic mai és menor que el mitjà.
    const per = (tp, tm) => (tp == null && tm == null ? h.per ?? null : Math.max(tp ?? 0, tm ?? 0));
    add(h.ww, h.wwDir, per(h.wwTp, h.wwPer), 'vent');
    add(h.sw, h.swDir, per(h.swTp, h.swPer), 'fons');
    add(h.s2, h.s2Dir, h.s2Per, 'fons2');
  } else add(h.hs, h.dir, h.per, 'total');
  if (!comps.length) return null;
  const hb = Math.sqrt(comps.reduce((s, c) => s + c.h * c.h, 0));
  const sorted = comps.filter((c) => c.h > 0.01).sort((a, b) => b.h - a.h);
  const dom = sorted[0], sec = sorted[1];
  const T = dom?.T ?? h.per ?? null;
  let kind;
  if (hb < 0.12) kind = 'plana';
  else if (sec && sec.h >= 0.12 && sec.h >= 0.4 * dom.h && angDiff(dom.dir, sec.dir) >= 45) kind = 'creuada';
  else if (T == null) kind = 'curta';
  else kind = T < PERIOD_LIMITS.picada ? 'picada' : T < PERIOD_LIMITS.curta ? 'curta' : T < PERIOD_LIMITS.mitjana ? 'mitjana' : 'llarga';
  return { hb, eff: hb * SEA_KINDS[kind].factor, kind, T, len: wavelength(T), dir: dom?.dir ?? h.dir, src: dom?.src, comps: sorted };
}

/** Relació del vent amb la platja: 'mar' (bufa cap a la platja), 'terra' (cap al mar) o 'lateral'. */
export function windRelation(beach, fromDir) {
  if (fromDir == null || beach.facing == null) return 'lateral';
  const d = angDiff(fromDir, beach.facing);
  if (d <= 60) return 'mar';
  if (d >= 120) return 'terra';
  return 'lateral';
}

/** Onada estimada a la platja (m): mar de vent i mars de fons, cadascun amb la seva direcció, període i exposició. */
export function beachWave(beach, h) {
  return seaState(beach, h)?.hb ?? null;
}

export const LEVELS = [
  { label: 'Bo per nedar', short: 'Bo', color: '#3ccf7a' },
  { label: 'Una mica mogut', short: 'Mogut', color: '#f5c542' },
  { label: 'Mala mar', short: 'Mala mar', color: '#ef5b5b' },
];

// Llindars (a calibrar). Onada a la platja: verd < 0,3 m · groc 0,3–0,8 m · vermell ≥ 0,8 m.
export const WAVE_LIMITS = [0.3, 0.8];
// Vent sostingut (km/h) per passar a groc i a vermell segons d'on bufa. El vermell és només per a vent fort de debò.
const WIND_LIMITS = { mar: [15, 35], lateral: [20, 38], terra: [25, 40] };
const GUST_LIMITS = [35, 50];

// Interpolació lineal per trams: pts = [[x, penalització], ...]
function ramp(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts.at(-1)[1];
}
const clamp10 = (v) => Math.max(0, Math.min(10, v));

/**
 * Índex de nedada d'una hora, de 0 (mala mar) a 10 (perfecte), combinant onada i vent.
 * Cada factor dona una penalització: 3 punts al llindar de groc i 6 al de vermell.
 * La pitjor compta sencera i la segona hi suma un terç (onada i vent junts empitjoren el mar).
 * Semàfor: més de 7 = bo, de 4 a 7 = mogut, 4 o menys = mala mar.
 */
export function analyze(beach, h) {
  const sea = seaState(beach, h);
  const bw = sea?.hb ?? null;
  const rel = windRelation(beach, h.windDir);
  const why = [];
  const [w0, w1] = WAVE_LIMITS, [v0, v1] = WIND_LIMITS[rel], [g0, g1] = GUST_LIMITS;

  // L'onada compta segons el tipus de mar: la picada o creuada pesa més que la seva alçada; la llarga, una mica menys.
  const pWave = bw == null ? 3 : ramp(sea.eff, [[0.1, 0], [w0, 3], [w1, 6], [w1 + 0.6, 10]]);
  if (sea && pWave >= 1.5 && (sea.kind === 'picada' || sea.kind === 'creuada')) why.push(sea.kind === 'picada' ? 'mar picada (choppy)' : 'mar creuada (rentadora)');
  const pWind = Math.max(
    ramp(h.wind ?? 0, [[5, 0], [v0, 3], [v1, 6], [v1 + 15, 10]]),
    ramp(h.gust ?? 0, [[20, 0], [g0, 3], [g1, 6], [g1 + 20, 10]]),
  );
  const hi = Math.max(pWave, pWind), lo = Math.min(pWave, pWind);
  let score = clamp10(10 - hi - lo / 3);

  if (pWave >= 6) why.push('onada alta'); else if (pWave >= 3) why.push('una mica d\x27onada');
  if (pWind >= 6) why.push(rel === 'terra' ? 'vent fort de terra (et pot allunyar)' : 'vent fort');
  else if (pWind >= 3) why.push(rel === 'mar' ? 'vent de mar' : 'vent moderat');
  if (h.code >= 95) { score = 0; why.push('tempesta'); }

  const levelOf = (sc) => (sc > 7 ? 0 : sc > 4 ? 1 : 2);
  if (!why.length && levelOf(score) > 0) why.push('onada i vent junts');
  return {
    level: levelOf(score),
    score: Math.round(score * 10) / 10,
    waveScore: Math.round(clamp10(10 - pWave)),
    windScore: Math.round(clamp10(10 - pWind)),
    windLevel: levelOf(10 - pWind),
    beachHs: bw, rel, why, sea,
  };
}

// ---------- Hores locals ----------
const fmtParts = new Intl.DateTimeFormat('ca', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export function localParts(t) {
  const p = Object.fromEntries(fmtParts.formatToParts(t * 1000).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const todayKey = () => localParts(Date.now() / 1000).day;
export function dayKeyOffset(offset) { return localParts(Date.now() / 1000 + offset * 86400).day; }

// Franja on es busca la millor hora per nedar (24/11/2026, l'usuari: "anem a nedar quan es pot i es vol"): de 8 a 19 h
// amb l'horari d'estiu i de 8 a 14 h amb el d'hivern (abans de 6 a 12 h). Només serveix per recomanar una hora millor.
const isSummerTime = (t) => (localParts(t).hour - new Date(t * 1000).getUTCHours() + 24) % 24 === 2;
const dayNoon = (day) => Date.parse(`${day}T12:00:00Z`) / 1000;
export function swimWindow(t = Date.now() / 1000) {
  if (typeof t === 'string') t = dayNoon(t);
  return isSummerTime(t) ? { from: 8, to: 19 } : { from: 8, to: 14 };
}

/**
 * Millor finestra de 2 hores dins la franja de bany d'aquell dia (8-19 h a l'estiu, 8-14 h a l'hivern).
 * Retorna null si la franja d'aquell dia ja ha passat.
 */
export function bestWindow(beach, hours, day, len = 2) {
  const { from, to } = swimWindow(day);
  const now = Date.now() / 1000;
  const cand = hours.filter((h) => { const p = localParts(h.t); return p.day === day && p.hour >= from && p.hour < to && h.t + 3600 > now; });
  if (cand.length < len) return null;
  let best = null;
  for (let i = 0; i + len <= cand.length; i++) {
    const win = cand.slice(i, i + len);
    if (win[len - 1].t - win[0].t !== (len - 1) * 3600) continue;
    const an = win.map((h) => analyze(beach, h));
    const level = Math.max(...an.map((a) => a.level));
    const score = level * 100 - an.reduce((s, a) => s + a.score, 0); // menys és millor
    if (!best || score < best.score) best = { start: win[0].t, end: win[len - 1].t + 3600, level, score, index: Math.min(...an.map((a) => a.score)), hs: an[0].beachHs, wind: win[0].wind, rel: an[0].rel };
  }
  return best;
}

/** Resum per a la targeta de la pantalla principal. */
export function summary(data) {
  const favs = store.get('favBeaches', []);
  const pool = favs.length ? BEACHES.filter((b) => favs.includes(b.id)) : BEACHES;
  const { to } = swimWindow();
  const nowH = localParts(Date.now() / 1000).hour;
  const dayOff = nowH < to - 1 ? 0 : 1;
  const day = dayKeyOffset(dayOff);
  let best = null;
  for (const b of pool) {
    const w = bestWindow(b, data.beaches[b.id], day);
    if (w && (!best || w.score < best.w.score)) best = { b, w };
  }
  const sst = avg(BEACHES.map((b) => nearestHour(data.beaches[b.id])?.sst));
  return { best, dayLabel: dayOff ? 'Demà' : 'Avui', sst };
}

export function nearestHour(hours) {
  const now = Date.now() / 1000;
  return hours.findLast((h) => h.t <= now) || hours[0];
}

function avg(xs) {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ---------- Contrast de models ----------
/**
 * Onada de cada model en una hora: mar obert i estimada a la platja (amb la mateixa correcció d'orientació).
 * El primer és el principal de l'app. `spread`: diferència entre el que més i el que menys dona a la platja.
 */
export function modelCompare(beach, h) {
  const rows = [{ id: 'main', name: 'Météo-France', note: "el de l'app", hs: h.hs, dir: h.dir, beach: beachWave(beach, h) }];
  for (const o of WAVE_MODELS) {
    const [hs, dir] = h.mod?.[o.id] ?? [null, null];
    if (hs == null) continue;
    rows.push({ id: o.id, name: o.name, note: o.note, hs, dir, beach: hs * exposure(beach, dir) });
  }
  const v = rows.map((r) => r.beach).filter((x) => x != null);
  return { rows, spread: v.length > 1 ? Math.max(...v) - Math.min(...v) : 0 };
}

/** Enllaç al Windy en aquest punt amb la capa d'onades (obre la previsió del punt). */
export function windyUrl(beach) {
  const [la, lo] = seaPoint(beach).map((v) => v.toFixed(3));
  return `https://www.windy.com/${la}/${lo}?waves,${la},${lo},12`;
}

// ---------- Temperatura de l'aigua ----------
/** Escala de color per a la temperatura de l'aigua (°C), de blau fred a taronja càlid. */
const SST_STOPS = [[12, [74, 123, 209]], [15, [79, 179, 217]], [18, [92, 201, 167]], [21, [245, 197, 66]], [24, [240, 138, 75]], [27, [226, 79, 79]]];
export const SST_RANGE = [SST_STOPS[0][0], SST_STOPS.at(-1)[0]];
export function sstColor(t) {
  if (t == null) return '#9aa9b5';
  const s = SST_STOPS;
  if (t <= s[0][0]) return `rgb(${s[0][1]})`;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const f = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return `rgb(${s[i][1].map((v, j) => Math.round(s[i - 1][1][j] + (v - s[i - 1][1][j]) * f))})`;
    }
  }
  return `rgb(${s.at(-1)[1]})`;
}
export const sstGradient = () => `linear-gradient(90deg, ${SST_STOPS.map(([t]) => sstColor(t)).join(', ')})`;

/** Com la notarà un nedador. */
export function sstWord(t) {
  if (t == null) return '';
  return t < 14 ? 'molt freda' : t < 17 ? 'freda' : t < 20 ? 'fresca' : t < 23 ? 'agradable' : 'càlida';
}

/** Temperatura de l'aigua a tota la costa en una hora: mitjana, i la platja més freda i la més calenta. */
export function sstStats(data, k) {
  const v = BEACHES.map((b) => ({ b, t: data.beaches[b.id][k]?.sst })).filter((x) => x.t != null);
  if (!v.length) return null;
  const min = v.reduce((a, x) => (x.t < a.t ? x : a)), max = v.reduce((a, x) => (x.t > a.t ? x : a));
  return { avg: v.reduce((a, x) => a + x.t, 0) / v.length, min, max };
}

// ---------- Avisos de temps ----------
// Els fronts i les tempestes es poden avançar o endarrerir fins a 2 hores respecte de la previsió:
// es miren de 2 h abans de ficar-se a l'aigua fins a 2 h després de sortir-ne.
export const ALERT_MARGIN = 2 * 3600;
export const ALERT_LIMITS = { pDrop: 3, cape: 700, windUp: 25, gust: 50, rain: 4 };

/**
 * Avisos per a una nedada de `from` a `to` (s): tempesta, baixada ràpida de pressió (entrada d'un front),
 * entrada o gir fort de vent, ratxes molt fortes i pluja forta. Cada avís: { kind, level ('perill' | 'atencio'), t, text }.
 */
export function weatherAlerts(hours, from, to = from) {
  if (!hours?.length) return [];
  const lo = from - ALERT_MARGIN, hi = to + ALERT_MARGIN;
  const H = hours.filter((h) => h.t >= lo && h.t <= hi);
  if (!H.length) return [];
  const L = ALERT_LIMITS;
  const at = (t) => `les ${new Intl.DateTimeFormat('ca', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(t * 1000)} h`;
  const out = [];
  const storm = H.find((h) => h.code >= 95);
  if (storm) out.push({ kind: 'tempesta', level: 'perill', t: storm.t, text: `Tempesta prevista cap a ${at(storm.t)}. Amb llamps, fora de l'aigua.` });
  else {
    const unstable = H.find((h) => h.cape >= L.cape && ((h.pr ?? 0) >= 0.2 || h.code >= 80));
    if (unstable) out.push({ kind: 'tempesta', level: 'atencio', t: unstable.t, text: `Atmosfera inestable cap a ${at(unstable.t)}: hi pot haver xàfecs amb tempesta.` });
  }
  // Baixada de pressió en 3 hores (es mira també una mica abans, perquè el front ja pot estar entrant).
  const P = hours.filter((h) => h.t >= lo - 3 * 3600 && h.t <= hi && h.p != null);
  let drop = null;
  for (const a of P) {
    const b = P.find((x) => x.t === a.t + 3 * 3600);
    if (b && a.p - b.p >= L.pDrop && (!drop || a.p - b.p > drop.d)) drop = { d: a.p - b.p, t: b.t };
  }
  if (drop) out.push({ kind: 'pressio', level: drop.d >= 5 ? 'perill' : 'atencio', t: drop.t,
    text: `La pressió baixa ${Math.round(drop.d)} hPa en 3 hores (fins a ${at(drop.t)}): entrada d'un front o de mal temps, el mar pot canviar ràpid.` });
  // Entrada de vent: el que bufa en ficar-se a l'aigua contra el màxim que arriba després.
  const h0 = H.find((h) => h.t >= from) ?? H[0];
  const later = H.filter((h) => h.t > h0.t && h.wind != null);
  const top = later.reduce((m, h) => (!m || h.wind > m.wind ? h : m), null);
  if (h0.wind != null && top && top.wind >= L.windUp && top.wind >= h0.wind + 12) {
    out.push({ kind: 'vent', level: top.wind >= 38 ? 'perill' : 'atencio', t: top.t,
      text: `El vent puja de ${Math.round(h0.wind)} a ${Math.round(top.wind)} km/h del ${windName(top.windDir)} cap a ${at(top.t)}.` });
  } else {
    const turn = later.find((h) => h.wind >= 18 && h0.windDir != null && angDiff(h.windDir, h0.windDir) >= 90);
    if (turn) out.push({ kind: 'vent', level: 'atencio', t: turn.t,
      text: `Gir de vent cap a ${at(turn.t)}: de ${windName(h0.windDir)} a ${windName(turn.windDir)}, ${Math.round(turn.wind)} km/h. El mar es pot girar o picar.` });
  }
  // Ratxes: només si arriben després (si ja bufen en ficar-se a l'aigua, el semàfor ja ho diu).
  const gust = (h0.gust ?? 0) < L.gust - 15 ? later.find((h) => h.gust >= L.gust) : null;
  if (gust) out.push({ kind: 'ratxes', level: 'perill', t: gust.t, text: `Ratxes de ${Math.round(gust.gust)} km/h cap a ${at(gust.t)}.` });
  const rain = H.find((h) => h.pr >= L.rain);
  if (rain && !storm) out.push({ kind: 'pluja', level: 'atencio', t: rain.t, text: `Pluja forta cap a ${at(rain.t)} (${Math.round(rain.pr)} mm en una hora): poca visibilitat a l'aigua.` });
  return out;
}
