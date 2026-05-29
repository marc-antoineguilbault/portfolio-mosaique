import { pool, projects, colorFromSeed, RATIOS } from './data.js';
import { extractGlowColors } from './modules/glow.js';
import { splitIntoLines, splitMetaIntoLines } from './modules/split-lines.js';
import { attachLock } from './modules/lock.js';

// Préférence d'accessibilité : neutralise les animations parasitaires (auto-scroll continu,
// auto-scroll au hover, tilt 3D, trail du curseur). Le glow + le focus projet restent OK.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Capacité de hover (= souris/trackpad). Sans hover (tactile pur), on skip tilt/trail/auto-scroll
// → pas de sticky-hover, pas de curseur custom invisible, comportement natif tactile.
const HAS_HOVER = window.matchMedia('(hover: hover)').matches;

const GAP = 48;
// Gap vertical entre tiles. Desktop 220px (espace pour la meta au hover), mobile 80px
// (la meta n'apparaît plus au tap → on densifie la mosaïque). Recalculé dans computeLayout().
const GAP_Y_DESKTOP = 220;
const GAP_Y_MOBILE = 80;
let GAP_Y = GAP_Y_DESKTOP;
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;

// Radius ancré à la grille de référence : vw=1470, 4 cols, gap=48 → colWidth=307.5, radius=32.
const REF_COL_WIDTH = (1470 - 5 * GAP) / 4;
const REF_RADIUS_OUTER = 32;
const REF_FRAME_PADDING = 12;
const RADIUS_RATIO = REF_RADIUS_OUTER / REF_COL_WIDTH;
const PADDING_RATIO = REF_FRAME_PADDING / REF_COL_WIDTH;
// Recalculé dans computeLayout() à chaque resize, en proportion de colWidth.
let FRAME_PADDING = REF_FRAME_PADDING;

// Patterns déterministes — la grille est identique à chaque reload.
const INITIAL_OFFSETS = [-50, -320, -180, -240];   // décalage Y de départ par colonne
const GROUP_VELOCITIES = [1, 1];                   // vitesses uniformes : un parallax (vitesses divergentes) entrerait en collision avec les tuiles `fullwidth`
const COL_STAGGER = [0, 80, 0, 80];                // décalage visuel permanent par colonne (briser l'alignement vertical entre cols) — offset constant, n'introduit pas de divergence dans le temps

const viewport = document.getElementById('viewport');
const scroller = document.getElementById('scroller');

// Index incrémenté pour la cascade d'apparition au load.
let tileEnterIdx = 0;

// État du focus projet : slug du projet cliqué, ou null si état initial.
let currentFocusedProject = null;

// ─── Typewriter du suffixe " pour <client>" du label TL au CLIC ──────────
// La partie statique "Marc-Antoine Guilbault, Lead Designer UI" ne bouge pas ;
// seul le span .ui-corner__suffix s'écrit/efface lettre par lettre.
const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
const projectDescById = new Map(projects.map((p) => [p.id, p.desc]));

// Désélectionne le projet focused : retire les classes sur toutes les tiles + reset suffixe TL.
// Utilisé par le re-clic sur une tile du projet ET par le clic sur le fond.
function unfocusProject() {
  if (!currentFocusedProject) return;
  currentFocusedProject = null;
  document.querySelectorAll('.tile').forEach((t) => {
    t.classList.remove('tile--project-focused', 'tile--project-dimmed');
  });
  animateSuffix('');
  currentProjectImages = [];
  currentImageIndex = 0;
  if (navTypewriterRAF) { cancelAnimationFrame(navTypewriterRAF); navTypewriterRAF = null; }
  const nav = document.querySelector('.ui-corner__project-nav');
  if (nav) nav.replaceChildren();
}

