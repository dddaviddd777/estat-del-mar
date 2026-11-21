// Desament local (al mòbil). Si el navegador no deixa desar, l'app funciona igual sense memòria.
const KEY = 'mar.v1';

let state = {};
try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }

// Primera vegada: recupera les platges preferides i la franja de l'antic apartat Mar de l'app del temps.
if (!state.migrated) {
  try {
    const old = JSON.parse(localStorage.getItem('temps.v1')) || {};
    if (old.favBeaches && !state.favBeaches) state.favBeaches = old.favBeaches;
    if (old.swimWindow && !state.swimWindow) state.swimWindow = old.swimWindow;
  } catch { /* res a recuperar */ }
  state.migrated = true;
  save();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sense espai o bloquejat */ }
}

export const get = (k, d) => state[k] ?? d;
export function set(k, v) { state[k] = v; save(); }
