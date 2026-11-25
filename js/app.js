import { BEACHES, TZ, waveLevel, fetchMarine, cachedMarine, analyze, bestWindow, LEVELS, localParts, dayKeyOffset, swimWindow, seaPoint, windName,
  modelCompare, windyUrl, sstColor, sstWord, sstStats, sstGradient, SST_RANGE, wetsuitAdvice, SEA_KINDS, fetchPoint, nearBeach, weatherAlerts, rainBefore, roughBefore } from './marine.js';
import * as store from './store.js';
import { initLayers, setLayersTime, GRID_BOUNDS } from './layers.js';
import { initMapPanel, showKind } from './mappanel.js';
import { initPlaces, loadPlaces, waterAlert, waterAlertText, placesNear, outfallText, OUTFALL_ICO } from './places.js';
import { initServices, loadServices, servicesHtml } from './services.js';
import { BUOY, fetchBuoy, cachedBuoy, fetchCalib, cachedCalib, OTHER_BUOYS, fetchOthers, cachedOthers } from './buoy.js';
import { initRoutes, isDrawing, sheetOpen as routeSheetOpen, closeSheet as closeRouteSheet, refreshRoute, redrawSheet, alertsHtml, startRouteAt, addPointAt, hasRoute } from './routeui.js';

const $ = (id) => document.getElementById(id);
const nf1 = new Intl.NumberFormat('ca', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = (o) => new Intl.DateTimeFormat('ca', { timeZone: TZ, ...o });
const hh = (t) => fmt({ hour: '2-digit', hourCycle: 'h23' }).format(t * 1000);
const hhmm = (t) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const m = (v) => (v == null ? '—' : nf1.format(v));
const REL = { terra: 'de terra', mar: 'de mar', lateral: 'lateral' };

let data = null;
let idx = 0;       // hora seleccionada (índex dins de data.times)
let nowIdx = 0;
let offline = false;
let map = null;
const markers = {};
let selected = null;
// Disposició d'ordinador / pantalla horitzontal (ha de coincidir amb la media query de css/mar.css).
const wide = matchMedia('(min-width: 900px) and (min-height: 540px)');

function dayLabel(t) {
  const d = localParts(t).day;
  if (d === dayKeyOffset(0)) return 'Avui';
  if (d === dayKeyOffset(1)) return 'Demà';
  return cap(fmt({ weekday: 'long' }).format(t * 1000));
}
const winText = (w) => `${hh(w.start)}–${hh(w.end)} h`;
function ago(ms) {
  const mn = Math.round((Date.now() - ms) / 60000);
  return mn < 1 ? 'ara mateix' : mn < 60 ? `fa ${mn} min` : `fa ${Math.floor(mn / 60)} h`;
}

// ---------- Càrrega ----------
// La boia va a part: si falla, la resta de l'app funciona igual.
let buoy = cachedBuoy();
let buoyErr = null;
let calib = cachedCalib();
let others = cachedOthers();
async function loadBuoy(force = false) {
  const [b, c, o] = await Promise.allSettled([fetchBuoy({ force }), fetchCalib({ force }), fetchOthers({ force })]);
  if (b.status === 'fulfilled') { buoy = b.value; buoyErr = null; } else buoyErr = b.reason?.message;
  if (c.status === 'fulfilled') calib = c.value;
  if (o.status === 'fulfilled') others = o.value;
  renderBuoy();
  if (selected) renderDetail();
}

async function load(force = false) {
  loadBuoy(force);
  const first = !data;
  data = data || cachedMarine();
  if (data && first) { setNow(); renderAll(); }
  $('refreshBtn').classList.add('spin');
  try {
    data = await fetchMarine({ force });
    offline = false;
    loadPts();
    refreshRoute();
    const keep = idx > nowIdx ? data.times[idx] : null;
    setNow();
    if (keep) { const k = data.times.indexOf(keep); if (k >= 0) idx = k; }
    renderAll();
  } catch (e) {
    offline = true;
    if (data) renderAll();
    else $('beaches').innerHTML = `<li class="brow">No s'han pogut carregar les dades del mar. ${e.message}</li>`;
  } finally {
    $('refreshBtn').classList.remove('spin');
  }
}

function setNow() {
  const now = Date.now() / 1000;
  nowIdx = Math.max(0, data.times.findLastIndex((t) => t <= now));
  idx = nowIdx;
}

// ---------- Pintar ----------
function renderAll() {
  const slider = $('time');
  slider.min = nowIdx;
  slider.max = data.times.length - 1;
  slider.value = idx;
  $('updated').textContent = offline
    ? `Sense connexió · dades de les ${hhmm(data.fetchedAt / 1000)} (${ago(data.fetchedAt)})`
    : `Actualitzat a les ${hhmm(data.fetchedAt / 1000)} (${ago(data.fetchedAt)}) · ${data.source}`;
  $('updated').classList.toggle('stale', offline);
  const sw = swimWindow();
  $('listHint').textContent = `millor franja entre les ${sw.from} i les ${sw.to} h`;
  initMap();
  renderBuoy();
  renderTime();
  if (selected) renderDetail();
}

function renderTime() {
  const t = data.times[idx];
  $('timeLabel').textContent = `${dayLabel(t)} · ${hhmm(t)}`;
  if (map) setLayersTime(t);
  renderChips();
  renderAlerts(); // abans de les etiquetes: n'han d'esquivar el bàner
  renderMarkers();
  renderList();
}

// ---------- Emissaris a prop d'una platja o punt (fitxa) ----------
const OUTFALL_SHEET_R = 1500;
function outfallsHtml(b, t) {
  const list = placesNear(b.lat, b.lon, 'emissari', OUTFALL_SHEET_R);
  if (!list.length) return '';
  const mm = rainBefore(data, b.lat, b.lon, t);
  const rain = mm != null && mm >= 10;
  const dist = (d) => (d < 1000 ? `${Math.round(d / 50) * 50} m` : `${nf1.format(d / 1000)} km`);
  return `<div class="d-h">Emissaris a prop</div><ul class="r-feat">${list.map((p) => `<li class="${rain ? 'atencio' : 'ok'}"><span class="rf-ico">${OUTFALL_ICO}</span><div>
      <b>${esc(p.name)}</b> <span class="rf-t">a ${dist(p.dist)}</span><p>${esc(outfallText(p))}</p></div></li>`).join('')}</ul>
    <p class="d-note">${rain ? `Han caigut ${Math.round(mm)} mm en 48 hores: amb pluja forta el clavegueram pot sobreeixir i a prop dels emissaris l'aigua pot estar bruta un o dos dies.` : `Sense pluja forta no hauria d'afectar l'aigua de la platja.`} Posició de la boca de l'emissari, de l'Agència Catalana de l'Aigua.</p>`;
}

// ---------- Avisos de temps ----------
// Una nedada dura unes 2 hores: es miren els avisos de l'hora triada fins a 2 h després (més el marge de weatherAlerts).
const SWIM_LEN = 2 * 3600;
/**
 * Avisos d'una platja o punt a l'hora `t`: els del temps i el d'aigua tèrbola (si ha plogut i hi ha una desembocadura o
 * un emissari a prop, o si fa poc hi havia mala mar).
 */
function beachAlerts(b, hours, t) {
  const out = weatherAlerts(hours, t, t + SWIM_LEN);
  const w = waterAlert([[b.lat, b.lon]], { mm: rainBefore(data, b.lat, b.lon, t), rough: roughBefore(data, b.lat, b.lon, t), t });
  if (w) out.push(w);
  return out;
}
/** Avisos de tota la costa a l'hora triada: si només afecten unes quantes platges, es diu on. */
function renderAlerts() {
  const t = data.times[idx];
  const byKind = new Map();
  for (const b of BEACHES) {
    for (const a of beachAlerts(b, data.beaches[b.id], t)) {
      const k = byKind.get(a.kind);
      if (!k) byKind.set(a.kind, { ...a, why: a.why && { ...a.why }, beaches: [b.short ?? b.name] });
      else {
        k.beaches.push(b.short ?? b.name);
        if (a.why) for (const w in a.why) k.why[w] ||= a.why[w];
        if (a.level === 'perill' && k.level !== 'perill') Object.assign(k, { level: a.level, text: a.text, t: a.t });
      }
    }
  }
  // L'avís d'aigua tèrbola diu quin riu o emissari hi ha a cada platja: per a tota la costa, un text general.
  const wat = byKind.get('aigua');
  if (wat?.beaches.length > 1) wat.text = waterAlertText(wat.why);
  const list = [...byKind.values()].sort((a, b) => (a.level === 'perill' ? 0 : 1) - (b.level === 'perill' ? 0 : 1) || a.t - b.t);
  list.forEach((a) => { if (a.beaches.length < BEACHES.length * 0.6) a.where = `(${a.beaches.slice(0, 3).join(', ')}${a.beaches.length > 3 ? '…' : ''})`; });
  const el = $('alerts');
  el.hidden = !list.length;
  if (!list.length) { el.innerHTML = ''; return; }
  const a = list[0], lv = (x) => (x.level === 'perill' ? 'Perill' : 'Atenció');
  el.classList.toggle('perill', list.some((x) => x.level === 'perill'));
  el.innerHTML = `<button class="wx-pill" type="button" aria-expanded="${el.classList.contains('open')}" title="Avisos de temps">${WARN_ICO}<span class="wx-long"><b>${lv(a)}:</b> ${a.text.split(/:\s|\.\s|\.$/)[0]}</span>${list.length > 1 ? `<em>+${list.length - 1}</em>` : ''}<span class="wx-short"><b>${list.length > 1 ? `${list.length} avisos` : lv(a)}</b></span><i class="wx-chev"></i></button>
    <div class="wx-more">${alertsHtml(list)}</div>`;
}
// Bàner discret dins del mapa (l'usuari, 25/11/2026: els avisos no han de prendre lloc al mapa). Una línia amb el primer
// avís; un toc el desplega amb tots els avisos i els enllaços del radar. Amb el mapa a tota la pantalla no surt.
const WARN_ICO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" fill="currentColor"/><path d="M12 9.5v5" stroke="#0b1d2c" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.2" fill="#0b1d2c"/></svg>';
function initAlertsBanner() {
  const el = L.DomUtil.create('div', 'wx-map', map.getContainer());
  el.id = 'alerts'; el.hidden = true; el.setAttribute('role', 'status');
  L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
  el.addEventListener('contextmenu', (e) => e.stopPropagation());
  const setOpen = (on) => { el.classList.toggle('open', on); el.querySelector('.wx-pill')?.setAttribute('aria-expanded', String(on)); };
  el.addEventListener('click', (e) => { if (e.target.closest('.wx-pill')) setOpen(!el.classList.contains('open')); });
  map.on('click movestart', () => setOpen(false));
}

// Botons ràpids: ara, demà a les 9 h i demà passat a les 9 h (l'hora habitual de nedar).
const SWIM_HOUR = 9;
function jumpIndex(j) {
  if (j === 'now') return nowIdx;
  const day = dayKeyOffset(Number(j));
  const k = data.times.findIndex((t) => { const p = localParts(t); return p.day === day && p.hour === SWIM_HOUR; });
  return k >= nowIdx ? k : -1;
}
function renderChips() {
  const chips = [['now', 'Ara']];
  for (const off of [1, 2]) {
    const k = jumpIndex(String(off));
    if (k < 0) continue;
    const name = off === 1 ? 'Demà' : cap(fmt({ weekday: 'long' }).format(data.times[k] * 1000));
    chips.push([String(off), `${name} ${SWIM_HOUR} h`]);
  }
  document.querySelector('.chips').innerHTML = chips
    .map(([j, txt]) => `<button data-jump="${j}" class="${jumpIndex(j) === idx ? 'on' : ''}">${txt}</button>`).join('');
}

function initMap() {
  if (map || !window.L) {
    if (!window.L) $('map').innerHTML = '<p style="padding:20px;color:#0b1d2c">El mapa necessita connexió.</p>';
    return;
  }
  // Rodeta del ratolí: fa zoom a l'ordinador (pantalla ampla, on el mapa no té la pàgina a sota per desplaçar).
  // En una sola columna la rodeta desplaça la pàgina, i amb Ctrl + rodeta es fa zoom.
  map = L.map('map', { zoomControl: false, scrollWheelZoom: wide.matches, wheelPxPerZoomLevel: 90, zoomSnap: 0.25, zoomDelta: 0.5, tapHold: true }); // mig nivell per clic: les etiquetes canvien de mida a poc a poc
  map.getContainer().addEventListener('wheel', (e) => {
    if (wide.matches || !e.ctrlKey) return;
    e.preventDefault();
    map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + (e.deltaY < 0 ? 0.5 : -0.5));
  }, { passive: false });
  // Fons: el mapa d'OSM o la foto de satèl·lit (es tria al panell «Mapa»).
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  // Ruta de nedada (botó sota el zoom): dibuix, línia de colors i fitxa, a js/routeui.js.
  // `routeUsed`: si l'usuari dibuixa o obre la ruta i l'havia amagat al panell del mapa, torna a sortir.
  initRoutes(map, { closeDetail, wide, dayLabel, times: () => data?.times ?? [], routeUsed: () => showKind('ruta') });
  // Capes d'onades i vent (a l'estil del Windy), coves i fars, i el panell «Mapa» (botó sota el de la ruta) per triar
  // què es veu: capes, platges, punts, boies, sortides, ports, coves, fars i la ruta.
  initLayers(map, { time: () => data.times[idx] });
  initPlaces(map);
  initServices(map);
  initMapPanel(map, { buoyIco: BUOY_ICO, osm });
  // Desembocadures (avís després de pluja) i serveis (fitxa de la platja): en arribar, es tornen a pintar els avisos.
  Promise.allSettled([loadPlaces(), loadServices()]).then(() => { if (data) renderAlerts(); if (selected) renderDetail(); redrawSheet(); });
  // Temperatura de l'aigua de tota la costa, al racó de dalt a l'esquerra (és terra: no tapa cap etiqueta), per sobre
  // dels botons: així el menú de capes, que s'obre a la dreta del seu botó, no queda tapat.
  const Sst = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'sst-box');
      el.id = 'sstBox';
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  const sstEl = new Sst({ position: 'topleft' }).addTo(map).getContainer();
  sstEl.parentNode.prepend(sstEl);
  // Les etiquetes surten cap a la dreta (mar): deixem-hi lloc perquè les de més a l'est no quedin tallades.
  const fitCoast = () => map.fitBounds(L.latLngBounds(BEACHES.map((b) => seaPoint(b))),
    wide.matches ? { paddingTopLeft: [40, 30], paddingBottomRight: [190, 30] } : { paddingTopLeft: [24, 24], paddingBottomRight: [170, 24] });
  // No es pot allunyar més enllà de la zona de les capes (l'usuari, 25/11/2026: amb el zoom molt allunyat el vent no
  // cobria el mapa i les etiquetes quedaven mal posades). El zoom mínim depèn de la mida del mapa.
  const gridB = L.latLngBounds(GRID_BOUNDS);
  map.setMaxBounds(gridB); map.options.maxBoundsViscosity = 1;
  const limitZoom = () => { if (map.getSize().x > 100) map.setMinZoom(map.getBoundsZoom(gridB, true)); };
  limitZoom();
  fitCoast();
  // En passar de mòbil a ordinador (o al revés) el mapa canvia molt de mida: el tornem a encaixar.
  wide.addEventListener('change', () => { map.scrollWheelZoom[wide.matches ? 'enable' : 'disable'](); setTimeout(() => { map.invalidateSize(); fitCoast(); }, 50); });
  // Si el mapa s'ha creat quan encara no tenia mida (pantalla amagada), l'ajustem quan en tingui.
  let hadSize = map.getSize().x > 100;
  new ResizeObserver(() => {
    map.invalidateSize();
    limitZoom();
    if (!hadSize && map.getSize().x > 100) { hadSize = true; fitCoast(); }
  }).observe($('map'));
  for (const b of BEACHES) {
    markers[b.id] = L.marker(seaPoint(b), { keyboard: true, title: b.name, riseOnHover: true })
      .on('click', () => openDetail(b.id))
      .addTo(map);
  }
  map.on('moveend resize', () => renderMarkers());
  renderBuoyDot();
  document.fonts?.ready.then(() => renderMarkers());
  // Mantenir premut (mòbil, tapHold de Leaflet) o clic dret (ordinador): menú per consultar el punt o començar-hi una ruta.
  let lastPick = 0;
  // Fora del dibuix surt un menú petit: consultar el mar d'aquell punt o començar-hi una ruta.
  // Dibuixant una ruta, posa el punt de la ruta allà mateix.
  map.on('contextmenu', (e) => {
    e.originalEvent?.preventDefault?.();
    if (Date.now() - lastPick < 800) return; // alguns mòbils l'envien dues vegades
    lastPick = Date.now();
    if (isDrawing()) return addPointAt(e.latlng);
    openCtxMenu(e.latlng);
  });
  // (el clic que alguns mòbils envien en deixar anar el dit després de mantenir premut no el tanca)
  map.on('click', () => { if (Date.now() - lastPick > 600) closeCtxMenu(); });
  map.on('movestart zoomstart', closeCtxMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
  initMaximize();
  initAlertsBanner();
  restorePts();
}

/**
 * Mapa a tota la pantalla (botó de dalt a la dreta). El mapa i la barra de temps ocupen tota la finestra
 * (`body.map-max`) i, si el navegador ho permet, també es demana la pantalla completa (a l'iPhone no es pot:
 * llavors ocupa tota la finestra del Safari). Les fitxes s'obren per sobre. Es surt amb el mateix botó, amb Esc
 * o amb el gest d'enrere que tanca la pantalla completa.
 */
const MAX_ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const MIN_ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
function initMaximize() {
  let btn;
  const isMax = () => document.body.classList.contains('map-max');
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const paint = (on) => {
    btn.innerHTML = on ? MIN_ICO : MAX_ICO;
    btn.title = on ? 'Surt de la pantalla completa' : 'Mapa a tota la pantalla';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(on));
  };
  function setMax(on) {
    document.body.classList.toggle('map-max', on);
    paint(on);
    closeCtxMenu();
    const de = document.documentElement;
    try {
      if (on && !fsEl()) (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de)?.catch?.(() => {});
      if (!on && fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    } catch { /* sense pantalla completa: el mapa ocupa igualment tota la finestra */ }
  }
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'leaflet-bar max-ctl');
      el.innerHTML = '<a href="#" role="button"></a>';
      btn = el.firstChild;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.preventDefault(e); setMax(!isMax()); });
      return el;
    },
  });
  new Ctl({ position: 'topright' }).addTo(map);
  paint(false);
  // Si l'usuari surt de la pantalla completa pel seu compte (Esc, gest d'enrere), el mapa torna al seu lloc.
  const onFs = () => { if (!fsEl() && isMax()) setMax(false); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMax() && !ctxEl && document.querySelector('.layers-panel')?.hidden !== false
      && [...document.querySelectorAll('.sheet')].every((s) => s.hidden)) setMax(false);
  }, true); // abans que els altres Esc: si hi ha una fitxa oberta, el primer Esc només tanca la fitxa
}

/** Menú del clic dret (o de mantenir premut al mòbil). */
// El menú es posa damunt del mapa al costat del punt, sense moure el mapa (un popup de Leaflet l'hauria desplaçat
// perquè hi cabés). Es tanca en tocar el mapa, moure'l, fer zoom o prémer Esc.
let ctxEl = null;
function closeCtxMenu() { ctxEl?.remove(); ctxEl = null; }
function openCtxMenu(ll) {
  closeCtxMenu();
  const box = document.createElement('div');
  box.className = 'ctx-float';
  const el = document.createElement('div');
  el.className = 'ctx-menu';
  el.innerHTML = `<button data-act="punt"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>Consulta el mar aquí</button>
    <button data-act="ruta"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="18.5" r="2.2"/><circle cx="18.5" cy="5.5" r="2.2"/><path d="M8 18.5h7.5a3.3 3.3 0 0 0 0-6.6h-7a3.3 3.3 0 0 1 0-6.6H16" stroke-dasharray="2.2 2.8"/></svg>${hasRoute() ? 'Comença una ruta nova aquí' : 'Comença una ruta aquí'}</button>`;
  const c = map.getContainer();
  const dot = document.createElement('i');
  dot.className = 'ctx-dot';
  box.append(el);
  c.append(dot, box);
  L.DomEvent.disableClickPropagation(box);
  L.DomEvent.disableScrollPropagation(box);
  L.DomEvent.on(box, 'contextmenu', L.DomEvent.preventDefault);
  // Al costat del punt (a la dreta i a sota si hi cap; si no, a l'altre costat), sempre dins del mapa.
  const p = map.latLngToContainerPoint(ll), sz = map.getSize(), w = box.offsetWidth, h = box.offsetHeight, m = 6;
  let x = p.x + 10, y = p.y + 4;
  if (x + w > sz.x - m) x = p.x - w - 10;
  if (y + h > sz.y - m) y = p.y - h - 4;
  box.style.left = `${Math.max(m, Math.min(sz.x - w - m, x))}px`;
  box.style.top = `${Math.max(m, Math.min(sz.y - h - m, y))}px`;
  dot.style.left = `${p.x}px`;
  dot.style.top = `${p.y}px`;
  const remove = () => dot.remove();
  ctxEl = { remove: () => { box.remove(); remove(); } };
  el.querySelector('button')?.focus({ preventScroll: true });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    closeCtxMenu();
    if (act === 'punt') pickPoint(ll.lat, ll.lng);
    else startRouteAt(ll.lat, ll.lng);
  });
}

// Mida de cada etiqueta (nota + nom + onada i vent apilats), per poder-les col·locar sense que es trepitgin.
// Ha de coincidir amb .bm .pill a css/mar.css: alçada PILL_H, cercle de 28 px a 2 px de la vora (centre a R), columna DATA_W.
const PILL_H = 32, R = PILL_H / 2, DATA_W = 66;
const measureCtx = document.createElement('canvas').getContext('2d');
function pillWidth(b) {
  measureCtx.font = '500 12px Outfit, system-ui, sans-serif';
  return 2 + 28 + 5 + measureCtx.measureText(b.short).width + 5 + DATA_W + 4;
}

/**
 * Etiqueta d'una platja (o del punt triat). Cada dada té la seva forma, perquè no es confonguin:
 * cercle de color = nota per nedar (l'únic amb el color del semàfor) · a la dreta, apilades: pastilla blava = onada
 * a la platja i cap on va (icona d'ones) · pastilla del vent = km/h, cap on bufa i color segons la força (icona de vent).
 */
const ARROW = '<svg viewBox="0 0 18 18" aria-hidden="true" style="transform:rotate(ROTdeg)"><path d="M9 1l5 12-5-3-5 3z"/></svg>';
const WAVE_ICO = '<svg class="ico" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4.5q1.25-1.6 2.5 0t2.5 0 2.5 0 2.5 0M1 8.5q1.25-1.6 2.5 0t2.5 0 2.5 0 2.5 0"/></svg>';
const WIND_ICO = '<svg class="ico" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4h6.5a1.6 1.6 0 1 0-1.6-1.6M1 6.5h9a1.6 1.6 0 1 1-1.6 1.6M1 9h4"/></svg>';
function pillHtml(b, h, a, mini = lbl.mini) {
  const score = a.score >= 9.95 ? '10' : nf1.format(a.score);
  if (mini) return `<b class="sc" style="--c:${LEVELS[a.level].color}" title="${esc(b.name)}: nota ${nf1.format(a.score)} de 10, onada ${a.beachHs == null ? '—' : m(a.beachHs)} m, vent ${h.wind == null ? '—' : Math.round(h.wind)} km/h">${score}</b>`;
  const wdir = a.sea?.dir ?? h.dir;
  const waveRot = ((wdir ?? 0) + 180) % 360, windRot = ((h.windDir ?? 0) + 180) % 360;
  return `<b class="sc" style="--c:${LEVELS[a.level].color}" title="Nota per nedar: ${nf1.format(a.score)} de 10 (${LEVELS[a.level].label.toLowerCase()})">${score}</b>
    <span class="nm">${esc(b.short)}</span>
    <span class="st">
      <span class="wv l${waveLevel(a.beachHs)}" title="Onada a la platja: ${m(a.beachHs)} m${wdir != null ? `, ve del ${windName(wdir)}` : ''}${['', ' (una mica d\'onada)', ' (onada alta)'][waveLevel(a.beachHs)]}">${WAVE_ICO}${wdir != null ? ARROW.replace('ROT', waveRot) : ''}${a.beachHs == null ? '—' : m(a.beachHs)}<small>m</small></span>
      <span class="wind" style="--w:${LEVELS[a.windLevel].color}" title="Vent ${REL[a.rel]}: ${h.wind == null ? '—' : Math.round(h.wind)} km/h del ${windName(h.windDir)}">${WIND_ICO}${ARROW.replace('ROT', windRot)}${h.wind == null ? '—' : Math.round(h.wind)}<small>km/h</small></span>
    </span>`;
}

/**
 * Mida de les etiquetes segons l'espai que hi ha: com més allunyat és el zoom, més juntes queden les platges.
 * Amb prou lloc, mida normal; si van justes, s'encongeixen (fins al 70 %); si ni així hi caben, només la nota
 * (cercle de color). En acostar-se tornen a créixer. `per` = píxels d'alçada per etiqueta: la columna d'etiquetes
 * pot ser una mica més llarga que la costa (×2 + 60 px), però no tant que quedin lluny de la seva platja.
 */
const lbl = { s: 1, mini: false };
function labelMode(ys, mapH) {
  if (ys.length < 2) return { s: 1, mini: false };
  const span = Math.max(...ys) - Math.min(...ys);
  const per = Math.min(mapH - 30, span * 2 + 60) / ys.length, need = PILL_H + 3;
  if (per >= need * 0.92) return { s: 1, mini: false }; // una mica justes encara caben (el repàs les separa)
  if (per >= need * 0.7) return { s: Math.round((per / need) * 20) / 20, mini: false };
  return { s: per >= need * 0.45 ? 0.85 : 0.7, mini: true };
}

/**
 * Col·loca les etiquetes: cadascuna surt del seu punt cap al mar (segons cap on mira la platja)
 * i, si se'n trepitgen dues, se separen. Retorna el desplaçament (px) de cada etiqueta respecte del seu punt.
 */
function layoutLabels() {
  const size = map.getSize();
  const GAP = 3;
  // Platges i punts propis: les etiquetes dels punts (a la dreta del punt, o a l'esquerra si no hi caben) també compten.
  const list = [...BEACHES, ...[...pts.values()].map((q) => q.b)].map((b) => ({ b, p: map.latLngToContainerPoint(seaPoint(b)) }));
  const inView = (p) => p.x > -20 && p.x < size.x + 20 && p.y > -20 && p.y < size.y + 20;
  const wxH = $('alerts') && !$('alerts').hidden ? 44 : 0; // el bàner dels avisos ocupa la franja de dalt
  Object.assign(lbl, labelMode(list.filter((a) => inView(a.p)).map((a) => a.p.y), size.y - wxH));
  const H = PILL_H * lbl.s, r = H / 2, LEAD = 12 * lbl.s; // el cercle surt una mica cap al mar des del punt de la platja
  const all = list.map(({ b, p }) => {
    const f = ((b.custom ? 90 : b.facing) * Math.PI) / 180;
    const d = { x: p.x + Math.sin(f) * LEAD, y: p.y - Math.cos(f) * LEAD };
    const w = (lbl.mini ? PILL_H : labelWidth(b)) * lbl.s;
    if (b.custom && d.x + w - r > size.x - 4) d.x = p.x - LEAD - w + 2 * r; // no hi cap a la dreta: a l'esquerra
    return { id: b.id, p, d, x: d.x, y: d.y, w, minX: b.custom ? p.x - LEAD - w + 2 * r : p.x - 4 };
  });
  // Només col·loquem les que es veuen; les de fora de la pantalla es queden a la seva posició natural.
  const items = all.filter((a) => inView(a.p));
  const rect = (a) => ({ l: a.x - r, r: a.x - r + a.w, t: a.y - r, b: a.y + r });
  // El requadre de la temperatura de l'aigua (dalt a l'esquerra) no ha de tapar cap etiqueta: les que hi cauen, a la seva dreta.
  const sstEl = $('sstBox'), mapBox = map.getContainer().getBoundingClientRect();
  const sb = sstEl && !sstEl.hidden ? sstEl.getBoundingClientRect() : null;
  const box = sb && sb.width ? { l: sb.left - mapBox.left - 4, r: sb.right - mapBox.left + 4, t: sb.top - mapBox.top - 4, b: sb.bottom - mapBox.top + 4 } : null;
  // El bàner dels avisos (dalt, al costat del requadre): les etiquetes que hi cauen, a sota.
  const wb = !$('alerts')?.hidden ? $('alerts').querySelector('.wx-pill')?.getBoundingClientRect() : null;
  const wbox = wb && wb.width ? { l: wb.left - mapBox.left - 4, r: wb.right - mapBox.left + 4, t: wb.top - mapBox.top - 4, b: wb.bottom - mapBox.top + 4 } : null;
  const hit = (q, B) => B && q.r > B.l && q.l < B.r && q.b > B.t && q.t < B.b;
  const dodgeSst = (A) => { if (hit(rect(A), box)) A.x = box.r + r; };
  const dodgeBox = (A) => { dodgeSst(A); if (hit(rect(A), wbox)) A.y = wbox.b + r; };
  for (let k = 0; k < 260; k++) {
    if (k < 200) for (const a of items) { a.x += (a.d.x - a.x) * 0.04; a.y += (a.d.y - a.y) * 0.04; }
    for (let i = 0; i < items.length; i++) {
      const A = items[i], ra = rect(A);
      for (let j = i + 1; j < items.length; j++) {
        const B = items[j], rb = rect(B);
        const ox = Math.min(ra.r, rb.r) - Math.max(ra.l, rb.l) + GAP;
        const oy = Math.min(ra.b, rb.b) - Math.max(ra.t, rb.t) + GAP;
        if (ox <= 0 || oy <= 0) continue;
        // Preferim separar-les en vertical (la costa va de nord a sud i les etiquetes són amples).
        // Qui queda a dalt ho diu el punt de cada etiqueta (de nord a sud), no on ha anat a parar: així no s'encreuen.
        if (oy < ox * 2) { const sh = (A.p.y < B.p.y || (A.p.y === B.p.y && i < j) ? -1 : 1) * oy / 2; A.y += sh; B.y -= sh; }
        else { const sh = (A.x < B.x ? -1 : 1) * ox / 2; A.x += sh; B.x -= sh; }
      }
      dodgeBox(A);
      // Dins del mapa, i la costa queda a l'oest: l'etiqueta no passa a l'esquerra del seu punt (no se'n va terra endins).
      A.x = Math.max(Math.min(A.x, size.x - A.w + r - 4), A.minX);
      A.y = Math.min(Math.max(A.y, r + 4), size.y - r - 18);
    }
  }
  // Repàs final: de dalt a baix, cap etiqueta en trepitja cap altra (si cal, la baixem).
  const hOverlap = (A, B) => Math.min(rect(A).r, rect(B).r) - Math.max(rect(A).l, rect(B).l) + GAP > 0;
  const sorted = [...items].sort((a, b) => a.y - b.y);
  sorted.forEach((B, i) => {
    dodgeBox(B);
    for (const A of sorted.slice(0, i)) if (hOverlap(A, B) && B.y < A.y + H + GAP) B.y = A.y + H + GAP;
  });
  // I si la de baix surt del mapa, pugem la columna.
  const bottom = size.y - r - 18;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const B = sorted[i];
    if (B.y > bottom) B.y = bottom;
    for (const C of sorted.slice(i + 1)) if (hOverlap(B, C) && B.y > C.y - H - GAP) B.y = C.y - H - GAP;
  }
  for (const B of sorted) { dodgeSst(B); B.x = Math.min(B.x, size.x - B.w + r - 4); }
  return Object.fromEntries(all.map((a) => [a.id, { dx: a.x - a.p.x, dy: a.y - a.p.y }]));
}

// Estil de posició d'una etiqueta: el cercle de la nota queda centrat a (dx, dy) i tota l'etiqueta s'escala des d'allà.
const pillPos = ({ dx, dy }) => `left:${(dx - R * lbl.s).toFixed(1)}px;top:${(dy - R * lbl.s).toFixed(1)}px${lbl.s !== 1 ? `;transform:scale(${lbl.s})` : ''}`;

let labelOff = {};
// Amplada de l'etiqueta: la d'un punt que encara carrega és més curta.
function labelWidth(b) {
  if (!b.custom) return pillWidth(b);
  const h = pts.get(b.id)?.hours?.[idx];
  return h && h.hs !== undefined ? pillWidth(b) : 130;
}

function renderSst() {
  const el = $('sstBox');
  if (!el || !data) return;
  const s = sstStats(data, idx);
  if (!s) { el.hidden = true; return; }
  el.hidden = false;
  const pos = (t) => Math.max(0, Math.min(100, ((t - SST_RANGE[0]) / (SST_RANGE[1] - SST_RANGE[0])) * 100));
  const same = Math.abs(s.max.t - s.min.t) < 0.25;
  el.style.setProperty('--sst', sstColor(s.avg));
  el.innerHTML = `
    <div class="sst-top">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/><circle cx="12" cy="17" r="1.8"/></svg>
      <b>${nf1.format(s.avg)}<small>°C</small></b>
    </div>
    <span class="sst-word">Aigua ${sstWord(s.avg)}</span>
    ${wetsuitAdvice(s.avg) ? `<span class="sst-neo">${wetsuitAdvice(s.avg).short}</span>` : ''}
    <i class="sst-bar" style="background:${sstGradient()}"><em style="left:${pos(s.avg)}%"></em></i>
    <span class="sst-range">${same ? 'Igual a tota la costa' : `Mín. ${nf1.format(s.min.t)} ${s.min.b.short}<br>Màx. ${nf1.format(s.max.t)} ${s.max.b.short}`}</span>`;
  el.title = `Temperatura de l'aigua (mitjana de les platges) ${dayLabel(data.times[idx]).toLowerCase()} a les ${hhmm(data.times[idx])}`;
}

function renderMarkers() {
  if (!map || !data) return;
  renderSst();
  const off = labelOff = layoutLabels();
  for (const b of BEACHES) {
    const h = data.beaches[b.id][idx];
    const a = analyze(b, h);
    const { dx, dy } = off[b.id];
    const html = `<div class="bm ${selected === b.id ? 'sel' : ''}">
        <span class="pill ${lbl.mini ? 'mini' : ''}" style="${pillPos({ dx, dy })}">${pillHtml(b, h, a)}</span></div>`;
    markers[b.id].setIcon(L.divIcon({ className: 'bm-wrap bm-beach', html, iconSize: [0, 0], iconAnchor: [0, 0] }));
  }
  renderPtMarkers();
}

// ---------- Punts propis al mapa ----------
// Mantenint premut (o amb clic dret) surt un punt provisional ('punt'). Si es desa amb un nom, queda fix
// al mapa i a la llista. Es calculen com una platja: amb l'orientació d'una platja propera, triada a mà o de mar obert.
const TEMP_ID = 'punt';
const pts = new Map(); // id → { b, hours, land, cellKm, err, marker }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortName = (s) => (s.length > 16 ? s.slice(0, 15).trimEnd() + '…' : s);

// Orientació: `like` = la d'una platja propera (la mateixa cala), `facing` = triada a mà, res = mar obert.
function ptBeach(id, lat, lon, { facing = null, like = null, name = null } = {}) {
  const near = nearBeach(lat, lon);
  const ref = like ? BEACHES.find((x) => x.id === like) : null;
  const saved = id !== TEMP_ID;
  return { id, custom: true, saved, name: saved ? name : 'Punt triat', short: saved ? shortName(name) : 'Punt',
    town: `${lat.toFixed(3)} N · ${lon.toFixed(3)} E`, lat, lon, near, like: ref?.id ?? null,
    facing: ref ? ref.facing : facing, open: ref ? ref.open : 50, sea: [lat, lon] };
}
const ptSpec = (b) => ({ lat: b.lat, lon: b.lon, facing: b.facing, like: b.like });
function persistPts() {
  const t = pts.get(TEMP_ID);
  store.set('point', t ? ptSpec(t.b) : undefined);
  store.set('savedPoints', [...pts.values()].filter((p) => p.b.saved).map((p) => ({ id: p.b.id, name: p.b.name, ...ptSpec(p.b) })));
}
const getBeach = (id) => pts.get(id)?.b ?? BEACHES.find((x) => x.id === id);
// Hores dels punts alineades amb les de les platges (la barra de temps fa servir el mateix índex).
const hoursOf = (b) => (b.custom ? pts.get(b.id)?.hours : data.beaches[b.id]);
const savedPts = () => [...pts.values()].filter((p) => p.b.saved);

function setPt(id, lat, lon, opts) {
  const old = pts.get(id);
  const p = { hours: null, ...old, b: ptBeach(id, lat, lon, opts) };
  pts.set(id, p);
  return p;
}

/** Punts desats i provisional de la vegada anterior (es crida quan ja hi ha mapa i dades). */
function restorePts() {
  if (pts.size) return;
  for (const s of store.get('savedPoints', [])) setPt(s.id, s.lat, s.lon, { facing: s.facing ?? null, like: s.like ?? null, name: s.name });
  const t = store.get('point', null);
  if (t) setPt(TEMP_ID, t.lat, t.lon, { facing: t.facing ?? null, like: t.like ?? null });
  renderPtMarkers();
  loadPts();
}

async function pickPoint(lat, lon) {
  // Un punt nou a prop d'una platja agafa la seva orientació: és la mateixa cala.
  removeMarker(TEMP_ID);
  pts.delete(TEMP_ID); // les hores eren d'un altre lloc
  setPt(TEMP_ID, lat, lon, { like: nearBeach(lat, lon)?.id ?? null });
  persistPts();
  renderMarkers();
  openDetail(TEMP_ID);
  await loadPt(TEMP_ID);
}

async function loadPt(id) {
  const p = pts.get(id);
  if (!p || !data) return;
  try {
    const r = await fetchPoint(p.b.lat, p.b.lon);
    const byT = new Map(r.hours.map((h) => [h.t, h]));
    p.hours = data.times.map((t) => byT.get(t) ?? { t });
    p.land = r.land; p.cellKm = r.cellKm; p.err = null;
  } catch (e) { p.err = e.message; }
  if (pts.get(id) !== p) return; // mentrestant l'han esborrat o canviat
  renderMarkers();
  if (p.b.saved) renderList();
  if (selected === id) renderDetail();
}
const loadPts = () => Promise.all([...pts.keys()].map(loadPt));

function setPointFacing(f) {
  const p = pts.get(selected);
  if (!p) return;
  const { lat, lon, name } = p.b;
  p.b = ptBeach(p.b.id, lat, lon, typeof f === 'string' ? { like: f, name } : { facing: f, name });
  persistPts();
  renderMarkers();
  if (p.b.saved) renderList();
  renderDetail();
}

/** Desa el punt provisional amb un nom, o canvia el nom d'un de desat. */
function savePoint(name) {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  const p = pts.get(selected);
  if (!p || !name) return;
  if (p.b.saved) {
    p.b = ptBeach(p.b.id, p.b.lat, p.b.lon, { facing: p.b.facing, like: p.b.like, name });
  } else {
    const id = `p${Date.now().toString(36)}`;
    removeMarker(TEMP_ID);
    pts.delete(TEMP_ID);
    pts.set(id, { ...p, marker: null, b: ptBeach(id, p.b.lat, p.b.lon, { facing: p.b.facing, like: p.b.like, name }) });
    selected = id;
  }
  persistPts();
  renderMarkers();
  renderList();
  renderDetail();
}

function deletePoint(id) {
  const p = pts.get(id);
  if (!p) return;
  if (p.b.saved && !confirm(`Vols esborrar el punt «${p.b.name}»?`)) return;
  removeMarker(id);
  pts.delete(id);
  persistPts();
  if (p.b.saved) renderList();
  if (selected === id) closeDetail(); else renderMarkers();
}

function removeMarker(id) {
  const p = pts.get(id);
  if (p?.marker) { p.marker.remove(); p.marker = null; }
}

const renderPtMarkers = () => { for (const id of pts.keys()) renderPtMarker(id); };
function renderPtMarker(id) {
  const p = pts.get(id);
  if (!map || !p) return;
  const b = p.b, h = p.hours?.[idx];
  const a = h && h.hs !== undefined ? analyze(b, h) : null;
  const body = a ? pillHtml(b, h, a)
    : lbl.mini ? `<b class="sc" style="--c:#fff" title="${esc(b.name)}">…</b>`
    : `<span class="nm" style="padding:0 8px">${esc(b.short)} · ${p.err ? 'sense dades' : 'carregant…'}</span>`;
  // Posició de l'etiqueta: la que li ha donat layoutLabels (si encara no en té, a la dreta del punt).
  const o = labelOff[id] ?? { dx: 12 + R, dy: 0 };
  const html = `<div class="bm pt ${b.saved ? 'saved' : ''} ${selected === id ? 'sel' : ''}"><i class="pt-dot"></i>
    <span class="pill ${lbl.mini ? 'mini' : ''}" style="${pillPos(o)}">${body}</span></div>`;
  const icon = L.divIcon({ className: 'bm-wrap bm-pt', html, iconSize: [0, 0], iconAnchor: [0, 0] });
  if (!p.marker) {
    p.marker = L.marker([b.lat, b.lon], { icon, keyboard: true, title: b.name, zIndexOffset: b.saved ? 900 : 1000 })
      .on('click', () => openDetail(id)).addTo(map);
  } else p.marker.setLatLng([b.lat, b.lon]).setIcon(icon);
}

// Bloc de la fitxa del punt: nom (desar-lo), cap on s'obre la costa (per corregir l'onada) i esborrar-lo.
const FACINGS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]];
function pointBlock(b) {
  const p = pts.get(b.id);
  const opts = [...(b.near ? [[`Com ${b.near.short}`, b.near.id]] : []), ['Mar obert', null], ...FACINGS];
  const chips = opts.map(([lbl, f]) => {
    const on = typeof f === 'string' ? b.like === f : !b.like && b.facing === f;
    return `<button data-facing="${f ?? ''}" class="${on ? 'on' : ''}">${lbl}</button>`;
  }).join('');
  const like = b.like && BEACHES.find((x) => x.id === b.like);
  const cell = p?.cellKm >= 1 ? ` El model d'onades no arriba dins de les cales: agafa el mar obert a ${nf1.format(p.cellKm)} km d'aquí, i l'app el corregeix segons cap on s'obre la costa.` : '';
  const save = b.saved
    ? `<form class="pt-save" data-save-point><input name="nom" value="${esc(b.name)}" maxlength="40" aria-label="Nom del punt" autocomplete="off"><button>Canvia el nom</button></form>`
    : `<form class="pt-save" data-save-point><input name="nom" placeholder="Posa-li un nom" maxlength="40" aria-label="Nom del punt" autocomplete="off"><button>Desa el punt</button></form>
       <p class="pt-hint">Desat, queda fix al mapa i a la llista de platges.</p>`;
  return `<div class="d-point">
    ${save}
    <p>${like
      ? `És a la cala <b>${/^[aeiouàèéíòóú]/i.test(like.name) ? `d'${like.name}` : `de ${like.name}`}</b>, que s'obre al ${windName(like.facing)}: es calcula com la platja, i l'onada que ve d'altres direccions hi arriba reduïda.`
      : b.facing == null
      ? 'Es calcula com a <b>mar obert</b>: l\x27onada entra sencera, vingui d\x27on vingui. Si el punt és dins d\x27una cala o badia, tria cap on s\x27obre la costa i l\x27app hi aplicarà la correcció d\x27orientació.'
      : `La costa s'obre al <b>${windName(b.facing)}</b>: l'onada que ve d'altres direccions arriba reduïda, com a les platges.`}${cell}</p>
    <div class="dir-chips" role="group" aria-label="Cap on s'obre la costa">${chips}</div>
    ${p?.land ? '<p class="d-warn">Aquest punt sembla a terra: l\x27onada és la del mar més proper.</p>' : ''}
  </div>`;
}

// ---------- Ordre de la llista (l'usuari, 25/11/2026) ----------
// De nord a sud (les preferides a dalt), de millor a pitjor nota a l'hora triada (canvia amb la barra de temps) o
// en l'ordre que triï l'usuari (clau `beachOrder`, s'ordena arrossegant la nansa de cada fila).
const ORDERS = [['costa', 'Nord-sud'], ['nota', 'Millors primer'], ['meu', 'El meu ordre']];
let editingOrder = false, drag = null;
const listOrder = () => { const o = store.get('listOrder', 'costa'); return ORDERS.some(([k]) => k === o) ? o : 'costa'; };
function customOrder() {
  const ids = BEACHES.map((b) => b.id);
  const saved = store.get('beachOrder', []).filter((id) => ids.includes(id));
  return [...saved, ...ids.filter((id) => !saved.includes(id))]; // si mai s'afegeix una platja, va al final
}
const scoreAt = (b) => { const h = data?.beaches[b.id]?.[idx]; return h ? analyze(b, h).score : -1; };
function sortedBeaches() {
  const o = listOrder(), pos = (b) => BEACHES.indexOf(b);
  if (o === 'meu') { const ord = customOrder(); return [...BEACHES].sort((x, y) => ord.indexOf(x.id) - ord.indexOf(y.id)); }
  if (o === 'nota') return BEACHES.map((b) => [b, scoreAt(b)]).sort((p, q) => q[1] - p[1] || pos(p[0]) - pos(q[0])).map(([b]) => b);
  const favs = store.get('favBeaches', []);
  return [...BEACHES].sort((x, y) => (favs.includes(y.id) - favs.includes(x.id)) || (pos(x) - pos(y)));
}
function renderSortBar() {
  const o = listOrder();
  $('sortSeg').innerHTML = ORDERS.map(([k, t]) => `<button type="button" data-order="${k}" aria-pressed="${k === o}" class="${k === o ? 'on' : ''}">${t}</button>`).join('');
  $('sortEdit').hidden = o !== 'meu';
  $('sortEdit').textContent = editingOrder ? 'Fet' : "Canvia l'ordre";
  $('sortEdit').classList.toggle('on', editingOrder);
}
function setOrder(o) {
  // La primera vegada que es tria «El meu ordre», es comença a editar (partint de nord a sud).
  editingOrder = o === 'meu' && (listOrder() === 'meu' ? editingOrder : !store.get('beachOrder', []).length);
  store.set('listOrder', o);
  renderList();
}
function saveOrderFromDom() {
  store.set('beachOrder', [...$('beaches').querySelectorAll('li[data-id]')].map((li) => li.dataset.id));
}
$('sortSeg').addEventListener('click', (e) => { const btn = e.target.closest('[data-order]'); if (btn) setOrder(btn.dataset.order); });
$('sortEdit').addEventListener('click', () => { editingOrder = !editingOrder; renderList(); });
// Arrossegar la nansa (ratolí o dit): es mouen les veïnes, no la fila agafada, perquè no perdi el punter.
$('beaches').addEventListener('pointerdown', (e) => {
  const g = e.target.closest('[data-grip]');
  if (!g) return;
  e.preventDefault();
  const li = g.closest('li');
  g.setPointerCapture(e.pointerId);
  drag = { li, y0: e.clientY };
  li.classList.add('dragging');
});
$('beaches').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { li } = drag;
  for (let k = 0; k < 40; k++) { // un moviment ràpid pot passar per sobre de diverses files
    const next = li.nextElementSibling, prev = li.previousElementSibling, dy = e.clientY - drag.y0;
    if (next && dy > next.offsetHeight / 2) { li.before(next); drag.y0 += next.offsetHeight; }
    else if (prev?.dataset.id && dy < -prev.offsetHeight / 2) { li.after(prev); drag.y0 -= prev.offsetHeight; }
    else break;
  }
  li.style.transform = `translateY(${e.clientY - drag.y0}px)`;
});
const endDrag = () => {
  if (!drag) return;
  drag.li.classList.remove('dragging'); drag.li.style.transform = '';
  drag = null;
  saveOrderFromDom();
};
$('beaches').addEventListener('pointerup', endDrag);
$('beaches').addEventListener('pointercancel', endDrag);
// Amb el teclat: fletxes amunt i avall sobre la nansa.
$('beaches').addEventListener('keydown', (e) => {
  const g = e.target.closest('[data-grip]');
  if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const li = g.closest('li'), other = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
  if (!other?.dataset.id) return;
  if (e.key === 'ArrowUp') other.before(li); else other.after(li);
  saveOrderFromDom();
  g.focus();
});

function bestOf(b) {
  const hours = hoursOf(b);
  const today = bestWindow(b, hours, dayKeyOffset(0));
  if (today) return { w: today, label: 'avui' };
  const tom = bestWindow(b, hours, dayKeyOffset(1));
  return tom ? { w: tom, label: 'demà' } : null;
}

function renderList() {
  if (drag) return; // no es repinta mentre s'arrossega una fila
  renderSortBar();
  const favs = store.get('favBeaches', []), order = listOrder(), byScore = order === 'nota', editing = order === 'meu' && editingOrder;
  // Ordenades per nota, les files llisquen al seu lloc nou quan canvia l'hora.
  const before = new Map();
  if (byScore) for (const li of $('beaches').querySelectorAll('li[data-id]')) before.set(li.dataset.id, li.getBoundingClientRect().top);
  $('beaches').classList.toggle('by-score', byScore);
  $('beaches').classList.toggle('editing', editing);
  // Els punts desats, a dalt de tot (són llocs que l'usuari ha triat).
  const mine = savedPts().map(({ b, hours, err }) => {
    const h = hours?.[idx];
    const ok = h && h.hs !== undefined;
    const a = ok ? analyze(b, h) : null;
    const best = ok ? bestOf(b) : null;
    const bestTxt = best ? `<span class="best"><i class="dot-s" style="color:${LEVELS[best.w.level].color}">●</i> Millor ${best.label} ${winText(best.w)}</span>` : '';
    return `<li class="mine">
      <button class="brow" data-b="${b.id}">
        <i class="dot pin" style="background:${a ? LEVELS[a.level].color : 'rgba(255,255,255,.3)'}"></i>
        <span class="bname">${esc(b.name)}<small>${bestTxt || (err ? 'Sense dades' : ok ? 'Punt desat' : 'Carregant…')}</small></span>
        <span class="bvals">${a ? `${m(a.beachHs)} m<small>${h.wind == null ? '—' : Math.round(h.wind)} km/h ${REL[a.rel]}</small>` : ''}</span>
      </button>
      <span class="mine-tag" aria-hidden="true">${PIN_SVG}</span>
    </li>`;
  }).join('');
  $('beaches').innerHTML = (editing ? '' : mine) + sortedBeaches().map((b) => {
    const h = data.beaches[b.id][idx];
    const a = analyze(b, h);
    const best = bestOf(b);
    const bestTxt = best ? `<span class="best"><i class="dot-s" style="color:${LEVELS[best.w.level].color}">●</i> Millor ${best.label} ${winText(best.w)}</span>` : '';
    if (editing) return `<li data-id="${b.id}" class="edit">
      <span class="brow"><i class="dot" style="background:${LEVELS[a.level].color}"></i><span class="bname">${b.name}<small>${b.town}</small></span></span>
      <button class="grip" type="button" data-grip aria-label="Mou ${b.name} (fletxes amunt i avall)" title="Arrossega per canviar l'ordre"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8h14M5 12h14M5 16h14"/></svg></button>
    </li>`;
    return `<li data-id="${b.id}">
      <button class="brow" data-b="${b.id}">
        ${byScore ? `<i class="dot sc-dot" style="background:${LEVELS[a.level].color}">${a.score >= 9.95 ? '10' : nf1.format(a.score)}</i>` : `<i class="dot" style="background:${LEVELS[a.level].color}"></i>`}
        <span class="bname">${b.name}<small>${bestTxt || b.town}</small></span>
        <span class="bvals">${m(a.beachHs)} m<small>${h.wind == null ? '—' : Math.round(h.wind)} km/h ${REL[a.rel]}</small></span>
      </button>
      <button class="star ${favs.includes(b.id) ? 'on' : ''}" data-star="${b.id}" aria-label="${favs.includes(b.id) ? 'Treure de preferides' : 'Marcar com a preferida'}: ${b.name}">${starSvg(favs.includes(b.id))}</button>
    </li>`;
  }).join('');
  if (before.size && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const li of $('beaches').querySelectorAll('li[data-id]')) {
      const t0 = before.get(li.dataset.id), d = t0 == null ? 0 : t0 - li.getBoundingClientRect().top;
      if (Math.abs(d) > 1) li.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    }
  }
}

const PIN_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
const starSvg = (on) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;

function toggleFav(id) {
  const favs = store.get('favBeaches', []);
  store.set('favBeaches', favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]);
  renderList();
  if (selected === id) renderDetail();
}

// ---------- Boia del Cap de Begur ----------
const signed = (v) => (v > 0.005 ? '+' : v < -0.005 ? '−' : '±') + nf2.format(Math.abs(v));
const nf2 = new Intl.NumberFormat('ca', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Resum del calibratge automàtic (boies + models cada hora, a GitHub): quin model l'encerta més de mitjana.
const MODEL_NAMES = { main: ['Météo-France', "el de l'app"], ecmwf: ['ECMWF', 'mapa del Windy'], gfs: ['GFS Wave', 'EUA'], dwd: ['DWD EWAM', 'Alemanya'] };
function calibBlock() {
  const R = calib?.resum;
  if (!R?.total) return '';
  const T = R.total;
  const since = R.des_de ? fmt({ day: 'numeric', month: 'numeric' }).format(Date.parse(R.des_de)) : '';
  const head = `<div class="by-h">Calibratge automàtic · des del ${since}</div>`;
  if (T.n < 6) return `${head}<p class="by-note">Acaba de començar: cada hora es comparen 3 boies (Cap de Begur, Cap de Creus i Tordera) amb els models. D'aquí a uns dies es veurà quin l'encerta més.</p>`;
  const ids = Object.keys(MODEL_NAMES).filter((id) => T.models[id]);
  const best = ids.reduce((a, id) => (T.models[id].mae < T.models[a].mae ? id : a), ids[0]);
  const a24 = T.ahead24 || {};
  const n24 = Math.max(0, ...ids.map((id) => a24[id]?.n ?? 0));
  const tend = (b) => (Math.abs(b) < 0.03 ? 'just' : b > 0 ? 'dona de més' : 'dona de menys');
  const rows = ids.map((id) => {
    const s = T.models[id], s24 = a24[id];
    return `<li class="${id === best ? 'best' : ''}">
      <span>${MODEL_NAMES[id][0]}<small>${MODEL_NAMES[id][1]}</small></span>
      <em>±${nf2.format(s.mae)} m</em>
      <i>${tend(s.bias)}${n24 >= 6 && s24 ? ` · 24 h abans ±${nf2.format(s24.mae)}` : ''}${id === best ? ' · el millor' : ''}</i>
    </li>`;
  }).join('');
  const sst = T.sst && T.sst.n >= 6 ? ` L'aigua del model, de mitjana, ${Math.abs(T.sst.bias) < 0.2 ? 'clava la de les boies' : `marca ${nf1.format(Math.abs(T.sst.bias))} °C ${T.sst.bias > 0 ? 'de més' : 'de menys'}`}.` : '';
  return `${head}<ul class="by-models">${rows}</ul>
    <p class="by-note">Error mitjà de l'onada en ${T.n} comparacions de 3 boies (Cap de Begur, Cap de Creus i Tordera) amb el que deia cada model per a aquella hora${n24 >= 6 ? `, i amb la previsió feta 24 h abans (${n24})` : ''}.${sst} Temporal, fins al ${fmt({ day: 'numeric', month: 'numeric', year: 'numeric' }).format(Date.parse(R.fins))}.</p>`;
}

