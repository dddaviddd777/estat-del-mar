// Sortides d'emergència: llocs on es pot sortir de l'aigua si la nedada es complica (platges, escales que arriben
// al mar, rampes de barques i ports), d'OpenStreetMap (data/sortides.json, tools/make-exits.js), més les correccions
// fetes a mà (data/sortides-extra.json: { add: [[lat, lon, tipus, nom]], remove: [[lat, lon]] }).

export const EXIT_TYPES = {
  platja: { label: 'platja' },
  escala: { label: 'escala' },
  rampa: { label: 'rampa' },
  port: { label: 'port' },
  altra: { label: 'sortida' },
};
const ROUTE_R = 200; // m: una sortida compta per a la ruta si és a menys de 200 m del recorregut (es neda a ~50 m de costa)
const REMOVE_R = 40; // m: radi de les sortides que es treuen a mà

let exits = null, loading = null;

const rad = (d) => (d * Math.PI) / 180;
const KY = 111320;
const kx = (lat) => 111320 * Math.cos(rad(lat));

export function loadExits() {
  if (exits) return Promise.resolve(exits);
  if (!loading) {
    loading = Promise.all([
      fetch('data/sortides.json').then((r) => { if (!r.ok) throw new Error(`no s'han pogut carregar les sortides (${r.status})`); return r.json(); }),
      fetch('data/sortides-extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([j, extra]) => {
      let list = j.exits.map(([lat, lon, t, n]) => ({ lat, lon, type: j.types[t], name: n >= 0 ? j.names[n] : null }));
      for (const [lat, lon] of extra?.remove ?? []) list = list.filter((e) => Math.hypot((e.lat - lat) * KY, (e.lon - lon) * kx(lat)) > REMOVE_R);
      for (const [lat, lon, type, name] of extra?.add ?? []) list.push({ lat, lon, type: EXIT_TYPES[type] ? type : 'altra', name: name ?? null, manual: true });
      exits = list;
      return exits;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
export const exitsReady = () => !!exits;

/** Sortides dins d'uns límits [s, w, n, e] (per pintar-les al mapa). */
export function exitsIn(s, w, n, e) {
  return exits ? exits.filter((x) => x.lat >= s && x.lat <= n && x.lon >= w && x.lon <= e) : [];
}

// Sense nom: «una escala», «un port»… (no «Escala», que es confondria amb el poble de L'Escala).
export const exitName = (x) => (x.name ? `${x.name}${x.type === 'platja' || !EXIT_TYPES[x.type] ? '' : ` (${EXIT_TYPES[x.type].label})`}` : `${x.type === 'port' ? 'un' : 'una'} ${EXIT_TYPES[x.type]?.label ?? 'sortida'}`);

/**
 * Sortides al llarg d'un recorregut (punts [lat, lon]): cada sortida a menys de 200 m es projecta sobre la línia
 * per saber a quin punt del recorregut queda (`along`, m des de l'inici) i a quina distància (`off`, m).
 * Les sortides molt properes entre elles (< 60 m al llarg de la ruta) es compten com una de sola.
 */
export function exitsAlong(pts) {
  if (!exits || pts.length < 2) return [];
  const lat0 = pts[0][0];
  const X = (p) => [p[1] * kx(lat0), p[0] * KY];
  const P = pts.map(X);
  const lens = [0];
  for (let i = 1; i < P.length; i++) lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  const m = 0.004; // ~400 m de marge
  const cand = exitsIn(Math.min(...lats) - m, Math.min(...lons) - m, Math.max(...lats) + m, Math.max(...lons) + m);
  const out = [];
  for (const x of cand) {
    const [ex, ey] = X([x.lat, x.lon]);
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ey - ay) * dy) / L2));
      const d = Math.hypot(ex - (ax + t * dx), ey - (ay + t * dy));
      if (!best || d < best.off) best = { off: d, along: lens[i] + t * Math.sqrt(L2) };
    }
    if (best.off <= ROUTE_R) out.push({ ...x, ...best });
  }
  out.sort((a, b) => a.along - b.along);
  // Una sola per grup (la més propera a la ruta): una platja llarga té molts punts.
  const merged = [];
  for (const e of out) {
    const last = merged.at(-1);
    if (last && e.along - last.along < 60) { if (e.off < last.off) merged[merged.length - 1] = e; } else merged.push(e);
  }
  return merged;
}
