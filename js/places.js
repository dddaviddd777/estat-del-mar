// Llocs de referència de la costa: coves de mar, fars i desembocadures (data/llocs.json, d'OSM, tools/make-llocs.js),
// més les correccions fetes a mà (data/llocs-extra.json: { add: [[lat, lon, tipus, nom]], remove: [[lat, lon]] }), i els
// emissaris submarins de l'ACA (data/emissaris.json, tools/make-emissaris.js).
// Es dibuixen sota les etiquetes de les platges, i només en acostar-se (si no, serien massa punts).

export const PLACE_TYPES = {
  cova: { label: 'cova', zoom: 13 },
  far: { label: 'far', zoom: 11 },
  riu: { label: 'desembocadura', zoom: 12 },
  emissari: { label: 'emissari', zoom: 12 },
  cap: { label: 'cap', zoom: Infinity }, // no es dibuixa: dona nom a les puntes de les rutes
};
const REMOVE_R = 40;
const KY = 111320;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export const CAVE_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="#6b4f3a" stroke="#fff" stroke-width="1.6"/><path d="M4 15.5 7.2 6.8c.4-1 1.2-1.6 2.8-1.6s2.4.6 2.8 1.6L16 15.5z" fill="#c9b49a"/><path d="M7.4 15.5v-3.6a2.6 2.6 0 0 1 5.2 0v3.6z" fill="#1d140e"/></svg>';
export const LIGHT_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#f2b33d" stroke="#fff" stroke-width="1.6"/><path d="M8.4 7.2h3.2l.9 8.3H7.5z" fill="#fff" stroke="#6b3d00" stroke-width="1"/><path d="M8 5.2h4v2H8z" fill="#6b3d00"/><path d="M8.2 11h3.6" stroke="#d63a2e" stroke-width="1.4"/><path d="M12.6 5.4 16 4M12.6 6.6 16 7.6M7.4 5.4 4 4M7.4 6.6 4 7.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>';
export const RIVER_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="9" fill="#2f86c9" stroke="#fff" stroke-width="1.6"/><path d="M7.5 3.8c1.8 2-1.6 3.6.4 5.6s-1.4 3.6.6 5.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="M4.2 14.6c1.2-.9 2.4-.9 3.6 0s2.4.9 3.6 0 2.4-.9 3.6 0" fill="none" stroke="#bfe3ff" stroke-width="1.5" stroke-linecap="round"/></svg>';
// Emissari: un tub que acaba en un difusor, amb bombolles que pugen.
export const OUTFALL_ICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#7d5aa6" stroke="#fff" stroke-width="1.6"/><path d="M3.6 12.6h7.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M11.6 10.2v4.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="14.4" cy="11.2" r="1.15" fill="#e6dcf3"/><circle cx="15.2" cy="7.6" r="1" fill="#e6dcf3"/><circle cx="13" cy="5.2" r=".85" fill="#e6dcf3"/></svg>';
const ICO = { cova: CAVE_ICO, far: LIGHT_ICO, riu: RIVER_ICO, emissari: OUTFALL_ICO };

let places = null, loading = null, map = null, layer = null;
const shown = { cova: true, far: true, riu: true, emissari: true };

