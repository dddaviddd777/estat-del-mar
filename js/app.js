import { BEACHES, TZ, fetchMarine, cachedMarine, analyze, bestWindow, LEVELS, localParts, dayKeyOffset, swimWindow, seaPoint, windName,
  modelCompare, windyUrl, sstColor, sstWord, sstStats, sstGradient, SST_RANGE } from './marine.js';
import * as store from './store.js';
import { BUOY, fetchBuoy, cachedBuoy, modelBias } from './buoy.js';

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
async function loadBuoy(force = false) {
  try { buoy = await fetchBuoy({ force }); buoyErr = null; } catch (e) { buoyErr = e.message; }
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
  map = L.map('map', { zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.25 });
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
  const fitCoast = () => map.fitBounds(L.latLngBounds(BEACHES.map((b) => seaPoint(b))), { padding: [24, 24], paddingBottomRight: [90, 24] });
  fitCoast();
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
  map.on('zoomend resize', () => renderMarkers());
  document.fonts?.ready.then(() => renderMarkers());
}

// Mida de cada etiqueta (cercle + nom + fletxa del vent), per poder-les col·locar sense que es trepitgin.
const PILL_H = 24, R = PILL_H / 2, WIND_W = 40; // WIND_W: amplada de la pastilla del vent
const measureCtx = document.createElement('canvas').getContext('2d');
function pillWidth(b) {
  measureCtx.font = '500 12px Outfit, system-ui, sans-serif';
  return PILL_H + 6 + measureCtx.measureText(b.short).width + 6 + WIND_W + 3;
}

/**
 * Col·loca les etiquetes: cadascuna surt del seu punt cap al mar (segons cap on mira la platja)
 * i, si se'n trepitgen dues, se separen. Retorna el desplaçament (px) de cada etiqueta respecte del seu punt.
 */
