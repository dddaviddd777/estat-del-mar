// Boia del Cap de Begur (Puertos del Estado, xarxa exterior): el mar mesurat ara, mar endins,
// i què deien els models per a aquella mateixa hora i lloc (per veure quin l'encerta més).
import * as store from './store.js';
import { WAVE_MODELS } from './marine.js';

export const BUOY = { id: 2798, name: 'Cap de Begur', lat: 41.9016, lon: 3.6568, km: 35 };

// API interna del web Portus (no documentada, CORS obert). Les hores són UTC.
const URL_LAST = `https://portus.puertos.es/portussvr/api/lastData/station/${BUOY.id}?locale=es`;
const TTL = 20 * 60 * 1000; // la boia dona una dada cada hora

// Models que comparem a la boia: el principal de l'app i els altres.
const MODELS = [{ id: 'main', api: 'meteofrance_wave', name: 'Météo-France', note: "el de l'app" }, ...WAVE_MODELS];

export function cachedBuoy() {
  return store.get('buoy', null);
}

export async function fetchBuoy({ force = false } = {}) {
  const c = cachedBuoy();
  if (!force && c && Date.now() - c.fetchedAt < TTL) return c;
  const r = await fetch(URL_LAST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '["WAVE","WIND","WATER_TEMP"]' });
  if (!r.ok) throw new Error(`Portus ha respost ${r.status}`);
  const j = await r.json();
  if (!j.fecha) throw new Error('La boia no té dades ara');
  const v = {};
  for (const d of j.datos || []) if (!d.averia && d.valor != null) v[d.nombreColumna] = Number(d.valor) / (d.factor || 1);
  const t = Date.parse(j.fecha.replace(' ', 'T').replace(/\.0$/, '') + 'Z') / 1000;
  const reading = {
    t, hs: v.hm0 ?? null, hmax: v.hmax ?? null, dir: v.dmd ?? null, tp: v.tp ?? null,
    wind: v.vv_md != null ? v.vv_md * 3.6 : null, windDir: v.dv_md ?? null, sst: v.ts2 ?? null,
  };
  const models = await modelsAt(t).catch(() => (c?.reading?.t === t ? c.models : null));
  const data = { fetchedAt: Date.now(), reading, models };
  store.set('buoy', data);
  return data;
}

/** Onada de cada model al punt de la boia per a l'hora `t` (UTC, en segons). */
async function modelsAt(t) {
  const u = `https://marine-api.open-meteo.com/v1/marine?latitude=${BUOY.lat}&longitude=${BUOY.lon}&hourly=wave_height,wave_direction&models=${MODELS.map((o) => o.api).join(',')}&timeformat=unixtime&past_days=1&forecast_days=1`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Open-Meteo ha respost ${r.status}`);
  const h = (await r.json()).hourly;
  const k = h.time.indexOf(t);
  if (k < 0) return null;
  return MODELS.map((o) => ({ id: o.id, name: o.name, note: o.note, hs: h[`wave_height_${o.api}`]?.[k] ?? null, dir: h[`wave_direction_${o.api}`]?.[k] ?? null }))
    .filter((x) => x.hs != null);
}

// ---------- Calibratge compartit ----------
// Una GitHub Action desa cada hora boies (Cap de Begur, Cap de Creus, Tordera) + models a la branca `calibratge`
// i en fa un resum (tools/calibra.js). Tothom el llegeix d'aquí: no depèn de qui obri l'app.
const URL_CALIB = 'https://raw.githubusercontent.com/dddaviddd777/estat-del-mar/calibratge/resum.json';
const CALIB_TTL = 60 * 60 * 1000;

export function cachedCalib() {
  return store.get('calib', null);
}

export async function fetchCalib({ force = false } = {}) {
  const c = cachedCalib();
  if (!force && c && Date.now() - c.fetchedAt < CALIB_TTL) return c;
  const r = await fetch(URL_CALIB, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`GitHub ha respost ${r.status}`);
  const data = { fetchedAt: Date.now(), resum: await r.json() };
  store.set('calib', data);
  return data;
}

// El registre que abans es desava al mòbil ara el fa GitHub per a tothom: l'esborrem.
if (store.get('buoyLog')) store.set('buoyLog', undefined);
