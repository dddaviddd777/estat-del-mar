// Serveis a tocar del mar: bars i xiringuitos, dutxes, fonts, lavabos, pàrquings i socorristes (data/serveis.json,
// d'OpenStreetMap, tools/make-serveis.js), més les correccions a mà (data/serveis-extra.json: { add: [[lat, lon,
// tipus, nom, extres]], remove: [[lat, lon]] }). Al mapa només surten molt a prop (zoom ≥ 14) i els tipus triats al
// panell «Mapa»; a la fitxa de la platja i a la de la ruta es resumeix què hi ha a prop.

const KY = 111320;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const REMOVE_R = 30;
export const SERVICE_ZOOM = 14;

const sq = (fill, inner) => `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="${fill}" stroke="#fff" stroke-width="1.6"/>${inner}</svg>`;
const txt = (t, size = 10) => `<text x="10" y="${10 + size * 0.36}" text-anchor="middle" font-size="${size}" font-weight="800" font-family="system-ui,sans-serif" fill="#fff">${t}</text>`;
export const SERVICE_TYPES = {
  bar: { color: '#d9822b', name: 'Bars i xiringuitos', one: 'bar', many: 'bars', ico: sq('#d9822b', '<path d="M5.5 7h7.5v4.2a3.4 3.4 0 0 1-3.4 3.4h-.7a3.4 3.4 0 0 1-3.4-3.4z" fill="#fff"/><path d="M13 8.3h.9a1.6 1.6 0 0 1 0 3.2H13" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M5 16h9" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>') },
  dutxa: { color: '#1e9bb0', name: 'Dutxes', one: 'dutxa', many: 'dutxes', ico: sq('#1e9bb0', '<path d="M5 4.5h4.5a3 3 0 0 1 3 3V8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 8.3h6l-.8 1.6h-4.4z" fill="#fff"/><path d="M10.7 12v1.2M12.5 12v1.8M14.3 12v1.2M11.6 15v1M13.4 15v1" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>') },
  aigua: { color: '#3b82d6', name: 'Fonts d\'aigua', one: 'font', many: 'fonts', ico: sq('#3b82d6', '<path d="M10 4.2c2.3 3 3.9 5 3.9 7.2a3.9 3.9 0 0 1-7.8 0c0-2.2 1.6-4.2 3.9-7.2z" fill="#fff"/>') },
  wc: { color: '#6c6fa8', name: 'Lavabos', one: 'lavabo', many: 'lavabos', ico: sq('#6c6fa8', txt('WC', 7.5)) },
  parking: { color: '#2463c7', name: 'Pàrquings', one: 'pàrquing', many: 'pàrquings', ico: sq('#2463c7', txt('P', 11.5)) },
  socorrista: { color: '#d63a2e', name: 'Socorristes', one: 'socorrista', many: 'socorristes', ico: sq('#d63a2e', '<path d="M8.4 4.5h3.2v3.9h3.9v3.2h-3.9v3.9H8.4v-3.9H4.5V8.4h3.9z" fill="#fff"/>') },
};
export const SERVICE_KINDS = Object.keys(SERVICE_TYPES);

let list = null, loading = null, map = null, layer = null;
const shown = Object.fromEntries(SERVICE_KINDS.map((k) => [k, false]));
const listeners = [];

