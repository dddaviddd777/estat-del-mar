// La ruta en un PDF d'un sol full A4 per llegir-la amb calma, imprimir-la o enviar-la: capçalera, xifres, mapa
// (tessel·les d'OpenStreetMap amb el traç a sobre), resum i avisos, gràfica d'onada i vent i taula de trams.
// Fa servir jsPDF (cdnjs), que només es baixa la primera vegada que es demana un PDF.
// Les fonts estàndard del PDF només tenen els caràcters llatins (ISO 8859-1): la resta es canvien (T()).
import { LEVELS, TZ } from './marine.js';

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const APP_URL = 'dddaviddd777.github.io/estat-del-mar';

let lib = null;
function loadLib() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  lib ??= new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = JSPDF;
    s.onload = () => (window.jspdf ? ok(window.jspdf) : ko(new Error('jsPDF no ha arrencat')));
    s.onerror = () => { lib = null; ko(new Error("no s'ha pogut baixar el generador de PDF (cal connexió la primera vegada)")); };
    document.head.append(s);
  });
  return lib;
}

// ---------- Utilitats ----------
const T = (s) => String(s ?? '')
  .replace(/[−–—]/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[→⟶]/g, '->').replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[    ]/g, ' ').replace(/[^\x00-\xFF]/g, '');
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const fmt = (o) => new Intl.DateTimeFormat('ca', { timeZone: TZ, ...o });
const hhmm = (t) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000);
const nf1 = (v) => (v == null ? '-' : v.toFixed(1).replace('.', ','));
const fmtDist = (mt) => (mt < 1000 ? `${Math.round(mt / 10) * 10} m` : `${nf1(mt / 1000)} km`);

const NAVY = [11, 29, 44], INK = [28, 40, 52], MUTED = [96, 110, 122], LINE = [218, 225, 232], SOFT = [243, 246, 249];
const BLUE = [26, 115, 232], WAVE = [23, 78, 166];
const ALERT = { perill: { bar: [214, 58, 46], bg: [253, 236, 234] }, atencio: { bar: [232, 160, 30], bg: [254, 246, 225] } };
const EFF = { favor: ['a favor', [31, 140, 70]], contra: ['en contra', [200, 50, 50]], neutre: ['neutre', MUTED] };

/**
 * Hores en punt dins la nedada (cada `min` minuts: 9:20, 9:40…) i on hi sereu: entre la mostra `i` i la següent, a la
 * fracció `f`, i a `d` metres. La sortida també hi és si queda prou lluny de la primera hora en punt.
 */
function clockTicks(R, min) {
  const S = R.samples, step = min * 60, out = [];
  const first = Math.ceil(R.start / step) * step;
  const times = first - R.start >= step / 2 || first === R.start ? [R.start] : [];
  for (let t = first === R.start ? first + step : first; t <= R.end; t += step) times.push(t);
  let i = 0;
  for (const t of times) {
    while (i < S.length - 2 && S[i + 1].t < t) i++;
    const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
    const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    out.push({ t, i, f, d: a.d + (b.d - a.d) * f });
  }
  return out;
}

// ---------- Mapa (canvas) ----------
function loadImg(url) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => ko(new Error('temps')), 12000);
    img.onload = () => { clearTimeout(t); ok(img); };
    img.onerror = () => { clearTimeout(t); ko(new Error('tessel·la')); };
    img.src = url;
  });
}

/**
 * Pinta el mapa de la ruta en un canvas de `wMm` × `hMm` mm (6 px per mm): tessel·les d'OSM, el traç amb el color
 * del semàfor (anada gruixuda; tornada prima, desplaçada cap a mar), fletxes, sortides, números dels trams, hores i
 * sortida/gir. Retorna la imatge (JPEG) i l'escala, per dibuixar-hi a sobre la barra d'escala.
 */
