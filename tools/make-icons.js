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

// Escena en coordenades 0..1. Retorna [r,g,b,a] per a un punt: sol sobre el mar amb ones.
function scene(x, y, { rounded, scale }) {
  if (rounded) {
    const r = 0.22, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  const t = y;
  let col = [Math.round(15 + (47 - 15) * t), Math.round(53 + (120 - 53) * t), Math.round(86 + (168 - 86) * t), 255];
  const u = (x - 0.5) / scale + 0.5, v = (y - 0.5) / scale + 0.5;
  if ((u - 0.66) ** 2 + (v - 0.32) ** 2 <= 0.14 ** 2) col = [255, 201, 60, 255]; // sol
  // ones: franges sinusoidals
  const wave = (y0, amp, th) => Math.abs(v - (y0 + amp * Math.sin((u - 0.1) * Math.PI * 4))) <= th && u > 0.12 && u < 0.88;
  if (wave(0.56, 0.035, 0.035)) col = [255, 255, 255, 255];
  if (wave(0.72, 0.035, 0.035)) col = [168, 220, 255, 255];
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
