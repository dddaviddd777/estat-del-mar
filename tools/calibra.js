// Registre de calibratge: cada hora (GitHub Action) desa què mesuren les boies i què deia cada model
// d'onades per a aquella hora i lloc, i escriu un resum petit que l'app llegeix.
// També escriu boies.json: l'última lectura de cada boia, perquè l'app ensenyi les d'ICATMAR (que el navegador no pot llegir).
// Temporal: el registre i el resum s'aturen a partir de FINS; boies.json se segueix escrivint mentre el workflow corri.
// Ús: node tools/calibra.js <carpeta-de-dades>   (sense dependències, Node 20+)
const fs = require('fs');
const path = require('path');

const FINS = '2027-01-31'; // data límit del calibratge (després no fa res)
const DIR = process.argv[2] || 'dades';

const BOIES = [
  { id: 'begur', nom: 'Cap de Begur', font: 'portus', codi: 2798, lat: 41.9016, lon: 3.6568 },
  { id: 'creus', nom: 'Cap de Creus', font: 'icatmar', codi: 'CDCR', lat: 42.3212, lon: 3.3495 },
  { id: 'tordera', nom: 'Tordera', font: 'icatmar', codi: 'TORD', lat: 41.5997, lon: 2.7698 },
];
// El mateix ordre i noms que a l'app ('main' = best_match, que aquí és Météo-France).
const MODELS = { main: 'meteofrance_wave', ecmwf: 'ecmwf_wam', gfs: 'ncep_gfswave025', dwd: 'dwd_ewam' };
const HOUR = 3600;

