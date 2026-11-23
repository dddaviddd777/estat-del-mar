// Genera data/sortides.json: llocs on es pot sortir de l'aigua si la nedada es complica
// (platges, escales que arriben al mar, rampes de barques i ports), a partir d'OpenStreetMap.
// Necessita data/costa.json (tools/make-coast.js) per saber què toca de debò el mar.
//   node tools/make-exits.js            (baixa les dades d'Overpass)
//   node tools/make-exits.js --cache    (reaprofita l'última baixada, desada a la carpeta temporal)
// Correccions a mà (sortides que el grup coneix o que no serveixen): data/sortides-extra.json, que llegeix l'app.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BBOX = [41.62, 2.70, 42.45, 3.36]; // sud, oest, nord, est (la mateixa zona que la costa)
const CHUNKS = 4;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OUT = path.join(__dirname, '..', 'data', 'sortides.json');
const RAW = path.join(os.tmpdir(), 'estat-del-mar-sortides-osm.json');
const TYPES = ['platja', 'escala', 'rampa', 'port'];
// Com de prop del mar ha de ser cada cosa (m) perquè compti com a sortida.
const NEAR = { platja: 40, escala: 25, rampa: 40, port: 250 };
const BEACH_STEP = 120; // m: en una platja llarga, un punt de sortida cada 120 m

// ---------- Costa (projecció plana, com js/coast.js) ----------
const LAT0 = 42, KY = 111320, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const CELL = 500;
const costa = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'costa.json'), 'utf8'));
const segs = [];
for (const enc of costa.lines) {
  let la = enc[0], lo = enc[1];
  let px = (lo / 1e5) * KX, py = (la / 1e5) * KY;
  for (let i = 2; i < enc.length; i += 2) {
    la += enc[i]; lo += enc[i + 1];
    const x = (lo / 1e5) * KX, y = (la / 1e5) * KY;
    segs.push([px, py, x, y]);
    px = x; py = y;
  }
}
const grid = new Map();
segs.forEach((s, k) => {
  for (let gx = Math.floor(Math.min(s[0], s[2]) / CELL); gx <= Math.floor(Math.max(s[0], s[2]) / CELL); gx++)
    for (let gy = Math.floor(Math.min(s[1], s[3]) / CELL); gy <= Math.floor(Math.max(s[1], s[3]) / CELL); gy++) {
      const key = gx * 100000 + gy;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k);
    }
});
/** Distància (m) del punt a la línia de costa (Infinity si n'és a més de ~500 m). */
function coastDist([lat, lon]) {
  const x = lon * KX, y = lat * KY;
  let best = Infinity;
  for (let gx = Math.floor(x / CELL) - 1; gx <= Math.floor(x / CELL) + 1; gx++)
    for (let gy = Math.floor(y / CELL) - 1; gy <= Math.floor(y / CELL) + 1; gy++)
      for (const k of grid.get(gx * 100000 + gy) ?? []) {
        const [ax, ay, bx, by] = segs[k];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
      }
  return best;
}
const distM = (a, b) => Math.hypot((b[0] - a[0]) * KY, (b[1] - a[1]) * KX);

