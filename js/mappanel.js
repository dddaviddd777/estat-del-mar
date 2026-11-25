// Panell «Mapa»: un sol botó (sota el de la ruta) per triar què es veu. Fa alhora de llegenda: cada fila porta la
// mateixa icona que surt al mapa. Capes del temps (colors: onades, ratxes o pluja; moviment: vent o corrents), llocs
// (platges, punts, boies, sortides, ports, coves, fars, desembocadures, emissaris, la ruta) i serveis (bars, dutxes, fonts,
// lavabos, pàrquings, socorristes), amb tres botons ràpids. Es recorda a `mapShow` (les capes, a `mapLayers`).
import * as store from './store.js';
import { setLayer, layersOn, WAVE_STOPS, GUST_STOPS, RAIN_STOPS, CUR_STOPS } from './layers.js';
import { setExitKinds, setRouteShown, EXIT_ICO, PORT_ICO } from './routeui.js';
import { setPlaceKinds, CAVE_ICO, LIGHT_ICO, RIVER_ICO, OUTFALL_ICO } from './places.js';
import { setServiceKinds, SERVICE_TYPES, SERVICE_KINDS } from './services.js';

const ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5"/></svg>';
const WIND_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="#24978a"/><path d="M4 8h8.5a2.2 2.2 0 1 0-2.2-2.2M4 12h10.5a2.2 2.2 0 1 1-2.2 2.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
const BEACH_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#3ccf7a" stroke="#fff" stroke-width="1.6"/><text x="10" y="13.4" text-anchor="middle" font-size="8.5" font-weight="700" font-family="system-ui,sans-serif" fill="#0b1d2c">8,5</text></svg>';
const PT_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="#1a73e8" stroke="#fff" stroke-width="2.4"/></svg>';
const CUR_SW = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="${CUR_STOPS[2][1]}"/><path d="M3.5 8c2-1.6 4-1.6 6 0s4 1.6 6 0M3.5 12.5c2-1.6 4-1.6 6 0s4 1.6 6 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="m14 10.2 2.4 2.3-2.4 2.3" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ROUTE_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16c3-1 3-6 7-7s4-5 7-6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M3 16c3-1 3-6 7-7s4-5 7-6" fill="none" stroke="#f2b33d" stroke-width="3" stroke-linecap="round"/></svg>';

const PLACES = [
  { k: 'platges', name: 'Platges', sub: 'nota, onada i vent' },
  { k: 'punts', name: 'Els meus punts' },
  { k: 'boies', name: 'Boies' },
  { k: 'sortides', name: 'Sortides', sub: 'platges, escales i rampes · de prop' },
  { k: 'ports', name: 'Ports', sub: 'de prop' },
  { k: 'coves', name: 'Coves', sub: 'de mar · de prop' },
  { k: 'fars', name: 'Fars' },
  { k: 'rius', name: 'Desembocadures', sub: 'rius i rieres · aigua tèrbola després de pluja' },
  { k: 'emissaris', name: 'Emissaris', sub: 'de les depuradores · on aboquen (ACA)' },
  { k: 'ruta', name: 'La meva ruta' },
];
// Noms curts dels serveis per als botons del panell.
const SVC_SHORT = { bar: 'Bars', dutxa: 'Dutxes', aigua: 'Fonts', wc: 'Lavabos', parking: 'Pàrquings', socorrista: 'Socorristes' };
const KEYS = [...PLACES.map((p) => p.k), ...SERVICE_KINDS.map((k) => `svc_${k}`)];
const fill = (v, extra = {}) => ({ ...Object.fromEntries(KEYS.map((k) => [k, v])), ...extra });
const svcOff = Object.fromEntries(SERVICE_KINDS.map((k) => [`svc_${k}`, false]));
// Per defecte, tots els llocs i cap servei (en acostar-se, serien molts punts).
const DEFAULT = fill(true, svcOff);
const PRESETS = {
  tot: { label: 'Tot', show: fill(true) },
  ruta: { label: 'Només la ruta', show: fill(false, { ruta: true, sortides: true, ports: true }) },
  explora: { label: 'Explorar la costa', show: fill(true, { ...svcOff, boies: false }) },
};

