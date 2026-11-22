// Pantalla de les rutes de nedada: dibuixar-la (com al MapTrack: creu al centre, "+ Punt", "Desfer"),
// pintar-la al mapa per trams amb el color del semàfor i la fitxa "La teva nedada".
import { LEVELS, TZ, localParts, dayKeyOffset, windName, SEA_KINDS } from './marine.js';
import { routeGeometry, fetchRouteData, cachedRouteData, runRoute, recommend, getRoute, saveRoute, deleteRoute,
  pathLength, isLoop, distM, bearing, DEFAULT_PACE, placeName, headingName } from './route.js';

const $ = (id) => document.getElementById(id);
const nf1 = new Intl.NumberFormat('ca', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = (o) => new Intl.DateTimeFormat('ca', { timeZone: TZ, ...o });
const hhmm = (t) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000);
const m1 = (v) => (v == null ? '—' : nf1.format(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDist = (mt) => (mt < 1000 ? `${Math.round(mt / 10) * 10} m` : `${nf1.format(mt / 1000)} km`);
const fmtDur = (s) => { const mn = Math.round(s / 60); return mn < 60 ? `${mn} min` : `${Math.floor(mn / 60)} h ${String(mn % 60).padStart(2, '0')}`; };
const paceTxt = (p) => `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`;
const signed1 = (v) => (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + nf1.format(Math.abs(v));
const EFF = { favor: 'a favor', contra: 'en contra', neutre: 'neutre' };
const WREL = { cara: 'de cara', esquena: "d'esquena", costat: 'de costat' };

const ICO = {
  route: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="18.5" r="2.2"/><circle cx="18.5" cy="5.5" r="2.2"/><path d="M8 18.5h7.5a3.3 3.3 0 0 0 0-6.6h-7a3.3 3.3 0 0 1 0-6.6H16" stroke-dasharray="2.2 2.8"/></svg>',
  arrow: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10 10 6 8 2 10z"/></svg>',
};

let map = null, ctx = null;
let layer = null;          // ruta analitzada al mapa
let drawing = null;        // { pts: [LatLng], layer, line, verts }
let cross = null, bar = null;
let geo = null, data = null, result = null, rec = null, err = null, busy = false;

export const isDrawing = () => !!drawing;
export const sheetOpen = () => !$('routeSheet').hidden;

/** Es crida des de initMap, just després del control de zoom (el botó de ruta hi queda a sota). */
export function initRoutes(m, c) {
  map = m; ctx = c;
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'leaflet-bar route-ctl');
      el.innerHTML = `<a href="#" role="button" title="Ruta de nedada" aria-label="Ruta de nedada">${ICO.route}</a>`;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.on(el.firstChild, 'click', (e) => { L.DomEvent.preventDefault(e); if (drawing) return; getRoute() ? openSheet() : startDraw(); });
      return el;
    },
  });
  new Ctl({ position: 'topleft' }).addTo(map);
  const cont = map.getContainer();
  cross = L.DomUtil.create('div', 'r-cross', cont);
  bar = L.DomUtil.create('div', 'r-bar', cont);
  bar.innerHTML = `<div class="r-bar-info"><b id="rDist">—</b><small id="rHint"></small></div>
    <div class="r-bar-btns">
      <button id="rUndo">Desfer</button><button id="rAdd" class="pri">+ Punt</button><button id="rDone" class="ok">Fet</button>
      <button id="rCancel" class="x" aria-label="Surt sense desar" title="Surt sense desar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`;
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
  $('rAdd').onclick = addPoint;
  $('rUndo').onclick = undoPoint;
  $('rDone').onclick = finishDraw;
  $('rCancel').onclick = cancelDraw;
  map.on('move', drawLive);
  // En editar una ruta, la creu no compta com a punt nou fins que l'usuari arrossega el mapa.
  map.on('dragstart', () => { if (drawing) drawing.follow = true; });
  layer = L.layerGroup().addTo(map);
  // Amb el mapa allunyat només es veu la línia de colors: les hores, fletxes i rètols es barrejarien amb les etiquetes.
  const far = () => map.getContainer().classList.toggle('route-far', map.getZoom() < 12);
  map.on('zoomend', far);
  far();

  $('rClose').onclick = closeSheet;
  $('routeSheet').addEventListener('click', (e) => { if (e.target === $('routeSheet')) closeSheet(); });
  $('rEdit').onclick = () => { const r = getRoute(); if (r) startDraw(r.pts); };
  $('rDel').onclick = () => {
    if (!confirm('Vols esborrar aquesta ruta?')) return;
    deleteRoute(); result = rec = geo = data = null; closeSheet(); renderLayer();
  };
  $('rBody').addEventListener('change', onSetting);
  $('rBody').addEventListener('click', onBodyClick);
  if (getRoute()) analyse();
}