async function renderMap(info, wMm, hMm, tiles = true) {
  const PX = 6, W = Math.round(wMm * PX), H = Math.round(hMm * PX);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const R = info.R, S = R.samples;
  const mx = (lon) => ((lon + 180) / 360) * 256;
  const my = (lat) => { const t = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + t) / (1 - t)) / (4 * Math.PI)) * 256; };
  const lats = S.map((s) => s.lat), lons = S.map((s) => s.lon);
  const x0 = mx(Math.min(...lons)), x1 = mx(Math.max(...lons)), y0 = my(Math.max(...lats)), y1 = my(Math.min(...lats));
  const PAD = 0.13;
  const fit = Math.min((W * (1 - 2 * PAD)) / Math.max(1e-7, x1 - x0), (H * (1 - 2 * PAD)) / Math.max(1e-7, y1 - y0));
  const z = Math.max(9, Math.min(17, Math.floor(Math.log2(fit))));
  const s = Math.min(2.5, fit / 2 ** z);
  const Z = 2 ** z * s;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (lon) => (mx(lon) - cx) * Z + W / 2, Y = (lat) => (my(lat) - cy) * Z + H / 2;
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mpp = (40075016.7 * Math.cos((lat0 * Math.PI) / 180)) / (256 * Z); // metres per px

  g.fillStyle = '#aad3df'; // el color del mar d'OSM, per si alguna tessel·la no arriba
  g.fillRect(0, 0, W, H);
  let ok = 0, total = 0;
  if (tiles) {
    const n = 2 ** z, left = cx * n - W / 2 / s, top = cy * n - H / 2 / s;
    const jobs = [];
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W / s) / 256); tx++) {
      for (let ty = Math.max(0, Math.floor(top / 256)); ty <= Math.min(n - 1, Math.floor((top + H / s) / 256)); ty++) {
        jobs.push(loadImg(`https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png`)
          .then((img) => ({ img, dx: (tx * 256 - left) * s, dy: (ty * 256 - top) * s })).catch(() => null));
      }
    }
    total = jobs.length;
    for (const t of await Promise.all(jobs)) if (t) { g.drawImage(t.img, t.dx, t.dy, 256 * s + 0.6, 256 * s + 0.6); ok++; }
    g.fillStyle = 'rgba(255,255,255,0.16)'; // una mica més clar, perquè el traç destaqui
    g.fillRect(0, 0, W, H);
  }

  const mm = (v) => v * PX;
  const P = info.positions(Math.max(50, mm(2.2) * mpp));
  const at = (smp) => { const p = P.get(smp); return [X(p[1]), Y(p[0])]; };
  const shiftPx = ([x, y], deg, d) => [x + Math.sin((deg * Math.PI) / 180) * d, y - Math.cos((deg * Math.PI) / 180) * d];
  g.lineCap = 'round'; g.lineJoin = 'round';

  // Traç: ombra, vora blanca i color de cada tram.
  const legs = ['anada', 'tornada'].map((leg) => {
    const L1 = S.filter((x) => x.leg === leg);
    if (!L1.length) return null;
    return { leg, pts: (leg === 'tornada' ? [S.find((x, i) => S[i + 1]?.leg === 'tornada')] : []).concat(L1).filter(Boolean).map(at) };
  }).filter(Boolean);
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  for (const l of legs) { g.strokeStyle = 'rgba(11,29,44,.35)'; g.lineWidth = mm(l.leg === 'anada' ? 2.5 : 1.9); poly(l.pts); }
  for (const l of legs) { g.strokeStyle = '#fff'; g.lineWidth = mm(l.leg === 'anada' ? 2.1 : 1.55); poly(l.pts); }
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    g.strokeStyle = LEVELS[Math.max(a.a.level, b.a.level)].color;
    g.lineWidth = mm(b.leg === 'anada' ? 1.25 : 0.85);
    poly([at(a), at(b)]);
  }

  // Sortides d'emergència (platges, escales, rampes i ports a prop del recorregut).
  const box = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  for (const e of R.exits ?? []) {
    const x = X(e.lon), y = Y(e.lat), q = mm(3.2);
    box(x - q / 2, y - q / 2, q, q, mm(0.8));
    g.fillStyle = e.type === 'port' ? '#2f5d8a' : '#1f9d55'; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = mm(0.35); g.stroke();
    g.beginPath(); g.moveTo(x, y + q * 0.27); g.lineTo(x, y - q * 0.25); g.moveTo(x - q * 0.2, y - q * 0.06); g.lineTo(x, y - q * 0.26); g.lineTo(x + q * 0.2, y - q * 0.06);
    g.lineWidth = mm(0.4); g.stroke();
  }

  // Coves, puntes i desembocadures per on passa la ruta.
  for (const f of info.features ?? []) {
    const x = X(f.lon), y = Y(f.lat), q = mm(3.4);
    g.strokeStyle = '#fff'; g.lineWidth = mm(0.4);
    if (f.kind === 'punta') {
      g.beginPath(); g.moveTo(x, y - q * 0.62); g.lineTo(x + q * 0.62, y + q * 0.46); g.lineTo(x - q * 0.62, y + q * 0.46); g.closePath();
      g.fillStyle = '#e8892b'; g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = `800 ${mm(2.1)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + q * 0.08);
    } else if (f.kind === 'riu') {
      g.beginPath(); g.arc(x, y, q / 2, 0, Math.PI * 2); g.fillStyle = '#2f86c9'; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x - q * 0.28, y); g.quadraticCurveTo(x - q * 0.14, y - q * 0.18, x, y); g.quadraticCurveTo(x + q * 0.14, y + q * 0.18, x + q * 0.28, y); g.stroke();
    } else {
      box(x - q / 2, y - q / 2, q, q, mm(0.8)); g.fillStyle = '#6b4f3a'; g.fill(); g.stroke();
      g.beginPath(); g.roundRect(x - q * 0.2, y - q * 0.05, q * 0.4, q * 0.42, [q * 0.2, q * 0.2, 0, 0]); g.fillStyle = '#1d140e'; g.fill();
    }
  }

  // Fletxes de sentit (cada ~600 m).
  let next = 300;
  for (const smp of S) {
    if (smp.d < next) continue;
    next += 600;
    const [x, y] = at(smp), a = (smp.heading * Math.PI) / 180, q = mm(1.7);
    const dx = Math.sin(a), dy = -Math.cos(a);
    g.beginPath();
    g.moveTo(x + dx * q, y + dy * q);
    g.lineTo(x - dx * q * 0.7 - dy * q * 0.75, y - dy * q * 0.7 + dx * q * 0.75);
    g.lineTo(x - dx * q * 0.7 + dy * q * 0.75, y - dy * q * 0.7 - dx * q * 0.75);
    g.closePath();
    g.fillStyle = '#0b1d2c'; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = mm(0.3); g.stroke();
  }

  const label = (text, x, y, { bg = '#fff', fg = '#0b1d2c', size = 2.4, bold = true, border = null, anchor = 'c' } = {}) => {
    g.font = `${bold ? '700 ' : ''}${mm(size)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const w = g.measureText(text).width + mm(1.8), h = mm(size + 1.4);
    let lx = anchor === 'l' ? x : anchor === 'r' ? x - w : x - w / 2;
    lx = Math.max(mm(1), Math.min(W - w - mm(1), lx));
    const ly = Math.max(mm(1), Math.min(H - h - mm(1), y - h / 2));
    box(lx, ly, w, h, mm(0.9));
    g.fillStyle = bg; g.fill();
    if (border) { g.strokeStyle = border; g.lineWidth = mm(0.45); g.stroke(); }
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, lx + w / 2, ly + h / 2 + mm(0.1));
  };

  // Hores de pas en punt (cada 20 o 30 minuts), damunt del traç, les mateixes que a la gràfica.
  for (const k of clockTicks(R, info.tick ?? 20)) {
    if (k.t === R.start) continue; // la sortida ja té el seu rètol
    const [ax, ay] = at(S[k.i]), [bx, by] = at(S[Math.min(S.length - 1, k.i + 1)]);
    label(hhmm(k.t), ax + (bx - ax) * k.f, ay + (by - ay) * k.f, { bg: 'rgba(11,29,44,.82)', fg: '#fff', size: 2.1 });
  }
  // Números dels trams: l'anada cap a terra i la tornada cap a mar (com a l'app).
  for (const tr of R.trams) {
    const dir = P.sea.get(tr.mid);
    const p = at(tr.mid);
    const [x, y] = dir == null ? p : shiftPx(p, tr.leg === 'tornada' ? dir : (dir + 180) % 360, mm(3.6));
    const col = LEVELS[tr.worst.a.level].color;
    const tor = tr.leg === 'tornada';
    label(String(tr.n), x, y, { bg: tor ? '#0b1d2c' : '#fff', fg: tor ? '#fff' : '#0b1d2c', border: col, size: 2.7 });
  }
  // Sortida i gir / arribada.
  const pin = (smp, color, text) => {
    const [x, y] = at(smp);
    g.beginPath(); g.arc(x, y, mm(1.7), 0, Math.PI * 2);
    g.fillStyle = color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = mm(0.6); g.stroke();
    label(text, x + mm(2.6), y - mm(3.4), { border: color, anchor: 'l', size: 2.5 });
  };
  const first = S[0], turn = R.back ? S.find((x, i) => S[i + 1]?.leg === 'tornada') : S.at(-1);
  if (turn && turn !== first) pin(turn, '#0b1d2c', `${R.back ? 'Gir' : 'Arribada'} ${hhmm(turn.t)}`);
  pin(first, '#1f9d55', `Sortida ${hhmm(first.t)}`);

  let dataUrl;
  try { dataUrl = cv.toDataURL('image/jpeg', 0.9); } catch { return tiles ? renderMap(info, wMm, hMm, false) : null; }
  return { dataUrl, mPerMm: mpp * PX, tilesOk: ok, tilesN: total };
}