// Punts discrets al mapa amb la posició de cada boia. Begur: la GPS de l'última lectura (gira al voltant de l'ancoratge)
// o la nominal. Cap de Creus i Tordera (ICATMAR): la de boies.json, que desa la GitHub Action.
const buoyDots = {};
// Boia clàssica: con i cos vermells amb franja blanca i una ona a sota (el punt de la boia és la línia d'aigua).
const BUOY_ICO = `<svg width="18" height="20" viewBox="0 0 20 22" aria-hidden="true"><path d="M10 3 13 11H7z" fill="#e0452f" stroke="#5a1409" stroke-width="1.2" stroke-linejoin="round"/><rect x="4" y="11" width="12" height="5" rx="2.5" fill="#e0452f" stroke="#5a1409" stroke-width="1.2"/><rect x="4.6" y="12.6" width="10.8" height="1.6" fill="#fff"/><path d="M2 19.5q2-2 4 0t4 0 4 0 4 0" fill="none" stroke="#185fa5" stroke-width="1.4"/></svg>`;
function placeBuoyDot(id, ll, tip) {
  let d = buoyDots[id];
  if (!d) {
    d = buoyDots[id] = L.marker(ll, { icon: L.divIcon({ className: 'buoy-dot', html: BUOY_ICO, iconSize: [18, 20], iconAnchor: [9, 17] }), keyboard: false, zIndexOffset: -2000 }) // sota les etiquetes
      .bindTooltip('', { direction: 'top', offset: [0, -16] })
      .on('click', () => $(id === 'begur' ? 'buoyCard' : 'buoyOthers')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      .addTo(map);
  } else d.setLatLng(ll);
  d.setTooltipContent(tip);
}
function renderBuoyDot() {
  if (!map) return;
  const r = buoy?.reading;
  const gps = r?.lat != null && r?.lon != null;
  placeBuoyDot('begur', gps ? [r.lat, r.lon] : [BUOY.lat, BUOY.lon],
    `Boia del ${BUOY.name} (Puertos del Estado)${gps ? ` · posició GPS de les ${hh(r.t)} h` : ''}${r?.hs != null ? ` · ${nf2.format(r.hs)} m mesurats` : ''}`);
  for (const id of OTHER_BUOYS) {
    const o = others?.boies?.[id];
    if (!o || o.lat == null) continue;
    placeBuoyDot(id, [o.lat, o.lon], `Boia del ${o.nom} (${o.font})${o.hs != null ? ` · ${nf2.format(o.hs)} m mesurats a les ${hh(o.t)} h` : ''}`);
  }
}

// Bloc "Altres boies" de la targeta: l'última lectura de Cap de Creus i Tordera i què deia el model de l'app.
function othersBlock() {
  const list = OTHER_BUOYS.map((id) => others?.boies?.[id]).filter((o) => o?.hs != null);
  if (!list.length) return '';
  return `<div class="by-h" id="buoyOthers">Altres boies (ICATMAR)</div>
    <ul class="by-models by-others">${list.map((o) => {
      const old = Date.now() / 1000 - o.t > 6 * 3600;
      const main = o.m?.main;
      return `<li>
        <span>${o.nom}<small>${dayLabel(o.t) === 'Avui' ? '' : dayLabel(o.t).toLowerCase() + ' '}${hh(o.t)} h · ${ago(o.t * 1000)}${old ? ' · antiga' : ''}</small></span>
        <em>${nf2.format(o.hs)} m</em>
        <i>${o.dir != null ? `del ${windName(o.dir)}` : ''}${o.tp ? ` · ${nf1.format(o.tp)} s` : ''}${o.sst != null ? ` · ${nf1.format(o.sst)} °C` : ''}${main != null ? `<br>model: ${nf2.format(main)} m (${signed(main - o.hs)})` : ''}</i>
      </li>`;
    }).join('')}</ul>
    <p class="by-note">Arriben amb unes 2 h de retard: les llegeix cada hora el procés de calibratge.</p>`;
}

function renderBuoy() {
  renderBuoyDot();
  const el = $('buoyCard');
  if (!el) return; // index.html antic encara a la memòria del navegador
  if (!buoy?.reading) {
    el.hidden = !buoyErr;
    if (buoyErr) el.innerHTML = `<h2>Boia del ${BUOY.name}</h2><p class="by-note">No s'ha pogut llegir la boia: ${buoyErr}</p>${othersBlock()}${calibBlock()}`;
    return;
  }
  el.hidden = false;
  const r = buoy.reading;
  const ageMin = (Date.now() / 1000 - r.t) / 60;
  const old = ageMin > 180;
  const when = `${dayLabel(r.t) === 'Avui' ? '' : dayLabel(r.t).toLowerCase() + ' '}a les ${hh(r.t)} h (${ago(r.t * 1000)})`;
  const lv = r.hs == null ? null : r.hs < 0.3 ? 0 : r.hs < 0.8 ? 1 : 2;

  const ms = (buoy.models || []).filter((x) => x.hs != null);
  let models = '';
  if (ms.length && r.hs != null) {
    const best = ms.reduce((a, x) => (Math.abs(x.hs - r.hs) < Math.abs(a.hs - r.hs) ? x : a));
    models = `<div class="by-h">Què deien els models per a les ${hh(r.t)} h, aquí mateix</div>
      <ul class="by-models">${ms.map((x) => `<li class="${x === best ? 'best' : ''}">
        <span>${x.name}<small>${x.note}</small></span>
        <em>${nf2.format(x.hs)} m</em>
        <i>${signed(x.hs - r.hs)} m${x === best ? ' · més encertat' : ''}</i>
      </li>`).join('')}</ul>`;
  }
  models += othersBlock() + calibBlock();

  el.innerHTML = `
    <h2>Boia ${BUOY.name} <span>mesurat, ${BUOY.km} km mar endins</span></h2>
    <div class="by-now">
      <div class="by-big" style="--c:${lv == null ? '#9aa9b5' : LEVELS[lv].color}">
        <b>${r.hs == null ? '—' : nf2.format(r.hs)}<small> m</small></b>
        <span>${r.hmax != null ? `màx. ${nf2.format(r.hmax)} m` : 'onada'}</span>
      </div>
      <ul class="by-facts">
        <li><span>Onada</span>${r.dir == null ? '—' : `del ${windName(r.dir)} (${Math.round(r.dir)}°)`}${r.tp ? ` · ${nf1.format(r.tp)} s` : ''}</li>
        <li><span>Vent</span>${r.wind == null ? '—' : `${Math.round(r.wind)} km/h del ${windName(r.windDir)}`}</li>
        <li><span>Aigua</span>${r.sst == null ? '—' : `<i class="sst-dot" style="background:${sstColor(r.sst)}"></i>${nf1.format(r.sst)} °C`}</li>
      </ul>
    </div>
    <p class="by-when ${old ? 'stale' : ''}">Lectura ${when}${old ? ' · dada antiga, la boia pot estar sense transmetre' : ''}</p>
    ${models}`;
}

// ---------- Fitxa de platja ----------
function openDetail(id) {
  if (isDrawing()) return;
  closeRouteSheet();
  selected = id;
  $('detail').hidden = false;
  renderDetail();
  renderMarkers();
  // Al mòbil la fitxa tapa mig mapa: hi centrem la platja. A l'ordinador el mapa queda sencer al costat.
  const b = getBeach(id);
  if (map && b && !b.custom && !wide.matches) map.panTo(seaPoint(b)); // el punt triat ja és on l'usuari mirava
}
function closeDetail() { $('detail').hidden = true; selected = null; renderMarkers(); }

// Color de cada tipus de mar (taronja/vermell = incòmode, verds = agradable).
const KIND_COLOR = { plana: '#9be7b4', curta: '#a8dcff', mitjana: '#9be7b4', llarga: '#7fe0c8', picada: '#ffb46b', creuada: '#ff8f8f' };

/** Dibuix del perfil de l'onada: la distància entre crestes surt del període (com més llarg, més espaiades). */
function waveSketch(sea) {
  const W = 300, Hh = 46, mid = 24;
  const lenPx = Math.max(16, Math.min(150, (sea.len ?? 25) * 1.1)); // 1 m ≈ 1,1 px
  const amp = Math.max(2, Math.min(16, sea.hb * 22));
  let d = `M0 ${mid}`;
  for (let x = 2; x <= W; x += 2) {
    let y = Math.sin((x / lenPx) * 2 * Math.PI);
    if (sea.kind === 'picada') y = Math.sign(y) * Math.pow(Math.abs(y), 0.6);                       // crestes punxegudes
    if (sea.kind === 'creuada') y = 0.65 * y + 0.45 * Math.sin((x / (lenPx * 0.62)) * 2 * Math.PI + 1); // dos trens barrejats
    d += ` L${x} ${(mid - y * amp).toFixed(1)}`;
  }
  return `<svg class="sea-sketch" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L${W} ${Hh} L0 ${Hh}z" fill="${KIND_COLOR[sea.kind]}" fill-opacity=".22"/>
    <path d="${d}" fill="none" stroke="${KIND_COLOR[sea.kind]}" stroke-width="2"/></svg>`;
}

/** Com és l'onada: tipus, període, distància entre crestes i per on entra a la platja. */
function seaBlock(b, h, a) {
  const s = a.sea;
  if (!s) return '';
  const K = SEA_KINDS[s.kind];
  const dom = s.comps[0];
  const e = dom && dom.off > 0 ? dom.h / dom.off : 1;
  const entra = e >= 0.9 ? 'entra de ple a la platja' : e >= 0.4 ? 'entra de biaix, una mica reduïda' : 'gairebé no entra: la platja hi queda arrecerada';
  const src = { vent: 'mar de vent', fons: 'mar de fons', fons2: 'segon mar de fons', total: 'onada' }[s.src] || 'onada';
  const factor = K.factor === 1 ? '' : ` A l'índex compta com ${m(s.eff)} m.`;
  return `<div class="d-sea">
    <div class="d-h" style="margin-top:0">Com és l'onada · ${hh(h.t)} h <button class="info-btn" data-help="periode" aria-label="Què vol dir">i</button></div>
    <div class="sea-head">
      <span class="sea-kind" style="--k:${KIND_COLOR[s.kind]}">${K.label}</span>
      <span>${s.T ? `${nf1.format(s.T)} s entre crestes` : 'període desconegut'}${s.len ? ` · ~${Math.round(s.len)} m d'una a l'altra` : ''}</span>
    </div>
    ${s.kind === 'plana' ? '' : waveSketch(s)}
    <p>${K.tip}${factor}</p>
    <ul class="sea-dirs">
      <li><span>Onada</span>${dom ? `${src} del ${windName(dom.dir)} (${Math.round(dom.dir)}°): ${entra}` : '—'}</li>
      <li><span>Vent</span>${h.wind == null ? '—' : `${Math.round(h.wind)} km/h del ${windName(h.windDir)}, ${REL[a.rel]}${a.rel === 'mar' && h.wind >= 12 ? ': aixeca onada curta a la vora' : a.rel === 'terra' ? ': aplana la vora però t\x27allunya' : ''}`}</li>
    </ul>
  </div>`;
}

function sentence(b, h, a) {
  const parts = [];
  parts.push(a.beachHs == null ? 'Sense dada d\'onada' : `Onada estimada de ${m(a.beachHs)} m a la platja${a.sea && a.sea.kind !== 'plana' ? `, ${SEA_KINDS[a.sea.kind].label.toLowerCase()}` : ''}`);
  if (h.wind != null) parts.push(`vent ${REL[a.rel]} de ${Math.round(h.wind)} km/h${h.gust != null ? ` (ratxes de ${Math.round(h.gust)})` : ''}`);
  return parts.join(', ') + '.';
}

// Fins on es busquen els serveis d'una platja (bars, dutxes, fonts, lavabos, pàrquing, socorrista).
const SERVICES_R = 400;

function renderDetail() {
  const b = getBeach(selected);
  if (!b || !data) return;
  const hours = hoursOf(b);
  const favs = store.get('favBeaches', []);
  $('dTitle').textContent = b.name;
  $('dTown').textContent = `${b.town} · ${b.facing == null ? 'mar obert' : `${b.custom ? 'la costa ' : ''}mira al ${windName(b.facing)}`}`;
  $('dStar').hidden = !!b.custom;
  $('dDel').hidden = !b.custom;
  $('dDel').title = b.saved ? 'Esborra el punt desat' : 'Treu el punt del mapa';
  $('dDel').setAttribute('aria-label', $('dDel').title);
  if (!b.custom) {
    $('dStar').innerHTML = starSvg(favs.includes(b.id));
    $('dStar').style.color = favs.includes(b.id) ? '#ffd34d' : '';
    $('dStar').onclick = () => toggleFav(b.id);
  }
  const h = hours?.[idx];
  if (!h || h.hs === undefined) {
    $('dBody').innerHTML = `${b.custom ? pointBlock(b) : ''}<p class="d-note" style="margin-top:14px">${pts.get(b.id)?.err ? `No s'han pogut carregar les dades d'aquest punt: ${pts.get(b.id).err}` : 'Carregant les dades del punt…'}</p>`;
    return;
  }
  const a = analyze(b, h);
  const alerts = beachAlerts(b, hours, h.t);
  const svc = servicesHtml(b.lat, b.lon, SERVICES_R);

  const wins = [0, 1].map((off) => {
    const w = bestWindow(b, hours, dayKeyOffset(off));
    const lbl = off ? 'Demà' : 'Avui';
    if (!w) return `<div>${lbl}<b>Franja passada</b></div>`;
    return `<div><i style="background:${LEVELS[w.level].color}"></i>${lbl}, millor<b>${winText(w)}</b>Índex ${nf1.format(w.index)} · ${m(w.hs)} m · ${w.wind == null ? '—' : Math.round(w.wind)} km/h</div>`;
  }).join('');

  const swDir = h.swDir ?? h.dir;
  const facts = [
    ['Mar obert (model)', `${m(h.hs)} m del ${windName(h.dir)}${h.per ? `, ${Math.round(h.per)} s` : ''}`],
    ['Mar de fons', h.sw == null ? '—' : `${m(h.sw)} m del ${windName(swDir)}${(h.swTp ?? h.swPer) ? `, ${nf1.format(Math.max(h.swTp ?? 0, h.swPer ?? 0))} s` : ''}`],
    ...(h.s2 >= 0.05 ? [['2n mar de fons', `${m(h.s2)} m del ${windName(h.s2Dir)}${h.s2Per ? `, ${nf1.format(h.s2Per)} s` : ''}`]] : []),
    ['Mar de vent', h.ww == null ? '—' : `${m(h.ww)} m del ${windName(h.wwDir)}${(h.wwTp ?? h.wwPer) ? `, ${nf1.format(Math.max(h.wwTp ?? 0, h.wwPer ?? 0))} s` : ''}`],
    ['Vent', h.wind == null ? '—' : `${Math.round(h.wind)} km/h del ${windName(h.windDir)} (${REL[a.rel]}) · ratxes ${Math.round(h.gust ?? 0)}`],
    ['Aigua', h.sst == null ? '—' : `<i class="sst-dot" style="background:${sstColor(h.sst)}"></i>${nf1.format(h.sst)} °C, ${sstWord(h.sst)}${wetsuitAdvice(h.sst) ? ` · <b class="neo">${wetsuitAdvice(h.sst).short.toLowerCase()}</b>` : ''}`],
    ['Aire', h.air == null ? '—' : `${Math.round(h.air)} °C`],
  ];
  const br = buoy?.reading;
  if (br?.hs != null) facts.push([`Boia ${BUOY.name}`, `${m(br.hs)} m del ${windName(br.dir)} · ${hh(br.t)} h (mesurat, mar obert)`]);

  $('dBody').innerHTML = `${b.custom ? pointBlock(b) : ''}
    ${alertsHtml(alerts)}
    <div class="d-now">
      <div class="lvl score" style="background:${LEVELS[a.level].color}" aria-label="Índex de nedada ${nf1.format(a.score)} sobre 10">${nf1.format(a.score)}<small>/10</small></div>
      <p><b>${LEVELS[a.level].label}</b> · ${dayLabel(h.t)} ${hhmm(h.t)}<br>${sentence(b, h, a)}
        ${a.why.length ? `<small>Per: ${a.why.join(', ')}.</small>` : ''}</p>
    </div>
    <div class="d-score">
      ${scoreBar('Onada', a.waveScore)}
      ${scoreBar('Vent', a.windScore)}
      <p>Índex de nedada de 0 a 10: combina l'onada a la platja (segons d'on ve, com d'alta és i el tipus de mar) amb el vent i les ratxes. Compta sobretot el pitjor dels dos, i si tots dos fallen alhora baixa encara més. Més de 7 = bo · de 4 a 7 = mogut · 4 o menys = mala mar. <button class="link-btn" data-help="index">Com es calcula?</button></p>
    </div>
    ${seaBlock(b, h, a)}
    <div class="d-windows">${wins}</div>
    ${svc ? `<div class="d-h">${b.custom ? 'A prop' : 'A la platja'}</div>${svc}<p class="d-note">Serveis d'OpenStreetMap a menys de ${SERVICES_R} m: pot ser que n'hi falti algun o que siguin de temporada.</p>` : ''}
    ${outfallsHtml(b, h.t)}
    ${modelsBlock(b, h)}
    <div class="d-h">Pròximes 48 hores</div>
    <div class="d-chart" id="dChart">${chart(b, hours)}</div>
    <div class="d-h">Detall a les ${hhmm(h.t)}</div>
    <ul class="d-facts">${facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('')}</ul>
    <p class="d-note">L'onada a la platja s'estima a partir de la previsió mar endins (el model té cel·les de diversos km) i de cap on mira la platja: el mar que ve de fora del seu sector obert arriba molt reduït. Vent "de terra" vol dir que bufa cap al mar: aigua plana a la vora, però et pot allunyar.</p>`;

  const sc = $('dChart');
  const x = (idx - nowIdx) * 34 - sc.clientWidth / 2 + 17;
  sc.scrollLeft = Math.max(0, x);
}

// Què diuen els altres models d'onades (inclòs el que ensenya el Windy) i enllaç per veure-ho allà mateix.
function modelsBlock(b, h) {
  const { rows, spread } = modelCompare(b, h);
  const max = Math.max(0.5, ...rows.map((r) => r.hs ?? 0));
  const agree = rows.length < 2 ? ''
    : spread < 0.2 ? 'Els models coincideixen: previsió fiable.'
    : spread < 0.5 ? 'Els models difereixen una mica.'
    : 'Els models no coincideixen: previsió incerta, mira-ho també al Windy.';
  const lines = rows.map((r) => {
    const lv = r.beach == null ? null : r.beach < 0.3 ? 0 : r.beach < 0.8 ? 1 : 2;
    return `<li class="${r.id === 'main' ? 'main' : ''}">
      <span>${r.name}<small>${r.note}</small></span>
      <i class="mbar"><b style="width:${((r.hs ?? 0) / max) * 100}%"></b><b class="in" style="width:${((r.beach ?? 0) / max) * 100}%;background:${lv == null ? '#9aa9b5' : LEVELS[lv].color}"></b></i>
      <em>${m(r.beach)} m<small>${m(r.hs)} ${windName(r.dir)}</small></em>
    </li>`;
  }).join('');
  return `<div class="d-models">
    <div class="d-h" style="margin-top:0">Què diuen els models · ${hh(h.t)} h</div>
    ${rows.length > 1 ? `<ul>${lines}</ul><p>${agree} Xifra gran: onada a la platja; petita: mar obert i d'on ve.</p>` : '<p>No s\'han pogut carregar els altres models.</p>'}
    <a class="windy-btn" href="${windyUrl(b)}" target="_blank" rel="noopener">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
      Obre al Windy
    </a>
  </div>`;
}

function scoreBar(label, v) {
  const c = LEVELS[v > 7 ? 0 : v > 4 ? 1 : 2].color;
  return `<div class="sb"><span>${label}</span><i><b style="width:${v * 10}%;background:${c}"></b></i><em>${v}/10</em></div>`;
}

function chart(b, hours) {
  const from = nowIdx, to = Math.min(hours.length, nowIdx + 48);
  const hs = hours.slice(from, to);
  const W = 34, H = 214, base = 112, maxM = Math.max(1, ...hs.map((h) => h.hs ?? 0));
  const sc = (v) => (v / maxM) * 76;
  let out = '';
  hs.forEach((h, i) => {
    const x = i * W, cx = x + W / 2, a = analyze(b, h), lv = LEVELS[a.level].color;
    const p = localParts(h.t);
    if (from + i === idx) out += `<rect x="${x + 1}" y="0" width="${W - 2}" height="${H}" rx="6" fill="rgba(255,255,255,.1)"/>`;
    if (p.hour === 0 && i) out += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/>`;
    out += `<rect x="${x + 2}" y="2" width="${W - 4}" height="17" rx="5" fill="${lv}"/>`;
    out += `<text x="${cx}" y="14.5" fill="#0b1d2c" font-size="11" font-weight="600" text-anchor="middle">${Math.round(a.score)}</text>`;
    // onada mar endins (contorn) i a la platja (ple)
    if (h.hs != null) out += `<rect x="${cx - 9}" y="${base - sc(h.hs)}" width="18" height="${sc(h.hs)}" rx="3" fill="none" stroke="rgba(168,220,255,.45)" stroke-dasharray="2 2"/>`;
    if (a.beachHs != null) {
      out += `<rect x="${cx - 9}" y="${base - sc(a.beachHs)}" width="18" height="${Math.max(sc(a.beachHs), 1)}" rx="3" fill="#a8dcff"/>`;
      out += `<text x="${cx}" y="${base - Math.max(sc(a.beachHs), sc(h.hs ?? 0)) - 5}" fill="#fff" font-size="10.5" text-anchor="middle">${m(a.beachHs)}</text>`;
    }
    // període (s), pintat segons el tipus de mar
    if (a.sea?.T && a.sea.kind !== 'plana') out += `<text x="${cx}" y="127" fill="${KIND_COLOR[a.sea.kind]}" font-size="10" font-weight="500" text-anchor="middle">${Math.round(a.sea.T)}s</text>`;
    // vent
    const rot = ((h.windDir ?? 0) + 180) % 360;
    const wc = a.rel === 'mar' ? '#ffb46b' : a.rel === 'terra' ? '#9be7b4' : '#fff';
    out += `<g transform="rotate(${rot} ${cx} 148)"><path d="M${cx} 139 l6 14 l-6 -4 l-6 4z" fill="${wc}"/></g>`;
    out += `<text x="${cx}" y="172" fill="#fff" font-size="11" text-anchor="middle">${h.wind == null ? '—' : Math.round(h.wind)}</text>`;
    out += `<text x="${cx}" y="186" fill="rgba(255,255,255,.5)" font-size="9.5" text-anchor="middle">${h.gust == null ? '' : Math.round(h.gust)}</text>`;
    out += `<text x="${cx}" y="206" fill="rgba(255,255,255,.75)" font-size="11" text-anchor="middle">${p.hour === 0 ? cap(fmt({ weekday: 'short' }).format(h.t * 1000)) : String(p.hour).padStart(2, '0')}</text>`;
  });
  return `<svg width="${hs.length * W}" height="${H}" viewBox="0 0 ${hs.length * W} ${H}" role="img" aria-label="Onada i vent per hores">${out}</svg>
    <div class="legend" style="padding:6px 8px 0">
      <span>A dalt: índex de nedada (0-10)</span>
      <span><i style="background:#a8dcff"></i>Onada a la platja (m)</span>
      <span><i style="background:none;border:1px dashed rgba(168,220,255,.7)"></i>Mar obert</span>
      <span>Segons: període, <b style="color:${KIND_COLOR.picada}">picada</b> / <b style="color:${KIND_COLOR.creuada}">creuada</b> / <b style="color:${KIND_COLOR.curta}">curta</b> / <b style="color:${KIND_COLOR.llarga}">llarga</b></span>
      <span>Fletxa: vent <b style="color:#9be7b4">de terra</b> / <b style="color:#ffb46b">de mar</b> · km/h i ratxes</span>
    </div>`;
}

