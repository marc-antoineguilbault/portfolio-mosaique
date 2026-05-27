import { pool, projects, colorFromSeed, RATIOS } from './data.js';

// Préférence d'accessibilité : neutralise les animations parasitaires (auto-scroll continu,
// auto-scroll au hover, tilt 3D, trail du curseur). Le glow + le focus projet restent OK.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Capacité de hover (= souris/trackpad). Sans hover (tactile pur), on skip tilt/trail/auto-scroll
// → pas de sticky-hover, pas de curseur custom invisible, comportement natif tactile.
const HAS_HOVER = window.matchMedia('(hover: hover)').matches;

const GAP = 48;
const GAP_Y = 220; /* augmenté pour laisser la place au bloc .tile-meta sous chaque tuile */
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
}
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

function animateSuffix(name) {
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

function placeNext(item) {
  if (item.type === 'mobile') {
    let i = 0;
    for (let k = 1; k < cols; k++) {
      if (colHeights[k] < colHeights[i]) i = k;
    }
    const x = GAP + i * (colWidth + GAP);
    const y = colHeights[i];
    const w = colWidth;
    const h = frameHeightForInner(w, RATIOS.mobile);
    colHeights[i] = y + h + GAP_Y;
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
    colHeights[bestI] = y + h + GAP_Y;
    colHeights[bestI + 1] = y + h + GAP_Y;
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

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
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


// ─── Verrouillage des projets confidentiels ────────────────────────────────
// Un seul mot de passe global : n'importe quelle saisie + Entrée débloque
// toutes les tuiles verrouillées (passées et futures).
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

function attachLock(inner, imgEl) {
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
// ──────────────────────────────────────────────────────────────────────────

// Extrait la couleur dominante d'une image pour piloter le glow.
// Échantillonne 32×32 px, ignore blanc/noir purs (UI chrome, fonds), moyenne RGB,
// puis convertit en HSL pour booster la saturation et plafonner la luminosité.
const _glowCanvas = document.createElement('canvas');
_glowCanvas.width = 32;
_glowCanvas.height = 32;
const _glowCtx = _glowCanvas.getContext('2d', { willReadFrequently: true });

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    case b: h = (r - g) / d + 4; break;
  }
  return [h * 60, s, l];
}

// Extrait 3 couleurs distinctes en samplant 3 bandes horizontales de l'image
// (haut, milieu, bas). Renvoie un array de 3 hsl ou des fallbacks gris si la
// zone est trop désaturée. Permet un glow multi-color au lieu d'une teinte moyenne.
function bandAverage(data, yStart, yEnd) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      if (data[i + 3] < 128) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 240 || lum < 16) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  if (count === 0) return null;
  r /= count; g /= count; b /= count;
  const [h, s, l] = rgbToHsl(r, g, b);
  const sBoosted = Math.min(s * 1.9, 0.9);
  const lClamped = Math.max(0.42, Math.min(0.6, l));
  return `hsl(${h.toFixed(0)}, ${(sBoosted * 100).toFixed(0)}%, ${(lClamped * 100).toFixed(0)}%)`;
}

function extractGlowColors(img) {
  try {
    _glowCtx.clearRect(0, 0, 32, 32);
    _glowCtx.drawImage(img, 0, 0, 32, 32);
    const data = _glowCtx.getImageData(0, 0, 32, 32).data;
    const fallback = 'hsl(0, 0%, 50%)';
    return [
      bandAverage(data, 0, 11)  || fallback,
      bandAverage(data, 11, 22) || fallback,
      bandAverage(data, 22, 32) || fallback,
    ];
  } catch (e) {
    return null;
  }
}

