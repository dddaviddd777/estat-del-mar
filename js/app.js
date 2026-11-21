import { BEACHES, TZ, fetchMarine, cachedMarine, analyze, bestWindow, LEVELS, localParts, dayKeyOffset, swimWindow, seaPoint, windName,
  modelCompare, windyUrl, sstColor, sstWord, sstStats, sstGradient, SST_RANGE, SEA_KINDS, fetchPoint, nearBeach } from './marine.js';
import * as store from './store.js';
import { BUOY, fetchBuoy, cachedBuoy, fetchCalib, cachedCalib } from './buoy.js';

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
async function loadBuoy(force = false) {
  const [b, c] = await Promise.allSettled([fetchBuoy({ force }), fetchCalib({ force })]);
  if (b.status === 'fulfilled') { buoy = b.value; buoyErr = null; } else buoyErr = b.reason?.message;
  if (c.status === 'fulfilled') calib = c.value;
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
  renderChips();
  renderMarkers();
  renderList();
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
  map = L.map('map', { zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.25, tapHold: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  // Temperatura de l'aigua de tota la costa, a dalt a l'esquerra (és terra: no tapa cap etiqueta).
  const Sst = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'sst-box');
      el.id = 'sstBox';
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  new Sst({ position: 'topleft' }).addTo(map);
  // Les etiquetes surten cap a la dreta (mar): deixem-hi lloc perquè les de més a l'est no quedin tallades.
  const fitCoast = () => map.fitBounds(L.latLngBounds(BEACHES.map((b) => seaPoint(b))),
    wide.matches ? { paddingTopLeft: [40, 30], paddingBottomRight: [190, 30] } : { paddingTopLeft: [24, 24], paddingBottomRight: [170, 24] });
  fitCoast();
  // En passar de mòbil a ordinador (o al revés) el mapa canvia molt de mida: el tornem a encaixar.
  wide.addEventListener('change', () => setTimeout(() => { map.invalidateSize(); fitCoast(); }, 50));
  // Si el mapa s'ha creat quan encara no tenia mida (pantalla amagada), l'ajustem quan en tingui.
  let hadSize = map.getSize().x > 100;
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!hadSize && map.getSize().x > 100) { hadSize = true; fitCoast(); }
  }).observe($('map'));
  for (const b of BEACHES) {
    markers[b.id] = L.marker(seaPoint(b), { keyboard: true, title: b.name, riseOnHover: true })
      .on('click', () => openDetail(b.id))
      .addTo(map);
  }
  map.on('moveend resize', () => renderMarkers());
  document.fonts?.ready.then(() => renderMarkers());
  // Mantenir premut (mòbil, tapHold de Leaflet) o clic dret (ordinador): consulta aquell punt.
  let lastPick = 0;
  map.on('contextmenu', (e) => {
    e.originalEvent?.preventDefault?.();
    if (Date.now() - lastPick < 800) return; // alguns mòbils l'envien dues vegades
    lastPick = Date.now();
    pickPoint(e.latlng.lat, e.latlng.lng);
  });
  restorePts();
}

// Mida de cada etiqueta (nota + nom + onada + vent), per poder-les col·locar sense que es trepitgin.
// Ha de coincidir amb .bm .pill a css/mar.css.
const PILL_H = 26, R = PILL_H / 2, WAVE_W = 52, WIND_W = 40;
const measureCtx = document.createElement('canvas').getContext('2d');
function pillWidth(b) {
  measureCtx.font = '500 12px Outfit, system-ui, sans-serif';
  return PILL_H + 5 + measureCtx.measureText(b.short).width + 5 + WAVE_W + 4 + WIND_W + 3;
}

/**
 * Etiqueta d'una platja (o del punt triat). Cada dada té la seva forma, perquè no es confonguin:
 * cercle de color = nota per nedar (l'únic amb el color del semàfor) · pastilla blava = onada a la platja
 * i cap on va · pastilla del vent = km/h, cap on bufa i color segons la força.
 */
