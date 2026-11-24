// Eines compartides per als generadors de dades d'OpenStreetMap (make-llocs.js, make-serveis.js):
// distància a la línia de costa (data/costa.json) i baixada d'Overpass per franges que es poden reprendre.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BBOX = [41.62, 2.70, 42.45, 3.36]; // sud, oest, nord, est (la mateixa zona que la costa)
const SERVERS = ['https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];

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
function coastDist(lat, lon) {
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

/** La caixa retallada a la franja de costa d'aquelles latituds (fins a ~2 km terra endins). */
function narrow(box) {
  let west = Infinity, east = -Infinity;
  for (const [ax, ay, bx, by] of segs) for (const [x, y] of [[ax, ay], [bx, by]]) {
    const lat = y / KY;
    if (lat >= box[0] && lat <= box[2]) { west = Math.min(west, x / KX); east = Math.max(east, x / KX); }
  }
  if (!isFinite(west)) return box;
  return [box[0], Math.max(box[1], west - 0.025), box[2], Math.min(box[3], east + 0.01)];
}

// ---------- Baixada ----------
async function query(q, label) {
  for (let round = 0; round < 2; round++) {
    for (const url of SERVERS) {
      try {
        console.log(`  ${label}: ${url} …`);
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'estat-del-mar-tools/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(180000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { console.log('    ha fallat:', e.message); }
    }
  }
  return null;
}

/**
 * Baixa tots els elements d'una consulta per franges de latitud (retallades a la costa). `body(b)` retorna el
 * cos de la consulta per a una caixa "s,w,n,e". Cada franja es desa a la carpeta temporal amb el nom `name`:
 * si una falla, en tornar-ho a executar es reaprofiten les fetes; si falla a tots els servidors, es parteix en dues.
 */
async function download(name, body, { chunks = 4, out = 'out center tags;' } = {}) {
  const els = new Map();
  async function strip(box, depth = 0) {
    const b = box.map((v) => v.toFixed(4)).join(',');
    const part = path.join(os.tmpdir(), `estat-del-mar-${name}-${b.replace(/,/g, '_')}.json`);
    if (fs.existsSync(part)) return JSON.parse(fs.readFileSync(part, 'utf8')).elements;
    const got = await query(`[out:json][timeout:170];(${body(b)});${out}`, b);
    if (got) { fs.writeFileSync(part, JSON.stringify(got)); return got.elements; }
    if (depth >= 2) { console.error(`No s'ha pogut baixar ${name}.`); process.exit(1); }
    const mid = (box[0] + box[2]) / 2;
    return [...await strip([box[0], box[1], mid, box[3]], depth + 1), ...await strip([mid, box[1], box[2], box[3]], depth + 1)];
  }
  const dLat = (BBOX[2] - BBOX[0]) / chunks;
  for (let c = 0; c < chunks; c++) {
    console.log(`Franja ${c + 1}/${chunks}`);
    const got = await strip(narrow([BBOX[0] + c * dLat, BBOX[1], BBOX[0] + (c + 1) * dLat, BBOX[3]]));
    for (const e of got) els.set(`${e.type}${e.id}`, e);
    console.log(`  ${got.length} elements`);
  }
  return [...els.values()];
}

/** Desa el fitxer de dades compacte: { font, generat, types, names, [key]: [[lat, lon, tipus, nom, ...extra]] }. */
function writeData(file, key, types, items, extra = () => []) {
  const names = [...new Set(items.map((o) => o.name).filter(Boolean))];
  const rows = items.map((o) => [+o.lat.toFixed(5), +o.lon.toFixed(5), types.indexOf(o.type), o.name ? names.indexOf(o.name) : -1, ...extra(o)]);
  fs.writeFileSync(file, JSON.stringify({ font: "© col·laboradors d'OpenStreetMap (ODbL)", generat: new Date().toISOString().slice(0, 10), types, names, [key]: rows }));
  const count = types.map((t) => `${t} ${items.filter((o) => o.type === t).length}`).join(', ');
  console.log(`${path.basename(file)}: ${rows.length} (${count}) · ${(fs.statSync(file).size / 1024).toFixed(1)} kB`);
}

/** Treu els que són a menys de `r` m d'un altre del mateix tipus (es queda el primer: ordeneu abans els que tenen nom). */
function dedupe(items, r) {
  const out = [];
  for (const o of items) if (!out.some((u) => u.type === o.type && distM([u.lat, u.lon], [o.lat, o.lon]) < r)) out.push(o);
  return out;
}

module.exports = { BBOX, coastDist, distM, narrow, download, writeData, dedupe, KX, KY };
