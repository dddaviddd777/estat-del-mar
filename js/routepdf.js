// La ruta en un PDF A4 per llegir-la amb calma, imprimir-la o enviar-la: capçalera, xifres, mapa gran (tessel·les
// d'OpenStreetMap amb el traç pintat a sobre), resum, avisos, perfil al llarg de la ruta, taula de trams i serveis.
// Fa servir jsPDF (cdnjs), que només es baixa la primera vegada que es demana un PDF.
// Les fonts estàndard del PDF només tenen els caràcters llatins (ISO 8859-1): la resta es canvien (T()).
import { LEVELS, TZ } from './marine.js';
import { SERVICE_TYPES } from './services.js';

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

  // Hores de pas cada 20 minuts, damunt del traç.
  let tick = R.start + 20 * 60;
  for (const smp of S) {
    if (smp.t < tick) continue;
    while (tick <= smp.t) tick += 20 * 60;
    const [x, y] = at(smp);
    label(hhmm(smp.t), x, y, { bg: 'rgba(11,29,44,.82)', fg: '#fff', size: 2.1 });
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

// ---------- PDF ----------
/**
 * Genera el PDF. `info`: { R, title, when, meta, kpis: [{ v, l, color?, warn? }], summary, rec, alerts, trams,
 * services: [{ title, lines: [{ type, text }] }], positions(offM), fetchedAt, notes }. Retorna { blob, name, pages }.
 */
export async function makeRoutePdf(info) {
  // Mapa més alt si la ruta és allargada de nord a sud (llavors el resum passa a la pàgina 2).
  const S0 = info.R.samples, la = S0.map((q) => q.lat), lo = S0.map((q) => q.lon);
  const asp = ((Math.max(...la) - Math.min(...la)) * 111320) / Math.max(1, (Math.max(...lo) - Math.min(...lo)) * 111320 * Math.cos((la[0] * Math.PI) / 180));
  const MH = asp > 1.1 ? 194 : asp > 0.8 ? 170 : 148;
  const [{ jsPDF }, map] = await Promise.all([loadLib(), renderMap(info, 182, MH)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 14, CW = PW - 2 * M, FOOT = 16;
  let y = 0;
  const pt = 0.3528; // mm per punt
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (s, x, yy, o = {}) => doc.text(T(s), x, yy, o);
  const wrap = (s, w) => doc.splitTextToSize(T(s), w);

  const pageHead = () => {
    font(8, 'bold', MUTED);
    text('ESTAT DEL MAR · RUTA DE NEDADA', M, 10);
    font(8, 'normal', MUTED);
    text(`${info.title} · ${info.when}`, PW - M, 10, { align: 'right', maxWidth: 120 });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 12.5, PW - M, 12.5);
    y = 18;
  };
  const ensure = (h) => { if (y + h > PH - FOOT) { doc.addPage(); pageHead(); return true; } return false; };
  const para = (s, { size = 9.5, style = 'normal', color = INK, w = CW, x = M, lh = 1.38 } = {}) => {
    font(size, style, color);
    const step = size * pt * lh;
    for (const l of wrap(s, w)) { ensure(step); text(l, x, y + size * pt * 0.8); y += step; }
  };
  const heading = (s) => {
    ensure(14);
    y += 4;
    font(10.5, 'bold', NAVY);
    text(s.toUpperCase(), M, y + 3.6, { charSpace: 0.25 });
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.6); doc.line(M, y + 5.6, M + 14, y + 5.6);
    y += 9;
  };

  // --- Capçalera ---
  doc.setFillColor(...NAVY); doc.rect(0, 0, PW, 36, 'F');
  font(8, 'bold', [140, 200, 235]);
  text('ESTAT DEL MAR · RUTA DE NEDADA', M, 10, { charSpace: 0.4 });
  let tsize = 19;
  font(tsize, 'bold', [255, 255, 255]);
  while (doc.getTextWidth(T(info.title)) > CW && tsize > 13) { tsize -= 1; font(tsize, 'bold', [255, 255, 255]); }
  text(wrap(info.title, CW)[0], M, 20.5);
  font(10.5, 'normal', [205, 220, 232]);
  text(info.when, M, 27.5);
  font(9, 'normal', [160, 185, 205]);
  text(info.meta, M, 32.5);

  // --- Xifres ---
  y = 41;
  const n = info.kpis.length, gap = 3, bw = (CW - gap * (n - 1)) / n;
  info.kpis.forEach((k, i) => {
    const x = M + i * (bw + gap);
    doc.setFillColor(...(k.warn ? [255, 241, 228] : SOFT)); doc.roundedRect(x, y, bw, 19, 2, 2, 'F');
    font(15, 'bold', k.warn ? [190, 90, 10] : INK);
    const vw = doc.getTextWidth(T(k.v)) + (k.color ? 5 : 0);
    const vx = x + (bw - vw) / 2;
    if (k.color) { doc.setFillColor(...rgb(k.color)); doc.circle(vx + 1.6, y + 7.4, 1.8, 'F'); }
    text(k.v, vx + (k.color ? 5 : 0), y + 9.4);
    font(7.5, 'normal', MUTED);
    text(k.l, x + bw / 2, y + 15, { align: 'center' });
  });
  y += 24;

  // --- Mapa ---
  if (map) doc.addImage(map.dataUrl, 'JPEG', M, y, CW, MH, undefined, 'FAST');
  else { doc.setFillColor(...SOFT); doc.rect(M, y, CW, MH, 'F'); font(9, 'normal', MUTED); text("No s'ha pogut dibuixar el mapa.", M + CW / 2, y + MH / 2, { align: 'center' }); }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.rect(M, y, CW, MH);
  if (map) {
    // Barra d'escala (a baix a l'esquerra) i nord (a dalt a la dreta).
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 5000];
    const len = nice.reduce((b, v) => (Math.abs(v / map.mPerMm - 28) < Math.abs(b / map.mPerMm - 28) ? v : b));
    const lw = len / map.mPerMm, bx = M + 4, by = y + MH - 6;
    doc.setFillColor(255, 255, 255); doc.roundedRect(bx - 2, by - 5.5, lw + 4, 8, 1.2, 1.2, 'F');
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.6); doc.line(bx, by, bx + lw, by); doc.line(bx, by - 1.3, bx, by + 0.3); doc.line(bx + lw, by - 1.3, bx + lw, by + 0.3);
    font(7, 'bold', NAVY); text(fmtDist(len), bx + lw / 2, by - 1.8, { align: 'center' });
    const nx = PW - M - 7, ny = y + 8;
    doc.setFillColor(255, 255, 255); doc.circle(nx, ny, 4.2, 'F');
    doc.setFillColor(...NAVY); doc.triangle(nx, ny - 3.2, nx - 1.8, ny + 1.2, nx + 1.8, ny + 1.2, 'F');
    font(6.5, 'bold', NAVY); text('N', nx, ny + 3.6, { align: 'center' });
    font(6, 'normal', MUTED);
    const attr = T("Mapa © col·laboradors d'OpenStreetMap");
    const aw = doc.getTextWidth(attr) + 3;
    doc.setFillColor(255, 255, 255); doc.rect(PW - M - aw, y + MH - 4.4, aw, 4.4, 'F');
    text(attr, PW - M - 1.5, y + MH - 1.3, { align: 'right' });
  }
  y += MH + 3;

  // --- Llegenda del mapa ---
  font(7.5, 'normal', MUTED);
  let lx = M;
  const leg = (draw, s, w) => { draw(lx, y + 1.6); lx += w; text(s, lx, y + 2.6); lx += doc.getTextWidth(T(s)) + 4.5; };
  const seg = (c, wdt) => (x, yy) => { doc.setDrawColor(...rgb(c)); doc.setLineWidth(wdt); doc.line(x, yy, x + 6, yy); };
  leg(seg(LEVELS[0].color, 1.3), 'Bo (més de 7)', 8);
  leg(seg(LEVELS[1].color, 1.3), 'Mogut (4-7)', 8);
  leg(seg(LEVELS[2].color, 1.3), 'Mala mar (4 o menys)', 8);
  leg((x, yy) => { doc.setFillColor(31, 157, 85); doc.roundedRect(x, yy - 1.6, 3.2, 3.2, 0.7, 0.7, 'F'); }, 'Sortida (platja, escala, rampa)', 4.6);
  leg((x, yy) => { doc.setDrawColor(...rgb(LEVELS[0].color)); doc.setLineWidth(0.5); doc.setFillColor(255, 255, 255); doc.roundedRect(x, yy - 1.7, 3.6, 3.4, 0.6, 0.6, 'FD'); }, 'Núm. de tram', 5);
  y += 5;
  font(7.5, 'normal', MUTED);
  text(info.R.back ? 'Línia gruixuda: anada · línia prima, desplaçada cap a mar: tornada (pel mateix camí). Hores de pas cada 20 minuts.' : 'Fletxes: sentit de nedada. Hores de pas cada 20 minuts.', M, y + 2.6);
  y += 6;
  if (map && map.tilesOk < map.tilesN) { font(7, 'italic', [190, 90, 10]); text(`Falten ${map.tilesN - map.tilesOk} trossos del mapa de fons (sense connexió?).`, M, y + 2.4); y += 4.5; }

  // --- Resum, recomanació i avisos ---
  heading('Resum');
  para(info.summary);
  const boxPara = (s, bg, bar) => {
    font(9.5, 'normal', INK);
    const lines = wrap(s, CW - 9);
    const h = lines.length * 9.5 * pt * 1.38 + 5;
    ensure(h + 2);
    y += 2;
    doc.setFillColor(...bg); doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'F');
    doc.setFillColor(...bar); doc.rect(M, y, 1.6, h, 'F');
    lines.forEach((l, i) => text(l, M + 5, y + 3 + 9.5 * pt * 0.8 + i * 9.5 * pt * 1.38));
    y += h;
  };
  if (info.rec) boxPara(info.rec, [232, 240, 254], BLUE);
  if (info.alerts.length) {
    heading('Avisos de temps');
    for (const a of info.alerts) boxPara(`${a.level === 'perill' ? 'Perill' : 'Atenció'}: ${a.text}`, ALERT[a.level]?.bg ?? SOFT, ALERT[a.level]?.bar ?? MUTED);
    y += 1.5;
    para("Els fronts i les tempestes es poden avançar o endarrerir fins a 2 hores. Abans de sortir, mireu el radar del Meteocat (meteo.cat) o de l'AEMET.", { size: 8, color: MUTED });
  }

  // --- Perfil al llarg de la ruta ---
  const CH = 50;
  ensure(CH + 26);
  heading('Al llarg de la ruta');
  drawChart(doc, info, M, y, CW, CH, font, text);
  y += CH + 2;
  para(`Barres: nota de cada tros de 250 m (color del semàfor, escala de l'esquerra). Línia blava: onada a la platja (escala de la dreta). Franja de sota: vent i corrent a favor (verd) o en contra (vermell). Marques verdes: sortides; taronja: el tram més llarg sense sortida.`, { size: 7.5, color: MUTED });

  // --- Trams ---
  heading('Trams');
  const cols = [
    { k: 'n', l: 'Tram', w: 11 }, { k: 'h', l: 'Hora', w: 14 }, { k: 's', l: 'Nota', w: 12 },
    { k: 'p', l: 'Lloc i mar', w: 58 }, { k: 'v', l: 'Vent i corrent', w: 38 }, { k: 'x', l: 'Sortida', w: 33 }, { k: 'e', l: 'Esforç', w: 16 },
  ];
  const head = () => {
    doc.setFillColor(...NAVY); doc.rect(M, y, CW, 6.5, 'F');
    font(7.5, 'bold', [255, 255, 255]);
    let x = M;
    for (const c of cols) { text(c.l, x + 1.8, y + 4.4); x += c.w; }
    y += 6.5;
  };
  ensure(20);
  head();
  const LH = 3.5;
  info.trams.forEach((tr, i) => {
    font(8.5, 'bold'); const place = wrap(tr.place, cols[3].w - 3.5);
    font(8, 'normal'); const sea = wrap(`${tr.sea} · ${tr.sector}`, cols[3].w - 3.5);
    const wind = wrap([tr.wind, tr.cur].filter(Boolean).join(' · ') || '-', cols[4].w - 3.5);
    const flags = tr.flags ? wrap(tr.flags, cols[4].w - 3.5) : [];
    const exit = wrap(tr.exit || '-', cols[5].w - 3.5);
    const lines = Math.max(place.length + sea.length, wind.length + flags.length, exit.length, 2);
    const h = lines * LH + 3.4;
    if (ensure(h)) head();
    if (i % 2) { doc.setFillColor(...SOFT); doc.rect(M, y, CW, h, 'F'); }
    const ty = y + 1.7 + 8 * pt * 0.85;
    let x = M;
    // Número (blanc a l'anada, fosc a la tornada, amb la vora del color del tram)
    const col = rgb(LEVELS[tr.level].color), tor = tr.leg === 'tornada';
    doc.setDrawColor(...col); doc.setLineWidth(0.6);
    doc.setFillColor(...(tor ? NAVY : [255, 255, 255])); doc.roundedRect(x + 1.8, y + 1.6, 6.4, 5, 1, 1, 'FD');
    font(8.5, 'bold', tor ? [255, 255, 255] : NAVY); text(String(tr.n), x + 5, y + 5.1, { align: 'center' });
    x += cols[0].w;
    font(8.5, 'bold', INK); text(hhmm(tr.t), x + 1.8, ty);
    if (tor) { font(6.5, 'normal', MUTED); text('tornada', x + 1.8, ty + LH); }
    x += cols[1].w;
    doc.setFillColor(...col); doc.roundedRect(x + 1.5, y + 1.6, 9, 5, 1.2, 1.2, 'F');
    font(8.5, 'bold', NAVY); text(nf1(tr.score), x + 6, y + 5.1, { align: 'center' });
    x += cols[2].w;
    font(8.5, 'bold', INK); place.forEach((l, j) => text(l, x + 1.8, ty + j * LH));
    font(8, 'normal', MUTED); sea.forEach((l, j) => text(l, x + 1.8, ty + (place.length + j) * LH));
    x += cols[3].w;
    font(8, 'normal', INK); wind.forEach((l, j) => text(l, x + 1.8, ty + j * LH));
    font(8, 'italic', [190, 90, 10]); flags.forEach((l, j) => text(l, x + 1.8, ty + (wind.length + j) * LH));
    x += cols[4].w;
    font(8, 'normal', tr.exitFar ? [190, 90, 10] : INK); exit.forEach((l, j) => text(l, x + 1.8, ty + j * LH));
    x += cols[5].w;
    const [et, ec] = EFF[tr.effort] ?? EFF.neutre;
    font(8, tr.effort === 'neutre' ? 'normal' : 'bold', ec); text(et, x + 1.8, ty);
    y += h;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y, PW - M, y);
  });
  y += 2;
  para("Cada tram es valora pel seu tros més mogut. Esforç: si el vent i el corrent us ajuden o us frenen en el sentit de nedada. «Punta exposada»: passeu per davant d'un cap on l'onada arriba de més direccions.", { size: 7.5, color: MUTED });

  // --- Serveis ---
  if (info.services.some((sv) => sv.lines.length)) {
    heading('Serveis');
    for (const sv of info.services) {
      if (!sv.lines.length) continue;
      ensure(10);
      font(9, 'bold', INK); text(sv.title, M, y + 3); y += 5;
      for (const l of sv.lines) {
        ensure(5);
        doc.setFillColor(...rgb(SERVICE_TYPES[l.type].color)); doc.roundedRect(M, y + 0.3, 3.4, 3.4, 0.7, 0.7, 'F');
        font(9, 'normal', INK); text(wrap(l.text, CW - 6)[0], M + 5.5, y + 3);
        y += 4.8;
      }
      y += 1.5;
    }
    para("D'OpenStreetMap: pot ser que en falti algun o que siguin de temporada.", { size: 7.5, color: MUTED });
  }

  // --- Com es calcula ---
  heading('Com es calcula');
  for (const nline of info.notes) { para(nline, { size: 8, color: MUTED }); y += 1; }

  // --- Peu a totes les pàgines ---
  const pages = doc.getNumberOfPages();
  const made = fmt({ day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.now());
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, PH - 11, PW - M, PH - 11);
    font(7, 'normal', MUTED);
    text(`Estat del Mar · ${APP_URL} · fet el ${made}`, M, PH - 7);
    text(`Pàgina ${i} de ${pages}`, PW - M, PH - 7, { align: 'right' });
  }
  doc.setProperties({ title: T(`Ruta de nedada: ${info.title}`), subject: T(info.when), creator: 'Estat del Mar' });
  return { blob: doc.output('blob'), pages };
}

