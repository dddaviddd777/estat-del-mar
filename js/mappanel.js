// Panell «Mapa»: un sol botó (sota el de la ruta) per triar què es veu. Fa alhora de llegenda: cada fila porta la
// mateixa icona que surt al mapa. Capes del temps (onades, vent) i llocs (platges, punts, boies, sortides, ports,
// coves, fars, la ruta), amb tres botons ràpids. Es recorda a `mapShow` (i les capes, a `mapLayers` de layers.js).
import * as store from './store.js';
import { setLayer, layersOn, WAVE_STOPS } from './layers.js';
import { setExitKinds, setRouteShown, EXIT_ICO, PORT_ICO } from './routeui.js';
import { setPlaceKinds, CAVE_ICO, LIGHT_ICO } from './places.js';

const ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5"/></svg>';
const WIND_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="5" fill="#24978a"/><path d="M4 8h8.5a2.2 2.2 0 1 0-2.2-2.2M4 12h10.5a2.2 2.2 0 1 1-2.2 2.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
const BEACH_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#3ccf7a" stroke="#fff" stroke-width="1.6"/><text x="10" y="13.4" text-anchor="middle" font-size="8.5" font-weight="700" font-family="system-ui,sans-serif" fill="#0b1d2c">8,5</text></svg>';
const PT_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="#1a73e8" stroke="#fff" stroke-width="2.4"/></svg>';
const ROUTE_SW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16c3-1 3-6 7-7s4-5 7-6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M3 16c3-1 3-6 7-7s4-5 7-6" fill="none" stroke="#f2b33d" stroke-width="3" stroke-linecap="round"/></svg>';

const PLACES = [
  { k: 'platges', name: 'Platges', sub: 'nota, onada i vent' },
  { k: 'punts', name: 'Els meus punts' },
  { k: 'boies', name: 'Boies' },
  { k: 'sortides', name: 'Sortides', sub: 'platges, escales i rampes · de prop' },
  { k: 'ports', name: 'Ports', sub: 'de prop' },
  { k: 'coves', name: 'Coves', sub: 'de mar · de prop' },
  { k: 'fars', name: 'Fars' },
  { k: 'ruta', name: 'La meva ruta' },
];
const ALL = Object.fromEntries(PLACES.map((p) => [p.k, true]));
const PRESETS = {
  tot: { label: 'Tot', show: ALL },
  ruta: { label: 'Només la ruta', show: { ...Object.fromEntries(PLACES.map((p) => [p.k, false])), ruta: true, sortides: true, ports: true } },
  explora: { label: 'Explorar la costa', show: { ...ALL, boies: false } },
};

let map = null, ui = null, show = { ...ALL };

function apply() {
  const b = document.body.classList;
  b.toggle('hide-platges', !show.platges);
  b.toggle('hide-punts', !show.punts);
  b.toggle('hide-boies', !show.boies);
  setExitKinds({ sortides: show.sortides, ports: show.ports });
  setPlaceKinds({ cova: show.coves, far: show.fars });
  setRouteShown(show.ruta);
  store.set('mapShow', { ...show });
  renderPanel();
}

function renderPanel() {
  if (!ui) return;
  const L1 = layersOn();
  ui.panel.querySelectorAll('[data-l]').forEach((i) => { i.checked = !!L1[i.dataset.l]; });
  ui.panel.querySelectorAll('[data-s]').forEach((i) => { i.checked = !!show[i.dataset.s]; });
  const same = (a) => PLACES.every((p) => !!a[p.k] === !!show[p.k]);
  ui.panel.querySelectorAll('[data-p]').forEach((c) => c.classList.toggle('on', same(PRESETS[c.dataset.p].show)));
  // El botó es marca si hi ha alguna capa encesa o algun lloc amagat (perquè se sàpiga que el mapa no és el de sempre).
  ui.btn.classList.toggle('on', L1.waves || L1.wind || !same(ALL));
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
  const saved = store.get('mapShow', null);
  if (saved) show = { ...ALL, ...saved };
  else if (store.get('hideMarks', false)) show = { ...ALL, platges: false, punts: false, boies: false }; // l'antic botó de l'ull
  const icons = { platges: BEACH_SW, punts: PT_SW, boies: `<span class="mp-buoy">${o.buoyIco ?? ''}</span>`, sortides: EXIT_ICO, ports: PORT_ICO, coves: CAVE_ICO, fars: LIGHT_ICO, ruta: ROUTE_SW };
  const waveSw = `<i class="mp-grad" style="background:linear-gradient(135deg, ${WAVE_STOPS.slice(0, 7).map(([, c]) => c).join(', ')})"></i>`;
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'leaflet-bar layers-ctl');
      el.innerHTML = `<a href="#" role="button" title="Mapa: capes i llocs" aria-label="Mapa: capes i llocs" aria-expanded="false">${ICO}</a>
        <div class="layers-panel" hidden>
          <div class="mp-top"><b>Mapa</b><button class="mp-x" aria-label="Tanca">✕</button></div>
          <div class="mp-chips">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}">${p.label}</button>`).join('')}</div>
          <div class="mp-h">Temps</div>
          ${row('data-l="waves"', waveSw, 'Onades', 'alçada (colors) i cap on van')}
          ${row('data-l="wind"', WIND_SW, 'Vent', 'partícules que segueixen el vent')}
          <div class="mp-h">Llocs</div>
          ${PLACES.map((p) => row(`data-s="${p.k}"`, icons[p.k], p.name, p.sub)).join('')}
          <p>Onades i vent: mar endins, cel·les d'uns 8 km (Open-Meteo), a l'hora de la barra. Sortides, ports i coves surten en acostar-se. Llocs d'OpenStreetMap.</p>
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
}

/** Torna a ensenyar una mena de lloc (p. ex. la ruta quan l'usuari en dibuixa o n'obre una). */
export function showKind(k) {
  if (show[k]) return;
  show[k] = true;
  apply();
}