/** Carrega els serveis (una sola vegada); en acabar avisa els que ho hagin demanat amb onServices. */
export function loadServices() {
  if (list) return Promise.resolve(list);
  if (!loading) {
    loading = Promise.all([
      fetch('data/serveis.json').then((r) => { if (!r.ok) throw new Error(`serveis ${r.status}`); return r.json(); }),
      fetch('data/serveis-extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([j, extra]) => {
      let l = j.serveis.map(([lat, lon, t, n, f]) => ({ lat, lon, type: j.types[t], name: n >= 0 ? j.names[n] : null, flags: f ?? 0 }));
      for (const [lat, lon] of extra?.remove ?? []) l = l.filter((p) => Math.hypot((p.lat - lat) * KY, (p.lon - lon) * kx(lat)) > REMOVE_R);
      for (const [lat, lon, type, name, f] of extra?.add ?? []) if (SERVICE_TYPES[type]) l.push({ lat, lon, type, name: name ?? null, flags: f ?? 0, manual: true });
      list = l;
      listeners.forEach((f) => f());
      return list;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
export const servicesReady = () => !!list;
export function onServices(f) { listeners.push(f); }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function parkingNote(f) {
  return [f & 1 ? 'de pagament' : null, f & 2 ? 'amb places adaptades' : null].filter(Boolean).join(' · ');
}
// Enllaços a Google Maps: un bar, per veure'l (horari, fotos, ressenyes); un pàrquing, per anar-hi en cotxe.
export const placeUrl = (p) => (p.name
  ? `https://www.google.com/maps/search/${encodeURIComponent(p.name)}/@${p.lat},${p.lon},18z`
  : `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`);
export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving`;
const GM_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const link = (href, text) => `<a class="gm-link" href="${href}" target="_blank" rel="noopener">${text}</a>`;
/** Contingut del globus en tocar un bar o un pàrquing del mapa. */
function popupHtml(p) {
  const a = p.type === 'parking' ? link(directionsUrl(p), `${GM_ICO}Com arribar-hi (Google Maps)`) : link(placeUrl(p), `${GM_ICO}Obre a Google Maps`);
  return `<div class="svc-pop">${tip(p)}${a}</div>`;
}

function tip(p) {
  const T = SERVICE_TYPES[p.type];
  const title = p.name ?? T.one[0].toUpperCase() + T.one.slice(1);
  const sub = p.type === 'parking' ? [p.name ? 'Pàrquing' : '', parkingNote(p.flags)].filter(Boolean).join(' · ') : p.name ? T.one[0].toUpperCase() + T.one.slice(1) : '';
  return `<b>${esc(title)}</b>${sub ? `<br><small>${esc(sub)}</small>` : ''}`;
}

// Els punts que ja hi són es queden (si no, en moure el mapa per ensenyar un globus sencer, el globus desapareixeria).
const marks = new Map(); // servei → marcador
function render() {
  if (!map) return;
  const want = SERVICE_KINDS.filter((k) => shown[k]);
  if (!want.length || map.getZoom() < SERVICE_ZOOM) { layer.clearLayers(); marks.clear(); return; }
  loadServices().then(() => {
    const b = map.getBounds().pad(0.1);
    const keep = new Set();
    for (const p of list) {
      if (!want.includes(p.type) || !b.contains([p.lat, p.lon])) continue;
      keep.add(p);
      if (marks.has(p)) continue;
      const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: `svc-dot ${p.type}`, html: SERVICE_TYPES[p.type].ico, iconSize: [16, 16], iconAnchor: [8, 8] }), keyboard: false, zIndexOffset: -1500 })
        .bindTooltip(tip(p), { direction: 'top', offset: [0, -8] })
        .addTo(layer);
      // Bars i pàrquings: en tocar-los, un globus amb l'enllaç a Google Maps.
      if (p.type === 'bar' || p.type === 'parking') mk.bindPopup(popupHtml(p), { offset: [0, -6], autoPanPadding: [12, 12], className: 'svc-popup' }).on('popupopen', () => mk.closeTooltip());
      marks.set(p, mk);
    }
    for (const [p, mk] of marks) if (!keep.has(p) && !mk.isPopupOpen()) { layer.removeLayer(mk); marks.delete(p); }
  }).catch(() => {});
}

export function initServices(m) {
  map = m;
  layer = L.layerGroup().addTo(map);
  map.on('moveend', render);
  render();
}

/** Quins tipus de serveis es veuen al mapa ({ bar, dutxa, ... }: bool). */
export function setServiceKinds(k) {
  Object.assign(shown, k);
  render();
}

/** Serveis a menys de `r` m del punt, per tipus: { bar: [{..., dist}], ... } (buit si encara no s'han carregat). */
export function servicesNear(lat, lon, r) {
  const out = {};
  for (const p of list ?? []) {
    const d = Math.hypot((p.lat - lat) * KY, (p.lon - lon) * kx(lat));
    if (d > r) continue;
    (out[p.type] ??= []).push({ ...p, dist: d });
  }
  for (const k in out) out[k].sort((a, b) => a.dist - b.dist);
  return out;
}

/** Una línia de text per tipus de servei a prop: [{ type, text }] («3 bars: X, Y… · a 50 m»). */
export function servicesLines(lat, lon, r, html = false) {
  const near = servicesNear(lat, lon, r);
  const q = html ? esc : (x) => x;
  const out = [];
  for (const k of SERVICE_KINDS) {
    const g = near[k];
    if (!g?.length) continue;
    const T = SERVICE_TYPES[k];
    let t = g.length === 1 ? `${T.one[0].toUpperCase()}${T.one.slice(1)}` : `${g.length} ${T.many}`;
    if (k === 'bar') {
      const named = [...new Map(g.filter((p) => p.name).map((p) => [p.name, p])).values()].slice(0, 3);
      if (named.length) t += `: ${named.map((p) => (html ? link(placeUrl(p), esc(p.name)) : p.name)).join(', ')}${g.length > named.length ? '…' : ''}`;
    } else if (k === 'parking') {
      const f = g.reduce((a, p) => a | p.flags, 0), free = g.some((p) => !(p.flags & 1));
      const notes = [f & 1 ? (free ? 'algun de pagament' : 'de pagament') : null, f & 2 ? 'places adaptades' : null].filter(Boolean);
      if (notes.length) t += ` (${notes.join(', ')})`;
    }
    t += ` · a ${Math.max(10, Math.round(g[0].dist / 10) * 10)} m`;
    if (html && k === 'parking') t += ` · ${link(directionsUrl(g[0]), 'com arribar-hi')}`;
    out.push({ type: k, text: t });
  }
  return out;
}

/**
 * Resum en HTML dels serveis a prop: una línia per tipus amb la icona («3 bars: Xiringuito X, …», «pàrquing de
 * pagament a 200 m»). Retorna '' si no n'hi ha cap (o si encara no s'han carregat).
 */
export function servicesHtml(lat, lon, r) {
  const rows = servicesLines(lat, lon, r, true).map((l) => `<li><span class="svc-ico">${SERVICE_TYPES[l.type].ico}</span>${l.text}</li>`);
  return rows.length ? `<ul class="svc-list">${rows.join('')}</ul>` : '';
}