const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
async function getJson(url, opts) {
  const r = await fetch(url, { ...opts, headers: { 'User-Agent': 'estat-del-mar-calibratge', ...(opts?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'estat-del-mar-calibratge' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

// ---------- Boies: lectures per hora en punt (UTC, segons) ----------
async function readPortus(b) {
  const j = await getJson(`https://portus.puertos.es/portussvr/api/lastData/station/${b.codi}?locale=es`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '["WAVE","WATER_TEMP"]',
  });
  if (!j.fecha) return [];
  const v = {};
  for (const d of j.datos || []) if (!d.averia && d.valor != null) v[d.nombreColumna] = Number(d.valor) / (d.factor || 1);
  const t = Date.parse(j.fecha.replace(' ', 'T').replace(/\.0$/, '') + 'Z') / 1000;
  // lat/lon: posició GPS de la boia en aquesta lectura (gira al voltant de l'ancoratge).
  return v.hm0 == null ? [] : [{ t, hs: v.hm0, dir: v.dmd ?? null, tp: v.tp ?? null, sst: v.ts2 ?? null, lat: v.lat ?? null, lon: v.lon ?? null }];
}

// ERDDAP d'ICATMAR: una dada cada ~20 min i ~1-2 h de retard. Agafem, per a cada hora en punt, la lectura més propera (±15 min).
function parseCsv(txt) {
  const [head, , ...rows] = txt.trim().split('\n');
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((x, i) => [cols[i], x])));
}
async function readIcatmar(b) {
  const q = '&time>=now-8hours';
  const [wave, ctd] = await Promise.all([
    getText(`https://hebe.icm.csic.es/erddap/tabledap/BUOY_${b.codi}_WAVE.csv?time,VHM0_WAVE,VMDR_WAVE,VTPK_WAVE${q}`).then(parseCsv),
    getText(`https://hebe.icm.csic.es/erddap/tabledap/BUOY_${b.codi}_CTD.csv?${q}`).then(parseCsv).catch(() => []),
  ]);
  const near = (rows, t, max = 900) => rows.map((r) => ({ r, d: Math.abs(Date.parse(r.time) / 1000 - t) })).filter((x) => x.d <= max).sort((a, c) => a.d - c.d)[0]?.r;
  const hours = [...new Set(wave.map((r) => Math.round(Date.parse(r.time) / 1000 / HOUR) * HOUR))];
  const out = [];
  for (const t of hours) {
    const w = near(wave, t);
    if (!w || !(Number(w.VHM0_WAVE) >= 0)) continue;
    const c = near(ctd, t, 1800); // la temperatura canvia a poc a poc: n'hi ha prou amb ±30 min
    const tempKey = c && Object.keys(c).find((k) => /^TEMP/.test(k));
    out.push({ t, hs: Number(w.VHM0_WAVE), dir: Number(w.VMDR_WAVE) || null, tp: Number(w.VTPK_WAVE) || null, sst: tempKey ? Number(c[tempKey]) : null });
  }
  // Per a boies.json: la lectura més recent tal com és (no arrodonida a l'hora en punt).
  const w = wave.filter((r) => Number(r.VHM0_WAVE) >= 0).at(-1);
  if (w) {
    const t = Math.round(Date.parse(w.time) / 1000), c = near(ctd, t, 1800), tempKey = c && Object.keys(c).find((k) => /^TEMP/.test(k));
    out.latest = { t, hs: Number(w.VHM0_WAVE), dir: Number(w.VMDR_WAVE) || null, tp: Number(w.VTPK_WAVE) || null, sst: tempKey ? Number(c[tempKey]) : null };
  }
  return out;
}

// ---------- Models al punt de la boia ----------
async function modelSeries(b) {
  const base = `https://marine-api.open-meteo.com/v1/marine?latitude=${b.lat}&longitude=${b.lon}&timeformat=unixtime&past_days=1&forecast_days=2`;
  const [h, s] = await Promise.all([
    getJson(`${base}&hourly=wave_height&models=${Object.values(MODELS).join(',')}`).then((j) => j.hourly),
    // Temperatura de l'aigua: la mateixa crida que fa l'app (best_match), sense triar model.
    getJson(`${base}&hourly=sea_surface_temperature`).then((j) => j.hourly).catch(() => null),
  ]);
  const at = (t) => {
    const k = h.time.indexOf(t);
    if (k < 0) return null;
    const m = Object.fromEntries(Object.entries(MODELS).map(([id, api]) => [id, round(h[`wave_height_${api}`]?.[k])]));
    const ks = s ? s.time.indexOf(t) : -1;
    return { m, msst: ks < 0 ? null : round(s.sea_surface_temperature[ks], 1) };
  };
  return at;
}

// ---------- Resum ----------
function stats(pairs) {
  if (!pairs.length) return null;
  const n = pairs.length;
  const bias = pairs.reduce((s, [m, o]) => s + (m - o), 0) / n;
  const mae = pairs.reduce((s, [m, o]) => s + Math.abs(m - o), 0) / n;
  return { n, bias: round(bias, 3), mae: round(mae, 3) };
}
function summarize(rows) {
  const per = (filter) => {
    const sel = rows.filter(filter);
    const models = {}, ahead = {};
    for (const id of Object.keys(MODELS)) {
      models[id] = stats(sel.filter((r) => r.m?.[id] != null).map((r) => [r.m[id], r.hs]));
      ahead[id] = stats(sel.filter((r) => r.m24?.[id] != null).map((r) => [r.m24[id], r.hs]));
    }
    const sst = stats(sel.filter((r) => r.sst != null && r.msst != null).map((r) => [r.msst, r.sst]));
    return { n: sel.length, models, ahead24: ahead, sst };
  };
  return {
    actualitzat: new Date().toISOString(),
    des_de: rows.length ? new Date(Math.min(...rows.map((r) => r.t)) * 1000).toISOString() : null,
    fins: FINS,
    total: per(() => true),
    boies: Object.fromEntries(BOIES.map((b) => [b.id, { nom: b.nom, ...per((r) => r.boia === b.id) }])),
  };
}

// ---------- Principal ----------
(async () => {
  const acabat = new Date().toISOString().slice(0, 10) > FINS;
  fs.mkdirSync(DIR, { recursive: true });
  const fReg = path.join(DIR, 'registre.jsonl'), fPend = path.join(DIR, 'previsions.json'), fRes = path.join(DIR, 'resum.json');
  const fBoies = path.join(DIR, 'boies.json');
  // Última lectura de cada boia (si una falla, es queda la que hi havia).
  const ultimes = fs.existsSync(fBoies) ? JSON.parse(fs.readFileSync(fBoies, 'utf8')).boies || {} : {};
  const rows = fs.existsSync(fReg) ? fs.readFileSync(fReg, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const have = new Set(rows.map((r) => `${r.boia}|${r.t}`));
  // Previsions fetes ~24 h abans per a cada hora i boia: quan arriba la mesura, les comparem (és el que mires el dia abans).
  const pend = fs.existsSync(fPend) ? JSON.parse(fs.readFileSync(fPend, 'utf8')) : {};
  const now = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  let added = 0;

  for (const b of BOIES) {
    try {
      const [lect, at] = await Promise.all([b.font === 'portus' ? readPortus(b) : readIcatmar(b), modelSeries(b)]);
      const last = lect.latest ?? lect.reduce((a, l) => (!a || l.t > a.t ? l : a), null);
      if (last) {
        ultimes[b.id] = { nom: b.nom, font: b.font === 'portus' ? 'Puertos del Estado' : 'ICATMAR', lat: round(last.lat ?? b.lat, 4), lon: round(last.lon ?? b.lon, 4),
          t: last.t, hs: round(last.hs), dir: round(last.dir, 0), tp: round(last.tp, 1), sst: round(last.sst, 1), m: at(Math.round(last.t / HOUR) * HOUR)?.m ?? null };
      }
      if (acabat) continue;
      for (const l of lect) {
        const key = `${b.id}|${l.t}`;
        if (have.has(key)) continue;
        const mod = at(l.t);
        if (!mod) continue;
        rows.push({ boia: b.id, t: l.t, hs: round(l.hs), dir: round(l.dir, 0), tp: round(l.tp, 1), sst: round(l.sst, 1), ...mod, m24: pend[key]?.m ?? null });
        have.add(key);
        added++;
      }
      // Desa la previsió d'ara per a d'aquí a 24 h (en punt).
      const t24 = now + 24 * HOUR, f = at(t24);
      if (f && !pend[`${b.id}|${t24}`]) pend[`${b.id}|${t24}`] = { m: f.m, fet: now };
      console.log(`${b.nom}: ${lect.length} lectures (${lect.map((l) => new Date(l.t * 1000).toISOString().slice(11, 16)).join(', ')})`);
    } catch (e) {
      console.log(`${b.nom}: error ${e.message}`);
    }
  }
  fs.writeFileSync(fBoies, JSON.stringify({ actualitzat: new Date().toISOString(), boies: ultimes }, null, 1));
  if (acabat) { console.log(`Calibratge acabat (${FINS}): només s'actualitza boies.json.`); return; }
  // Les previsions de fa més de 2 dies ja no s'aparellaran amb cap lectura.
  for (const k of Object.keys(pend)) if (Number(k.split('|')[1]) < now - 48 * HOUR) delete pend[k];

  rows.sort((a, c) => a.t - c.t || a.boia.localeCompare(c.boia));
  fs.writeFileSync(fReg, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(fPend, JSON.stringify(pend));
  fs.writeFileSync(fRes, JSON.stringify(summarize(rows), null, 1));
  console.log(`Noves: ${added} · total: ${rows.length}`);
})();