// ---------- PDF (un sol full A4) ----------
// Tot en una pàgina: capçalera, xifres, mapa (amb el resum al costat si la ruta és allargada de nord a sud, o a
// sota si és ampla), gràfica d'onada i vent amb els eixos marcats i la taula de trams en dues columnes.
const niceStep = (v) => [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((s) => s >= v) ?? 100;
const fmtNum = (v, step) => {
  if (!v) return '0';
  const dec = Number.isInteger(step) ? 0 : String(step).split('.')[1].length;
  return v.toFixed(dec).replace('.', ',');
};
const WIND = [224, 102, 47], GUST = [240, 165, 120], WAVEF = [206, 228, 246];

/**
 * Genera el PDF. `info`: { R, title, when, meta, kpis: [{ v, l, color?, warn? }], summary, rec, alerts, trams,
 * services: [{ title, lines: [{ type, text }] }], positions(offM), note }. Retorna { blob, pages }.
 */
export async function makeRoutePdf(info) {
  const R = info.R, S = R.samples;
  info.tick = R.duration > 150 * 60 ? 30 : 20; // hores de pas: cada 20 min (cada 30 si la nedada és llarga)
  const { jsPDF } = await loadLib();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 10, CW = PW - 2 * M, BOTTOM = PH - 10;
  const pt = 0.3528; // mm per punt
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (s, x, yy, o = {}) => doc.text(T(s), x, yy, o);
  const wrap = (s, w) => doc.splitTextToSize(T(s), w);
  const fit = (s, w) => {
    let t = T(s);
    if (doc.getTextWidth(t) <= w) return t;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };

  // --- Capçalera ---
  doc.setFillColor(...NAVY); doc.rect(0, 0, PW, 21, 'F');
  font(6.8, 'bold', [140, 200, 235]); text('ESTAT DEL MAR · RUTA DE NEDADA', M, 6, { charSpace: 0.35 });
  let ts = 15;
  font(ts, 'bold', [255, 255, 255]);
  while (doc.getTextWidth(T(info.title)) > CW && ts > 10.5) { ts -= 0.5; font(ts, 'bold', [255, 255, 255]); }
  doc.text(fit(info.title, CW), M, 12.8);
  font(8, 'normal', [205, 220, 232]); doc.text(fit(`${info.when} · ${info.meta}`, CW), M, 18);

  // --- Xifres ---
  let y = 24;
  const nk = info.kpis.length, kg = 1.8, kw = (CW - kg * (nk - 1)) / nk, kh = 12;
  info.kpis.forEach((k, i) => {
    const x = M + i * (kw + kg);
    doc.setFillColor(...(k.warn ? [255, 241, 228] : SOFT)); doc.roundedRect(x, y, kw, kh, 1.6, 1.6, 'F');
    font(11, 'bold', k.warn ? [190, 90, 10] : INK);
    const vw = doc.getTextWidth(T(k.v)) + (k.color ? 3.6 : 0), vx = x + (kw - vw) / 2;
    if (k.color) { doc.setFillColor(...rgb(k.color)); doc.circle(vx + 1.3, y + 4.6, 1.3, 'F'); }
    text(k.v, vx + (k.color ? 3.6 : 0), y + 6);
    font(6, 'normal', MUTED); doc.text(fit(k.l, kw - 1.5), x + kw / 2, y + 9.8, { align: 'center' });
  });
  y += kh + 3;

  // --- Taula de trams: una columna per tram d'anada / tornada (o primera / segona meitat) ---
  const half = Math.ceil(info.trams.length / 2);
  const legs = (R.back ? [['Anada', info.trams.filter((t) => t.leg !== 'tornada')], ['Tornada', info.trams.filter((t) => t.leg === 'tornada')]]
    : [['Primera meitat', info.trams.slice(0, half)], ['Segona meitat', info.trams.slice(half)]]).filter(([, l]) => l.length);
  const ROW = 4.1;
  const legH = (l) => 3.2 + 4.2 + l.length * ROW + 1.5;
  const TABLE_TXT = "Cada tram, pel seu tros més mogut. Onada: m a la platja i d'on ve. Vent: km/h, d'on bufa i (ratxes). Sortida: la més propera. Punt verd: vent i corrent a favor; vermell: en contra.";
  const tableTxtH = (w) => { font(6); return wrap(TABLE_TXT, w).length * 6 * pt * 1.3 + 1; };
  const TABLE2_H = 5 + Math.max(...legs.map(([, l]) => legH(l))) + tableTxtH(CW);
  const tramTable = ([title, list], x0, y0, colW) => {
    const cols = [['', 7], ['Hora', 9.5], ['Nota', 9], ['Lloc', colW - 67], ['Onada', 13], ['Vent (ratxes)', 15.5], ['Sortida', 13]];
    let yy = y0;
    font(6.8, 'bold', INK); text(title, x0, yy + 2.2);
    yy += 3.2;
    doc.setFillColor(...NAVY); doc.rect(x0, yy, colW, 4.2, 'F');
    font(6.2, 'bold', [255, 255, 255]);
    let cx = x0;
    for (const [l, w] of cols) { if (l) text(l, cx + 1, yy + 2.9); cx += w; }
    yy += 4.2;
    list.forEach((tr, i) => {
      if (i % 2) { doc.setFillColor(...SOFT); doc.rect(x0, yy, colW, ROW, 'F'); }
      const by = yy + 2.85;
      let x = x0;
      const col = rgb(LEVELS[tr.level].color), tor = tr.leg === 'tornada';
      doc.setDrawColor(...col); doc.setLineWidth(0.45);
      doc.setFillColor(...(tor ? NAVY : [255, 255, 255])); doc.roundedRect(x + 0.6, yy + 0.5, 5.4, 3.1, 0.6, 0.6, 'FD');
      font(6.5, 'bold', tor ? [255, 255, 255] : NAVY); text(String(tr.n), x + 3.3, by, { align: 'center' });
      x += cols[0][1];
      font(6.8, 'normal', INK); text(hhmm(tr.t), x + 1, by); x += cols[1][1];
      doc.setFillColor(...col); doc.roundedRect(x + 0.5, yy + 0.5, 7.4, 3.1, 0.8, 0.8, 'F');
      font(6.8, 'bold', NAVY); text(nf1(tr.score), x + 4.2, by, { align: 'center' }); x += cols[2][1];
      font(6.8, 'bold', INK); doc.text(fit(tr.place, cols[3][1] - 1.5), x + 1, by); x += cols[3][1];
      font(6.8, 'normal', INK); text(`${nf1(tr.hs)} m${tr.seaFrom ? ` ${tr.seaFrom}` : ''}`, x + 1, by); x += cols[4][1];
      text(tr.windKmh == null ? '-' : `${Math.round(tr.windKmh)} ${tr.windFrom ?? ''} (${Math.round(tr.gust ?? tr.windKmh)})`, x + 1, by); x += cols[5][1];
      font(6.8, tr.exitFar ? 'bold' : 'normal', tr.exitFar ? [190, 90, 10] : INK);
      text(tr.exitM == null ? '-' : tr.exitM < 120 ? 'aquí' : fmtDist(tr.exitM), x + 1, by);
      if (EFF[tr.effort] && tr.effort !== 'neutre') { doc.setFillColor(...EFF[tr.effort][1]); doc.circle(x0 + colW - 1.5, yy + ROW / 2, 0.9, 'F'); }
      yy += ROW;
    });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(x0, yy, x0 + colW, yy);
    return yy + 1.5 - y0;
  };
  const tableNote = (x, y0, w) => {
    font(6, 'normal', MUTED);
    const L = wrap(TABLE_TXT, w);
    L.forEach((l, i) => doc.text(l, x, y0 + 2 + i * 6 * pt * 1.3));
    return L.length * 6 * pt * 1.3 + 1;
  };

  const CHART_MIN = 58;
  font(6.3); const noteLines = wrap(info.note, CW);
  const NOTE_H = noteLines.length * 6.3 * pt * 1.3 + 1;

  // --- Bloc de text: resum, millor hora, avisos, coves/puntes/desembocadures i serveis (draw = false només mesura) ---
  const FEAT_COL = { cova: [107, 79, 58], punta: [232, 137, 43], riu: [47, 134, 201] };
  const LVL_COL = { ok: [60, 170, 100], atencio: [232, 160, 30], perill: [214, 58, 46] };
  const featIcon = (kind, x, yy) => {
    doc.setFillColor(...FEAT_COL[kind]);
    if (kind === 'punta') doc.triangle(x + 1.4, yy, x + 2.9, yy + 2.7, x - 0.1, yy + 2.7, 'F');
    else if (kind === 'riu') doc.circle(x + 1.4, yy + 1.4, 1.4, 'F');
    else { doc.roundedRect(x, yy, 2.8, 2.8, 0.6, 0.6, 'F'); doc.setFillColor(29, 20, 14); doc.roundedRect(x + 0.8, yy + 1.1, 1.2, 1.7, 0.5, 0.5, 'F'); }
  };
  const block = (x, y0, w, draw) => {
    let yy = y0;
    const P = (s, size, style, color, dx = 0) => {
      font(size, style, color);
      const L = wrap(s, w - dx), step = size * pt * 1.3;
      if (draw) L.forEach((l, i) => doc.text(l, x + dx, yy + size * pt * 0.8 + i * step));
      yy += L.length * step;
    };
    const boxed = (s, bg, bar) => {
      font(7.4, 'normal', INK);
      const L = wrap(s, w - 4.5), step = 7.4 * pt * 1.3, h = L.length * step + 2.4;
      if (draw) {
        doc.setFillColor(...bg); doc.roundedRect(x, yy, w, h, 1, 1, 'F');
        doc.setFillColor(...bar); doc.rect(x, yy, 1.2, h, 'F');
        L.forEach((l, i) => doc.text(l, x + 3, yy + 1.2 + 7.4 * pt * 0.8 + i * step));
      }
      yy += h + 1.4;
    };
    const H = (s) => { P(s, 7.2, 'bold', NAVY); yy += 0.6; };
    H('RESUM');
    P(info.summary, 7.6, 'normal', INK); yy += 1.6;
    if (info.rec) boxed(info.rec, [232, 240, 254], BLUE);
    for (const a of info.alerts) boxed(`${a.level === 'perill' ? 'Perill' : 'Atenció'}: ${a.text}`, ALERT[a.level]?.bg ?? SOFT, ALERT[a.level]?.bar ?? MUTED);
    if (info.alerts.length) { P("Els fronts i les tempestes es poden avançar o endarrerir fins a 2 hores: abans de sortir, mireu el radar del Meteocat o de l'AEMET.", 6.3, 'normal', MUTED); yy += 1.4; }
    if (info.features.length || info.noRiver) {
      yy += 0.6; H('COVES, PUNTES I DESEMBOCADURES');
      for (const f of info.features) {
        const top = yy;
        P(`${f.head} · ${f.times}${f.dist != null ? ` · a ${fmtDist(Math.max(10, f.dist))}` : ''}`, 7, 'bold', INK, 5.5);
        if (f.cond) P(f.cond, 6.4, 'normal', MUTED, 5.5);
        P(f.advice, 6.6, 'normal', INK, 5.5);
        if (draw) { doc.setFillColor(...LVL_COL[f.level]); doc.rect(x, top + 0.2, 0.9, yy - top - 0.2, 'F'); featIcon(f.kind, x + 1.9, top + 0.2); }
        yy += 1.4;
      }
      if (info.noRiver) { P(info.noRiver, 6.4, 'normal', MUTED); yy += 1.2; }
    }
    if (info.services.length) {
      yy += 0.6; H('SERVEIS');
      for (const s of info.services) { P(`${s.title}: ${s.lines.length ? s.lines.map((l) => l.text).join(' · ') : 'cap servei a prop'}.`, 6.8, 'normal', INK); yy += 0.6; }
    }
    return yy - y0;
  };

  // --- Mapa: si la ruta és allargada de nord a sud, de 90 mm d'ample i la columna del costat plena (text i, si hi
  // caben, els trams); si és ampla, a tota l'amplada amb el text a sota. La gràfica s'estira fins a omplir el full. ---
  const la = S.map((q) => q.lat), lo = S.map((q) => q.lon);
  const asp = ((Math.max(...la) - Math.min(...la)) * 111320) / Math.max(1, (Math.max(...lo) - Math.min(...lo)) * 111320 * Math.cos((la[0] * Math.PI) / 180));
  const tall = asp > 0.85;
  const LEG_H = (tall ? 9.5 : 6) + (info.features.length ? 3.4 : 0); // la llegenda del mapa (2-3 línies o 1-2)
  let mw, mh, tx, tw, th, sideTable = false, side1H = 0;
  if (tall) {
    mw = 90; tx = M + mw + 4; tw = CW - mw - 4;
    th = block(tx, y, tw, false);
    const table1 = legs.reduce((s, [, l]) => s + legH(l), 0) + tableTxtH(tw) + 4;
    const room = BOTTOM - y - CHART_MIN - 3 - NOTE_H - 2;
    if (th + table1 <= Math.min(150, room)) { sideTable = true; side1H = table1; mh = Math.max(95, Math.min(150, th + table1 - LEG_H)); }
    // Si els trams no hi caben, van a sota i el mapa fa l'alçada del text del costat (sense espai buit).
    else mh = Math.max(80, Math.min(130, room - TABLE2_H - LEG_H, th - LEG_H));
  } else {
    mw = CW; tx = M; tw = CW;
    th = block(tx, 0, tw, false);
    mh = Math.max(55, Math.min(100, BOTTOM - y - CHART_MIN - 3 - TABLE2_H - NOTE_H - 2 - LEG_H - th - 2));
  }
  const map = await renderMap(info, mw, mh);
  if (map) doc.addImage(map.dataUrl, 'JPEG', M, y, mw, mh, undefined, 'FAST');
  else { doc.setFillColor(...SOFT); doc.rect(M, y, mw, mh, 'F'); font(8, 'normal', MUTED); text("No s'ha pogut dibuixar el mapa.", M + mw / 2, y + mh / 2, { align: 'center' }); }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(M, y, mw, mh);
  if (map) {
    // Barra d'escala (a baix a l'esquerra), nord (a dalt a la dreta) i atribució.
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 5000];
    const len = nice.reduce((b, v) => (Math.abs(v / map.mPerMm - 18) < Math.abs(b / map.mPerMm - 18) ? v : b));
    const lw = len / map.mPerMm, bx = M + 3, by = y + mh - 4;
    doc.setFillColor(255, 255, 255); doc.roundedRect(bx - 1.5, by - 4.3, lw + 3, 6, 1, 1, 'F');
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(bx, by, bx + lw, by); doc.line(bx, by - 1, bx, by + 0.2); doc.line(bx + lw, by - 1, bx + lw, by + 0.2);
    font(6, 'bold', NAVY); text(fmtDist(len), bx + lw / 2, by - 1.4, { align: 'center' });
    const nx = M + mw - 5.5, ny = y + 6;
    doc.setFillColor(255, 255, 255); doc.circle(nx, ny, 3.4, 'F');
    doc.setFillColor(...NAVY); doc.triangle(nx, ny - 2.6, nx - 1.4, ny + 1, nx + 1.4, ny + 1, 'F');
    font(5.5, 'bold', NAVY); text('N', nx, ny + 2.9, { align: 'center' });
    font(5, 'normal', MUTED);
    const attr = T("© col·laboradors d'OpenStreetMap"), aw = doc.getTextWidth(attr) + 2;
    doc.setFillColor(255, 255, 255); doc.rect(M + mw - aw, y + mh - 3.4, aw, 3.4, 'F');
    doc.text(attr, M + mw - 1, y + mh - 1, { align: 'right' });
  }
  // Llegenda del mapa (a sota, a la mateixa amplada)
  let ly = y + mh + 1.3, lx = M;
  const legItem = (draw, s, w0) => {
    font(6.2, 'normal', MUTED);
    const w = w0 + doc.getTextWidth(T(s)) + 3.2;
    if (lx > M && lx + w > M + mw) { lx = M; ly += 3.4; }
    draw(lx, ly + 1.3); font(6.2, 'normal', MUTED); text(s, lx + w0, ly + 2.2); lx += w;
  };
  const seg = (c) => (x, yy) => { doc.setDrawColor(...rgb(c)); doc.setLineWidth(1); doc.line(x, yy, x + 4.5, yy); };
  legItem(seg(LEVELS[0].color), 'Bo (més de 7)', 5.8);
  legItem(seg(LEVELS[1].color), 'Mogut (4-7)', 5.8);
  legItem(seg(LEVELS[2].color), 'Mala mar (4 o menys)', 5.8);
  legItem((x, yy) => { doc.setFillColor(31, 157, 85); doc.roundedRect(x, yy - 1.3, 2.6, 2.6, 0.5, 0.5, 'F'); }, 'Sortida', 3.6);
  legItem((x, yy) => { doc.setDrawColor(...rgb(LEVELS[0].color)); doc.setLineWidth(0.4); doc.setFillColor(255, 255, 255); doc.roundedRect(x, yy - 1.4, 3, 2.8, 0.5, 0.5, 'FD'); }, 'Tram', 4);
  const kinds = new Set(info.features.map((f) => f.kind));
  if (kinds.has('cova')) legItem((x, yy) => featIcon('cova', x, yy - 1.4), 'Cova', 3.8);
  if (kinds.has('punta')) legItem((x, yy) => featIcon('punta', x, yy - 1.4), 'Punta', 3.8);
  if (kinds.has('riu')) legItem((x, yy) => featIcon('riu', x, yy - 1.4), 'Desembocadura', 3.8);
  legItem(() => {}, R.back ? `Línia prima: tornada · hores de pas cada ${info.tick} min` : `Hores de pas cada ${info.tick} min`, 0);
  if (map && map.tilesOk < map.tilesN) legItem(() => {}, `Falten ${map.tilesN - map.tilesOk} trossos del mapa de fons`, 0);
  const mapBottom = ly + 3.6;
  if (tall) {
    let yy = y + block(tx, y, tw, true);
    if (sideTable) {
      yy += 1.5;
      font(7.2, 'bold', NAVY); text('TRAMS', tx, yy + 3);
      yy += 4.6;
      for (const lg of legs) yy += tramTable(lg, tx, yy, tw);
      yy += tableNote(tx, yy, tw);
    }
    y = Math.max(mapBottom, yy) + 2.5;
  } else { y = mapBottom + 1.5; block(M, y, CW, true); y += th + 1.5; }

  // --- Gràfica: s'estira fins a omplir el que queda del full ---
  const below = sideTable ? 0 : TABLE2_H + 3;
  const chartH = Math.max(CHART_MIN, Math.min(95, BOTTOM - y - below - NOTE_H - 3));
  if (y + chartH > BOTTOM) { doc.addPage(); y = 12; }
  drawChart(doc, info, M, y, CW, chartH, font, text);
  y += chartH + 3;

  // --- Trams en dues columnes (si no han cabut al costat del mapa) ---
  if (!sideTable) {
    if (y + TABLE2_H > BOTTOM) { doc.addPage(); y = 12; }
    font(7.2, 'bold', NAVY); text('TRAMS', M, y + 3);
    y += 5;
    const colW = (CW - 4) / 2;
    y += Math.max(...legs.map((lg, li) => tramTable(lg, M + li * (colW + 4), y, colW)));
    y += tableNote(M, y, CW) + 1;
  }

  // --- Nota i peu ---
  if (y + NOTE_H > BOTTOM) { doc.addPage(); y = 12; }
  font(6.3, 'normal', MUTED);
  noteLines.forEach((l, i) => doc.text(l, M, y + 2 + i * 6.3 * pt * 1.3));
  const pages = doc.getNumberOfPages();
  const made = fmt({ day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.now());
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(M, PH - 8, PW - M, PH - 8);
    font(6.3, 'normal', MUTED);
    text(`Estat del Mar · ${APP_URL} · fet el ${made}`, M, PH - 4.5);
    if (pages > 1) text(`${i} / ${pages}`, PW - M, PH - 4.5, { align: 'right' });
  }
  doc.setProperties({ title: T(`Ruta de nedada: ${info.title}`), subject: T(info.when), creator: 'Estat del Mar' });
  return { blob: doc.output('blob'), pages };
}