let map = null, ui = null, show = { ...DEFAULT };
// Fons del mapa: OSM o satèl·lit amb noms (ortofoto de l'ICGC). La foto ajuda on la platja és poc fonda i al mapa no es
// distingeix bé la sorra de l'aigua.
let base = 'mapa', osm = null, sat = null;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ICGC = 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts';
function setBase(v) {
  base = v === 'sat' ? 'sat' : 'mapa';
  if (base === 'sat') {
    // L'ortofoto híbrida de l'ICGC (com al Track-Map): la foto aèria amb els noms de pobles, platges, cales, caps i
    // puntes. Només cobreix Catalunya: a sota, la foto d'Esri, per si es mira més enllà.
    sat ??= L.layerGroup([
      L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 17, maxNativeZoom: 18 }),
      L.tileLayer(`${ICGC}/orto-hibrida/MON3857NW/{z}/{x}/{y}.png`, { maxZoom: 17, maxNativeZoom: 19,
        attribution: 'Ortofoto © <a href="https://www.icgc.cat" target="_blank" rel="noopener">ICGC</a> CC BY 4.0 · Esri' }),
    ]);
    if (osm && map.hasLayer(osm)) map.removeLayer(osm);
    // Al fons de tot, primer l'ICGC i després Esri: així Esri queda a sota i els noms de l'ICGC es veuen.
    if (!map.hasLayer(sat)) { sat.addTo(map); sat.getLayers().reverse().forEach((l) => l.bringToBack()); }
  } else {
    if (sat && map.hasLayer(sat)) map.removeLayer(sat);
    if (osm && !map.hasLayer(osm)) { osm.addTo(map); osm.bringToBack(); }
  }
  document.body.classList.toggle('sat', base === 'sat');
  store.set('mapBase', base);
  if (ui) ui.panel.querySelectorAll('[data-base]').forEach((b) => b.classList.toggle('on', b.dataset.base === base));
}

function apply() {
  const b = document.body.classList;
  b.toggle('hide-platges', !show.platges);
  b.toggle('hide-punts', !show.punts);
  b.toggle('hide-boies', !show.boies);
  setExitKinds({ sortides: show.sortides, ports: show.ports });
  setPlaceKinds({ cova: show.coves, far: show.fars, riu: show.rius, emissari: show.emissaris });
  setServiceKinds(Object.fromEntries(SERVICE_KINDS.map((k) => [k, !!show[`svc_${k}`]])));
  setRouteShown(show.ruta);
  store.set('mapShow', { ...show });
  renderPanel();
}

function renderPanel() {
  if (!ui) return;
  const L1 = layersOn();
  ui.panel.querySelectorAll('[data-l]').forEach((i) => { i.checked = !!L1[i.dataset.l]; });
  ui.panel.querySelectorAll('[data-s]').forEach((i) => { i.checked = !!show[i.dataset.s]; });
  const same = (a) => KEYS.every((k) => !!a[k] === !!show[k]);
  ui.panel.querySelectorAll('[data-p]').forEach((c) => c.classList.toggle('on', same(PRESETS[c.dataset.p].show)));
  // El botó es marca si hi ha alguna capa encesa o algun lloc amagat (perquè se sàpiga que el mapa no és el de sempre).
  ui.btn.classList.toggle('on', Object.values(L1).some(Boolean) || !same(DEFAULT));
}

const row = (attr, ico, name, sub) => `<label class="mp-row"><span class="mp-ico">${ico}</span><span class="mp-nm">${name}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" ${attr}><span class="sw"></span></label>`;

function openPanel(open) {
  ui.panel.hidden = !open;
  ui.btn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  // El panell va de dalt a baix del mapa, a la dreta de la columna de botons; si no hi cap, es desplaça per dins.
  const mb = map.getContainer().getBoundingClientRect(), cb = ui.el.getBoundingClientRect();
  ui.panel.style.top = `${mb.top + 8 - cb.top}px`;
  ui.panel.style.maxHeight = `${mb.height - 16}px`;
}