export function loadPlaces() {
  if (places) return Promise.resolve(places);
  if (!loading) {
    loading = Promise.all([
      fetch('data/llocs.json').then((r) => { if (!r.ok) throw new Error(`llocs ${r.status}`); return r.json(); }),
      fetch('data/llocs-extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('data/emissaris.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([j, extra, emi]) => {
      let list = j.llocs.map(([lat, lon, t, n]) => ({ lat, lon, type: j.types[t], name: n >= 0 ? j.names[n] : null }));
      for (const [lat, lon] of extra?.remove ?? []) list = list.filter((p) => Math.hypot((p.lat - lat) * KY, (p.lon - lon) * kx(lat)) > REMOVE_R);
      for (const [lat, lon, type, name] of extra?.add ?? []) if (PLACE_TYPES[type]) list.push({ lat, lon, type, name: name ?? null, manual: true });
      for (const [lat, lon, name, kind, beach, len, depth] of emi?.emissaris ?? []) list.push({ lat, lon, type: 'emissari', name, kind, beach, len, depth });
      places = list;
      return places;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function tip(p) {
  if (p.type === 'cova') return `<b>${esc(p.name ?? 'Cova')}</b><br><small>Cova de mar · amb onada no hi entreu: l'aigua hi xucla i rebota</small>`;
  if (p.type === 'emissari') return `<b>${esc(p.name)}</b><br><small>${p.kind === 'E' ? "D'emergència: només aboca si falla el sistema o amb pluja forta" : 'Aboca l\'aigua depurada'} · ${p.len ? `${p.len.toLocaleString('ca')} m mar endins, ` : ''}a ${p.depth} m de fons · surt de la ${esc(p.beach)}.<br>Després de pluja forta, l'aigua del voltant pot estar bruta. Font: ACA</small>`;
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
        .bindTooltip(tip(p), { direction: 'top', offset: [0, -9], className: 'place-tip' })
        .on('tooltipopen', flipTip)
        .addTo(layer);
    }
  }).catch(() => {});
}

/**
 * Els globus s'obren cap amunt, però si el punt és a la meitat de dalt del mapa, cap avall: a dalt hi ha el requadre de
 * la temperatura de l'aigua i el bàner d'avisos, que queden per sobre i el tapaven (l'usuari, 25/11/2026).
 * Per fer servir com a `marker.on('tooltipopen', flipTip)`.
 */
export function flipTip(e) {
  const t = e.tooltip, mp = t._map;
  if (!mp) return;
  const down = mp.latLngToContainerPoint(t.getLatLng()).y < mp.getSize().y * 0.45;
  const dir = down ? 'bottom' : 'top';
  if (t.options.direction === dir) return;
  const off = Math.abs(t.options.offset?.[1] ?? 9);
  t.options.direction = dir;
  t.options.offset = [0, down ? off : -off];
  t.update();
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

// ---------- Emissaris submarins (data/emissaris.json, de l'ACA, tools/make-emissaris.js) ----------
// Aboquen al mar l'aigua de les depuradores, uns centenars de metres o més d'un km mar endins. Els d'emergència (E)
// només aboquen si falla el sistema o amb pluja forta. Després de pluja forta el clavegueram també pot sobreeixir.
export const OUTFALL_NEAR = 1000; // m: avís de la platja o la ruta si ha plogut
/** «l'emissari de Lloret», «la canonada Ros». */
export const outfallRef = (p) => `${/^canonada/i.test(p.name) ? 'la ' : "l'"}${p.name[0].toLowerCase()}${p.name.slice(1)}`;
/** Què és i on és: «Emissari de la depuradora (surt de la platja de Lloret, 1.600 m mar endins, a 42 m de fondària): …» */
export function outfallText(p) {
  const where = `surt de la ${p.beach}${p.len ? `, ${p.len.toLocaleString('ca')} m mar endins` : ''}, a ${p.depth} m de fondària`;
  return p.kind === 'E' ? `Emissari d'emergència (${where}): només aboca si falla la depuradora o el bombament, o amb pluja forta.`
    : `Emissari de la depuradora (${where}): hi aboca l'aigua depurada.`;
}

// ---------- Aigua tèrbola o bruta ----------
// Després de pluja, els rius i les rieres porten aigua tèrbola, fang i deixalles al mar, i el clavegueram pot sobreeixir
// (sobreeixidors i emissaris). Després de mala mar, la sorra remoguda enterboleix l'aigua i es veu poc.
export const RIVER_RAIN = 10; // mm en 48 h
export const RIVER_NEAR = 1500; // m
export const ROUGH_BEFORE = 1.0; // m d'onada a la platja (mala mar) les 48 h d'abans

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

const nf1 = new Intl.NumberFormat('ca', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** «d'1,2 m», «de 2,0 m». */
const deNum = (x) => (/^1(,|$)|^11(,|$)/.test(x) ? `d'${x}` : `de ${x}`);
/** «tocant a la desembocadura del Ter», «a 600 m de l'emissari de Lloret». */
const atRef = (dist, ref) => (dist < 150 ? `tocant a ${ref}` : `a ${Math.round(dist / 100) * 100} m de ${ref}`);

/**
 * Avís d'aigua tèrbola o bruta per a una platja o una ruta (`pts`: [[lat, lon], ...]), en el format de weatherAlerts:
 * - si han caigut ≥ 10 mm les 48 h d'abans (`mm`) i hi ha una desembocadura a < 1,5 km o un emissari a < 1 km;
 * - si fa poc hi ha hagut mala mar (`rough`, de roughBefore: ≥ 1 m a la platja) i ara ja s'ha calmat.
 * La part de la pluja necessita els llocs carregats (loadPlaces).
 */
export function waterAlert(pts, { mm, rough, t }) {
  const rain = mm != null && mm >= RIVER_RAIN && !!places;
  const nearest = (type, r) => {
    let best = null;
    for (const [lat, lon] of pts) for (const p of placesNear(lat, lon, type, r)) if (!best || p.dist < best.dist || (p.name && !best.name && p.dist < best.dist + 300)) best = p;
    return best;
  };
  const river = rain ? nearest('riu', RIVER_NEAR) : null;
  const outfall = rain ? nearest('emissari', OUTFALL_NEAR) : null;
  const wasRough = !!rough && rough.hs >= ROUGH_BEFORE && (rough.now == null || rough.now < ROUGH_BEFORE);
  if (!river && !outfall && !wasRough) return null;
  const parts = [];
  if (river || outfall) {
    const refs = [river && atRef(river.dist, `la desembocadura ${riverOf(river)}`), outfall && atRef(outfall.dist, outfallRef(outfall))].filter(Boolean);
    parts.push(`han caigut ${Math.round(mm)} mm en 48 hores i ${refs.join(' i ')} l'aigua pot estar bruta (fang, branques, deixalles${outfall ? ' i, si el clavegueram sobreeixeix, aigües residuals' : ''}) durant un o dos dies`);
  }
  if (wasRough) {
    const ago = Math.max(3, Math.round((t - rough.t) / 3600));
    parts.push(`fa unes ${ago} hores hi havia mala mar (onada ${deNum(nf1.format(rough.hs))} m a la platja): la sorra remoguda enterboleix l'aigua i s'hi veu poc`);
  }
  return { kind: 'aigua', level: 'atencio', t, mm, river, outfall, rough: wasRough ? rough : null, why: { rain: !!(river || outfall), rough: wasRough },
    text: `Aigua tèrbola: ${parts.join('. A més, ')}.` };
}
/** El mateix avís, en general, per a tota la costa (quan afecta més d'una platja). */
export function waterAlertText(why) {
  const p = [];
  if (why.rain) p.push("ha plogut força les últimes 48 hores i prop de les desembocadures i dels emissaris l'aigua pot estar bruta durant un o dos dies");
  if (why.rough) p.push("fa poc hi havia mala mar i la sorra remoguda enterboleix l'aigua");
  return `Aigua tèrbola: ${p.join('. A més, ')}.`;
}

/** Quins tipus de llocs es veuen ({ cova, far, riu }: bool). */
export function setPlaceKinds(k) {
  Object.assign(shown, k);
  render();
}
