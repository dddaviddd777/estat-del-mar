// Genera data/serveis.json: serveis a tocar de la costa (bars i xiringuitos, dutxes, fonts, lavabos, pàrquings i
// socorristes), d'OpenStreetMap. Necessita data/costa.json (tools/make-coast.js).
//   node tools/make-serveis.js   (baixa per franges; si una falla, en tornar-ho a executar es reaprofiten les fetes)
// Correccions a mà: data/serveis-extra.json ({ add: [[lat, lon, tipus, nom, extres]], remove: [[lat, lon]] }).
// Extres (bits): 1 = pàrquing de pagament, 2 = places per a persones amb mobilitat reduïda.
const path = require('path');
const { coastDist, download, writeData, dedupe } = require('./osm.js');

const OUT = path.join(__dirname, '..', 'data', 'serveis.json');
const TYPES = ['bar', 'dutxa', 'aigua', 'wc', 'parking', 'socorrista'];
// Fins a quina distància de la línia de costa (m) compta com a servei de platja.
const NEAR = { bar: 150, restaurant: 60, dutxa: 150, aigua: 150, wc: 200, parking: 300, socorrista: 200 };

function typeOf(t) {
  if (t.emergency === 'lifeguard') return 'socorrista';
  switch (t.amenity) {
    case 'bar': case 'cafe': case 'pub': return 'bar';
    case 'restaurant': return 'restaurant'; // només els de primera línia (xiringuitos)
    case 'shower': return 'dutxa';
    case 'drinking_water': return 'aigua';
    case 'toilets': return 'wc';
    case 'parking': case 'parking_space': return 'parking';
  }
  return null;
}

(async () => {
  const els = await download('serveis', (b) =>
    `nwr["amenity"~"^(bar|cafe|pub|restaurant|shower|drinking_water|toilets|parking)$"](${b});nwr["amenity"="parking_space"]["parking_space"="disabled"](${b});nwr["emergency"="lifeguard"](${b});`);
  const out = [];
  for (const e of els) {
    const t = e.tags ?? {};
    let type = typeOf(t);
    if (!type) continue;
    if (type === 'parking' && /^(private|customers|no)$/.test(t.access ?? '')) continue;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null || coastDist(lat, lon) > NEAR[type]) continue;
    if (type === 'restaurant') type = 'bar';
    let flags = 0;
    if (type === 'parking') {
      if (t.fee === 'yes') flags |= 1;
      const dis = t['capacity:disabled'];
      if (t.parking_space === 'disabled' || t.wheelchair === 'designated' || (dis && dis !== 'no' && dis !== '0')) flags |= 2;
    }
    out.push({ lat, lon, type, name: type === 'bar' || type === 'parking' ? t.name ?? null : null, flags });
  }
  out.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));
  // Una plaça adaptada sola, a tocar d'un pàrquing: es marca el pàrquing en lloc de sortir dues vegades.
  const items = dedupe(out, 20);
  for (const o of out) if (o.flags & 2 && !items.includes(o)) {
    const p = items.find((u) => u.type === 'parking' && Math.hypot((u.lat - o.lat) * 111320, (u.lon - o.lon) * 82700) < 20);
    if (p) p.flags |= 2;
  }
  writeData(OUT, 'serveis', TYPES, items, (o) => (o.flags ? [o.flags] : []));
})();