/** Crea el botó i el panell. `o.buoyIco`: la icona de les boies (la mateixa del mapa). */
export function initMapPanel(m, o = {}) {
  map = m;
  osm = o.osm ?? null;
  const saved = store.get('mapShow', null);
  if (saved) show = { ...DEFAULT, ...saved };
  else if (store.get('hideMarks', false)) show = { ...DEFAULT, platges: false, punts: false, boies: false }; // l'antic botó de l'ull
  const icons = { platges: BEACH_SW, punts: PT_SW, boies: `<span class="mp-buoy">${o.buoyIco ?? ''}</span>`, sortides: EXIT_ICO, ports: PORT_ICO, coves: CAVE_ICO, fars: LIGHT_ICO, rius: RIVER_ICO, emissaris: OUTFALL_ICO, ruta: ROUTE_SW };
  const grad = (S, n = S.length) => `<i class="mp-grad" style="background:linear-gradient(135deg, ${S.slice(0, n).map(([, c]) => c).join(', ')})"></i>`;
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'leaflet-bar layers-ctl');
      el.innerHTML = `<a href="#" role="button" title="Mapa: capes i llocs" aria-label="Mapa: capes i llocs" aria-expanded="false">${ICO}</a>
        <div class="layers-panel" hidden>
          <div class="mp-top"><b>Mapa</b><button class="mp-x" aria-label="Tanca">✕</button></div>
          <div class="mp-h">Fons</div>
          <div class="mp-chips"><button data-base="mapa">Mapa</button><button data-base="sat">Satèl·lit</button></div>
          <div class="mp-h">Botons ràpids</div>
          <div class="mp-chips">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}">${p.label}</button>`).join('')}</div>
          <div class="mp-h">Temps · colors <small>una a la vegada</small></div>
          ${row('data-l="waves"', grad(WAVE_STOPS, 7), 'Onades', 'alçada (colors) i cap on van')}
          ${row('data-l="gusts"', grad(GUST_STOPS), 'Ratxes', 'cops de vent més forts')}
          ${row('data-l="rain"', grad(RAIN_STOPS), 'Pluja', 'mm en una hora')}
          <div class="mp-h">Temps · moviment <small>un a la vegada</small></div>
          ${row('data-l="wind"', WIND_SW, 'Vent', 'partícules que segueixen el vent')}
          ${row('data-l="currents"', CUR_SW, 'Corrents', 'mar endins · a la costa, més febles')}
          <div class="mp-h">Llocs</div>
          ${PLACES.map((p) => row(`data-s="${p.k}"`, icons[p.k], p.name, p.sub)).join('')}
          <div class="mp-h">Serveis <small>en acostar-s'hi</small></div>
          <div class="mp-svc">${SERVICE_KINDS.map((k) => `<label><input type="checkbox" data-s="svc_${k}"><span>${SERVICE_TYPES[k].ico}${SVC_SHORT[k]}</span></label>`).join('')}</div>
          <p>Capes del temps: Open-Meteo, cel·les d'uns 8-10 km, a l'hora de la barra. Sortides, ports, coves i desembocadures surten en acostar-se; els serveis, ben a prop. Llocs i serveis d'OpenStreetMap.</p>
        </div>`;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      const a = el.firstElementChild, panel = el.querySelector('.layers-panel');
      ui = { btn: a, panel, el };
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); openPanel(panel.hidden); });
      panel.querySelector('.mp-x').addEventListener('click', () => openPanel(false));
      panel.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.l) { setLayer(t.dataset.l, t.checked); renderPanel(); }
        if (t.dataset.s) { show[t.dataset.s] = t.checked; apply(); }
      });
      panel.addEventListener('click', (e) => {
        const bs = e.target.closest('[data-base]');
        if (bs) { setBase(bs.dataset.base); return; }
        const c = e.target.closest('[data-p]');
        if (c) { show = { ...PRESETS[c.dataset.p].show }; apply(); }
      });
      return el;
    },
  });
  new Ctl({ position: 'topleft' }).addTo(map);
  map.on('click', () => { if (!ui.panel.hidden) openPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.panel.hidden) openPanel(false); });
  apply();
  setBase(store.get('mapBase', 'mapa'));
}

/** Torna a ensenyar una mena de lloc (p. ex. la ruta quan l'usuari en dibuixa o n'obre una). */
export function showKind(k) {
  if (show[k]) return;
  show[k] = true;
  apply();
}