const ARROW = '<svg viewBox="0 0 18 18" aria-hidden="true" style="transform:rotate(ROTdeg)"><path d="M9 1l5 12-5-3-5 3z"/></svg>';
function pillHtml(b, h, a) {
  const score = a.score >= 9.95 ? '10' : nf1.format(a.score);
  const wdir = a.sea?.dir ?? h.dir;
  const waveRot = ((wdir ?? 0) + 180) % 360, windRot = ((h.windDir ?? 0) + 180) % 360;
  return `<b class="sc" style="--c:${LEVELS[a.level].color}" title="Nota per nedar: ${nf1.format(a.score)} de 10 (${LEVELS[a.level].label.toLowerCase()})">${score}</b>
    <span class="nm">${esc(b.short)}</span>
    <span class="wv" title="Onada a la platja: ${m(a.beachHs)} m${wdir != null ? `, ve del ${windName(wdir)}` : ''}">${wdir != null ? ARROW.replace('ROT', waveRot) : ''}${a.beachHs == null ? '—' : m(a.beachHs)}<small>m</small></span>
    <span class="wind" style="--w:${LEVELS[a.windLevel].color}" title="Vent ${REL[a.rel]}: ${h.wind == null ? '—' : Math.round(h.wind)} km/h del ${windName(h.windDir)}">${ARROW.replace('ROT', windRot)}${h.wind == null ? '—' : Math.round(h.wind)}</span>`;
}

/**
 * Col·loca les etiquetes: cadascuna surt del seu punt cap al mar (segons cap on mira la platja)
 * i, si se'n trepitgen dues, se separen. Retorna el desplaçament (px) de cada etiqueta respecte del seu punt.
 */
function layoutLabels() {
  const size = map.getSize();
  const LEAD = 12, GAP = 3; // el cercle surt una mica cap al mar des del punt de la platja
  // Platges i punts propis: les etiquetes dels punts (a la dreta del punt, o a l'esquerra si no hi caben) també compten.
  const all = [...BEACHES, ...[...pts.values()].map((q) => q.b)].map((b) => {
    const p = map.latLngToContainerPoint(seaPoint(b));
    const f = ((b.custom ? 90 : b.facing) * Math.PI) / 180;
    const d = { x: p.x + Math.sin(f) * LEAD, y: p.y - Math.cos(f) * LEAD };
    const w = labelWidth(b);
    if (b.custom && d.x + w - R > size.x - 4) d.x = p.x - LEAD - w + 2 * R; // no hi cap a la dreta: a l'esquerra
    return { id: b.id, p, d, x: d.x, y: d.y, w, minX: b.custom ? p.x - LEAD - w + 2 * R : p.x - 4 };
  });
  // Només col·loquem les que es veuen; les de fora de la pantalla es queden a la seva posició natural.
  const items = all.filter((a) => a.p.x > -20 && a.p.x < size.x + 20 && a.p.y > -20 && a.p.y < size.y + 20);
  const rect = (a) => ({ l: a.x - R, r: a.x - R + a.w, t: a.y - R, b: a.y + R });
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
        if (oy < ox * 2) { const s = (A.p.y < B.p.y || (A.p.y === B.p.y && i < j) ? -1 : 1) * oy / 2; A.y += s; B.y -= s; }
        else { const s = (A.x < B.x ? -1 : 1) * ox / 2; A.x += s; B.x -= s; }
      }
      // Dins del mapa, i la costa queda a l'oest: l'etiqueta no passa a l'esquerra del seu punt (no se'n va terra endins).
      A.x = Math.max(Math.min(A.x, size.x - A.w + R - 4), A.minX);
      A.y = Math.min(Math.max(A.y, R + 4), size.y - R - 18);
    }
  }
  // Repàs final: de dalt a baix, cap etiqueta en trepitja cap altra (si cal, la baixem).
  const hOverlap = (A, B) => Math.min(rect(A).r, rect(B).r) - Math.max(rect(A).l, rect(B).l) + GAP > 0;
  const sorted = [...items].sort((a, b) => a.y - b.y);
  sorted.forEach((B, i) => {
    for (const A of sorted.slice(0, i)) if (hOverlap(A, B) && B.y < A.y + PILL_H + GAP) B.y = A.y + PILL_H + GAP;
  });
  // I si la de baix surt del mapa, pugem la columna.
  const bottom = size.y - R - 18;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const B = sorted[i];
    if (B.y > bottom) B.y = bottom;
    for (const C of sorted.slice(i + 1)) if (hOverlap(B, C) && B.y > C.y - PILL_H - GAP) B.y = C.y - PILL_H - GAP;
  }
  return Object.fromEntries(all.map((a) => [a.id, { dx: a.x - a.p.x, dy: a.y - a.p.y }]));
}

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
        <span class="pill" style="left:${(dx - R).toFixed(1)}px;top:${(dy - R).toFixed(1)}px">${pillHtml(b, h, a)}</span></div>`;
    markers[b.id].setIcon(L.divIcon({ className: 'bm-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }));
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
  const body = a ? pillHtml(b, h, a) : `<span class="nm" style="padding:0 8px">${esc(b.short)} · ${p.err ? 'sense dades' : 'carregant…'}</span>`;
  // Posició de l'etiqueta: la que li ha donat layoutLabels (si encara no en té, a la dreta del punt).
  const o = labelOff[id] ?? { dx: 12 + R, dy: 0 };
  const html = `<div class="bm pt ${b.saved ? 'saved' : ''} ${selected === id ? 'sel' : ''}"><i class="pt-dot"></i>
    <span class="pill" style="left:${(o.dx - R).toFixed(1)}px;top:${(o.dy - R).toFixed(1)}px">${body}</span></div>`;
  const icon = L.divIcon({ className: 'bm-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] });
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
    <button class="link-btn" data-del-point>${b.saved ? 'Esborra aquest punt desat' : 'Treu el punt del mapa'}</button>
  </div>`;
}

