// Línia de costa real (OpenStreetMap, data/costa.json) per saber, des de qualsevol punt de mar,
// per quines direccions hi pot arribar l'onada i per quines la tapa la terra (caps, illes, el fons d'una cala).
// Fa servir una projecció plana en metres (a la Costa Brava l'error és d'un 1 %, prou per a distàncies de pocs km).

const LAT0 = 42;
const KY = 111320, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toX = (lon) => lon * KX, toY = (lat) => lat * KY;
const CELL = 500;      // m: costat de cada casella de l'índex espacial
export const STEP = 10; // graus entre direccions (36 direccions)
const N = 360 / STEP;
const MAXR = 5000;     // m: fins on es mira cada direcció
const F_SHUT = 250, F_OPEN = 3000; // m: amb terra a menys de 250 m la direcció és tapada; amb més de 3 km de mar, oberta

let coast = null;      // { s: Float64Array [x1, y1, x2, y2, ...], grid: Map }
let loading = null;

/** Carrega la línia de costa (una sola vegada; el service worker la guarda per quan no hi ha connexió). */
export function loadCoast() {
  if (coast) return Promise.resolve(coast);
  if (!loading) {
    loading = fetch('data/costa.json').then((r) => {
      if (!r.ok) throw new Error(`no s'ha pogut carregar la línia de costa (${r.status})`);
      return r.json();
    }).then(build).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function build(j) {
  const segs = [];
  for (const enc of j.lines) {
    let la = enc[0], lo = enc[1];
    let px = toX(lo / 1e5), py = toY(la / 1e5);
    for (let i = 2; i < enc.length; i += 2) {
      la += enc[i]; lo += enc[i + 1];
      const x = toX(lo / 1e5), y = toY(la / 1e5);
      segs.push(px, py, x, y);
      px = x; py = y;
    }
  }
  const s = Float64Array.from(segs);
  const grid = new Map();
  for (let k = 0; k < s.length; k += 4) {
    const x0 = Math.floor(Math.min(s[k], s[k + 2]) / CELL), x1 = Math.floor(Math.max(s[k], s[k + 2]) / CELL);
    const y0 = Math.floor(Math.min(s[k + 1], s[k + 3]) / CELL), y1 = Math.floor(Math.max(s[k + 1], s[k + 3]) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const key = gx * 100000 + gy;
      let a = grid.get(key);
      if (!a) grid.set(key, (a = []));
      a.push(k);
    }
  }
  coast = { s, grid, bbox: j.bbox };
  return coast;
}

export const coastReady = () => !!coast;
export const inCoastArea = (lat, lon) => !coast || (lat >= coast.bbox[0] && lat <= coast.bbox[2] && lon >= coast.bbox[1] && lon <= coast.bbox[3]);

/** Segments de costa a menys de `r` m del punt (x, y). */
function near(x, y, r) {
  const out = [], seen = new Set();
  const gx0 = Math.floor((x - r) / CELL), gx1 = Math.floor((x + r) / CELL);
  const gy0 = Math.floor((y - r) / CELL), gy1 = Math.floor((y + r) / CELL);
  for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
    const a = coast.grid.get(gx * 100000 + gy);
    if (a) for (const k of a) if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/**
 * Costa més propera: distància (m) i si el punt és al mar. Les línies de costa d'OSM tenen la terra a l'esquerra
 * i el mar a la dreta: el costat del segment més proper diu on és el punt.
 */
export function coastInfo(lat, lon, r = 3000) {
  if (!coast) return null;
  const x = toX(lon), y = toY(lat), s = coast.s;
  let cand = [], bestD = Infinity;
  for (const k of near(x, y, r)) {
    const ax = s[k], ay = s[k + 1], bx = s[k + 2], by = s[k + 3];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d > bestD + 0.01) continue;
    const c = { d, t, dx, dy, left: dx * (y - ay) - dy * (x - ax) > 0 }; // a l'esquerra = terra
    if (d < bestD - 0.01) { cand = [c]; bestD = d; } else cand.push(c);
  }
  if (!cand.length) return { dist: Infinity, sea: true };
  // Si el més proper cau dins d'un segment, el costat d'aquest segment ho diu.
  const inner = cand.find((c) => c.t > 0.001 && c.t < 0.999);
  if (inner) return { dist: bestD, sea: !inner.left };
  // Si és un vèrtex (la punta d'una roca, un racó), cal mirar els dos segments que s'hi ajunten: si allà la costa
  // gira cap a la terra (esquerra), el punt només és terra si queda a l'esquerra de tots dos; si gira cap al mar, d'un.
  const inc = cand.find((c) => c.t >= 0.999), out = cand.find((c) => c.t <= 0.001);
  if (inc && out) {
    const turn = inc.dx * out.dy - inc.dy * out.dx;
    const land = turn > 0 ? inc.left && out.left : inc.left || out.left;
    return { dist: bestD, sea: !land };
  }
  return { dist: bestD, sea: !cand[0].left };
}

/**
 * Per a cada direcció (cada 10°, des d'on vindria l'onada), a quina distància hi ha terra.
 * `open`: obertura de 0 (tapada) a 1 (mar obert), suavitzada ±20° perquè l'onada també es difracta.
 * `facing`: cap on s'obre el mar (mitjana de les direccions obertes); `span`: graus oberts en total.
 */
export function shelterAt(lat, lon) {
  if (!coast) return null;
  const x = toX(lon), y = toY(lat), s = coast.s;
  const fetchM = new Float32Array(N).fill(MAXR);
  const dirs = [];
  for (let i = 0; i < N; i++) { const a = (i * STEP * Math.PI) / 180; dirs.push([Math.sin(a), Math.cos(a)]); }
  for (const k of near(x, y, MAXR)) {
    const ax = s[k] - x, ay = s[k + 1] - y, bx = s[k + 2] - x, by = s[k + 3] - y;
    const ex = bx - ax, ey = by - ay;
    for (let i = 0; i < N; i++) {
      const [ux, uy] = dirs[i];
      // Raig P + t·u contra el segment A + s·e: t = (A × e) / (u × e), s = (A × u) / (u × e)
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den;
      if (t <= 0 || t >= fetchM[i]) continue;
      const sp = (ax * uy - ay * ux) / den;
      if (sp >= 0 && sp <= 1) fetchM[i] = t;
    }
  }
  const raw = Array.from(fetchM, (f) => Math.max(0, Math.min(1, Math.log(f / F_SHUT) / Math.log(F_OPEN / F_SHUT))));
  const W = [1, 2, 3, 2, 1];
  const open = raw.map((_, i) => W.reduce((acc, w, j) => acc + w * raw[(i + j - 2 + N) % N], 0) / 9);
  let vx = 0, vy = 0, span = 0;
  open.forEach((o, i) => { vx += o * dirs[i][0]; vy += o * dirs[i][1]; if (o >= 0.5) span += STEP; });
  const facing = Math.hypot(vx, vy) > 0.3 ? Math.round(((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360) : null;
  return { open: open.map((o) => Math.round(o * 100) / 100), fetch: Array.from(fetchM, Math.round), facing, span };
}

const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const dname = (d) => NAMES[Math.round((((d % 360) + 360) % 360) / 45) % 8];
/** "obert del NE al S": el sector obert més ample, en paraules. */
export function sectorText(sh) {
  if (!sh) return '';
  const on = sh.open.map((o) => o >= 0.5);
  if (on.every(Boolean)) return 'obert per tots costats';
  if (!on.some(Boolean)) return 'arrecerat per tots costats';
  let best = null;
  for (let i = 0; i < N; i++) {
    if (!on[i] || on[(i - 1 + N) % N]) continue; // inici d'un tram obert
    let n = 0;
    while (on[(i + n) % N] && n < N) n++;
    if (!best || n > best.n) best = { i, n };
  }
  const a = best.i * STEP, b = (best.i + best.n - 1) * STEP;
  return dname(a) === dname(b) ? `obert al ${dname(a)}` : `obert del ${dname(a)} al ${dname(b)}`;
}