function layoutLabels() {
  const size = map.getSize();
  const LEAD = 12, GAP = 3; // el cercle surt una mica cap al mar des del punt de la platja
  const all = BEACHES.map((b) => {
    const p = map.latLngToContainerPoint(seaPoint(b));
    const f = (b.facing * Math.PI) / 180;
    const d = { x: p.x + Math.sin(f) * LEAD, y: p.y - Math.cos(f) * LEAD };
    return { id: b.id, p, d, x: d.x, y: d.y, w: pillWidth(b) };
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
        if (oy < ox * 2) { const s = (A.y < B.y || (A.y === B.y && i < j) ? -1 : 1) * oy / 2; A.y += s; B.y -= s; }
        else { const s = (A.x < B.x ? -1 : 1) * ox / 2; A.x += s; B.x -= s; }
      }
      // Dins del mapa, i la costa queda a l'oest: l'etiqueta no passa a l'esquerra del seu punt (no se'n va terra endins).
      A.x = Math.max(Math.min(A.x, size.x - A.w + R - 4), A.p.x - 4);
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
  const off = layoutLabels();
  for (const b of BEACHES) {
    const h = data.beaches[b.id][idx];
    const a = analyze(b, h);
    const rot = ((h.windDir ?? 0) + 180) % 360;
    const { dx, dy } = off[b.id];
    const html = `<div class="bm ${selected === b.id ? 'sel' : ''}" style="--c:${LEVELS[a.level].color}">
        <span class="pill" style="left:${(dx - R).toFixed(1)}px;top:${(dy - R).toFixed(1)}px">
          <b title="Onada a la platja">${a.beachHs == null ? '—' : m(a.beachHs)}</b>${b.short}
          <span class="wind" style="--w:${LEVELS[a.windLevel].color}" title="Vent ${REL[a.rel]}">
            <svg viewBox="0 0 18 18" style="transform:rotate(${rot}deg)" aria-hidden="true"><path d="M9 1l5 12-5-3-5 3z"/></svg>${h.wind == null ? '—' : Math.round(h.wind)}
          </span>
        </span></div>`;
    markers[b.id].setIcon(L.divIcon({ className: 'bm-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }));
  }
}

function sortedBeaches() {
  const favs = store.get('favBeaches', []);
  return [...BEACHES].sort((x, y) => (favs.includes(y.id) - favs.includes(x.id)) || (BEACHES.indexOf(x) - BEACHES.indexOf(y)));
}

function bestOf(b) {
  const hours = data.beaches[b.id];
  const today = bestWindow(b, hours, dayKeyOffset(0));
  if (today) return { w: today, label: 'avui' };
  const tom = bestWindow(b, hours, dayKeyOffset(1));
  return tom ? { w: tom, label: 'demà' } : null;
}

function renderList() {
  const favs = store.get('favBeaches', []);
  $('beaches').innerHTML = sortedBeaches().map((b) => {
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

function renderBuoy() {
  const el = $('buoyCard');
  if (!buoy?.reading) {
    el.hidden = !buoyErr;
    if (buoyErr) el.innerHTML = `<h2>Boia del ${BUOY.name}</h2><p class="by-note">No s'ha pogut llegir la boia: ${buoyErr}</p>`;
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
    const bias = modelBias();
    const n = Math.max(0, ...Object.values(bias).map((o) => o.n));
    if (n >= 6) {
      models += `<p class="by-note">Mitjana de les ${n} hores que s'han comparat en aquest mòbil: ${ms.filter((x) => bias[x.id])
        .map((x) => `${x.name} ${signed(bias[x.id].bias)} m`).join(' · ')}. Positiu vol dir que el model dona més onada que la real.</p>`;
    } else {
      models += `<p class="by-note">Cada hora que obris l'app es guarda aquesta comparació al mòbil; d'aquí a uns dies veurem quin model l'encerta més de mitjana.</p>`;
    }
  }

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
  if (map) map.panTo(seaPoint(BEACHES.find((x) => x.id === id)));
}
function closeDetail() { $('detail').hidden = true; selected = null; renderMarkers(); }

function sentence(b, h, a) {
  const parts = [];
  parts.push(a.beachHs == null ? 'Sense dada d\'onada' : `Onada estimada de ${m(a.beachHs)} m a la platja`);
  if (h.wind != null) parts.push(`vent ${REL[a.rel]} de ${Math.round(h.wind)} km/h${h.gust != null ? ` (ratxes de ${Math.round(h.gust)})` : ''}`);
  return parts.join(', ') + '.';
}

function renderDetail() {
  const b = BEACHES.find((x) => x.id === selected);
  if (!b || !data) return;
  const hours = data.beaches[b.id];
  const h = hours[idx];
  const a = analyze(b, h);
  const favs = store.get('favBeaches', []);
  $('dTitle').textContent = b.name;
  $('dTown').textContent = `${b.town} · mira al ${windName(b.facing)}`;
  $('dStar').innerHTML = starSvg(favs.includes(b.id));
  $('dStar').style.color = favs.includes(b.id) ? '#ffd34d' : '';
  $('dStar').onclick = () => toggleFav(b.id);

  const wins = [0, 1].map((off) => {
    const w = bestWindow(b, hours, dayKeyOffset(off));
    const lbl = off ? 'Demà' : 'Avui';
    if (!w) return `<div>${lbl}<b>Franja passada</b></div>`;
    return `<div><i style="background:${LEVELS[w.level].color}"></i>${lbl}, millor<b>${winText(w)}</b>Índex ${nf1.format(w.index)} · ${m(w.hs)} m · ${w.wind == null ? '—' : Math.round(w.wind)} km/h</div>`;
  }).join('');

  const swDir = h.swDir ?? h.dir;
  const facts = [
    ['Mar obert (model)', `${m(h.hs)} m del ${windName(h.dir)}${h.per ? `, ${Math.round(h.per)} s` : ''}`],
    ['Mar de fons', h.sw == null ? '—' : `${m(h.sw)} m del ${windName(swDir)}${h.swPer ? `, ${Math.round(h.swPer)} s` : ''}`],
    ['Mar de vent', h.ww == null ? '—' : `${m(h.ww)} m del ${windName(h.wwDir)}`],
    ['Vent', h.wind == null ? '—' : `${Math.round(h.wind)} km/h del ${windName(h.windDir)} (${REL[a.rel]}) · ratxes ${Math.round(h.gust ?? 0)}`],
    ['Aigua', h.sst == null ? '—' : `<i class="sst-dot" style="background:${sstColor(h.sst)}"></i>${nf1.format(h.sst)} °C, ${sstWord(h.sst)}`],
    ['Aire', h.air == null ? '—' : `${Math.round(h.air)} °C`],
  ];
  const br = buoy?.reading;
  if (br?.hs != null) facts.push([`Boia ${BUOY.name}`, `${m(br.hs)} m del ${windName(br.dir)} · ${hh(br.t)} h (mesurat, mar obert)`]);

  $('dBody').innerHTML = `
    <div class="d-now">
      <div class="lvl score" style="background:${LEVELS[a.level].color}" aria-label="Índex de nedada ${nf1.format(a.score)} sobre 10">${nf1.format(a.score)}<small>/10</small></div>
      <p><b>${LEVELS[a.level].label}</b> · ${dayLabel(h.t)} ${hhmm(h.t)}<br>${sentence(b, h, a)}
        ${a.why.length ? `<small>Per: ${a.why.join(', ')}.</small>` : ''}</p>
    </div>
    <div class="d-score">
      ${scoreBar('Onada', a.waveScore)}
      ${scoreBar('Vent', a.windScore)}
      <p>Índex de nedada de 0 a 10: combina l'onada a la platja amb el vent i les ratxes. Compta sobretot el pitjor dels dos, i si tots dos fallen alhora baixa encara més. Més de 7 = bo · de 4 a 7 = mogut · 4 o menys = mala mar.</p>
    </div>
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
  const W = 34, H = 200, base = 112, maxM = Math.max(1, ...hs.map((h) => h.hs ?? 0));
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
    // vent
    const rot = ((h.windDir ?? 0) + 180) % 360;
    const wc = a.rel === 'mar' ? '#ffb46b' : a.rel === 'terra' ? '#9be7b4' : '#fff';
    out += `<g transform="rotate(${rot} ${cx} 134)"><path d="M${cx} 125 l6 14 l-6 -4 l-6 4z" fill="${wc}"/></g>`;
    out += `<text x="${cx}" y="158" fill="#fff" font-size="11" text-anchor="middle">${h.wind == null ? '—' : Math.round(h.wind)}</text>`;
    out += `<text x="${cx}" y="172" fill="rgba(255,255,255,.5)" font-size="9.5" text-anchor="middle">${h.gust == null ? '' : Math.round(h.gust)}</text>`;
    out += `<text x="${cx}" y="192" fill="rgba(255,255,255,.75)" font-size="11" text-anchor="middle">${p.hour === 0 ? cap(fmt({ weekday: 'short' }).format(h.t * 1000)) : String(p.hour).padStart(2, '0')}</text>`;
  });
  return `<svg width="${hs.length * W}" height="${H}" viewBox="0 0 ${hs.length * W} ${H}" role="img" aria-label="Onada i vent per hores">${out}</svg>
    <div class="legend" style="padding:6px 8px 0">
      <span>A dalt: índex de nedada (0-10)</span>
      <span><i style="background:#a8dcff"></i>Onada a la platja (m)</span>
      <span><i style="background:none;border:1px dashed rgba(168,220,255,.7)"></i>Mar obert</span>
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });
$('refreshBtn').onclick = () => load(true);

setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

load();