// ---------- Interaccions ----------
$('time').addEventListener('input', (e) => {
  idx = Number(e.target.value);
  renderTime();
  if (selected) renderDetail();
});

document.querySelector('.chips').addEventListener('click', (e) => {
  const j = e.target.closest('[data-jump]')?.dataset.jump;
  if (!j || !data) return;
  const k = jumpIndex(j);
  if (k >= 0) idx = k;
  $('time').value = idx;
  renderTime();
  if (selected) renderDetail();
});

$('beaches').addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (star) return toggleFav(star.dataset.star);
  const row = e.target.closest('[data-b]');
  if (row) openDetail(row.dataset.b);
});

$('dClose').onclick = closeDetail;
$('dDel').onclick = () => deletePoint(selected);
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) closeDetail(); });

// Manual "Com funciona": s'obre des de la capçalera o des de la fitxa, a la secció que toca.
function openHelp(key) {
  $('help').hidden = false;
  const panel = $('help').querySelector('.sheet-panel');
  const target = key && key !== 'top' ? $(`h-${key}`) : null;
  const head = panel.querySelector('.sheet-head').offsetHeight; // la capçalera queda fixa a dalt
  panel.scrollTop = target ? target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - head - 4 : 0;
}
const closeHelp = () => { $('help').hidden = true; };
document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-help]')?.dataset.help;
  if (k) openHelp(k);
});
$('helpClose').onclick = closeHelp;
$('help').addEventListener('click', (e) => {
  if (e.target === $('help')) return closeHelp();
  const a = e.target.closest('.help-nav a');
  if (a) { e.preventDefault(); openHelp(a.getAttribute('href').slice(3)); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('help').hidden) closeHelp();
  else if (!$('detail').hidden) closeDetail();
  else if (routeSheetOpen()) closeRouteSheet();
});
$('refreshBtn').onclick = () => load(true);

setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

load();

// Fitxa del punt triat: cap on mira la costa (esborrar-lo és la paperera de la capçalera, #dDel).
$('dBody').addEventListener('click', (e) => {
  const f = e.target.closest('[data-facing]');
  if (f) { const v = f.dataset.facing; return setPointFacing(v === '' ? null : /^[0-9]+$/.test(v) ? Number(v) : v); }
});
// Desar el punt (o canviar-ne el nom). És un formulari perquè la tecla Retorn també desi.
$('dBody').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-save-point]')) return;
  e.preventDefault();
  savePoint(e.target.elements.nom.value);
});