function sortedBeaches() {
  const favs = store.get('favBeaches', []);
  return [...BEACHES].sort((x, y) => (favs.includes(y.id) - favs.includes(x.id)) || (BEACHES.indexOf(x) - BEACHES.indexOf(y)));
}

function bestOf(b) {
  const hours = hoursOf(b);
  const today = bestWindow(b, hours, dayKeyOffset(0));
  if (today) return { w: today, label: 'avui' };
  const tom = bestWindow(b, hours, dayKeyOffset(1));
  return tom ? { w: tom, label: 'demà' } : null;
}

function renderList() {
  const favs = store.get('favBeaches', []);
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
  $('beaches').innerHTML = mine + sortedBeaches().map((b) => {
    const h = data.beaches[b.id][idx];
    const a = analyze(b, h);
    const best = bestOf(b);
    const bestTxt = best ? `<span class="best"><i class="dot-s" style="color:${LEVELS[best.w.level].color}">●</i> Millor ${best.label} ${winText(best.w)}</span>` : '';
    return `<li>
      <button class="brow" data-b="${b.id}">
        <i class="dot" style="background:${LEVELS[a.level].color}"></i>
        <span class="bname">${b.name}<small>${bestTxt || b.town}</small></span>
        <span class="bvals">${m(a.beachHs)} m<small>${h.wind == null ? '—' : Math.round(h.wind)} km/h ${REL[a.rel]}</small></span>
      </button>
      <button class="star ${favs.includes(b.id) ? 'on' : ''}" data-star="${b.id}" aria-label="${favs.includes(b.id) ? 'Treure de preferides' : 'Marcar com a preferida'}: ${b.name}">${starSvg(favs.includes(b.id))}</button>
    </li>`;
  }).join('');
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

function renderBuoy() {
  const el = $('buoyCard');
  if (!el) return; // index.html antic encara a la memòria del navegador
  if (!buoy?.reading) {
    el.hidden = !buoyErr;
    if (buoyErr) el.innerHTML = `<h2>Boia del ${BUOY.name}</h2><p class="by-note">No s'ha pogut llegir la boia: ${buoyErr}</p>${calibBlock()}`;
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
  models += calibBlock();

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

function renderDetail() {
  const b = getBeach(selected);
  if (!b || !data) return;
  const hours = hoursOf(b);
  const favs = store.get('favBeaches', []);
  $('dTitle').textContent = b.name;
  $('dTown').textContent = `${b.town} · ${b.facing == null ? 'mar obert' : `${b.custom ? 'la costa ' : ''}mira al ${windName(b.facing)}`}`;
  $('dStar').hidden = !!b.custom;
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
    ['Aigua', h.sst == null ? '—' : `<i class="sst-dot" style="background:${sstColor(h.sst)}"></i>${nf1.format(h.sst)} °C, ${sstWord(h.sst)}`],
    ['Aire', h.air == null ? '—' : `${Math.round(h.air)} °C`],
  ];
  const br = buoy?.reading;
  if (br?.hs != null) facts.push([`Boia ${BUOY.name}`, `${m(br.hs)} m del ${windName(br.dir)} · ${hh(br.t)} h (mesurat, mar obert)`]);

  $('dBody').innerHTML = `${b.custom ? pointBlock(b) : ''}
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
});
$('refreshBtn').onclick = () => load(true);

setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

load();

// Fitxa del punt triat: cap on mira la costa i esborrar-lo.
$('dBody').addEventListener('click', (e) => {
  const f = e.target.closest('[data-facing]');
  if (f) { const v = f.dataset.facing; return setPointFacing(v === '' ? null : /^[0-9]+$/.test(v) ? Number(v) : v); }
  if (e.target.closest('[data-del-point]')) deletePoint(selected);
});
// Desar el punt (o canviar-ne el nom). És un formulari perquè la tecla Retorn també desi.
$('dBody').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-save-point]')) return;
  e.preventDefault();
  savePoint(e.target.elements.nom.value);
});
