// Emissaris submarins de la Costa Brava → data/emissaris.json.
// Font: perfils de les zones de bany de l'Agència Catalana de l'Aigua (ACA), taula «Emissaris» de cada sistema de
// sanejament (https://info.aca.gencat.cat/ca/aca/informacio/platgescat/perfils-platges/<codi>.pdf, consultats el
// 25/11/2026). OSM no en té cap a la Costa Brava. Les coordenades de l'ACA són UTM 31N ED50 i marquen la boca de
// l'emissari (on aboca, mar endins), no on surt de terra. Aquí es passen a WGS84.
// Sistemes sense emissari (aboquen d'una altra manera): Portbou, Colera, Empuriabrava, Torroella-l'Estartit, Tossa.
// Ús: node tools/make-emissaris.js
const fs = require('fs');
const path = require('path');

// [nom, tipus (P = principal, E = emergència), platja d'on surt, longitud (m), fondària (m), X, Y, perfil de l'ACA]
const ACA = [
  ['Emissari de Llançà', 'P', 'cala de la Gola', 417, 18, 513859, 4691603, '17092A'],
  ['Emissari del Port de la Selva', 'P', 'platja del Port de la Selva', 1275, 42, 516245, 4688369, '17140A'],
  ['Emissari Nou de Cadaqués', 'P', 'platja Gran', 1350, 35, 523913, 4680989, '17032A'],
  ['Emissari Vell de Cadaqués', 'E', 'platja Gran', null, 14, 523200, 4681696, '17032A'],
  ['Canonada de Portlligat', 'E', 'platja de Portlligat', null, 4, 523839, 4682559, '17032A'],
  ["Canonada de s'Arenella", 'E', "platja de s'Arenella", null, 5, 524095, 4681267, '17032A'],
  ['Canonada Ros', 'E', 'platja ses Oliveres', null, 3, 523658, 4681636, '17032A'],
  ['Canonada del Llané', 'E', 'platja del Llané Gran', null, 3, 523017, 4681572, '17032A'],
  ['Emissari de Roses', 'P', 'platja de Roses', 1532, 18, 513611, 4678001, '17152A'],
  ["Emissari de l'Escala", 'P', "port de l'Escala", 1180, 21, 512903, 4664120, '17062A'],
  ['Emissari de sa Tuna', 'P', 'platja de sa Tuna', 891, 50, 520025, 4646340, '17013A'],
  ['Emissari de Fornells', 'P', 'platja de Fornells', 1169, 39, 519068, 4642883, '17013A'],
  ['Emissari de Tamariu', 'P', 'platja de Tamariu', 800, 30, 517669, 4640628, '17117A'],
  ['Emissari de Castell', 'P', 'platja de Castell', 1030, 30, 513051, 4633771, '17118A'],
  ["Emissari de Platja d'Aro", 'P', "Platja Gran de Platja d'Aro", 350, 24, 505907, 4628333, '17048A'],
  ['Emissari de Canyelles', 'P', 'platja de Canyelles', 550, 22, 490454, 4616279, '17095A'],
  ['Emissari de Lloret', 'P', 'platja de Lloret', 1600, 42, 487724, 4614802, '17095A'],
  ['Emissari de Sabanell', 'E', 'platja de Sabanell', 1525, 42, 483442, 4612652, '17023A'],
];

// UTM → geogràfiques sobre l'el·lipsoide de Hayford (ED50), i d'ED50 a WGS84 amb el desplaçament mitjà
// (-87, -98, -121 m): a Catalunya l'error queda en uns pocs metres, més que suficient per a un punt al mapa.
const rad = Math.PI / 180;
function utmToGeo(x, y, zone, a, f) {
  const k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const m = y / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C = ep2 * Math.cos(p) ** 2, T = Math.tan(p) ** 2, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const R = a * (1 - e2) / (1 - e2 * Math.sin(p) ** 2) ** 1.5, D = (x - 500000) / (N * k0);
  const lat = p - (N * Math.tan(p) / R) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T + 298 * C + 45 * T * T - 252 * ep2 - 3 * C * C) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * D ** 5 / 120) / Math.cos(p);
  return [lat / rad, (zone * 6 - 183) + lon / rad];
}
function toCart(lat, lon, a, f) {
  const e2 = f * (2 - f), s = Math.sin(lat * rad), N = a / Math.sqrt(1 - e2 * s * s);
  return [N * Math.cos(lat * rad) * Math.cos(lon * rad), N * Math.cos(lat * rad) * Math.sin(lon * rad), N * (1 - e2) * s];
}
function fromCart([X, Y, Z], a, f) {
  const e2 = f * (2 - f), p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 6; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(Z + e2 * N * Math.sin(lat), p); }
  return [lat / rad, Math.atan2(Y, X) / rad];
}
const HAYFORD = [6378388, 1 / 297], WGS84 = [6378137, 1 / 298.257223563], SHIFT = [-87, -98, -121];
function ed50ToWgs(x, y) {
  const [la, lo] = utmToGeo(x, y, 31, ...HAYFORD);
  const c = toCart(la, lo, ...HAYFORD).map((v, i) => v + SHIFT[i]);
  return fromCart(c, ...WGS84);
}

const items = ACA.map(([name, kind, beach, len, depth, x, y, src]) => {
  const [lat, lon] = ed50ToWgs(x, y);
  return [+lat.toFixed(5), +lon.toFixed(5), name, kind, beach, len, depth, src];
}).sort((a, b) => b[0] - a[0]);

const out = {
  nota: "Emissaris submarins de la Costa Brava, de les taules dels perfils de zona de bany de l'ACA (UTM ED50 passat a WGS84). Es genera amb node tools/make-emissaris.js. [lat, lon, nom, tipus (P principal, E emergència), platja d'on surt, longitud m, fondària m, perfil de l'ACA]. La posició és la boca de l'emissari.",
  font: 'https://info.aca.gencat.cat/ca/aca/informacio/platgescat/perfils-platges/',
  emissaris: items,
};
const file = path.join(__dirname, '..', 'data', 'emissaris.json');
fs.writeFileSync(file, JSON.stringify(out).replace(/\],\[/g, '],\n[') + '\n');
console.log(`${items.length} emissaris → ${path.relative(process.cwd(), file)}`);
for (const i of items) console.log(i.slice(0, 3).join('  '));
