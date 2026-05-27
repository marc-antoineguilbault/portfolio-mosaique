// Verrouillage des projets confidentiels — un seul mot de passe global :
// n'importe quelle saisie + Entrée débloque toutes les tuiles verrouillées
// (passées et futures, via le Set `lockedEntries`).
//
// API : attachLock(inner, imgEl) — appelée par createTile pour les items.locked.

const SVG_NS = 'http://www.w3.org/2000/svg';
const lockedEntries = new Set();
let unlockedAll = false;

function createLockSvg() {
  // Adapté de Noun Project — lock-8106161 by Win Ningsih.
  // Body plein avec trou de serrure (evenodd cutout) + arc épais en stroke.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 20');
  svg.setAttribute('class', 'tile-lock');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M1 10 H15 V20 H1 Z M7.4 13 H8.6 V17 H7.4 Z');
  body.setAttribute('fill', 'currentColor');
  body.setAttribute('fill-rule', 'evenodd');
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('d', 'M4.2 10 V6 a3.8 3.8 0 0 1 7.6 0 V10');
  arc.setAttribute('stroke', 'currentColor');
  arc.setAttribute('stroke-width', '2');
  arc.setAttribute('fill', 'none');
  svg.appendChild(body);
  svg.appendChild(arc);
  return svg;
}

function unlockAll() {
  unlockedAll = true;
  for (const entry of lockedEntries) {
    entry.imgEl.classList.remove('tile-img--locked');
    entry.overlayEl.style.opacity = '0';
    entry.lockSvg.style.opacity = '0';
    if (entry.inputEl) entry.inputEl.style.opacity = '0';
    setTimeout(() => {
      entry.overlayEl.remove();
      entry.lockSvg.remove();
      if (entry.inputEl) entry.inputEl.remove();
    }, 900);
  }
  lockedEntries.clear();
}

function showPasswordInput(entry, inner) {
  if (entry.inputEl) return;
  entry.lockSvg.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'tile-pw';
  input.autocomplete = 'off';
  input.spellcheck = false;
  entry.inputEl = input;
  inner.appendChild(input);
  // Bloque la propagation vers les handlers viewport (wheel/mousedown).
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.length > 0) unlockAll();
  });
  input.addEventListener('blur', () => {
    if (input.value.length === 0) {
      input.remove();
      entry.inputEl = null;
      entry.lockSvg.style.display = '';
    }
  });
  setTimeout(() => input.focus(), 0);
}

export function attachLock(inner, imgEl) {
  if (unlockedAll) return;
  imgEl.classList.add('tile-img--locked');
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay-locked';
  inner.appendChild(overlay);
  const lockSvg = createLockSvg();
  inner.appendChild(lockSvg);
  const entry = { imgEl, overlayEl: overlay, lockSvg, inputEl: null };
  lockedEntries.add(entry);
  lockSvg.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showPasswordInput(entry, inner);
  });
}