/**
 * Gràfica al llarg de la ruta: onada a la platja (àrea blava, eix de l'esquerra, en m) i vent (línia taronja) amb
 * les ratxes (discontínua), eix de la dreta en km/h. Eix X: hora de pas i km nedats. A dalt, la franja de la nota
 * (color del semàfor); a sota, les sortides i el tram més llarg sense sortida.
 */
function drawChart(doc, info, X0, Y0, W, H, font, text) {
  const R = info.R, S = R.samples;
  // Títol i llegenda (de dreta a esquerra)
  font(7.2, 'bold', NAVY); text('ONADA I VENT AL LLARG DE LA RUTA', X0, Y0 + 3);
  let lx = X0 + W;
  const leg = (s, draw) => { font(6.3, 'normal', INK); lx -= doc.getTextWidth(T(s)); text(s, lx, Y0 + 3); lx -= 6.5; draw(lx, Y0 + 2.1); lx -= 4.5; };
  leg('ratxes (km/h)', (x, y) => { doc.setDrawColor(...GUST); doc.setLineWidth(0.5); doc.setLineDashPattern([0.8, 0.7], 0); doc.line(x, y, x + 5, y); doc.setLineDashPattern([], 0); });
  leg('vent (km/h, eix de la dreta)', (x, y) => { doc.setDrawColor(...WIND); doc.setLineWidth(0.7); doc.line(x, y, x + 5, y); });
  leg('onada a la platja (m, eix de l\'esquerra)', (x, y) => { doc.setFillColor(...WAVEF); doc.rect(x, y - 1.2, 5, 2.2, 'F'); doc.setDrawColor(...WAVE); doc.setLineWidth(0.7); doc.line(x, y - 1.2, x + 5, y - 1.2); });

  const px0 = X0 + 14, px1 = X0 + W - 14, pw = px1 - px0;
  const yNote = Y0 + 6, pTop = Y0 + 11.5, ph = H - 29, pBot = pTop + ph;
  const yExit = pBot + 2, yTime = yExit + 7;
  const x = (d) => px0 + (d / R.length) * pw;
  // Escales: 4 divisions a cada eix, que comparteixen les línies guia.
  const maxHs = Math.max(0.2, ...S.map((s) => s.a.beachHs ?? 0));
  const maxW = Math.max(10, ...S.map((s) => Math.max(s.h.wind ?? 0, s.h.gust ?? 0)));
  const hStep = niceStep(maxHs / 4), wStep = niceStep(maxW / 4);
  const hTop = hStep * 4, wTop = wStep * 4;
  const yH = (v) => pBot - ((v ?? 0) / hTop) * ph, yW = (v) => pBot - ((v ?? 0) / wTop) * ph;

  // Fons i tornada
  doc.setFillColor(...SOFT); doc.rect(px0, pTop, pw, ph, 'F');
  const turn = R.back ? S.find((s, i) => S[i + 1]?.leg === 'tornada') : null;
  if (turn) {
    doc.setFillColor(233, 238, 243); doc.rect(x(turn.d), pTop, px1 - x(turn.d), ph, 'F');
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.25); doc.setLineDashPattern([1, 1], 0); doc.line(x(turn.d), yNote, x(turn.d), pBot); doc.setLineDashPattern([], 0);
    font(6, 'italic', MUTED); text('anada', x(turn.d) - 1, pTop + 2.6, { align: 'right' }); text('tornada', x(turn.d) + 1, pTop + 2.6);
  }
  // Línies guia i valors dels dos eixos
  doc.setDrawColor(...LINE); doc.setLineWidth(0.15);
  for (let i = 0; i <= 4; i++) {
    const yy = pBot - (i / 4) * ph;
    if (i) doc.line(px0, yy, px1, yy);
    doc.setDrawColor(...MUTED); doc.line(px0 - 1, yy, px0, yy); doc.line(px1, yy, px1 + 1, yy); doc.setDrawColor(...LINE);
    font(6.3, 'bold', WAVE); text(fmtNum(i * hStep, hStep), px0 - 1.6, yy + 1, { align: 'right' });
    font(6.3, 'bold', WIND); text(fmtNum(i * wStep, wStep), px1 + 1.6, yy + 1);
  }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.15);
  for (const k of clockTicks(R, info.tick)) doc.line(x(k.d), pTop, x(k.d), pBot);
  font(6.2, 'bold', WAVE); text('Onada (m)', X0 + 2.6, pBot - ph / 2, { angle: 90, align: 'center' });
  font(6.2, 'bold', WIND); text('Vent (km/h)', X0 + W - 1.2, pBot - ph / 2, { angle: -90, align: 'center' });

  // Franja de la nota (semàfor)
  font(5.8, 'normal', MUTED); text('nota', px0 - 1.6, yNote + 2.1, { align: 'right' });
  S.forEach((s, i) => {
    const a = i ? (S[i - 1].d + s.d) / 2 : 0, b = i < S.length - 1 ? (s.d + S[i + 1].d) / 2 : R.length;
    doc.setFillColor(...rgb(LEVELS[s.a.level].color)); doc.rect(x(a), yNote, Math.max(0.2, x(b) - x(a) + 0.05), 2.8, 'F');
  });

  // Onada: àrea i línia
  const pts = S.map((s) => [x(s.d), yH(s.a.beachHs)]);
  doc.setFillColor(...WAVEF);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    doc.triangle(ax, pBot, bx, pBot, bx, by, 'F'); doc.triangle(ax, pBot, ax, ay, bx, by, 'F');
  }
  doc.setDrawColor(...WAVE); doc.setLineWidth(0.7);
  for (let i = 1; i < pts.length; i++) doc.line(...pts[i - 1], ...pts[i]);
  // Vent i ratxes
  doc.setDrawColor(...GUST); doc.setLineWidth(0.45); doc.setLineDashPattern([0.8, 0.7], 0);
  for (let i = 1; i < S.length; i++) if (S[i - 1].h.gust != null && S[i].h.gust != null) doc.line(x(S[i - 1].d), yW(S[i - 1].h.gust), x(S[i].d), yW(S[i].h.gust));
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...WIND); doc.setLineWidth(0.65);
  for (let i = 1; i < S.length; i++) if (S[i - 1].h.wind != null && S[i].h.wind != null) doc.line(x(S[i - 1].d), yW(S[i - 1].h.wind), x(S[i].d), yW(S[i].h.wind));
  // Màxims, amb el valor i l'hora
  const top = (f) => S.reduce((b, s) => ((f(s) ?? -1) > (f(b) ?? -1) ? s : b), S[0]);
  const hMax = top((s) => s.a.beachHs), wMax = top((s) => s.h.wind);
  const marks = [];
  const mark = (xx, yy, s, col) => {
    doc.setFillColor(...col); doc.circle(xx, yy, 0.8, 'F');
    font(6.2, 'bold', col);
    const tw = doc.getTextWidth(T(s)) + 1.6;
    let bx = Math.min(px1 - tw, Math.max(px0, xx - tw / 2)), byy = Math.max(pTop + 0.3, yy - 4.4);
    // Si topa amb l'altra etiqueta, a sota del punt.
    if (marks.some((m) => bx < m[0] + m[2] && m[0] < bx + tw && Math.abs(byy - m[1]) < 3.4)) byy = Math.min(pBot - 3.5, yy + 1.4);
    marks.push([bx, byy, tw]);
    doc.setFillColor(255, 255, 255); doc.roundedRect(bx, byy, tw, 3.2, 0.6, 0.6, 'F');
    text(s, bx + 0.8, byy + 2.35);
  };
  mark(x(hMax.d), yH(hMax.a.beachHs), `màx. ${nf1(hMax.a.beachHs ?? 0)} m a les ${hhmm(hMax.t)}`, WAVE);
  if (wMax.h.wind != null) mark(x(wMax.d), yW(wMax.h.wind), `màx. ${Math.round(wMax.h.wind)} km/h a les ${hhmm(wMax.t)}`, WIND);
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.3); doc.line(px0, pBot, px1, pBot); doc.line(px0, pTop, px0, pBot); doc.line(px1, pTop, px1, pBot);

  // Sortides i el tram més llarg sense sortida
  font(5.8, 'normal', MUTED); text('sortides', px0 - 1.6, yExit + 2.1, { align: 'right' });
  const Ld = R.drawLen;
  const seqD = (along) => (R.back ? [along, 2 * Ld - along] : [R.reverse ? Ld - along : along]);
  if (R.gap?.len >= 600) {
    const a = seqD(R.gap.from), b = seqD(R.gap.to);
    const spans = R.back ? (R.gap.deadEnd ? [[a[0], a[1]]] : [[a[0], b[0]], [b[1], a[1]]]) : [[Math.min(a[0], b[0]), Math.max(a[0], b[0])]];
    doc.setFillColor(255, 200, 140);
    for (const [p, q] of spans) doc.roundedRect(x(Math.min(p, q)), yExit, Math.abs(x(q) - x(p)), 2.6, 0.5, 0.5, 'F');
  }
  doc.setFillColor(31, 157, 85);
  for (const e of R.exits ?? []) for (const d of seqD(e.along)) doc.rect(x(d) - 0.4, yExit - 0.3, 0.8, 3.2, 'F');

  // Eix X: hora de pas (a dalt) i km nedats (a sota)
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.2);
  for (const k of clockTicks(R, info.tick)) {
    const xx = x(k.d);
    doc.line(xx, pBot, xx, pBot + 1.2);
    const cx = Math.min(px1 - 3.5, Math.max(px0 + 3.5, xx));
    font(6.5, 'bold', INK); text(hhmm(k.t), cx, yTime, { align: 'center' });
    font(5.7, 'normal', MUTED); text(`${nf1(k.d / 1000)} km`, cx, yTime + 2.7, { align: 'center' });
  }
  font(6, 'normal', MUTED);
  text('hora', px0 - 1.6, yTime, { align: 'right' }); text('km', px0 - 1.6, yTime + 2.7, { align: 'right' });
  text(`Hora de pas i distància nedada · ${R.back ? 'tornada' : 'arribada'} a les ${hhmm(R.end)}, ${fmtDist(R.length)} en total`, X0 + W / 2, yTime + 6, { align: 'center' });
}

/** Desa el PDF (ordinador) o el deixa a punt per compartir (mòbil): `share()` necessita un toc de l'usuari. */
export function pdfActions(blob, name) {
  const file = new File([blob], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  return {
    name, url,
    canShare: !!navigator.canShare?.({ files: [file] }),
    share: () => navigator.share({ files: [file], title: name }),
    download: () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); },
  };
}
