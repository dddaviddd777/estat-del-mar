// Genera data/llocs.json: coves de mar, fars i desembocadures de rius i rieres de la Costa Brava, d'OpenStreetMap.
// Necessita data/costa.json (tools/make-coast.js) per quedar-se només amb el que toca el mar.
//   node tools/make-llocs.js   (baixa per franges; si una falla, en tornar-ho a executar es reaprofiten les fetes)
// Correccions a mà: data/llocs-extra.json ({ add: [[lat, lon, tipus, nom]], remove: [[lat, lon]] }), que llegeix l'app.
const path = require('path');
const { coastDist, download, writeData, dedupe } = require('./osm.js');

const OUT = path.join(__dirname, '..', 'data', 'llocs.json');
const TYPES = ['cova', 'far', 'riu', 'cap'];
// Com de prop de la línia de costa (m): una cova de mar té la boca a l'aigua; un far, dalt del cap; un riu hi acaba.
// Els caps amb nom (natural=cape) no es dibuixen: donen nom a les puntes per on passa una ruta.
const NEAR = { cova: 60, far: 300, riu: 80, cap: 300 };

(async () => {
  const els = await download('llocs', (b) =>
    `nwr["natural"="cave_entrance"](${b});nwr["man_made"="lighthouse"](${b});node["natural"="cape"]["name"](${b});way["waterway"="river"](${b});way["waterway"="stream"]["name"](${b});`,
  { out: 'out geom tags;' });
  const out = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (t.waterway) {
      // Una desembocadura: l'extrem del riu que toca el mar.
      const g = (e.geometry ?? []).filter(Boolean);
      if (g.length < 2) continue;
      for (const p of [g[0], g.at(-1)]) if (coastDist(p.lat, p.lon) <= NEAR.riu) out.push({ lat: p.lat, lon: p.lon, type: 'riu', name: t.name ?? null });
      continue;
    }
    const type = t.natural === 'cave_entrance' ? 'cova' : t.man_made === 'lighthouse' ? 'far' : t.natural === 'cape' ? 'cap' : null;
    if (!type) continue;
    // A OSM, els llums d'entrada dels ports (dics i escullera) també són man_made=lighthouse, però no tenen nom ni són
    // edificis i s'hi veuen a 3-5 milles: a Palamós en sortien set. Els fars de veritat tenen nom (Far de Palamós, de
    // Tossa, Sant Sebastià…) o, com el de Roses, són un edifici i s'hi veuen de lluny.
    if (type === 'far' && !t.name && t.building !== 'yes' && !(Number(t['seamark:light:range']) >= 10)) continue;
    let lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null && e.geometry?.length) { lat = e.geometry[0].lat; lon = e.geometry[0].lon; }
    if (lat == null && e.bounds) { lat = (e.bounds.minlat + e.bounds.maxlat) / 2; lon = (e.bounds.minlon + e.bounds.maxlon) / 2; }
    if (lat == null || coastDist(lat, lon) > NEAR[type]) continue;
    out.push({ lat, lon, type, name: t.name ?? null });
  }
  // Primer els que tenen nom; dues entrades de la mateixa cova (< 25 m) o trams del mateix riu (< 300 m), una de sola.
  out.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0));
  const items = [...dedupe(out.filter((o) => o.type !== 'riu'), 25), ...dedupe(out.filter((o) => o.type === 'riu'), 300)];
  writeData(OUT, 'llocs', TYPES, items);
})();