// Anime offset → targetOffset en ease-out cubic. Clamp au floor pour cohérence.
function smoothScrollOffset(targetOffset, duration = 700) {
  const startOffset = offset;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    offset = startOffset + (targetOffset - startOffset) * eased;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// État de navigation entre les maquettes d'un projet focused.
let currentProjectImages = [];
let currentImageIndex = 0;
const TOP_MARGIN = 80;

function findMinTileY(targetSrc) {
  let targetY = Infinity;
  for (const tile of liveTiles) {
    if (tile.item.src === targetSrc && tile.y < targetY) targetY = tile.y;
  }
  return targetY;
}

function scrollToCurrentImage() {
  if (!currentProjectImages.length) return;
  const targetSrc = currentProjectImages[currentImageIndex].src;
  let targetY = findMinTileY(targetSrc);
  if (targetY === Infinity) {
    flushPrefillSync(targetSrc);
    targetY = findMinTileY(targetSrc);
    if (targetY === Infinity) return; // sécurité, ne devrait pas arriver
  }
  const targetOffset = Math.max(minLiveTileY - SCROLL_TOP_Y, targetY - TOP_MARGIN);
  smoothScrollOffset(targetOffset);
}

function navigateToProjectImage(delta) {
  const total = currentProjectImages.length;
  if (!total) return;
  currentImageIndex = (currentImageIndex + delta + total) % total;
  scrollToCurrentImage();
  renderProjectNav();
}

// Flèches inversées : ↑ = précédent (1→N→...), ↓ = suivant (1→2→...)
function renderProjectNav() {
  const nav = document.querySelector('.ui-corner__project-nav');
  if (!nav) return;
  nav.replaceChildren();
  const total = currentProjectImages.length;
  if (!total) return;
  nav.appendChild(document.createTextNode(' ('));
  const upBtn = document.createElement('button');
  upBtn.className = 'ui-corner__nav-btn';
  upBtn.type = 'button';
  upBtn.setAttribute('aria-label', 'Maquette précédente');
  upBtn.textContent = '↑';
  upBtn.addEventListener('click', (ev) => { ev.stopPropagation(); navigateToProjectImage(-1); });
  nav.appendChild(upBtn);
  nav.appendChild(document.createTextNode(` ${currentImageIndex + 1}/${total} `));
  const downBtn = document.createElement('button');
  downBtn.className = 'ui-corner__nav-btn';
  downBtn.type = 'button';
  downBtn.setAttribute('aria-label', 'Maquette suivante');
  downBtn.textContent = '↓';
  downBtn.addEventListener('click', (ev) => { ev.stopPropagation(); navigateToProjectImage(1); });
  nav.appendChild(downBtn);
  nav.appendChild(document.createTextNode(')'));
}

// Wrapper conservé pour le clic depuis la liste client.
function scrollToFirstProjectTile() { scrollToCurrentImage(); }

// Typewriter du nav (1/N ↑ ↓) après que le suffix-name ait fini son typewriter.
let navTypewriterRAF = null;
function typewriteProjectNav() {
  const nav = document.querySelector('.ui-corner__project-nav');
  if (!nav) return;
  const total = currentProjectImages.length;
  if (!total) return;
  if (navTypewriterRAF) cancelAnimationFrame(navTypewriterRAF);
  const fullText = ` (↑ ${currentImageIndex + 1}/${total} ↓)`;
  const CHAR_MS = 16;
  const start = performance.now();
  nav.replaceChildren();
  function step(now) {
    const elapsed = now - start;
    const charsShown = Math.min(fullText.length, Math.floor(elapsed / CHAR_MS) + 1);
    if (charsShown < fullText.length) {
      renderNavTypewriterFrame(nav, fullText.slice(0, charsShown));
      navTypewriterRAF = requestAnimationFrame(step);
    } else {
      // Fin du typewriter → remplace par DOM avec boutons cliquables.
      navTypewriterRAF = null;
      renderProjectNav();
    }
  }
  navTypewriterRAF = requestAnimationFrame(step);
}

// Pendant le typewriter, ↑ et ↓ sont wrappés dans un span rouge → cohérence
// visuelle avec les boutons finaux (qui sont rouges aussi).
function renderNavTypewriterFrame(nav, s) {
  nav.replaceChildren();
  for (const ch of s) {
    if (ch === '↑' || ch === '↓') {
      const span = document.createElement('span');
      span.className = 'ui-corner__nav-arrow';
      span.textContent = ch;
      nav.appendChild(span);
    } else {
      nav.appendChild(document.createTextNode(ch));
    }
  }
}

// Au focus d'un projet, promote en fetchpriority='high' les srcs du projet (l'user va
// les voir via ↑↓) et en 'auto' les voisines. Préchargement via <link rel="preload"
// type="image/avif"> : les browsers AVIF-capable préchargent l'AVIF (cache hit au render
// du <picture>) ; les autres ignorent (type mismatch) et fetchent le WebP au render.
// Évite le flash blanc quand l'user navigue rapidement vers une maquette dont le
// voisinage est encore en fetch low priority du préfill phase 2.
function preloadAvif(src, priority) {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.type = 'image/avif';
  if (priority && priority !== 'auto') link.fetchPriority = priority;
  link.href = src.replace(/\.webp$/, '.avif');
  document.head.appendChild(link);
}

function preloadProjectAndNeighbors(projId) {
  // 1. Toujours précharger les srcs du projet (high priority) — dérivé du pool, indépendant
  //    de l'état de liveTiles (au cas où le préfill phase 2 n'a pas encore fini).
  const projectSrcSet = new Set(
    pool.filter((item) => item.project === projId).map((i) => i.src)
  );
  for (const src of projectSrcSet) {
    preloadAvif(src, 'high');
  }

  // 2. Voisines (auto priority) : tiles déjà placées dont la position Y est < 1 viewport
  //    des positions des tiles du projet. Si le préfill phase 2 n'a pas fini, on les
  //    rate ; pas grave, scrollToCurrentImage déclenchera flushPrefillSync si besoin.
  const vh = window.innerHeight;
  const projectTileYs = [];
  for (const tile of liveTiles) {
    if (tile.item.project === projId) projectTileYs.push(tile.y);
  }
  if (projectTileYs.length === 0) return;

  const neighborSrcs = new Set();
  for (const tile of liveTiles) {
    if (projectSrcSet.has(tile.item.src)) continue;
    for (const py of projectTileYs) {
      if (Math.abs(tile.y - py) < vh) {
        neighborSrcs.add(tile.item.src);
        break;
      }
    }
  }
  for (const src of neighborSrcs) {
    preloadAvif(src, 'auto');
  }
}

// Focus le projet : ses tiles → focused, les autres → dimmed, suffix TL → "pour <Nom>"
// + indicateur de navigation (N/M ↑ ↓) à côté du nom.
function focusProject(projId) {
  if (!projId) return;
  currentFocusedProject = projId;
  document.querySelectorAll('.tile').forEach((t) => {
    if (t.dataset.project === projId) {
      t.classList.add('tile--project-focused');
      t.classList.remove('tile--project-dimmed');
    } else {
      t.classList.add('tile--project-dimmed');
      t.classList.remove('tile--project-focused');
    }
  });
  // Prépare la nav inter-maquettes : liste des images du projet, tri par src (m01,m02,t01,t02).
  currentProjectImages = pool
    .filter((item) => item.project === projId)
    .sort((a, b) => a.src.localeCompare(b.src));
  currentImageIndex = 0;
  preloadProjectAndNeighbors(projId);
  // Clear nav le temps du typewriter du suffix-name, puis typewriter du nav en chaîne.
  const nav = document.querySelector('.ui-corner__project-nav');
  if (nav) nav.replaceChildren();
  const name = projectNameById.get(projId);
  if (name) animateSuffix(name, typewriteProjectNav);
}

// ─── Menu liste de clients ──────────────────────────────────────────────────
// Au clic sur "Marc-Antoine Guilbault, Lead Designer UI", on cache la mosaïque et on
// transforme le suffix TL en "pour " suivi d'une <ul> verticale de TOUS les projets.
// Le 1er projet s'aligne inline avec "pour", les suivants tombent en colonne en dessous
// (flow naturel via display: inline-block + list-style: none).
let clientListOpen = false;

// Phrase de bio affichée en bas de l'écran quand la liste des projets est ouverte
// (reprise du statut "Lead Designer Interactif" du Portfolio Personnel).
// Deux lignes : retour à la ligne avant "La rigueur".
const BIO_LINES = [
  'Je maîtrise des systèmes, les ordonne, les décline et les enrichis.',
  'La rigueur dans chaque détail.',
];
// Décalage entre l'apparition de deux noms consécutifs (cascade).
const CASCADE_STEP_MS = 55;

// Aligne le bord gauche de la phrase de bio sur la colonne des noms de projet.
function alignBio() {
  const ul = document.querySelector('.ui-corner__suffix-list');
  const bio = document.querySelector('.ui-bio');
  if (ul && bio) bio.style.left = `${Math.round(ul.getBoundingClientRect().left)}px`;
}

function openClientList() {
  if (clientListOpen) return;
  clientListOpen = true;
  document.body.classList.add('is-client-list');
  document.querySelector('.ui-corner--tl')?.setAttribute('aria-expanded', 'true');
  const suffix = document.querySelector('.ui-corner__suffix');
  if (!suffix) return;
  if (typewriterRAF) { cancelAnimationFrame(typewriterRAF); typewriterRAF = null; }
  suffix.replaceChildren();
  suffix.appendChild(document.createTextNode(' pour '));
  const ul = document.createElement('ul');
  ul.className = 'ui-corner__suffix-list';
  projects.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'ui-corner__suffix-item';
    li.dataset.projectId = p.id;
    li.textContent = p.name;
    // Cascade : chaque nom apparaît décalé du précédent (0 si reduced-motion).
    li.style.setProperty('--enter-delay', `${REDUCED_MOTION ? 0 : i * CASCADE_STEP_MS}ms`);
    // A11y : focusable au clavier + activable via Enter/Space.
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Voir les maquettes de ${p.name}`);
    const activate = () => {
      closeClientList();
      focusProject(p.id);
      scrollToFirstProjectTile(p.id);
    };
    li.addEventListener('click', (ev) => { ev.stopPropagation(); activate(); });
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        activate();
      }
    });
    ul.appendChild(li);
  });
  suffix.appendChild(ul);

  // Phrase de bio en bas de l'écran : apparaît juste après le dernier nom (délai =
  // durée totale de la cascade), alignée en x sur la colonne des noms. L'animation CSS
  // (fill-mode both) la garde masquée pendant le délai → pas de flash avant l'alignement.
  const bio = document.createElement('p');
  bio.className = 'ui-bio';
  BIO_LINES.forEach((line, i) => {
    if (i) bio.appendChild(document.createElement('br'));
    bio.appendChild(document.createTextNode(line));
  });
  bio.style.setProperty('--bio-delay', `${REDUCED_MOTION ? 0 : projects.length * CASCADE_STEP_MS}ms`);
  document.querySelector('.ui-overlay')?.appendChild(bio);
  requestAnimationFrame(alignBio);

  // Focus le premier item après ouverture pour permettre la nav clavier immédiate.
  ul.firstElementChild?.focus();
}

function closeClientList() {
  if (!clientListOpen) return;
  clientListOpen = false;
  document.body.classList.remove('is-client-list');
  document.querySelector('.ui-corner--tl')?.setAttribute('aria-expanded', 'false');
  const suffix = document.querySelector('.ui-corner__suffix');
  if (suffix) suffix.replaceChildren();
  document.querySelector('.ui-bio')?.remove();
}

// Click sur le label TL → toggle la liste des projets. On ignore les clics sur les
// liens et les items déjà gérés.
// Desktop/souris UNIQUEMENT : sur tactile (mobile), le tap sur la phrase du haut ne
// doit pas ouvrir la liste → on ne pose ni handler ni sémantique bouton. La phrase
// reste alors du texte statique.
const tlLabel = document.querySelector('.ui-corner--tl');
if (HAS_HOVER && tlLabel) {
  tlLabel.addEventListener('click', (e) => {
    if (e.target.closest('a, .ui-corner__suffix-item')) return;
    if (clientListOpen) closeClientList();
    else { unfocusProject(); openClientList(); }
  });
  // A11y : le label TL est focusable et ouvre la liste via Enter/Space.
  tlLabel.tabIndex = 0;
  tlLabel.setAttribute('role', 'button');
  tlLabel.setAttribute('aria-label', 'Ouvrir la liste des projets');
  tlLabel.setAttribute('aria-expanded', 'false');
  tlLabel.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && !ev.target.closest('a, .ui-corner__suffix-item, .ui-corner__nav-btn')) {
      ev.preventDefault();
      if (clientListOpen) closeClientList();
      else { unfocusProject(); openClientList(); }
    } else if (ev.key === 'Escape' && clientListOpen) {
      ev.preventDefault();
      closeClientList();
      tlLabel.focus();
    }
  });
}
// ──────────────────────────────────────────────────────────────────────────
let typewriterRAF = null;

// Rend le suffix avec " pour " statique + le nom dans un .ui-corner__suffix-name (colorisable).
function renderSuffix(suffix, text) {
  const PREFIX = ' pour ';
  suffix.replaceChildren();
  if (text.length <= PREFIX.length) {
    suffix.textContent = text;
    return;
  }
  suffix.appendChild(document.createTextNode(text.slice(0, PREFIX.length)));
  const nameSpan = document.createElement('span');
  nameSpan.className = 'ui-corner__suffix-name';
  nameSpan.textContent = text.slice(PREFIX.length);
  suffix.appendChild(nameSpan);
}

function animateSuffix(name, onDone) {
  const suffix = document.querySelector('.ui-corner__suffix');
  if (!suffix) return;
  if (typewriterRAF) cancelAnimationFrame(typewriterRAF);
  const fromText = suffix.textContent;
  const toText = name ? ` pour ${name}` : '';
  const CHAR_MS = 16;
  const deleteDur = fromText.length * CHAR_MS;
  const writeDur = toText.length * CHAR_MS;
  const total = deleteDur + writeDur;
  const start = performance.now();
  function step(now) {
    const e = now - start;
    if (e < deleteDur) {
      const keep = Math.max(0, fromText.length - Math.floor(e / CHAR_MS));
      renderSuffix(suffix, fromText.slice(0, keep));
      typewriterRAF = requestAnimationFrame(step);
    } else if (e < total) {
      const wr = Math.min(toText.length, Math.floor((e - deleteDur) / CHAR_MS));
      renderSuffix(suffix, toText.slice(0, wr));
      typewriterRAF = requestAnimationFrame(step);
    } else {
      renderSuffix(suffix, toText);
      typewriterRAF = null;
      if (onDone) onDone();
    }
  }
  typewriterRAF = requestAnimationFrame(step);
}
// ──────────────────────────────────────────────────────────────────────────


let cols = 4;
let colWidth = 0;
let colHeights = [];
let colVelocityMultipliers = [];
let liveTiles = [];
const placedSrcs = new Set();
let prefillHandle = null;
let lcpPromoted = false;

const idle = (typeof requestIdleCallback === 'function')
  ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 1);
const cancelIdle = (typeof cancelIdleCallback === 'function')
  ? cancelIdleCallback
  : clearTimeout;

function shouldSkipPrefill() {
  const c = navigator.connection;
  if (!c) return false;
  if (c.saveData === true) return true;
  if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g') return true;
  return false;
}

// A11y + SEO : alt descriptif sur chaque <img> de maquette.
// Format : "Maquette mobile 01 — Liquides Paris" / "Maquette tablette 02 — Centre Pompidou"
function describeImage(item) {
  const name = projectNameById.get(item.project) ?? item.project;
  const match = item.src.match(/\/([mt])(\d+)\./);
  const typeLabel = item.type === 'mobile' ? 'mobile' : 'tablette';
  const num = match ? match[2] : '';
  return num
    ? `Maquette ${typeLabel} ${num} — ${name}`
    : `Maquette ${typeLabel} — ${name}`;
}

function getColsForViewport(w) {
  if (w >= 900) return 4;
  if (w >= 600) return 3;
  return 2;
}

function getViewportSize() {
  const w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  const h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
  return { w, h };
}

function computeLayout() {
  const { w: vw } = getViewportSize();
  cols = getColsForViewport(vw);
  // Mobile (2 cols) : gap réduit, sinon gap desktop. Cohérent avec getColsForViewport.
  GAP_Y = cols <= 2 ? GAP_Y_MOBILE : GAP_Y_DESKTOP;
  colWidth = (vw - (cols + 1) * GAP) / cols;
  colHeights = new Array(cols).fill(0).map((_, i) => GAP + (INITIAL_OFFSETS[i] ?? -100));
  colVelocityMultipliers = new Array(cols).fill(0).map((_, i) => GROUP_VELOCITIES[Math.floor(i / 2) % GROUP_VELOCITIES.length]);

  // Padding homothétique : à 1440-1470px viewport on a 12px, sur écrans plus petits ça réduit.
  FRAME_PADDING = colWidth * PADDING_RATIO;
  document.documentElement.style.setProperty('--frame-padding', `${FRAME_PADDING}px`);
  const radiusOuter = colWidth * RADIUS_RATIO;
  const radiusInner = Math.max(0, radiusOuter - FRAME_PADDING);
  document.documentElement.style.setProperty('--tile-radius-outer', `${radiusOuter}px`);
  document.documentElement.style.setProperty('--tile-radius-inner', `${radiusInner}px`);
}

// Le tile-frame a un padding (FRAME_PADDING px de chaque côté) → la zone visible interne
// (tile-inner) est plus petite que la tile externe. Pour qu'une image au ratio nominal
// rentre PILE dans tile-inner, on dimensionne la tile externe pour que (inner.h / inner.w)
// = ratio nominal, en compensant le padding sur les deux axes.
function frameHeightForInner(w, ratio) {
  const pad = FRAME_PADDING * 2;
  return (w - pad) / ratio + pad;
}

function placeNext(item, gapBelow = GAP_Y) {
  if (item.type === 'mobile') {
    let i = 0;
    for (let k = 1; k < cols; k++) {
      if (colHeights[k] < colHeights[i]) i = k;
    }
    const x = GAP + i * (colWidth + GAP);
    const y = colHeights[i];
    const w = colWidth;
    const h = frameHeightForInner(w, RATIOS.mobile);
    colHeights[i] = y + h + gapBelow;
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[i], colIdx: i };
  } else {
    let bestI = 0;
    let bestScore = Infinity;
    for (let i = 0; i + 1 < cols; i += 2) {
      const score = Math.max(colHeights[i], colHeights[i + 1]);
      if (score < bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    const x = GAP + bestI * (colWidth + GAP);
    const y = Math.max(colHeights[bestI], colHeights[bestI + 1]);
    const w = 2 * colWidth + GAP;
    const h = frameHeightForInner(w, RATIOS.tablet);
    colHeights[bestI] = y + h + gapBelow;
    colHeights[bestI + 1] = y + h + gapBelow;
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[bestI], colIdx: bestI };
  }
}

const TILT_MAX_DEG = 2.5;
const TILT_PERSPECTIVE = 1400;
// Au rollover : la tile lift verticalement avant que le tilt 3D s'applique.
const HOVER_LIFT_PX = 12;
const LIFT_BEFORE_TILT_MS = 250;
const CONTENT_HEIGHT_RATIO = 2.5;
// Vitesse FIXE (px/seconde) → la durée du scroll dépend uniquement de la distance à parcourir.
// Une maquette deux fois plus longue mettra deux fois plus de temps : la vitesse perçue
// reste identique entre formats mobile et tablet, peu importe la hauteur du contenu.
const SCROLL_DOWN_PX_PER_SEC = 250;
const SCROLL_UP_PX_PER_SEC = 1200;
// Survol < ce délai → l'auto-scroll ne se déclenche pas. Au-delà, intention manifeste.
const SCROLL_DOWN_DELAY = 500;

function attachScroll(scroller, host) {
  // A11y : pas d'auto-scroll au hover en reduced-motion. Tactile : pas de hover → no-op.
  if (REDUCED_MOTION || !HAS_HOVER) return;
  let animId = null;
  let startTimer = null;
  function animateScrollTo(target, duration, onDone) {
    cancelAnimationFrame(animId);
    const start = scroller.scrollTop;
    const delta = target - start;
    const startTime = performance.now();
    function step(t) {
      const elapsed = t - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Linéaire (pas d'ease) → vitesse instantanée vraiment constante (SCROLL_DOWN_PX_PER_SEC)
      // et identique entre toutes les tiles, peu importe la longueur du contenu.
      scroller.scrollTop = start + delta * progress;
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      } else if (onDone) {
        onDone();
      }
    }
    animId = requestAnimationFrame(step);
  }
  host.addEventListener('mouseenter', () => {
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      startTimer = null;
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroll <= 0) return;
      const distance = Math.max(maxScroll - scroller.scrollTop, 0);
      const duration = (distance / SCROLL_DOWN_PX_PER_SEC) * 1000;
      animateScrollTo(maxScroll, duration);
    }, SCROLL_DOWN_DELAY);
  });
  host.addEventListener('mouseleave', () => {
    clearTimeout(startTimer);
    startTimer = null;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0) return;
    const distance = scroller.scrollTop;
    const duration = (distance / SCROLL_UP_PX_PER_SEC) * 1000;
    animateScrollTo(0, duration);
  });
}

const cursorEl = document.getElementById('cursor');

// Position globale du curseur (en coords viewport). Utilisée pour le radial-gradient du
// contour de chaque tile, projeté dans son repère local par frame() à chaque rAF.
let mouseX = 0, mouseY = 0;
// true dès que la souris a bougé depuis la dernière frame. Permet de ne réécrire
// --cursor-x/y que quand nécessaire → supprime le repaint continu du contour pendant
// le défilement auto quand la souris est immobile.
let cursorDirty = true;

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursorDirty = true;
  // Transform = compositing GPU pur (pas de layout). translate(-50%, -50%) centre le rond.
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
});

// Smoothing du trail : par frame (≈60fps), current += (target - current) * SMOOTH.
// 0.08 ≈ 400ms pour rattraper 98% du chemin → trail traînant, plus marqué.
const CURSOR_LIGHT_SMOOTH = 0.08;

function attachTilt(inner) {
  const frame = inner.parentElement;

  // Tactile : pas de mousemove à attendre, pas de curseur custom → skip total.
  if (!HAS_HOVER) return;

  // A11y : en reduced-motion, on conserve uniquement le lock du curseur (signal d'état,
  // pas une animation parasitaire). Pas de tilt 3D, pas de trail.
  if (REDUCED_MOTION) {
    inner.addEventListener('mouseenter', () => cursorEl.classList.add('locked'));
    inner.addEventListener('mouseleave', () => cursorEl.classList.remove('locked'));
    return;
  }

  // Position cible (curseur réel) et current (lumière), en proportions 0..1 de la tile.
  let targetX = 0.5, targetY = 0.5;
  let currentX = 0.5, currentY = 0.5;
  let rafId = null;
  let active = false;
  // Pour séquencer "lift d'abord, tilt ensuite" : on stocke le timestamp du mouseenter.
  let liftStartTime = 0;

  function tick() {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    currentX += dx * CURSOR_LIGHT_SMOOTH;
    currentY += dy * CURSOR_LIGHT_SMOOTH;
    inner.style.setProperty('--gx', (currentX * 100) + '%');
    inner.style.setProperty('--gy', (currentY * 100) + '%');
    // Tant qu'on est en survol OU qu'il reste un delta à rattraper, on continue.
    if (active || Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }

  inner.addEventListener('mouseenter', (e) => {
    cursorEl.classList.add('locked');
    // Arrête le défilement auto de la mosaïque le temps qu'on examine le projet.
    hoverPaused = true;
    // Perf : lire le layout AVANT d'écrire transform (évite un reflow synchrone).
    const rect = inner.getBoundingClientRect();
    // Init current à la position du curseur (évite un "snap depuis le centre" au 1er hover).
    targetX = currentX = (e.clientX - rect.left) / rect.width;
    targetY = currentY = (e.clientY - rect.top) / rect.height;
    // Lift initial sans tilt — "respiration" verticale avant la déformation 3D.
    liftStartTime = performance.now();
    frame.style.transform = `perspective(${TILT_PERSPECTIVE}px) translateY(-${HOVER_LIFT_PX}px)`;
    inner.style.setProperty('--gx', (currentX * 100) + '%');
    inner.style.setProperty('--gy', (currentY * 100) + '%');
    active = true;
    if (rafId === null) rafId = requestAnimationFrame(tick);
  });

  inner.addEventListener('mousemove', (e) => {
    const rect = inner.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Tilt 3D : appliqué uniquement après le délai de lift initial → la tile lift d'abord,
    // puis la déformation 3D suit le curseur.
    const liftElapsed = performance.now() - liftStartTime;
    if (liftElapsed >= LIFT_BEFORE_TILT_MS) {
      const dx = (px - cx) / cx;
      const dy = (py - cy) / cy;
      const rotateY = dx * TILT_MAX_DEG;
      const rotateX = -dy * TILT_MAX_DEG;
      frame.style.transform = `perspective(${TILT_PERSPECTIVE}px) translateY(-${HOVER_LIFT_PX}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    }
    // Lumière : on met à jour la target, le tick rAF lerp vers elle (trail indépendant du lift).
    targetX = px / rect.width;
    targetY = py / rect.height;
    if (rafId === null) rafId = requestAnimationFrame(tick);
  });

  inner.addEventListener('mouseleave', () => {
    frame.style.transform = '';
    cursorEl.classList.remove('locked');
    hoverPaused = false;
    active = false;
    // Le tick continue jusqu'à ce que la lumière ait rattrapé sa dernière target, puis s'arrête.
  });
}