// ─── Apparition ligne par ligne de la meta ────────────────────────────────
// Wrap chaque mot d'un <p> dans un span temporaire, mesure offsetTop par
// getBoundingClientRect() (précis pour des inlines), regroupe en lignes
// visuelles, puis reconstruit en <span class="tile-meta__line">
// (clip) > <span class="tile-meta__line-inner"> (animé). Le texte d'origine
// est stocké en data-original-text pour permettre un re-split (resize).
function splitIntoLines(pEl, startIdx = 0, stepMs = 70) {
  const text = pEl.dataset.originalText ?? pEl.textContent.trim();
  if (!text) return 0;
  pEl.dataset.originalText = text;
  const words = text.split(/\s+/);
  pEl.replaceChildren();
  const wordSpans = [];
  words.forEach((w, i) => {
    if (i > 0) pEl.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = '__w';
    sp.textContent = w;
    pEl.appendChild(sp);
    wordSpans.push(sp);
  });
  void pEl.offsetHeight;
  const lines = [];
  let currentTop = null;
  for (const span of wordSpans) {
    const top = span.getBoundingClientRect().top;
    if (currentTop === null || Math.abs(top - currentTop) > 2) {
      lines.push([]);
      currentTop = top;
    }
    lines[lines.length - 1].push(span.textContent);
  }
  pEl.replaceChildren();
  lines.forEach((wordList, i) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'tile-meta__line';
    const inner = document.createElement('span');
    inner.className = 'tile-meta__line-inner';
    inner.style.setProperty('--line-delay', `${(startIdx + i) * stepMs}ms`);
    inner.textContent = wordList.join(' ');
    wrapper.appendChild(inner);
    pEl.appendChild(wrapper);
  });
  return lines.length;
}

function splitMetaIntoLines(meta) {
  const subtitle = meta.querySelector('.tile-meta__subtitle');
  const desc = meta.querySelector('.tile-meta__desc');
  let idx = 0;
  if (subtitle) idx += splitIntoLines(subtitle, idx);
  if (desc) idx += splitIntoLines(desc, idx);
}
// ──────────────────────────────────────────────────────────────────────────

function createTile(item, pos, label) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.type = item.type;
  if (item.project) el.dataset.project = item.project;
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.h}px`;
  el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;

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
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    const applyGlow = () => {
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
    content.appendChild(img);
    content.classList.add('tile-content--image');
    if (item.locked) attachLock(inner, img);
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
    const proj = el.dataset.project;
    if (!proj) return;
    if (currentFocusedProject === proj) {
      // Toggle off : retour à l'état initial
      unfocusProject();
    } else {
      currentFocusedProject = proj;
      document.querySelectorAll('.tile').forEach((t) => {
        if (t.dataset.project === proj) {
          t.classList.add('tile--project-focused');
          t.classList.remove('tile--project-dimmed');
        } else {
          t.classList.add('tile--project-dimmed');
          t.classList.remove('tile--project-focused');
        }
      });
      const name = projectNameById.get(proj);
      if (name) animateSuffix(name);
    }
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

  scroller.appendChild(el);
  // Split de la meta en lignes APRES insertion DOM (besoin du layout pour mesurer).
  splitMetaIntoLines(meta);
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
    const tile = createTile(item, pos, String(++counter));
    liveTiles.push(tile);
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
    tile.el.style.setProperty('--cursor-x', ((mouseX - tile.x) / tile.w) * 100 + '%');
    tile.el.style.setProperty('--cursor-y', ((mouseY - ty) / tile.h) * 100 + '%');
  }
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
  lastFrameTime = performance.now();
  requestAnimationFrame(frame);
}

init();

function rebuildLayout() {
  const { h } = getViewportSize();
  computeLayout();
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
    const meta = tile.el.querySelector('.tile-meta');
    if (meta) {
      meta.style.width = `${colWidth}px`;
      meta.style.left = tile.item.type === 'tablet' ? `${colWidth + GAP}px` : '0';
      // colWidth a changé → wrap des lignes a changé : re-splitter à partir du texte original.
      splitMetaIntoLines(meta);
    }
  }
  fillUntil(h * 2);
  offset = 0;
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuildLayout, 150);
});