// ---------- Dibuixar ----------
function startDraw(pts = []) {
  closeSheet();
  ctx.closeDetail();
  drawing = { pts: pts.map((p) => L.latLng(p[0], p[1])), layer: L.layerGroup().addTo(map), edit: pts.length > 0, follow: !pts.length };
  drawing.line = L.polyline([], { color: '#d93025', weight: 3, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(drawing.layer);
  drawing.verts = L.layerGroup().addTo(drawing.layer);
  map.removeLayer(layer);
  document.body.classList.add('routing');
  map.scrollWheelZoom.enable();
  if (pts.length > 1) map.fitBounds(L.latLngBounds(drawing.pts), { padding: [40, 40], maxZoom: 15 });
  if (!ctx.wide.matches) map.getContainer().scrollIntoView({ block: 'start', behavior: 'smooth' });
  drawVerts();
  drawLive();
}

function drawVerts() {
  drawing.verts.clearLayers();
  drawing.pts.forEach((p, i) => L.circleMarker(p, { radius: i ? 4.5 : 6.5, color: '#0b1d2c', weight: 2, fillColor: i ? '#fff' : '#d93025', fillOpacity: 1, interactive: false }).addTo(drawing.verts));
}

/** Punts de la ruta: els fixats i, si s'ha mogut el mapa, on és la creu. */
function designPts() {
  const pts = drawing.pts.map((p) => [p.lat, p.lng]);
  const c = map.getCenter();
  if (drawing.follow && (!pts.length || distM(pts.at(-1), [c.lat, c.lng]) > 15)) pts.push([c.lat, c.lng]);
  return pts;
}

function drawLive() {
  if (!drawing) return;
  const c = map.getCenter();
  drawing.line.setLatLngs(drawing.follow ? (drawing.pts.length ? [...drawing.pts, c] : []) : drawing.pts);
  const pts = designPts();
  const L0 = drawing.pts.length ? pathLength(pts) : 0;
  $('rDist').textContent = drawing.pts.length ? fmtDist(L0) : 'Ruta nova';
  $('rHint').textContent = !drawing.pts.length
    ? (map.getZoom() < MIN_ZOOM ? 'Acosta el mapa on sortiu i posa-hi la creu' : 'Posa la creu on sortiu i toca «+ Punt»')
    : drawing.pts.length === 1 ? 'Mou el mapa seguint la costa i posa un punt a cada revolt' : 'Toca «Fet» quan arribis al final (la tornada la calculo sola)';
  $('rUndo').disabled = drawing.pts.length < 1;
  $('rDone').disabled = drawing.pts.length < 1 || pts.length < 2;
}

const MIN_ZOOM = 12.5; // amb el mapa més allunyat els punts quedarien massa imprecisos
function addPoint() {
  if (map.getZoom() < MIN_ZOOM) { flashHint('Acosta més el mapa (+) per posar el punt amb precisió'); return; }
  const c = map.getCenter();
  const last = drawing.pts.at(-1);
  if (last && distM([last.lat, last.lng], [c.lat, c.lng]) < 15) { flashHint('Mou el mapa per marcar un punt nou'); return; }
  drawing.pts.push(c);
  drawing.follow = true;
  navigator.vibrate?.(15);
  drawVerts();
  drawLive();
}
function undoPoint() {
  drawing.pts.pop();
  drawVerts();
  drawLive();
}
function flashHint(t) { $('rHint').textContent = t; $('rHint').classList.add('flash'); setTimeout(() => $('rHint').classList.remove('flash'), 1200); }

function stopDraw() {
  map.removeLayer(drawing.layer);
  drawing = null;
  document.body.classList.remove('routing');
  map.scrollWheelZoom.disable();
  layer.addTo(map);
}
function cancelDraw() {
  if (drawing.pts.length > 1 && !confirm(drawing.edit ? 'Vols sortir sense desar els canvis?' : 'Vols sortir sense desar la ruta?')) return;
  stopDraw();
  renderLayer();
}

function finishDraw() {
  const pts = designPts().map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  if (pts.length < 2 || pathLength(pts) < 200) { flashHint('La ruta ha de fer almenys 200 m'); return; }
  const old = getRoute();
  const loop = isLoop(pts);
  // Si abans ja era una ruta oberta, es manté si era d'anada i tornada o només d'anada.
  const back = loop ? false : old && !isLoop(old.pts) ? old.back : true;
  saveRoute({ pts, back, reverse: false, pace: old?.pace ?? DEFAULT_PACE, start: validStart(old?.start) });
  stopDraw();
  result = rec = null;
  map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  openSheet();
  analyse();
}

// ---------- Hora de sortida ----------
const SWIM_HOUR = 9;
/** Instant d'un dia (clau AAAA-MM-DD) a una hora en minuts, a partir de les hores de la previsió (hora local). */
function startOf(day, min) {
  const t = ctx.times().find((x) => { const p = localParts(x); return p.day === day && p.hour === Math.floor(min / 60); });
  return t == null ? null : t + (min % 60) * 60;
}
/** L'hora desada si encara és futura; si no, la pròxima sortida a les 9 h. */
function validStart(t) {
  const now = Date.now() / 1000;
  if (t && t > now - 1800 && t <= ctx.times().at(-1)) return t;
  return startOf(dayKeyOffset(0), SWIM_HOUR * 60) > now ? startOf(dayKeyOffset(0), SWIM_HOUR * 60) : startOf(dayKeyOffset(1), SWIM_HOUR * 60) ?? Math.ceil(now / 900) * 900;
}

// ---------- Càlcul ----------
async function analyse({ force = false } = {}) {
  const r = getRoute();
  if (!r) return;
  if (!ctx.times()?.length) { setTimeout(() => analyse({ force }), 1500); return; } // encara no hi ha dades del mar
  const st = validStart(r.start);
  if (st !== r.start) saveRoute({ ...r, start: st });
  busy = true; err = null;
  renderSheet();
  try {
    geo = await routeGeometry(getRoute().pts);
    data = cachedRouteData(geo);
    if (data) compute();
    renderLayer(); renderSheet();
    data = await fetchRouteData(geo, { force });
    compute();
  } catch (e) {
    err = e.message;
  }
  busy = false;
  renderLayer();
  renderSheet();
}
function compute() {
  const r = getRoute();
  result = runRoute(geo, data, r);
  rec = recommend(geo, data, r);
}
/** Canvi d'hora, ritme o sentit: les dades ja hi són, només cal tornar a calcular. */
function recompute() {
  if (geo && data) { compute(); renderLayer(); renderSheet(); } else analyse();
}
export const refreshRoute = () => { if (map && getRoute() && !drawing && !busy) analyse(); };

// ---------- Ruta al mapa ----------
/** Un punt desplaçat `mt` metres mar endins (la tornada es dibuixa una mica separada de l'anada). */
function seaward(s, mt) {
  if (s.facing == null) return [s.lat, s.lon];
  const f = (s.facing * Math.PI) / 180;
  return [s.lat + (mt * Math.cos(f)) / 111320, s.lon + (mt * Math.sin(f)) / (111320 * Math.cos((s.lat * Math.PI) / 180))];
}

function renderLayer() {
  layer.clearLayers();
  const r = getRoute();
  if (!r || drawing) return;
  if (!result) {
    L.polyline(r.pts, { color: '#0b1d2c', weight: 3, dashArray: '2 8', lineCap: 'round' }).on('click', openSheet).addTo(layer);
    return;
  }
  const S = result.samples;
  const at = (s) => (s.leg === 'tornada' ? seaward(s, 30) : [s.lat, s.lon]);
  for (const leg of ['anada', 'tornada']) {
    const L1 = S.filter((s) => s.leg === leg);
    if (!L1.length) continue;
    const coords = (leg === 'tornada' ? [S.find((s, i) => S[i + 1]?.leg === 'tornada')] : []).concat(L1).filter(Boolean).map(at);
    L.polyline(coords, { color: '#fff', weight: leg === 'anada' ? 10 : 7, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
  }
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    const lv = Math.max(a.a.level, b.a.level);
    L.polyline([at(a), at(b)], { color: LEVELS[lv].color, weight: b.leg === 'anada' ? 6 : 4, lineCap: 'round', lineJoin: 'round' })
      .on('click', openSheet).addTo(layer);
  }
  // Fletxes de sentit (cada ~600 m) i hores de pas (cada 20 min).
  let nextArrow = 300, nextTick = result.start + 20 * 60;
  for (const s of S) {
    if (s.d >= nextArrow) {
      nextArrow += 600;
      L.marker(at(s), { icon: L.divIcon({ className: 'r-arrow', html: `<i style="transform:rotate(${Math.round(s.heading)}deg)">${ICO.arrow}</i>`, iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, keyboard: false }).addTo(layer);
    }
    if (s.t >= nextTick) {
      while (nextTick <= s.t) nextTick += 20 * 60;
      L.marker(at(s), { icon: L.divIcon({ className: 'r-tick', html: `<span>${hhmm(s.t)}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, keyboard: false }).addTo(layer);
    }
  }
  const first = S[0], turn = result.back ? S.find((s, i) => S[i + 1]?.leg === 'tornada') : S.at(-1);
  L.marker(at(first), { icon: L.divIcon({ className: 'r-pin start', html: `<i></i><span>Sortida ${hhmm(first.t)}</span>`, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 900 }).on('click', openSheet).addTo(layer);
  if (turn) L.marker(at(turn), { icon: L.divIcon({ className: 'r-pin end', html: `<i></i><span>${result.back ? 'Gir' : 'Arribada'} ${hhmm(turn.t)}</span>`, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 900 }).on('click', openSheet).addTo(layer);
  const w = result.worst;
  if (w.a.level > 0 || w.a.score < 8.5) {
    L.marker(at(w), { icon: L.divIcon({ className: 'r-worst', iconSize: [0, 0],
      html: `<span><b style="background:${LEVELS[w.a.level].color}">${m1(w.a.score)}</b>${m1(w.a.beachHs)} m · ${hhmm(w.t)}</span>` }), keyboard: false, zIndexOffset: 1000, title: 'Tram més mogut' })
      .on('click', openSheet).addTo(layer);
  }
}

// ---------- Fitxa "La teva nedada" ----------
export function openSheet() {
  ctx.closeDetail();
  $('routeSheet').hidden = false;
  // Si la ruta no es veu sencera (o es veu massa petita), hi acostem el mapa.
  const r = getRoute();
  if (r && map) {
    const b = L.latLngBounds(r.pts);
    if (map.getZoom() < 12.5 || !map.getBounds().contains(b)) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }
  renderSheet();
}
export function closeSheet() { $('routeSheet').hidden = true; }

function settingsHtml(r) {
  const now = Date.now() / 1000;
  const day = localParts(r.start).day;
  const hour = localParts(r.start).hour;
  const min = hour * 60 + Math.round((r.start - startOf(day, hour * 60)) / 60);
  // Dies amb previsió i amb alguna hora de sortida (fins a les 21 h) encara per venir.
  const days = [0, 1, 2, 3].map((o) => dayKeyOffset(o)).filter((d) => d === day || (startOf(d, 6 * 60) != null && (startOf(d, 21 * 60) ?? Infinity) > now));
  const dayOpts = days.map((d) => { const t = startOf(d, 12 * 60) ?? startOf(d, 23 * 60) ?? now; return `<option value="${d}" ${d === day ? 'selected' : ''}>${ctx.dayLabel(t)}</option>`; }).join('');
  const timeOpts = [];
  for (let mn = 5 * 60; mn <= 21 * 60; mn += 15) timeOpts.push(`<option value="${mn}" ${mn === min ? 'selected' : ''}>${String(Math.floor(mn / 60)).padStart(2, '0')}:${String(mn % 60).padStart(2, '0')}</option>`);
  const paceOpts = [];
  for (let p = 80; p <= 210; p += 5) paceOpts.push(`<option value="${p}" ${p === r.pace ? 'selected' : ''}>${paceTxt(p)} /100 m · ${nf1.format(360 / p)} km/h</option>`);
  const loop = isLoop(r.pts);
  const h0 = headingName(bearing(r.pts[0], r.pts[1]));
  const h1 = headingName(bearing(r.pts.at(-1), r.pts.at(-2)));
  return `<div class="r-set">
      <label><span>Sortida</span><select data-set="day">${dayOpts}</select><select data-set="time">${timeOpts.join('')}</select></label>
      <label><span>Ritme</span><select data-set="pace">${paceOpts.join('')}</select></label>
      ${loop ? '<p class="r-small">Circuit: acaba on comença.</p>' : `<div class="dir-chips"><button data-back="1" class="${r.back ? 'on' : ''}">Anada i tornada</button><button data-back="0" class="${r.back ? '' : 'on'}">Només anada</button></div>`}
      ${r.back ? '' : `<div class="dir-chips"><button data-rev="0" class="${r.reverse ? '' : 'on'}">Com l'he dibuixada (${h0})</button><button data-rev="1" class="${r.reverse ? 'on' : ''}">Al revés (${loop ? h1 : 'des del final'})</button></div>`}
    </div>`;
}

function recHtml(r) {
  if (!rec) return '';
  const lo = rec.window;
  if (!rec.better) return `<div class="r-rec same">L'hora i el sentit triats són dels millors per a aquest dia entre les ${lo.from} i les ${lo.to} h.</div>`;
  const b = rec.r, c = rec.cur;
  const dir = r.back ? '' : rec.reverse !== !!r.reverse ? `, ${rec.reverse ? 'al revés' : 'com l\'has dibuixada'} (${headingName(b.samples[0].heading)})` : '';
  const why = [];
  if (b.worst.a.score > c.worst.a.score + 0.2) why.push(`el pitjor tram passa de ${m1(c.worst.a.score)} a ${m1(b.worst.a.score)}`);
  if (b.ret && c.ret && b.ret.wind - c.ret.wind >= 4) why.push('a la tornada el vent molesta menys');
  if (b.duration < c.duration - 240) why.push(`${fmtDur(c.duration - b.duration)} menys`);
  return `<div class="r-rec">Millor sortir <b>a les ${hhmm(rec.start)}${dir}</b>${why.length ? `: ${why.join(', ')}` : ''}.
    <button data-apply>Aplica-ho</button></div>`;
}

function summaryHtml(R) {
  const w = R.worst, k = w.a.sea?.kind;
  const p = [];
  p.push(`Sortint a les ${hhmm(R.start)} ${headingName(R.samples[0].heading)}, ${R.back ? 'tornareu' : 'arribareu'} cap a les <b>${hhmm(R.end)}</b>.`);
  p.push(`El tram més mogut és <b>${esc(placeName(w))}</b> (${hhmm(w.t)}): ${m1(w.a.beachHs)} m${k && k !== 'plana' ? `, ${SEA_KINDS[k].label.toLowerCase()}` : ''}, ${w.sector || 'mar obert'}${w.h.wind != null ? `, vent de ${Math.round(w.h.wind)} km/h del ${windName(w.h.windDir)}` : ''}.`);
  if (R.ret) {
    const o = R.out, t = R.ret;
    const harder = t.cur < o.cur - 0.1 || t.wind < o.wind - 6;
    const easier = t.cur > o.cur + 0.1 || t.wind > o.wind + 6;
    if (t.head <= -10) p.push(`A la tornada, vent de cara de fins a ${Math.round(-t.head)} km/h${harder ? ': costarà més que l\'anada' : ''}.`);
    else if (harder) p.push('La tornada costarà una mica més que l\'anada (vent o corrent en contra).');
    else if (easier) p.push('A la tornada el vent i el corrent us ajudaran.');
  }
  const diff = R.duration - R.plain;
  if (Math.abs(diff) >= 240) p.push(`El corrent i el vent ${diff > 0 ? 'us fan perdre' : 'us fan guanyar'} uns ${fmtDur(Math.abs(diff))}.`);
  const off = R.samples.find((s) => s.a.rel === 'terra' && (s.h.wind ?? 0) >= 20);
  if (off) p.push(`<span class="r-warn-t">Vent de terra de ${Math.round(off.h.wind)} km/h a ${esc(placeName(off))}: us allunya de la costa.</span>`);
  return `<p class="r-sum">${p.join(' ')}</p>`;
}

/** Perfil al llarg de la ruta: nota de cada tram (barres), onada a la platja (línia) i esforç (franja de sota). */
function chartHtml(R) {
  const S = R.samples, W = 600, H = 150, top = 14, hBar = 78, yE = top + hBar + 8;
  const x = (d) => (d / R.length) * W;
  const bw = Math.max(2, W / S.length);
  const maxHs = Math.max(0.5, ...S.map((s) => s.a.beachHs ?? 0));
  let out = '';
  const turn = R.back ? S.find((s, i) => S[i + 1]?.leg === 'tornada') : null;
  if (turn) out += `<rect x="${x(turn.d)}" y="0" width="${W - x(turn.d)}" height="${yE + 10}" fill="rgba(255,255,255,.05)"/><text x="${x(turn.d) + 4}" y="10" font-size="10" fill="rgba(255,255,255,.6)">tornada</text>`;
  S.forEach((s) => {
    const hgt = Math.max(2, (s.a.score / 10) * hBar);
    out += `<rect x="${(x(s.d) - bw / 2).toFixed(1)}" y="${(top + hBar - hgt).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" fill="${LEVELS[s.a.level].color}" opacity=".9"/>`;
    const ec = s.effort === 'favor' ? '#9be7b4' : s.effort === 'contra' ? '#ff8f8f' : 'rgba(255,255,255,.22)';
    out += `<rect x="${(x(s.d) - bw / 2).toFixed(1)}" y="${yE}" width="${bw.toFixed(1)}" height="7" fill="${ec}"/>`;
  });
  const line = S.map((s, i) => `${i ? 'L' : 'M'}${x(s.d).toFixed(1)} ${(top + hBar - ((s.a.beachHs ?? 0) / maxHs) * hBar).toFixed(1)}`).join(' ');
  out += `<path d="${line}" fill="none" stroke="#0b1d2c" stroke-width="4" stroke-linejoin="round" opacity=".55"/><path d="${line}" fill="none" stroke="#a8dcff" stroke-width="2" stroke-linejoin="round"/>`;
  let next = R.start;
  for (const s of S) {
    if (s.t < next) continue;
    while (next <= s.t) next += 20 * 60;
    out += `<line x1="${x(s.d)}" y1="${yE + 8}" x2="${x(s.d)}" y2="${yE + 13}" stroke="rgba(255,255,255,.5)"/><text x="${Math.min(W - 16, Math.max(14, x(s.d)))}" y="${yE + 25}" font-size="10.5" fill="rgba(255,255,255,.75)" text-anchor="middle">${hhmm(s.t)}</text>`;
  }
  out += `<text x="${W}" y="${yE + 38}" font-size="10" fill="rgba(255,255,255,.5)" text-anchor="end">${fmtDist(R.length)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Nota i onada al llarg de la ruta">${out}</svg>
    <div class="legend r-legend"><span><i style="background:#3ccf7a"></i>Barres: nota de cada tram</span><span><i style="background:#a8dcff"></i>Línia: onada (fins a ${m1(maxHs)} m)</span>
    <span>Franja de sota: <b style="color:#9be7b4">a favor</b> / <b style="color:#ff8f8f">en contra</b></span></div>`;
}

function tramsHtml(R) {
  return `<ul class="r-trams">${R.trams.map((g, i) => {
    const w = g.worst, h = w.h, k = w.a.sea?.kind, dom = w.a.sea?.comps?.[0];
    const sea = `${m1(g.hs)} m${dom ? ` del ${windName(dom.dir)}` : ''}${k && k !== 'plana' ? ` · ${SEA_KINDS[k].label.split(' ')[0].toLowerCase()}` : ''}`;
    const wind = h.wind == null ? '' : `vent ${Math.round(h.wind)} km/h ${WREL[w.windRel] ?? ''}`;
    const cur = Math.abs(g.cur) >= 0.05 ? ` · corrent ${signed1(g.cur)} km/h` : '';
    const flags = [g.cape ? 'punta exposada' : '', g.land ? 'passa per terra?' : ''].filter(Boolean).join(' · ');
    return `<li data-tram="${i}">
      <span class="r-t">${hhmm(g.from.t)}${g.leg === 'tornada' ? '<small>tornada</small>' : ''}</span>
      <b class="r-sc" style="background:${LEVELS[w.a.level].color}">${m1(w.a.score)}</b>
      <span class="r-what"><b>${esc(placeName(g.mid))}</b><small>${sea} · ${w.sector || 'mar obert'}</small><small>${wind}${cur}${flags ? ` · <em>${flags}</em>` : ''}</small></span>
      <span class="ef ${g.effort}">${EFF[g.effort]}</span>
    </li>`;
  }).join('')}</ul>`;
}

function renderSheet() {
  const r = getRoute();
  if (!r || $('routeSheet').hidden) return;
  const loop = isLoop(r.pts);
  const L0 = pathLength(r.pts) * (r.back ? 2 : 1);
  $('rSub').textContent = `${fmtDist(L0)} · ${loop ? 'circuit' : r.back ? 'anada i tornada' : 'només anada'}`;
  const R = result;
  const warns = [];
  if (err) warns.push(`No s'han pogut carregar les dades de la ruta: ${esc(err)}`);
  if (geo?.noCoast) warns.push("No s'ha pogut carregar la línia de costa: la ruta es calcula com si tot fos mar obert.");
  if (geo?.outside && !geo?.noCoast) warns.push('Una part de la ruta queda fora de la Costa Brava: allà no es té en compte la forma de la costa.');
  if (geo?.onLand) warns.push('Algun punt de la ruta sembla que passa per terra. Revisa el dibuix (llapis de dalt).');
  if (R?.beyond) warns.push('La nedada acaba més enllà de la previsió disponible: l\'últim tram fa servir l\'última hora que hi ha.');
  let body = settingsHtml(r) + warns.map((w) => `<p class="d-warn">${w}</p>`).join('');
  if (!R) body += `<p class="d-note">${busy ? 'Calculant la ruta: costa, onades, vent i corrents…' : ''}</p>`;
  else {
    const wl = LEVELS[R.worst.a.level];
    body += recHtml(r) + `
      <div class="r-kpis">
        <div><b>${fmtDur(R.duration)}</b><span>durada</span></div>
        <div><b>${hhmm(R.end)}</b><span>${R.back || loop ? 'tornada' : 'arribada'}</span></div>
        <div><b><i style="background:${wl.color}"></i>${m1(R.worst.a.score)}</b><span>pitjor tram</span></div>
        <div><b>${m1(R.mean)}</b><span>nota mitjana</span></div>
      </div>
      ${summaryHtml(R)}
      <div class="d-h">Al llarg de la ruta</div>
      <div class="r-chart">${chartHtml(R)}</div>
      <div class="d-h">Trams <button class="info-btn" data-help="rutes" aria-label="Com es calcula">i</button></div>
      ${tramsHtml(R)}
      <p class="d-note">Cada 250 m es mira per on hi pot arribar l'onada segons la línia de costa real (caps, cales i illes) i quin temps farà a l'hora que hi passareu. El corrent és una estimació: la meitat del que dona el model mar endins (cel·les de ~8 km) més un 2 % del vent. A la Costa Brava la marea és de pocs centímetres i no es té en compte. Dades de les ${hhmm(data.fetchedAt / 1000)}${busy ? ' · actualitzant…' : ''}.</p>`;
  }
  $('rBody').innerHTML = body;
}

function onSetting(e) {
  const k = e.target.dataset.set;
  const r = getRoute();
  if (!k || !r) return;
  if (k === 'pace') r.pace = Number(e.target.value);
  else {
    const day = $('rBody').querySelector('[data-set="day"]').value;
    const min = Number($('rBody').querySelector('[data-set="time"]').value);
    const t = startOf(day, min);
    if (t == null) return;
    r.start = t;
  }
  saveRoute(r);
  recompute();
}

function onBodyClick(e) {
  const r = getRoute();
  if (!r) return;
  const bk = e.target.closest('[data-back]');
  if (bk) { r.back = bk.dataset.back === '1'; r.reverse = false; saveRoute(r); return recompute(); }
  const rv = e.target.closest('[data-rev]');
  if (rv) { r.reverse = rv.dataset.rev === '1'; saveRoute(r); return recompute(); }
  if (e.target.closest('[data-apply]') && rec) { r.start = rec.start; r.reverse = rec.reverse; saveRoute(r); return recompute(); }
  const tr = e.target.closest('[data-tram]');
  if (tr && result) {
    const g = result.trams[Number(tr.dataset.tram)];
    const S = result.samples.filter((s) => s.d >= g.from.d && s.d <= g.to.d);
    map.fitBounds(L.latLngBounds(S.map((s) => [s.lat, s.lon])), { padding: [60, 60], maxZoom: 16 });
    if (!ctx.wide.matches) { closeSheet(); map.getContainer().scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
}
