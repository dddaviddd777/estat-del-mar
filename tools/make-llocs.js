// Genera data/llocs.json: coves de mar i fars de la Costa Brava, a partir d'OpenStreetMap.
// Necessita data/costa.json (tools/make-coast.js) per quedar-se només amb el que toca el mar.
//   node tools/make-llocs.js            (baixa les dades d'Overpass)
//   node tools/make-llocs.js --cache    (reaprofita l'última baixada, desada a la carpeta temporal)
// Correccions a mà: data/llocs-extra.json ({ add: [[lat, lon, tipus, nom]], remove: [[lat, lon]] }), que llegeix l'app.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BBOX = [41.62, 2.70, 42.45, 3.36]; // sud, oest, nord, est (la mateixa zona que la costa)
const SERVERS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const OUT = path.join(__dirname, '..', 'data', 'llocs.json');
const RAW = path.join(os.tmpdir(), 'estat-del-mar-llocs-osm.json');
const TYPES = ['cova', 'far'];
// Com de prop de la línia de costa ha de ser (m): una cova de mar té la boca a l'aigua; un far, dalt del cap.
const NEAR = { cova: 60, far: 300 };

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
/** Distància (m) a la línia de costa (Infinity si n'és a més de ~500 m). */
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

// ---------- Baixada ----------
async function download() {
  if (process.argv.includes('--cache') && fs.existsSync(RAW)) {
    console.log('Fent servir la còpia desada', RAW);
    return JSON.parse(fs.readFileSync(RAW, 'utf8'));
  }
  const b = BBOX.join(',');
  const q = `[out:json][timeout:90];(nwr["natural"="cave_entrance"](${b});nwr["man_made"="lighthouse"](${b}););out center tags;`;
  for (let round = 0; round < 3; round++) {
    for (const url of SERVERS) {
      try {
        console.log(`${url} …`);
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'estat-del-mar-tools/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(150000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        fs.writeFileSync(RAW, JSON.stringify(j));
        return j;
      } catch (e) { console.log('  ha fallat:', e.message); }
    }
  }
  console.error("No s'han pogut baixar les coves i els fars.");
  process.exit(1);
}

(async () => {
  const j = await download();
  const out = [];
  for (const e of j.elements) {
    const t = e.tags ?? {};
    const type = t.natural === 'cave_entrance' ? 'cova' : t.man_made === 'lighthouse' ? 'far' : null;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (!type || lat == null || coastDist(lat, lon) > NEAR[type]) continue;
    out.push({ lat, lon, type, name: t.name ?? null });
  }
  // Dues entrades de la mateixa cova (o el far i la seva torre) a menys de 25 m: una de sola, la que té nom.
  const uniq = [];
  for (const o of out.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0))) {
    if (!uniq.some((u) => u.type === o.type && Math.hypot((u.lat - o.lat) * KY, (u.lon - o.lon) * KX) < 25)) uniq.push(o);
  }
  const names = [...new Set(uniq.map((o) => o.name).filter(Boolean))];
  const llocs = uniq.map((o) => [+o.lat.toFixed(5), +o.lon.toFixed(5), TYPES.indexOf(o.type), o.name ? names.indexOf(o.name) : -1]);
  fs.writeFileSync(OUT, JSON.stringify({ font: "© col·laboradors d'OpenStreetMap (ODbL)", generat: new Date().toISOString().slice(0, 10), types: TYPES, names, llocs }));
  const count = TYPES.map((ty) => `${ty} ${uniq.filter((o) => o.type === ty).length}`).join(', ');
  console.log(`Llocs: ${llocs.length} (${count}) · ${(fs.statSync(OUT).size / 1024).toFixed(1)} kB`);
})();
