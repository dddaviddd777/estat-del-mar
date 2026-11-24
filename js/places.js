// Llocs de referència de la costa: coves de mar, fars i desembocadures (data/llocs.json, d'OSM, tools/make-llocs.js),
// més les correccions fetes a mà (data/llocs-extra.json: { add: [[lat, lon, tipus, nom]], remove: [[lat, lon]] }).
// Es dibuixen sota les etiquetes de les platges, i només en acostar-se (si no, serien massa punts).

export const PLACE_TYPES = {
  cova: { label: 'cova', zoom: 13 },
  far: { label: 'far', zoom: 11 },
  riu: { label: 'desembocadura', zoom: 12 },
  cap: { label: 'cap', zoom: Infinity }, // no es dibuixa: dona nom a les puntes de les rutes
};
const REMOVE_R = 40;
const KY = 111320;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export const CAVE_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="#6b4f3a" stroke="#fff" stroke-width="1.6"/><path d="M4 15.5 7.2 6.8c.4-1 1.2-1.6 2.8-1.6s2.4.6 2.8 1.6L16 15.5z" fill="#c9b49a"/><path d="M7.4 15.5v-3.6a2.6 2.6 0 0 1 5.2 0v3.6z" fill="#1d140e"/></svg>';
export const LIGHT_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#f2b33d" stroke="#fff" stroke-width="1.6"/><path d="M8.4 7.2h3.2l.9 8.3H7.5z" fill="#fff" stroke="#6b3d00" stroke-width="1"/><path d="M8 5.2h4v2H8z" fill="#6b3d00"/><path d="M8.2 11h3.6" stroke="#d63a2e" stroke-width="1.4"/><path d="M12.6 5.4 16 4M12.6 6.6 16 7.6M7.4 5.4 4 4M7.4 6.6 4 7.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>';
export const RIVER_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="9" fill="#2f86c9" stroke="#fff" stroke-width="1.6"/><path d="M7.5 3.8c1.8 2-1.6 3.6.4 5.6s-1.4 3.6.6 5.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="M4.2 14.6c1.2-.9 2.4-.9 3.6 0s2.4.9 3.6 0 2.4-.9 3.6 0" fill="none" stroke="#bfe3ff" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICO = { cova: CAVE_ICO, far: LIGHT_ICO, riu: RIVER_ICO };

let places = null, loading = null, map = null, layer = null;
const shown = { cova: true, far: true, riu: true };

export function loadPlaces() {
  if (places) return Promise.resolve(places);
  if (!loading) {
    loading = Promise.all([
      fetch('data/llocs.json').then((r) => { if (!r.ok) throw new Error(`llocs ${r.status}`); return r.json(); }),
      fetch('data/llocs-extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([j, extra]) => {
      let list = j.llocs.map(([lat, lon, t, n]) => ({ lat, lon, type: j.types[t], name: n >= 0 ? j.names[n] : null }));
      for (const [lat, lon] of extra?.remove ?? []) list = list.filter((p) => Math.hypot((p.lat - lat) * KY, (p.lon - lon) * kx(lat)) > REMOVE_R);
      for (const [lat, lon, type, name] of extra?.add ?? []) if (PLACE_TYPES[type]) list.push({ lat, lon, type, name: name ?? null, manual: true });
      places = list;
      return places;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function tip(p) {
  if (p.type === 'cova') return `<b>${esc(p.name ?? 'Cova')}</b><br><small>Cova de mar · amb onada no hi entreu: l'aigua hi xucla i rebota</small>`;
  if (p.type === 'riu') return `<b>${esc(p.name ? `Desembocadura: ${p.name}` : 'Desembocadura')}</b><br><small>Després de pluja l'aigua hi baixa tèrbola i bruta</small>`;
  return `<b>${esc(p.name ?? 'Far')}</b><br><small>Far · bona referència des de l'aigua</small>`;
}

function render() {
  if (!map) return;
  const z = map.getZoom();
  const want = Object.keys(PLACE_TYPES).filter((t) => shown[t] && z >= PLACE_TYPES[t].zoom);
  if (!want.length) { layer.clearLayers(); return; }
  loadPlaces().then(() => {
    layer.clearLayers();
    const b = map.getBounds().pad(0.1);
    for (const p of places) {
      if (!want.includes(p.type) || !b.contains([p.lat, p.lon])) continue;
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: `place-dot ${p.type}`, html: ICO[p.type], iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false, zIndexOffset: -1400 })
        .bindTooltip(tip(p), { direction: 'top', offset: [0, -9] })
        .addTo(layer);
    }
  }).catch(() => {});
}

export function initPlaces(m) {
  map = m;
  layer = L.layerGroup().addTo(map);
  map.on('moveend', render);
  render();
}

/** Llocs d'un tipus a menys de `r` metres del punt, del més proper al més llunyà (cal haver cridat loadPlaces). */
export function placesNear(lat, lon, type, r) {
  if (!places) return [];
  return places.filter((p) => p.type === type)
    .map((p) => ({ ...p, dist: Math.hypot((p.lat - lat) * KY, (p.lon - lon) * kx(lat)) }))
    .filter((p) => p.dist <= r).sort((a, b) => a.dist - b.dist);
}

// Després de pluja, els rius i les rieres porten aigua tèrbola, fang i deixalles (i de vegades sobreeixidors) al mar.
export const RIVER_RAIN = 10; // mm en 48 h
export const RIVER_NEAR = 1500; // m

/** Com es diu en un text: «de la Tordera», «del Ter», «de la riera de Tossa», «d'una riera», «(Daró)». */
export function riverOf(p) {
  const n = p.name;
  if (!n) return "d'una riera";
  const m = n.match(/^(riu|riera|ribera|torrent|rec|còrrec|rierot)(\s.*)$/i);
  if (m) return `${/^(riera|ribera)$/i.test(m[1]) ? 'de la' : 'del'} ${m[1].toLowerCase()}${m[2]}`;
  if (/^(la |l')/i.test(n)) return `de ${n[0].toLowerCase()}${n.slice(1)}`;
  if (/^el /i.test(n)) return `del ${n.slice(3)}`;
  return `(${n})`;
}

/**
 * Avís d'aigua tèrbola si ha plogut (`mm` les 48 h d'abans) i hi ha alguna desembocadura a prop d'algun dels
 * punts (`pts`: [[lat, lon], ...]). Mateix format que weatherAlerts. Cal haver carregat els llocs.
 */
export function riverAlert(pts, mm, t) {
  if (mm == null || mm < RIVER_RAIN || !places) return null;
  let best = null;
  for (const [lat, lon] of pts) for (const p of placesNear(lat, lon, 'riu', RIVER_NEAR)) if (!best || p.dist < best.dist || (p.name && !best.name && p.dist < best.dist + 300)) best = p;
  if (!best) return null;
  const d = best.dist < 150 ? 'tocant a la' : `a ${Math.round(best.dist / 100) * 100} m de la`;
  return { kind: 'riera', level: 'atencio', t, mm, river: best,
    text: `Han caigut ${Math.round(mm)} mm en 48 hores: ${d} desembocadura ${riverOf(best)} l'aigua pot estar tèrbola i bruta (fang, branques, deixalles) durant un o dos dies.` };
}

/** Quins tipus de llocs es veuen ({ cova, far, riu }: bool). */
export function setPlaceKinds(k) {
  Object.assign(shown, k);
  render();
}
