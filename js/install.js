// Suggeriment d'instal·lar l'app al mòbil (l'usuari, 25/11/2026: "ha de poder ser instal·lable i et suggereix
// instal·lar-la al mòbil"). Android / Chrome: es guarda l'esdeveniment `beforeinstallprompt` i un avís discret a baix
// ofereix el botó «Instal·la». iPhone / iPad (Safari no té aquest esdeveniment): l'avís explica com afegir-la a la
// pantalla d'inici. No surt si ja està instal·lada, a l'ordinador, ni durant 14 dies després de «Ara no».
import * as store from './store.js';

const SNOOZE = 14 * 86400 * 1000;
const DELAY = 5000; // que primer es vegi l'app
const SHARE_ICO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobile = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const snoozed = () => Date.now() - store.get('installAsked', 0) < SNOOZE;

let deferred = null, el = null;

function close(remember) {
  if (remember) store.set('installAsked', Date.now());
  el?.remove(); el = null;
}

function show(kind) {
  if (el || standalone() || snoozed()) return;
  el = document.createElement('div');
  el.className = 'install-tip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', "Instal·la l'app");
  const text = kind === 'ios'
    ? `Toca ${SHARE_ICO} <b>Comparteix</b> i després <b>Afegeix a la pantalla d'inici</b>.`
    : "S'obre com una app, a pantalla completa i més ràpid, i funciona sense connexió amb l'última previsió.";
  el.innerHTML = `<img src="icons/icon-192.png" alt="" width="40" height="40">
    <div class="it-txt"><b>Instal·la Estat del Mar al mòbil</b><span>${text}</span></div>
    <div class="it-btns">${kind === 'ios' ? '' : '<button type="button" class="it-go">Instal·la</button>'}<button type="button" class="it-no">${kind === 'ios' ? "D'acord" : 'Ara no'}</button></div>`;
  el.querySelector('.it-no').onclick = () => close(true);
  el.querySelector('.it-go')?.addEventListener('click', async () => {
    const p = deferred; deferred = null;
    close(false);
    if (!p) return;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    if (r?.outcome !== 'accepted') store.set('installAsked', Date.now());
  });
  document.body.append(el);
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // en lloc de la barra del navegador, el nostre avís (i només al mòbil)
    deferred = e;
    if (mobile()) setTimeout(() => show('android'), DELAY);
  });
  window.addEventListener('appinstalled', () => { deferred = null; close(false); store.set('installed', true); });
  // A l'iPhone, Safari és l'únic que pot afegir-la a la pantalla d'inici (Chrome i Firefox d'iOS ja ho fan amb el
  // mateix menú Comparteix des de la versió 16.4).
  if (ios() && !standalone()) setTimeout(() => show('ios'), DELAY);
}