// attachLock + createLockSvg + showPasswordInput + unlockAll → modules/lock.js

// extractGlowColors → modules/glow.js (canvas 32×32, sampling 3 bandes)
// splitIntoLines, splitMetaIntoLines → modules/split-lines.js (apparition ligne par ligne)

function createTile(item, pos, label, fetchPriority = 'auto') {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.type = item.type;
  if (item.project) el.dataset.project = item.project;
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.h}px`;
  el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  // frame() ne réécrit --cursor-x/y qu'au mouvement souris ; une tuile créée pendant le
  // défilement (souris immobile) resterait sinon sur le fallback CSS (contour centré).
  // On l'initialise donc ici sur la position souris connue, comme les tuiles voisines.
  const tyInit = pos.y - offset * pos.velocityMultiplier + (COL_STAGGER[pos.colIdx] ?? 0);
  el.style.setProperty('--cursor-x', ((mouseX - pos.x) / pos.w) * 100 + '%');
  el.style.setProperty('--cursor-y', ((mouseY - tyInit) / pos.h) * 100 + '%');

  const color = colorFromSeed(item.seed);
  el.style.setProperty('--tile-glow-color', color);
  // Cascade d'apparition : delay croissant pour le 1er fill, puis 0 pour les tiles ajoutées au scroll
  const enterDelayMs = tileEnterIdx < 30 ? tileEnterIdx * 60 : 0;
  el.style.setProperty('--enter-delay', `${enterDelayMs}ms`);
  tileEnterIdx++;

  const frame = document.createElement('div');
  frame.className = 'tile-frame';

  const inner = document.createElement('div');
  inner.className = 'tile-inner';

  const tileScroll = document.createElement('div');
  tileScroll.className = 'tile-scroll';

  const content = document.createElement('div');
  content.className = 'tile-content';

  // Scrollbar custom : track + fill. La track est dans .tile-frame (par-dessus le tile-inner
   // qui est clip-pathed). `.is-active` est ajoutée par updateScrollbar() si scrollable.
  const scrollbar = document.createElement('div');
  scrollbar.className = 'tile-scrollbar';
  scrollbar.setAttribute('aria-hidden', 'true');
  const scrollbarFill = document.createElement('div');
  scrollbarFill.className = 'tile-scrollbar__fill';
  scrollbar.appendChild(scrollbarFill);

  function updateScrollbar() {
    const maxScroll = tileScroll.scrollHeight - tileScroll.clientHeight;
    if (maxScroll <= 0) {
      scrollbar.classList.remove('is-active');
      scrollbarFill.style.height = '0px';
      scrollbarFill.style.transform = 'translateY(0)';
      return;
    }
    scrollbar.classList.add('is-active');
    const trackHeight = scrollbar.clientHeight;
    // Hauteur du thumb proportionnelle au ratio visible (= clientHeight / scrollHeight),
    // clampée à un minimum lisible pour les très longs contenus.
    const thumbHeight = Math.max(20, trackHeight * tileScroll.clientHeight / tileScroll.scrollHeight);
    const progress = Math.max(0, Math.min(1, tileScroll.scrollTop / maxScroll));
    const thumbY = progress * (trackHeight - thumbHeight);
    scrollbarFill.style.height = thumbHeight + 'px';
    scrollbarFill.style.transform = `translateY(${thumbY}px)`;
  }

  tileScroll.addEventListener('scroll', updateScrollbar, { passive: true });

  if (item.src) {
    // <picture> + AVIF source : les browsers AVIF-capable (Chrome, Safari 16+, Firefox 93+,
    // ~95% du trafic) servent l'AVIF (-63% vs WebP). Fallback automatique sur le WebP pour
    // les autres. L'<img> reste référencé pour extractGlowColors (rend depuis pixels affichés).
    const picture = document.createElement('picture');
    const sourceAvif = document.createElement('source');
    sourceAvif.type = 'image/avif';
    sourceAvif.srcset = item.src.replace(/\.webp$/, '.avif');
    picture.appendChild(sourceAvif);

    const img = document.createElement('img');
    if (fetchPriority !== 'auto') img.fetchPriority = fetchPriority;
    img.src = item.src;
    img.alt = describeImage(item);
    img.draggable = false;
    img.decoding = 'async';
    // Skip glow extraction sur saveData/2G : extractGlowColors crée un canvas + lit les pixels
    // (coûteux GPU + CPU). Le glow CSS reste sur sa couleur seedée par défaut (colorFromSeed).
    const skipHeavyVisuals = shouldSkipPrefill();
    const applyGlow = () => {
      if (skipHeavyVisuals) return;
      const colors = extractGlowColors(img);
      if (colors && colors.length === 3) {
        el.style.setProperty('--tile-glow-1', colors[0]);
        el.style.setProperty('--tile-glow-2', colors[1]);
        el.style.setProperty('--tile-glow-3', colors[2]);
      }
    };
    const onImgLoaded = () => {
      applyGlow();
      // L'image chargée modifie scrollHeight → re-check si scrollbar nécessaire.
      updateScrollbar();
      // Fade-in : la classe déclenche la transition opacity 0 → 1.
      img.classList.add('is-loaded');
    };
    if (img.complete && img.naturalWidth > 0) onImgLoaded();
    else img.addEventListener('load', onImgLoaded, { once: true });
    picture.appendChild(img);
    content.appendChild(picture);
    content.classList.add('tile-content--image');
    if (item.locked) attachLock(inner, img, item.project);
  } else {
    const hueMatch = color.match(/hsl\((\d+)/);
    const hue = hueMatch ? hueMatch[1] : 0;
    const lighter = `hsl(${hue}, 35%, 62%)`;
    const darker = `hsl(${hue}, 35%, 32%)`;
    content.style.background = `linear-gradient(180deg, ${lighter} 0%, ${color} 50%, ${darker} 100%)`;
    content.style.height = `${pos.h * CONTENT_HEIGHT_RATIO}px`;
    content.textContent = label;
  }

  tileScroll.appendChild(content);
  inner.appendChild(tileScroll);
  frame.appendChild(inner);
  frame.appendChild(scrollbar);

  el.appendChild(frame);
  // Init scrollbar après attachement DOM (besoin du layout pour scrollHeight/clientHeight).
  requestAnimationFrame(updateScrollbar);
  attachTilt(inner);
  attachScroll(tileScroll, inner);

  // Au clic : focus le projet (toggle si re-clic d'un projet du même nom).
  // Si la tuile est verrouillée → délègue au handler du cadenas (= ouvre le champ mot de passe).
  inner.addEventListener('click', () => {
    const lockSvg = inner.querySelector('.tile-lock');
    if (lockSvg && lockSvg.style.display !== 'none') {
      lockSvg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return;
    }
    // Mobile/tactile : pas de focus projet au tap (la mécanique focus+dim+meta visible
    // n'est utile qu'en desktop où le hover montre déjà la meta). On garde juste le clic
    // sur le lock pour les projets confidentiels.
    if (!HAS_HOVER) return;
    const proj = el.dataset.project;
    if (!proj) return;
    if (currentFocusedProject === proj) unfocusProject();
    else focusProject(proj);
  });

  // Méta sous la tuile : largeur fixe = 1 colonne. Pour les tablets (2 cols),
  // on l'aligne sur la colonne DROITE → offset de colWidth + GAP par rapport au bord gauche.
  const meta = document.createElement('div');
  meta.className = 'tile-meta';
  meta.style.width = `${colWidth}px`;
  if (item.type === 'tablet') {
    meta.style.left = `${colWidth + GAP}px`;
  }
  const subtitle = document.createElement('p');
  subtitle.className = 'tile-meta__subtitle';
  subtitle.textContent = '↑ Détails';
  const desc = document.createElement('p');
  desc.className = 'tile-meta__desc';
  desc.textContent = projectDescById.get(item.project) ?? '';
  meta.appendChild(subtitle);
  meta.appendChild(desc);
  el.appendChild(meta);

  // Split différé au 1er survol : évite le burst de ~50 reflows synchrones au boot
  // (fillUntil crée toutes les tuiles d'un coup ; chaque split force 2 reflows).
  // Garde HAS_HOVER : sur tactile pur la méta n'est jamais révélée (CSS @media hover),
  // inutile de splitter — et on évite un split parasite déclenché par un hover collant.
  if (HAS_HOVER) {
    el.addEventListener('mouseenter', () => {
      if (!meta.dataset.split) {
        splitMetaIntoLines(meta);
        meta.dataset.split = '1';
      }
    }, { passive: true });
  }

  scroller.appendChild(el);
  // Adopte l'état focus en cours (si une nouvelle tuile arrive après un clic sur projet)
  if (currentFocusedProject) {
    if (item.project === currentFocusedProject) el.classList.add('tile--project-focused');
    else el.classList.add('tile--project-dimmed');
  }
  return { el, inner, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, velocityMultiplier: pos.velocityMultiplier, colIdx: pos.colIdx };
}

// Shuffle déterministe (PRNG linéaire seedé) — entrelace les projets dès la 1ère tuile
// sans casser la propriété "grille identique à chaque reload".
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const poolByType = {
  mobile: seededShuffle(pool.filter(p => p.type === 'mobile'), 42),
  tablet: seededShuffle(pool.filter(p => p.type === 'tablet'), 1337),
};
const poolIndices = { mobile: 0, tablet: 0 };

const TYPE_CYCLE = ['mobile', 'mobile', 'tablet'];
let cycleIdx = 0;

function pickRandom() {
  let desiredType;
  for (let attempt = 0; attempt < TYPE_CYCLE.length; attempt++) {
    desiredType = TYPE_CYCLE[(cycleIdx + attempt) % TYPE_CYCLE.length];
    if (poolByType[desiredType].length > 0) break;
  }
  cycleIdx++;
  const p = poolByType[desiredType];
  const item = p[poolIndices[desiredType] % p.length];
  poolIndices[desiredType]++;
  return item;
}

function fillUntil(targetHeight) {
  let counter = liveTiles.length;
  while (Math.min(...colHeights) < targetHeight) {
    const item = pickRandom();
    const pos = placeNext(item);
    let priority = 'auto';
    if (!lcpPromoted && item.type === 'tablet') {
      priority = 'high';
      lcpPromoted = true;
    }
    const tile = createTile(item, pos, String(++counter), priority);
    liveTiles.push(tile);
    placedSrcs.add(item.src);
  }
}

// Phase 2 préfill : crée des tiles pour les srcs non vues par fillUntil(h*3).
// Batché via requestIdleCallback pour ne pas bloquer le main thread > 2ms par tour.
function prefillRemainingSources(deadline) {
  prefillHandle = null;
  let counter = liveTiles.length;
  const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
  let iterSinceCheck = 0;
  while (placedSrcs.size < pool.length) {
    if (hasDeadline && iterSinceCheck >= 3 && deadline.timeRemaining() < 2) {
      prefillHandle = idle(prefillRemainingSources);
      return;
    }
    const item = pickRandom();
    const pos = placeNext(item);
    const tile = createTile(item, pos, String(++counter), 'low');
    liveTiles.push(tile);
    placedSrcs.add(item.src);
    iterSinceCheck++;
  }
}

// Flush sync : appelé par scrollToCurrentImage si la src cible n'est pas dans liveTiles.
// Boucle sans budget (l'utilisateur attend déjà l'animation smoothScroll de 700ms).
// Si targetSrc est fourni, on s'arrête dès que cette src est placée (perf au click ↑↓).
// Sinon, on fill tout le pool restant.
function flushPrefillSync(targetSrc) {
  if (prefillHandle !== null) {
    cancelIdle(prefillHandle);
    prefillHandle = null;
  }
  let counter = liveTiles.length;
  const safety = pool.length * 3;
  let iter = 0;
  while (placedSrcs.size < pool.length && iter++ < safety) {
    const item = pickRandom();
    const pos = placeNext(item);
    const tile = createTile(item, pos, String(++counter), 'low');
    liveTiles.push(tile);
    placedSrcs.add(item.src);
    if (targetSrc && item.src === targetSrc) break;
  }
}

function topUpIfNeeded() {
  const { h: vh } = getViewportSize();
  const maxVel = Math.max(...colVelocityMultipliers);
  const target = offset * maxVel + vh * 3;
  if (Math.min(...colHeights) < target) {
    fillUntil(target);
  }
}

let offset = 0;
let velocity = REDUCED_MOTION ? 0 : BASE_VELOCITY;
let lastFrameTime = 0;
let paused = false;
// Pause de l'auto-scroll quand on survole une tile (indépendant du drag mousedown).
let hoverPaused = false;
// Floor offset : recalculé à chaque frame = min(tile.y) parmi les tiles vivantes.
// Le tile recycling supprime les tiles passées sous l'écran ; sans ce floor, scroller
// trop haut révèle un gap noir (les premières tiles ont été recyclées).
let minLiveTileY = -Infinity;
// Position Y cible de la première tile quand on a scrollé au max vers le haut.
// Négative = tile au-dessus du viewport (cachée). Positive = sous le top (visible).
const SCROLL_TOP_Y = -240;

viewport.addEventListener('mousedown', () => { paused = true; });
window.addEventListener('mouseup', () => { paused = false; });

// Tactile : swipe pour scroller la mosaïque + momentum (inertie style iOS).
let lastTouchY = 0;
let lastTouchTime = 0;
let touchVelocity = 0;     // px/s, signe = direction (positif = doigt vers le haut = défilement vers le bas)
let momentumRaf = null;
const MOMENTUM_FRICTION = 0.94;   // décrément par frame ≈16ms (≈0.94^60 ≈ 0.024 en 1s)
const MOMENTUM_MIN_PX_PER_S = 30; // sous ce seuil on arrête

function stopMomentum() {
  if (momentumRaf) cancelAnimationFrame(momentumRaf);
  momentumRaf = null;
  touchVelocity = 0;
}

function startMomentum() {
  if (Math.abs(touchVelocity) < MOMENTUM_MIN_PX_PER_S) return;
  let lastT = performance.now();
  function step(now) {
    const dt = (now - lastT) / 1000;
    lastT = now;
    offset += touchVelocity * dt;
    const floor = minLiveTileY - SCROLL_TOP_Y;
    if (offset < floor) { offset = floor; stopMomentum(); return; }
    touchVelocity *= MOMENTUM_FRICTION;
    if (Math.abs(touchVelocity) > MOMENTUM_MIN_PX_PER_S) {
      momentumRaf = requestAnimationFrame(step);
    } else {
      stopMomentum();
    }
  }
  momentumRaf = requestAnimationFrame(step);
}

// Gain tactile : un swipe physique de 100 px déplace 150 px de contenu (perception plus réactive).
const TOUCH_GAIN = 1.5;

viewport.addEventListener('touchstart', (e) => {
  paused = true;
  stopMomentum();
  lastTouchY = e.touches[0].clientY;
  lastTouchTime = performance.now();
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  // passive: false + preventDefault → on prend la main sur le scroll natif iOS/Android.
  e.preventDefault();
  const ty = e.touches[0].clientY;
  const now = performance.now();
  const dy = (lastTouchY - ty) * TOUCH_GAIN;
  const dt = now - lastTouchTime;
  offset += dy;
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) offset = floor;
  // Velocity en px/s pour le momentum au lâcher
  if (dt > 0) touchVelocity = (dy / dt) * 1000;
  lastTouchY = ty;
  lastTouchTime = now;
}, { passive: false });

window.addEventListener('touchend', () => { paused = false; startMomentum(); });
window.addEventListener('touchcancel', () => { paused = false; stopMomentum(); });

// Clic sur le fond (= dans le viewport, hors d'une tile) → désélectionne le projet focused.
viewport.addEventListener('click', (e) => {
  if (!currentFocusedProject) return;
  if (e.target.closest('.tile-inner')) return;
  unfocusProject();
});

viewport.addEventListener('wheel', (e) => {
  // Scroll manuel dans la tile désactivé : le wheel défile toujours la mosaïque.
  // (Le scroll de la tile reste possible uniquement via l'auto-scroll au hover.)
  e.preventDefault();
  offset += e.deltaY * WHEEL_GAIN;
  // Clamp au floor : la plus haute tile s'aligne à ty = SCROLL_TOP_Y au max scroll up.
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) offset = floor;
}, { passive: false });

function frame(t) {
  // Skip tout le travail si l'onglet est en background (ou minimisé).
  // Empêche l'accumulation de tiles via topUpIfNeeded() en background + libère CPU/batterie.
  if (document.visibilityState !== 'visible') {
    lastFrameTime = t;
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min((t - lastFrameTime) / 1000, 0.1);
  lastFrameTime = t;
  if (!paused && !hoverPaused) {
    offset += velocity * dt;
  }
  // Filet de sécurité : snap au floor (= première tile à ty = SCROLL_TOP_Y).
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) offset = floor;
  // Cycling à 3 niveaux pour permettre le scroll up (récupération depuis le cache) :
  // - VISIBLE_MARGIN : tile dans la zone d'affichage active → DOM attaché + transforms écrits
  // - DETACH_MARGIN  : tile hors viewport mais en mémoire (DOM détaché) → recouvrable au scroll up
  // - HARD_RECYCLE   : tile très loin → suppression définitive (mémoire bornée)
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const VISIBLE_MARGIN = 200;
  const DETACH_MARGIN = 1500;
  const HARD_RECYCLE = 50000;
  const toRemove = [];
  let nextMinY = Infinity;
  for (let i = 0; i < liveTiles.length; i++) {
    const tile = liveTiles[i];
    const tileOffset = offset * tile.velocityMultiplier;
    const stagger = COL_STAGGER[tile.colIdx] ?? 0;
    const ty = tile.y - tileOffset + stagger;
    // Très loin → suppression définitive (memory cap, sinon scroll long = leak)
    if (ty + tile.h < -HARD_RECYCLE) {
      toRemove.push(i);
      continue;
    }
    // Toutes les tiles encore vivantes (détachées ou non) comptent pour le floor.
    if (tile.y < nextMinY) nextMinY = tile.y;
    const inView = ty < vh + VISIBLE_MARGIN && ty + tile.h > -VISIBLE_MARGIN;
    const inDetachZone = ty < vh + DETACH_MARGIN && ty + tile.h > -DETACH_MARGIN;
    if (!inDetachZone) {
      // Trop loin pour le DOM → détache si pas déjà fait, mais garde la tile dans liveTiles
      // (sa position tile.y reste connue, on pourra la rattacher au scroll up).
      if (!tile.detached) {
        tile.el.remove();
        tile.detached = true;
      }
      continue;
    }
    if (tile.detached) {
      // Tile revient dans la zone : rattache au DOM (position absolue → réapparaît au bon endroit)
      scroller.appendChild(tile.el);
      tile.detached = false;
    }
    if (!inView) {
      // Dans la zone DOM mais pas dans la zone visible : skip les writes (économie de CPU)
      continue;
    }
    tile.el.style.transform = `translate3d(${tile.x}px, ${ty}px, 0)`;
    if (cursorDirty) {
      tile.el.style.setProperty('--cursor-x', ((mouseX - tile.x) / tile.w) * 100 + '%');
      tile.el.style.setProperty('--cursor-y', ((mouseY - ty) / tile.h) * 100 + '%');
    }
  }
  // Une fois toutes les tiles de la frame traitées, on acquitte le dirty : les prochaines
  // frames n'écriront plus --cursor-x/y tant que la souris ne rebougera pas.
  cursorDirty = false;
  // Reverse splice pour les hard-recycles (préserve les indices)
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const tile = liveTiles[toRemove[i]];
    if (!tile.detached) tile.el.remove();
    liveTiles.splice(toRemove[i], 1);
  }
  // Met à jour le floor pour le prochain frame. -Infinity si plus aucune tile (transitoire,
  // topUpIfNeeded va en regénérer en bas).
  minLiveTileY = (nextMinY === Infinity) ? -Infinity : nextMinY;
  topUpIfNeeded();
  requestAnimationFrame(frame);
}

// Au retour sur l'onglet, reset lastFrameTime pour éviter un grand dt et un saut visuel.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    lastFrameTime = performance.now();
  }
});

function init() {
  const { w, h } = getViewportSize();
  if (w === 0 || h === 0) {
    requestAnimationFrame(init);
    return;
  }
  computeLayout();
  fillUntil(h * 3);
  if (!shouldSkipPrefill()) {
    prefillHandle = idle(prefillRemainingSources);
  }
  lastFrameTime = performance.now();
  requestAnimationFrame(frame);
}

init();

function rebuildLayout() {
  const { h } = getViewportSize();
  computeLayout();
  lcpPromoted = false;
  // Reset offset AVANT la boucle : on écrit les transforms avec offset=0, sinon les tiles
  // hors VISIBLE_MARGIN (mais dans DETACH_MARGIN) gardent leur ancien transform et se
  // superposent visuellement quand on retourne à la taille initiale après resize.
  offset = 0;
  for (const tile of liveTiles) {
    const pos = placeNext(tile.item);
    tile.x = pos.x;
    tile.y = pos.y;
    tile.w = pos.w;
    tile.h = pos.h;
    tile.velocityMultiplier = pos.velocityMultiplier;
    tile.colIdx = pos.colIdx;
    tile.el.style.width = `${pos.w}px`;
    tile.el.style.height = `${pos.h}px`;
    // Force l'écriture du transform pour TOUTES les tiles : frame() ne réécrit que les
    // tiles inView (VISIBLE_MARGIN). Sans ça, les tiles attachées hors viewport gardent
    // leur ancienne position après resize → superposition au retour à la taille initiale.
    const stagger = COL_STAGGER[tile.colIdx] ?? 0;
    tile.el.style.transform = `translate3d(${tile.x}px, ${tile.y + stagger}px, 0)`;
    const meta = tile.el.querySelector('.tile-meta');
    if (meta) {
      meta.style.width = `${colWidth}px`;
      meta.style.left = tile.item.type === 'tablet' ? `${colWidth + GAP}px` : '0';
      // Re-splitter uniquement les métas déjà traitées : les autres seront splittées
      // au 1er survol, à ce moment-là la largeur sera déjà à jour.
      if (meta.dataset.split) splitMetaIntoLines(meta);
    }
  }
  fillUntil(h * 2);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuildLayout, 150);
  if (clientListOpen) alignBio();
});

// Service Worker : cache-first sur les assets immuables (images + JS/CSS versionnés),
// network-first sur le HTML. 2e visite = quasi-instantanée. Registered en window.load
// pour ne pas concurrencer le boot critique du portfolio.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW pas crucial — silent fail si bloqué (file://, env de dev, etc.)
    });
  });
}
