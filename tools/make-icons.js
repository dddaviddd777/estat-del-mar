// Genera les icones PNG d'Estat del Mar (sense dependències): node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Logo «Ona i vent» (proposta A, triada per l'usuari el 25/11/2026: sense sol, colors del mar, minimalista): fons blau
// marí, una ratxa de vent que s'enrotlla i una línia curta a sota, i dues ones (blanca i blava). Coordenades 0..100,
// com l'SVG de la proposta; cada traç és una polilínia amb gruix (extrems arrodonits).
const BG = [15, 53, 86];
const cubic = (p0, p1, p2, p3, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, s = 1 - t;
  return [0, 1].map((k) => s * s * s * p0[k] + 3 * s * s * t * p1[k] + 3 * s * t * t * p2[k] + t * t * t * p3[k]);
});
const arc = (cx, cy, r, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + (a1 - a0) * i / n) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
// Ona: quatre corbes de 18 unitats d'ample i 9 d'alt (com «c9 0 11-9 18-9 s9 9 18 9…»).
function wave(x0, y0) {
  const pts = [];
  for (let k = 0; k < 4; k++) {
    const x = x0 + 18 * k, up = k % 2 === 0;
    const a = [x, up ? y0 : y0 - 9], b = [x + 18, up ? y0 - 9 : y0];
    const seg = up ? cubic(a, [x + 9, y0], [x + 11, y0 - 9], b) : cubic(a, [x + 7, y0 - 9], [x + 9, y0], b);
    pts.push(...(k ? seg.slice(1) : seg));
  }
  return pts;
}
const STROKES = [
  // Ratxa: recta i, al final, un rínxol de 270° (cercle de radi 8 centrat a 58,23).
  { pts: [[20, 31], [58, 31], ...arc(58, 23, 8, 90, -180).slice(1)], w: 5, col: [159, 216, 245] },
  { pts: [[20, 43], [42, 43]], w: 5, col: [159, 216, 245] },
  { pts: wave(14, 64), w: 7, col: [255, 255, 255] },
  { pts: wave(14, 80), w: 7, col: [47, 155, 224] },
].map((s) => ({ ...s, box: [Math.min(...s.pts.map((p) => p[0])) - s.w, Math.min(...s.pts.map((p) => p[1])) - s.w,
  Math.max(...s.pts.map((p) => p[0])) + s.w, Math.max(...s.pts.map((p) => p[1])) + s.w] }));
function near(s, u, v) {
  if (u < s.box[0] || v < s.box[1] || u > s.box[2] || v > s.box[3]) return false;
  const r2 = (s.w / 2) ** 2;
  for (let i = 1; i < s.pts.length; i++) {
    const [ax, ay] = s.pts[i - 1], [bx, by] = s.pts[i], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1)));
    if ((u - ax - t * dx) ** 2 + (v - ay - t * dy) ** 2 <= r2) return true;
  }
  return false;
}

// Escena en coordenades 0..1. Retorna [r,g,b,a] per a un punt. `scale` encongeix el dibuix (icones «maskable»).
function scene(x, y, { rounded, scale }) {
  if (rounded) {
    const r = 0.22, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  const u = ((x - 0.5) / scale + 0.5) * 100, v = ((y - 0.5) / scale + 0.5) * 100;
  let col = [...BG, 255];
  for (const s of STROKES) if (near(s, u, v)) col = [...s.col, 255];
  return col;
}

function render(size, opts) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const c = scene((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
      acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
    }
    const i = (py * size + px) * 4;
    buf[i] = acc[3] ? acc[0] / acc[3] : 0; buf[i + 1] = acc[3] ? acc[1] / acc[3] : 0;
    buf[i + 2] = acc[3] ? acc[2] / acc[3] : 0; buf[i + 3] = acc[3] / (ss * ss);
  }
  return png(size, buf);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, { rounded: true, scale: 0.95 }));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, { rounded: true, scale: 0.95 }));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), render(512, { rounded: false, scale: 0.72 }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, { rounded: false, scale: 0.85 }));
console.log('Icones generades a', out);
