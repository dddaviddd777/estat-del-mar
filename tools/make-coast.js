// Genera data/costa.json: la línia de costa d'OpenStreetMap de tota la Costa Brava (de Portbou a Blanes),
// simplificada, per calcular des de cada punt d'una ruta de nedada per on li pot arribar el mar.
// Només cal tornar-lo a executar si es vol ampliar la zona:  node tools/make-coast.js
// Format: { bbox: [s, w, n, e], lines: [[lat0, lon0, dlat1, dlon1, ...], ...] } en enters de 1e-5 graus (~1 m),
// cada coordenada a partir de la segona com a diferència amb l'anterior.
// Les línies de costa d'OSM tenen la terra a l'esquerra i el mar a la dreta, en el sentit en què es recorren:
// es conserva aquest sentit perquè l'app sàpiga a quin costat hi ha el mar.
const fs = require('fs');
const path = require('path');

const BBOX = [41.62, 2.70, 42.45, 3.36]; // sud, oest, nord, est
const TOL = 4; // m: tolerància de la simplificació (Douglas-Peucker)
const OUT = path.join(__dirname, '..', 'data', 'costa.json');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const CHUNKS = 4; // la zona es demana en franges (de sud a nord) perquè els servidors no s'hi cansin

const R = 6371000;
const xy = (p, o) => [((p[1] - o[1]) * Math.PI / 180) * R * Math.cos(o[0] * Math.PI / 180), ((p[0] - o[0]) * Math.PI / 180) * R];

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const o = pts[0], q = pts.map((p) => xy(p, o));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = q[a], [bx, by] = q[b];
    const L = Math.hypot(bx - ax, by - ay);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs((bx - ax) * (ay - q[i][1]) - (ax - q[i][0]) * (by - ay)) / L : Math.hypot(q[i][0] - ax, q[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const inBox = ([la, lo], m = 0.03) => la >= BBOX[0] - m && la <= BBOX[2] + m && lo >= BBOX[1] - m && lo <= BBOX[3] + m;

const MIN_AREA = 1000; // m²: les roques més petites (uns 30 × 30 m) no fan d'abric a l'onada i es descarten
const RAW = path.join(require('os').tmpdir(), 'estat-del-mar-costa-osm.json'); // còpia de la baixada, per no tornar-la a demanar

/** Simplifica un anell tancat per meitats (així no queda reduït a una agulla A→B→A sense superfície). */
function simplifyRing(g, tol) {
  const o = g[0], q = g.map((p) => xy(p, o));
  let m = 1;
  q.forEach((p, i) => { if (Math.hypot(p[0], p[1]) > Math.hypot(q[m][0], q[m][1])) m = i; });
  let r = simplify(g.slice(0, m + 1), tol).concat(simplify(g.slice(m), tol).slice(1));
  if (r.length < 4) { // massa estret: hi afegim el punt més lluny de la corda perquè tingui tres vèrtexs
    const [mx, my] = q[m], L = Math.hypot(mx, my) || 1;
    let k = 1, kd = -1;
    q.forEach(([x, y], i) => { const d = Math.abs(mx * y - my * x) / L; if (i && i !== m && i !== q.length - 1 && d > kd) { kd = d; k = i; } });
    r = (k < m ? [g[0], g[k], g[m], g[0]] : [g[0], g[m], g[k], g[0]]);
  }
  return r;
}
/** Àrea d'un anell en m² (amb signe: positiva si va en sentit antihorari, com les illes a OSM). */
function ringArea(g) {
  const q = g.map((p) => xy(p, g[0]));
  let A = 0;
  for (let i = 0; i < q.length - 1; i++) A += q[i][0] * q[i + 1][1] - q[i + 1][0] * q[i][1];
  return A / 2;
}

(async () => {
  let j = null;
  if (process.argv.includes('--cache') && fs.existsSync(RAW)) { j = JSON.parse(fs.readFileSync(RAW, 'utf8')); console.log('Fent servir la còpia desada', RAW); }
  if (!j) {
    const ways = new Map();
    const dLat = (BBOX[2] - BBOX[0]) / CHUNKS;
    for (let c = 0; c < CHUNKS; c++) {
      const box = [BBOX[0] + c * dLat, BBOX[1], BBOX[0] + (c + 1) * dLat, BBOX[3]].map((v) => v.toFixed(4));
      const q = `[out:json][timeout:180];way["natural"="coastline"](${box.join(',')});out geom;`;
      let got = null;
      for (const url of SERVERS) {
        try {
          console.log(`Franja ${c + 1}/${CHUNKS}: ${url} …`);
          const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'estat-del-mar-tools/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(200000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          got = await r.json();
          break;
        } catch (e) { console.log('  ha fallat:', e.message); }
      }
      if (!got) { console.error("No s'ha pogut baixar la costa."); process.exit(1); }
      for (const w of got.elements) ways.set(w.id, w); // una via que travessa dues franges surt a totes dues
      console.log(`  ${got.elements.length} vies`);
    }
    j = { elements: [...ways.values()] };
    fs.writeFileSync(RAW, JSON.stringify(j));
  }

  let n0 = 0, n1 = 0, small = 0;
  const lines = [];
  for (const w of j.elements) {
    const g = w.geometry.map((p) => [p.lat, p.lon]);
    n0 += g.length;
    const closed = w.nodes ? w.nodes[0] === w.nodes.at(-1) : g[0][0] === g.at(-1)[0] && g[0][1] === g.at(-1)[1];
    if (closed && g.every((p) => inBox(p))) {
      if (Math.abs(ringArea(g)) < MIN_AREA) { small++; continue; }
      lines.push(simplifyRing(g, TOL));
      continue;
    }
    // Talla els trossos que surten de la zona (amb un marge), conservant el sentit.
    let cur = [];
    const flush = () => { if (cur.length >= 2) lines.push(simplify(cur, TOL)); cur = []; };
    for (const p of g) { if (inBox(p)) cur.push(p); else flush(); }
    flush();
  }
  const out = [];
  for (const s of lines) {
    n1 += s.length;
    const enc = [];
    let pla = 0, plo = 0;
    s.forEach(([la, lo], i) => {
      const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
      if (i === 0) enc.push(a, b); else enc.push(a - pla, b - plo);
      pla = a; plo = b;
    });
    out.push(enc);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ font: '© col·laboradors d\'OpenStreetMap (ODbL)', generat: new Date().toISOString().slice(0, 10), bbox: BBOX, lines: out }));
  console.log(`Línies: ${out.length} · punts: ${n0} → ${n1} · roques petites descartades: ${small} · ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
})();