/** Perfil: nota de cada mostra (barres), onada a la platja (línia), esforç, sortides i hores, en vectors. */
function drawChart(doc, info, X0, Y0, W, H, font, text) {
  const R = info.R, S = R.samples;
  const lx = X0 + 8, w = W - 17; // marges per a les escales
  const top = Y0 + 3, hb = H - 22; // barres
  const yE = top + hb + 2, yX = yE + 4.2, yT = yX + 7;
  doc.setFillColor(...SOFT); doc.roundedRect(X0, Y0, W, H, 1.5, 1.5, 'F');
  const x = (d) => lx + (d / R.length) * w;
  const turn = R.back ? S.find((s, i) => S[i + 1]?.leg === 'tornada') : null;
  if (turn) {
    doc.setFillColor(232, 237, 242); doc.rect(x(turn.d), top - 2, lx + w - x(turn.d), hb + 2, 'F');
    font(6.5, 'normal', MUTED); text('tornada', x(turn.d) + 1.2, top + 1.2);
  }
  // Línies guia: 4 i 7 (els llindars del semàfor)
  doc.setLineWidth(0.15); doc.setDrawColor(...LINE);
  for (const v of [0, 4, 7, 10]) doc.line(lx, top + hb - (v / 10) * hb, lx + w, top + hb - (v / 10) * hb);
  font(6.5, 'normal', MUTED);
  for (const v of [0, 4, 7, 10]) text(String(v), lx - 1.5, top + hb - (v / 10) * hb + 1, { align: 'right' });
  const bw = Math.max(0.6, w / S.length - 0.25);
  for (const s of S) {
    const hh = Math.max(0.6, (s.a.score / 10) * hb);
    doc.setFillColor(...rgb(LEVELS[s.a.level].color));
    doc.rect(x(s.d) - bw / 2, top + hb - hh, bw, hh, 'F');
    const ec = s.effort === 'favor' ? [120, 205, 145] : s.effort === 'contra' ? [235, 120, 120] : [222, 228, 234];
    doc.setFillColor(...ec); doc.rect(x(s.d) - bw / 2 - 0.15, yE, bw + 0.3, 2.4, 'F');
  }
  const maxHs = Math.max(0.5, ...S.map((s) => s.a.beachHs ?? 0));
  const wy = (v) => top + hb - ((v ?? 0) / maxHs) * hb;
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1.3);
  for (let i = 1; i < S.length; i++) doc.line(x(S[i - 1].d), wy(S[i - 1].a.beachHs), x(S[i].d), wy(S[i].a.beachHs));
  doc.setDrawColor(...WAVE); doc.setLineWidth(0.6);
  for (let i = 1; i < S.length; i++) doc.line(x(S[i - 1].d), wy(S[i - 1].a.beachHs), x(S[i].d), wy(S[i].a.beachHs));
  font(6.5, 'bold', WAVE);
  text(`${nf1(maxHs)} m`, lx + w + 1.2, top + 1);
  text('0 m', lx + w + 1.2, top + hb + 1);
  // Sortides i el tram més llarg sense cap, passats a la distància nedada.
  const Ld = R.drawLen;
  const seqD = (along) => (R.back ? [along, 2 * Ld - along] : [R.reverse ? Ld - along : along]);
  if (R.gap?.len >= 600) {
    const a = seqD(R.gap.from), b = seqD(R.gap.to);
    const spans = R.back ? (R.gap.deadEnd ? [[a[0], a[1]]] : [[a[0], b[0]], [b[1], a[1]]]) : [[Math.min(a[0], b[0]), Math.max(a[0], b[0])]];
    doc.setFillColor(255, 190, 120);
    for (const [p, q] of spans) doc.roundedRect(x(Math.min(p, q)), yX, Math.abs(x(q) - x(p)), 2.4, 0.6, 0.6, 'F');
  }
  doc.setFillColor(31, 157, 85);
  for (const e of R.exits ?? []) for (const d of seqD(e.along)) doc.rect(x(d) - 0.45, yX - 0.4, 0.9, 3.2, 'F');
  font(6.5, 'normal', MUTED);
  text('esforç', lx - 1.5, yE + 2, { align: 'right' });
  text('sortides', lx - 1.5, yX + 2, { align: 'right' });
  // Hores cada 20 min
  let next = R.start;
  font(7, 'normal', INK);
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.2);
  for (const s of S) {
    if (s.t < next) continue;
    while (next <= s.t) next += 20 * 60;
    doc.line(x(s.d), yT - 2.6, x(s.d), yT - 1.4);
    text(hhmm(s.t), Math.min(lx + w - 4, Math.max(lx + 4, x(s.d))), yT + 1.2, { align: 'center' });
  }
  font(6.5, 'normal', MUTED);
  text(fmtDist(R.length), lx + w, yT + 5, { align: 'right' });
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