// ---------- Baixada ----------
// Cada franja es desa a la carpeta temporal en acabar: si una falla, en tornar-lo a executar es reaprofiten les fetes.
// Una franja que falla a tots els servidors es parteix en dues (fins a 3 vegades).
async function query(box) {
  const b = box.map((v) => v.toFixed(4)).join(',');
  const q = `[out:json][timeout:180];(nwr["natural"="beach"](${b});way["highway"="steps"](${b});nwr["leisure"="slipway"](${b});nwr["leisure"="marina"](${b});nwr["harbour"="yes"](${b}););out geom;`;
  for (const url of SERVERS) {
    try {
      console.log(`  ${b}: ${url} …`);
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'estat-del-mar-tools/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(200000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { console.log('    ha fallat:', e.message); }
  }
  return null;
}
/** La mateixa caixa, però només fins a 2 km terra endins de la costa més occidental d'aquelles latituds. */
function narrow(box) {
  let west = Infinity, east = -Infinity;
  for (const [ax, ay, bx, by] of segs) for (const [x, y] of [[ax, ay], [bx, by]]) {
    const lat = y / KY;
    if (lat >= box[0] && lat <= box[2]) { west = Math.min(west, x / KX); east = Math.max(east, x / KX); }
  }
  if (!isFinite(west)) return box;
  return [box[0], Math.max(box[1], west - 0.025), box[2], Math.min(box[3], east + 0.01)];
}
async function strip(box, depth = 0, narrowed = false) {
  const part = path.join(os.tmpdir(), `estat-del-mar-sortides-${box.map((v) => v.toFixed(4)).join('_')}.json`);
  if (fs.existsSync(part)) return JSON.parse(fs.readFileSync(part, 'utf8')).elements;
  // Si la caixa té molt interior (pobles amb moltes escales), es retalla a la franja de costa abans de provar-ho.
  if (!narrowed) {
    const nb = narrow(box);
    if (nb[1] - box[1] > 0.05 || box[3] - nb[3] > 0.05) return strip(nb, depth, true);
  }
  const got = await query(box);
  if (got) { fs.writeFileSync(part, JSON.stringify(got)); return got.elements; }
  if (depth >= 3) { console.error("No s'han pogut baixar les sortides."); process.exit(1); }
  const mid = (box[0] + box[2]) / 2;
  return [...await strip([box[0], box[1], mid, box[3]], depth + 1, true), ...await strip([mid, box[1], box[2], box[3]], depth + 1, true)];
}
async function download() {
  if (process.argv.includes('--cache') && fs.existsSync(RAW)) {
    console.log('Fent servir la còpia desada', RAW);
    return JSON.parse(fs.readFileSync(RAW, 'utf8'));
  }
  const els = new Map();
  const dLat = (BBOX[2] - BBOX[0]) / CHUNKS;
  for (let c = 0; c < CHUNKS; c++) {
    console.log(`Franja ${c + 1}/${CHUNKS}`);
    const got = await strip([BBOX[0] + c * dLat, BBOX[1], BBOX[0] + (c + 1) * dLat, BBOX[3]]);
    for (const e of got) els.set(`${e.type}${e.id}`, e);
    console.log(`  ${got.length} elements`);
  }
  const j = { elements: [...els.values()] };
  fs.writeFileSync(RAW, JSON.stringify(j));
  return j;
}

/** Totes les coordenades d'un element (node, via o relació amb geometria). */
function coords(e) {
  if (e.type === 'node') return [[e.lat, e.lon]];
  if (e.geometry) return e.geometry.filter(Boolean).map((p) => [p.lat, p.lon]);
  if (e.members) return e.members.flatMap((m) => (m.geometry ?? (m.lat != null ? [{ lat: m.lat, lon: m.lon }] : [])).filter(Boolean).map((p) => [p.lat, p.lon]));
  return [];
}
function typeOf(t) {
  if (t.natural === 'beach') return 'platja';
  if (t.highway === 'steps') return 'escala';
  if (t.leisure === 'slipway') return 'rampa';
  if (t.leisure === 'marina' || t.harbour === 'yes') return 'port';
  return null;
}

(async () => {
  const j = await download();
  const out = [];
  const count = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const e of j.elements) {
    const type = typeOf(e.tags ?? {});
    if (!type) continue;
    const pts = coords(e);
    if (!pts.length) continue;
    const name = e.tags.name ?? null;
    if (type === 'platja') {
      // Els vèrtexs de la platja que toquen el mar, un cada 120 m.
      const wet = pts.filter((p) => coastDist(p) <= NEAR.platja);
      const kept = [];
      for (const p of wet) if (!kept.some((q) => distM(p, q) < BEACH_STEP)) kept.push(p);
      if (!kept.length && pts.length === 1 && coastDist(pts[0]) <= 80) kept.push(pts[0]);
      kept.forEach((p) => out.push({ p, type, name }));
    } else if (type === 'port') {
      // Un port: el seu punt més proper a la costa (la bocana o el moll).
      const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
      if (coastDist(c) <= NEAR.port) out.push({ p: c, type, name });
    } else {
      // Escala o rampa: el punt que arriba més a prop de l'aigua.
      const best = pts.reduce((a, p) => { const d = coastDist(p); return d < a.d ? { p, d } : a; }, { p: null, d: Infinity });
      if (best.d <= NEAR[type]) out.push({ p: best.p, type, name });
    }
  }
  // Treu duplicats molt propers del mateix tipus (p. ex. dues escales que acaben al mateix lloc).
  const uniq = [];
  for (const o of out) if (!uniq.some((u) => u.type === o.type && distM(u.p, o.p) < 30)) uniq.push(o);
  uniq.forEach((o) => count[o.type]++);
  const names = [...new Set(uniq.map((o) => o.name).filter(Boolean))];
  const exits = uniq.map((o) => [+o.p[0].toFixed(5), +o.p[1].toFixed(5), TYPES.indexOf(o.type), o.name ? names.indexOf(o.name) : -1]);
  fs.writeFileSync(OUT, JSON.stringify({ font: "© col·laboradors d'OpenStreetMap (ODbL)", generat: new Date().toISOString().slice(0, 10), types: TYPES, names, exits }));
  console.log(`Sortides: ${exits.length} (${TYPES.map((t) => `${t} ${count[t]}`).join(', ')}) · ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
})();
