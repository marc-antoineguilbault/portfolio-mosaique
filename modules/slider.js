import { pool, projects, RATIOS } from '../data.js';
import { extractGlowColors } from './glow.js';

const projectName = (id) => projects.find((p) => p.id === id)?.name ?? 'Projet';
const projectDesc = (id) => projects.find((p) => p.id === id)?.desc ?? '';

// FLIP (First-Last-Invert-Play) — continuité visuelle de la maquette cliquée.
// En reduced-motion on skip l'animation (ouverture/fermeture directes).
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HAS_HOVER = window.matchMedia('(hover: hover)').matches;
const FLIP_MS = 700;
const FLIP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const LAYOUT_MS = 500;   // = durée de transition de .slider__slide (styles.css)
const ENTRY_STAGGER_MAX_MS = 100;   // décalage max entre voisines à l'ouverture (les + proches d'abord)

const SWIPE_THRESHOLD = 80;

let root = null;        // élément .slider courant (ou null)
let state = null;       // { projId, slides, index, onClosed, onNav, slideEls, originRect, closing }
// Auto-scroll vertical : on réutilise attachScroll de la mosaïque (passé via openSlider),
// appliqué PAR DIAPO dans la boucle de construction → délai/vitesse/easing IDENTIQUES à la
// vue mosaïque (500ms d'attente, 250px/s à la descente, 1200px/s à la remontée).

// Maquettes d'un projet, ordre naturel (m01→m02→…→t01→t02…), tri par src.
function projectSlides(projId) {
  return pool.filter((it) => it.project === projId)
             .sort((a, b) => a.src.localeCompare(b.src));
}

export function isSliderOpen() { return root !== null; }

// ─── Dimensionnement ──────────────────────────────────────────────────────────
const GAP = 48;

// Taille d'une diapo = taille qu'aurait la tuile dans la mosaïque (plus d'agrandissement).
// La fonction state.tileSize vient d'app.js et lit colWidth à jour (correct au resize).
// Fallback sur l'ancien calcul plein-écran si tileSize n'est pas fourni (sécurité).
function slideSize(type) {
  if (state && state.tileSize) return state.tileSize(type);
  const margin = 96;
  const h = window.innerHeight - margin * 2;
  const ratio = type === 'tablet' ? RATIOS.tablet : RATIOS.mobile;
  return { w: h * ratio, h };
}

// Position de layout (coin haut-gauche, en coords viewport) d'une diapo selon son rel.
// Ancrage horizontal sur la tuile cliquée (anchorX) ; centrage vertical sur l'écran.
// rel=0 (courante) → centrée sur (anchorX, centerY) à sa taille mosaïque.
function slidePos(rel, sz, sizeCur) {
  const anchorX = state.anchorX ?? window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const step = sizeCur.w / 2 + GAP + sz.w / 2;   // entre-axe courante↔voisine
  return { left: anchorX + rel * step - sz.w / 2, top: centerY - sz.h / 2 };
}

// ─── Layout circulaire : positionne les diapos autour de la courante ─────────
// Carousel circulaire : à droite de la DERNIÈRE maquette vient la PREMIÈRE (et inversement
// à gauche) → on voit toujours dépasser « ce qu'il reste à voir » avant/après, même aux
// extrémités. Écart GAP UNIFORME entre bords consécutifs quelle que soit la largeur (mobile
// 1 col vs tablet 2 cols) : on cumule les largeurs réelles. La courante reste ANCRÉE sur le X de
// la tuile cliquée (pas de recentrage) ; on choisit la répartition gauche/droite qui comble au
// mieux les deux bords autour de cette ancre (voisines toutes du même côté si on clique en bord).
function layout() {
  const { slides, index } = state;
  const N = slides.length;
  const anchorX = state.anchorX ?? window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const sizes = slides.map((s) => slideSize(s.type));
  const W = window.innerWidth;
  const totalW = sizes.reduce((acc, z) => acc + z.w, 0) + (N - 1) * GAP;  // largeur totale du ruban
  const lefts = new Array(N);
  const rels = new Array(N);                 // décalage circulaire vs courante
  lefts[index] = anchorX - sizes[index].w / 2;   // courante ANCRÉE sur la tuile cliquée (pas de recentrage X)
  rels[index] = 0;
  // Répartition gauche/droite des voisines : la courante reste à anchorX, on choisit COMBIEN
  // passent à gauche pour que le RUBAN soit le plus centré possible sur le viewport autour de cette
  // ancre → on comble au mieux les deux bords (« hors champ », pas de vide). Cible : extension
  // gauche (de anchorX au bord gauche du ruban) ext ≈ anchorX + (totalW - W) / 2. leftCount peut
  // valoir 0 (toutes les voisines à DROITE) : indispensable quand on clique près du bord GAUCHE →
  // on remplit la droite avec +1 puis le début de +2 (le vide signalé sur Pozzo). Clamp : au moins
  // 1 voisine à droite (carousel circulaire : la 1re suit la dernière) → leftCount ≤ N - 2.
  const leftTarget = anchorX + (totalW - W) / 2;
  const maxLeft = Math.max(0, N - 2);
  let leftCount = 0, bestErr = Infinity, ext = sizes[index].w / 2;
  for (let k = 0; k <= maxLeft; k++) {
    if (Math.abs(ext - leftTarget) < bestErr) { bestErr = Math.abs(ext - leftTarget); leftCount = k; }
    ext += GAP + sizes[((index - (k + 1)) % N + N) % N].w;   // extension gauche cumulée (k voisines)
  }
  const rightCount = N - 1 - leftCount;
  // Droite : voisines circulaires index+1, index+2, … (mod N) → la 1re suit la dernière.
  let edge = lefts[index] + sizes[index].w;
  for (let step = 1; step <= rightCount; step++) {
    const j = (index + step) % N;
    lefts[j] = edge + GAP; rels[j] = step;
    edge = lefts[j] + sizes[j].w;
  }
  // Gauche : voisines circulaires index-1, index-2, … (mod N).
  edge = lefts[index];
  for (let step = 1; step <= leftCount; step++) {
    const j = ((index - step) % N + N) % N;
    lefts[j] = edge - GAP - sizes[j].w; rels[j] = -step;
    edge = lefts[j];
  }
  const prev = state.lefts;                       // positions du layout précédent (undefined au 1er)
  const tops = sizes.map((sz) => centerY - sz.h / 2);
  // Attributs (taille, pos, opacité, méta) + repérage des diapos qui « wrappent » : celles qui
  // changent de bord (saut > MOITIÉ du ruban) doivent être TÉLÉPORTÉES, pas animées — sinon on
  // les voit traverser l'écran (le bug signalé). Seuil = totalW/2 : un décalage d'un pas (≤ une
  // largeur de diapo + GAP) reste sous le seuil ; un vrai wrap (extrémité→extrémité) le dépasse,
  // quelle que soit la taille du projet (le seuil « largeur écran » ratait les petits projets).
  const wrapped = [];
  state.slideEls.forEach((slide, i) => {
    const sz = sizes[i];
    slide.style.width  = sz.w + 'px';
    slide.style.height = sz.h + 'px';
    const rel = rels[i];
    slide.dataset.pos = rel === 0 ? 'current' : rel === -1 ? 'prev' : rel === 1 ? 'next' : 'far';
    slide.setAttribute('aria-current', rel === 0 ? 'true' : 'false');
    // TOUTES les diapos positionnées : l'overflow:hidden du .slider clippe celles hors écran ;
    // celles qui chevauchent les bords DÉBORDENT (« il reste à voir avant/après »).
    slide.style.opacity = '1';
    slide.style.pointerEvents = 'auto';
    // Largeur/offset de la méta = 1 colonne (recalculés ici pour rester corrects au resize).
    const meta = slide.querySelector('.tile-meta');
    if (meta) {
      const colWidth = slideSize('mobile').w;
      meta.style.width = `${colWidth}px`;
      meta.style.left = slides[i].type === 'tablet' ? `${colWidth + GAP}px` : '0';
    }
    if (prev && Math.abs(lefts[i] - prev[i]) > totalW / 2) wrapped.push(i);
  });
  // Diapos qui wrappent : téléportées (sans transition) JUSTE hors écran, du côté d'où elles
  // arrivent (déduit du sens du déplacement), PUIS animées vers leur cible → elles GLISSENT depuis
  // le bord. Ni traversée d'écran (l'ancien bug), ni arrivée « en cut » (pas de pop directement
  // dans une position de peek déjà clippée au bord).
  // Δ = translation rigide commune à toutes les diapos non-wrappées (la courante incluse) entre
  // l'ancien et le nouveau layout. On fait DÉMARRER chaque diapo qui wrappe à (cible − Δ) : un cran
  // « avant » sa cible, du côté d'où elle arrive (hors écran). Elle parcourt alors exactement Δ, à
  // la MÊME vitesse que le reste du ruban → mouvement synchrone (plus de diapo « qui arrive plus
  // vite »), sans traversée d'écran ni arrivée « en cut ».
  const delta = prev ? lefts[index] - prev[index] : 0;   // 1er layout (prev absent) : aucune wrappée
  for (const i of wrapped) {
    state.slideEls[i].style.transition = 'none';
    state.slideEls[i].style.transform = `translate(${lefts[i] - delta}px, ${tops[i]}px)`;
  }
  if (wrapped.length) void root.offsetWidth;             // fige la position de départ (hors écran)
  // Toutes les diapos rejoignent leur cible avec la transition CSS, du même déplacement Δ.
  state.slideEls.forEach((slide, i) => {
    if (wrapped.includes(i)) slide.style.transition = '';
    slide.style.transform = `translate(${lefts[i]}px, ${tops[i]}px)`;
  });
  state.lefts = lefts;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function go(delta) {
  // Pendant la fermeture (FLIP en cours), on ne navigue plus : layout() réécrirait l'opacity
  // que closeSlider a mise à 0 sur les voisines + bougerait la diapo courante pendant son FLIP.
  if (!state || state.closing) return;
  const n = state.slides.length;
  const next = ((state.index + delta) % n + n) % n;   // circulaire : boucle aux extrémités
  if (next === state.index) return;
  state.index = next;
  layout();
  // Pas de reset/relance ici : l'auto-scroll est piloté au survol PAR DIAPO (attachScroll, iso
  // mosaïque). Quitter une diapo (mouseleave) la fait remonter ; survoler la nouvelle la déroule.
  if (state.onNav) state.onNav(state.index, state.slides.length);
}

export function sliderGo(delta) { go(delta); }

export function openSlider({ projId, startSrc, originRect, onClosed, onFinished, onNav, tileSize, attachTilt, attachScroll }) {
  if (root) return;
  const slides = projectSlides(projId);
  const index = Math.max(0, slides.findIndex((s) => s.src === startSrc));
  // Ancre horizontale = centre X de la tuile cliquée (fallback centre écran si pas d'originRect,
  // ex. ouverture via la liste clients). La courante reste posée sur ce X (pas de recentrage).
  const anchorX = originRect ? originRect.left + originRect.width / 2 : window.innerWidth / 2;
  // attachTilt (passé par app.js, sa closure tient cursorEl/hoverPaused/REDUCED_MOTION) : on
  // l'applique au .tile-inner de chaque diapo → tilt 3D + lumière qui suit le curseur, iso mosaïque.
  // entryIndex = maquette par laquelle on est entré dans la vue projet (la « vue initiale »).
  // Sert au retour par étapes : un clic dans le vide y ramène d'abord, avant de quitter.
  state = { projId, slides, index, entryIndex: index, onClosed, onFinished, onNav, slideEls: null, originRect, closing: false, tileSize, anchorX, attachTilt, attachScroll };

  root = document.createElement('div');
  root.className = 'slider';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', projectName(projId));

  const track = document.createElement('div');
  track.className = 'slider__track';
  root.appendChild(track);

  // Construire les diapos, garder leurs refs, attacher les clics de navigation.
  state.slideEls = slides.map((item) => {
    const slide = buildSlide(item);
    // Tilt 3D + lumière-qui-suit-le-curseur, réutilise attachTilt de la mosaïque (pas de
    // duplication). Agit sur inner.parentElement (.tile-frame) ; le transform de layout du
    // slider est sur .slider__slide (parent du frame) → aucun conflit.
    const inner = slide.querySelector('.tile-inner');
    if (inner && state.attachTilt) state.attachTilt(inner);
    // Auto-scroll au survol, iso mosaïque : attachScroll(scroller=.slider__scroll, host=.tile-inner)
    // → attend 500ms puis déroule à 250px/s ; remonte à 1200px/s au mouseleave.
    const scrollEl = slide.querySelector('.slider__scroll');
    if (inner && scrollEl && state.attachScroll) state.attachScroll(scrollEl, inner);
    slide.addEventListener('click', (e) => {
      if (state && state.justDragged) { state.justDragged = false; e.stopPropagation(); return; }
      // Clic sur n'importe quelle diapo non-courante → navigue vers elle (toutes positionnées).
      const i = state.slideEls.indexOf(slide);
      // Re-clic sur la maquette COURANTE → affiche la maquette suivante du projet.
      // Clic sur une voisine → navigue vers elle.
      go(i === state.index ? 1 : i - state.index);
      e.stopPropagation();
    });
    track.appendChild(slide);
    return slide;
  });

  // Positionnement initial
  layout();
  // Notifie le coin TL (onNav) de l'index initial.
  if (state.onNav) state.onNav(state.index, slides.length);

  // Recalcul des tailles quand la fenêtre est redimensionnée pendant que le slider est ouvert.
  // Debounce à 200ms, > le debounce du rebuildLayout mosaïque (150ms) : la mosaïque recalcule
  // d'abord colWidth, puis layout() (qui lit tileSize → colWidth) le récupère à jour.
  let resizeTimer = null;
  state.onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state) layout(); }, 200);
  };
  window.addEventListener('resize', state.onResize);

  // Clic dans le vide (pas sur une diapo) → sortie par étapes (cf. exitSlider, partagée avec Échap).
  root.addEventListener('click', (e) => {
    if (state && state.justDragged) { state.justDragged = false; return; }
    if (!e.target.closest('.slider__slide')) exitSlider();
  });

  document.body.appendChild(root);

  // ─── Animation d'ouverture ──────────────────────────────────────────────────
  // Continuité avec le clic : la diapo CLIQUÉE (courante) part de la position verticale de sa
  // tuile (originRect.top, même X) et glisse jusqu'au centre. Les VOISINES arrivent depuis le
  // bord de leur côté (à gauche → depuis la gauche, à droite → depuis la droite) jusqu'à leur
  // position de layout. Stagger ∝ distance horizontale (les plus proches entrent en premier).
  // Positions finales = state.lefts (posées par layout()) ; layout() les a posées calque DÉTACHÉ
  // (pas de transition) → on (re)part d'une position de départ ici, après appendChild, pour animer.
  if (originRect && !REDUCED_MOTION) {
    const { slides, index } = state;
    const W = window.innerWidth;
    const centerY = window.innerHeight / 2;
    const curLeft = state.lefts[index];
    const targets = state.slideEls.map((el, i) => {
      const sz = slideSize(slides[i].type);
      const finalLeft = state.lefts[i];
      const finalTop = centerY - sz.h / 2;
      // First : cliquée → depuis sa tuile (vertical, X inchangé) ; voisine → hors écran du côté
      // vers lequel elle est posée (gauche/droite), déjà à hauteur centrée.
      const startLeft = i === index ? finalLeft : (finalLeft < curLeft ? -(sz.w + 60) : W + 60);
      const startTop  = i === index ? originRect.top : finalTop;
      el.style.transition = 'none';
      el.style.transform = `translate(${startLeft}px, ${startTop}px)`;
      return { finalLeft, finalTop, dist: Math.abs(finalLeft - curLeft) };
    });
    root.getBoundingClientRect();                          // reflow : fige les positions de départ
    // Play SYNCHRONE (pas de rAF) : après le reflow, changer transition + transform déclenche la
    // transition CSS start→final. Plus robuste qu'un rAF (qui peut être gelé quand la page ne peint
    // pas : onglet de fond, headless) → sinon les diapos resteraient bloquées hors écran.
    state.slideEls.forEach((el, i) => {
      const delay = i === index ? 0 : Math.min(targets[i].dist / W, 1) * ENTRY_STAGGER_MAX_MS;
      el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE} ${delay}ms`;
      el.style.transform = `translate(${targets[i].finalLeft}px, ${targets[i].finalTop}px)`;
    });
    setTimeout(() => {                                     // cleanup → rend la main à layout()/CSS
      if (!state) return;
      state.slideEls.forEach((el) => { el.style.transition = ''; });
    }, FLIP_MS + ENTRY_STAGGER_MAX_MS + 80);
  }

  attachDrag();
  // Plus d'attachCursorLight : attachTilt (appliqué par diapo) gère déjà --gx/--gy
  // (lumière qui suit le curseur), iso mosaïque → pas de double source.
}

// ─── Drag / Swipe horizontal ──────────────────────────────────────────────────
function attachDrag() {
  let startX = 0, startY = 0, dragging = false, axis = null, dx = 0;

  root.addEventListener('pointerdown', (e) => {
    dragging = true; axis = null; dx = 0;
    startX = e.clientX; startY = e.clientY;
    // Pas de setPointerCapture ici : sur un simple clic, la capture redirigerait l'event
    // `click` vers root → le clic sur une diapo voisine ne déclencherait plus sa navigation.
    // On ne capture qu'au moment où un vrai drag horizontal est confirmé (cf. pointermove).
  });

  root.addEventListener('pointermove', (e) => {
    if (!dragging || !state) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // Verrou d'axe au 1er déplacement significatif (> 8px total)
    if (!axis && Math.abs(dx) + Math.abs(dy) > 8) {
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      // Capture le pointeur uniquement pour un vrai drag horizontal (pas au simple clic).
      if (axis === 'x') { try { root.setPointerCapture(e.pointerId); } catch (_) {} }
    }
    if (axis === 'x') {
      e.preventDefault();
      const cur = state.slideEls[state.index];
      const sz = slideSize(state.slides[state.index].type);
      const p = slidePos(0, sz, sz);          // position de layout de la courante
      cur.style.transition = 'none';
      cur.style.transform = `translate(${p.left + dx}px, ${p.top}px)`;
    }
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { root.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!state) return;
    const cur = state.slideEls[state.index];
    // Clic pur (axis null) ou scroll vertical (axis 'y') : AUCUN drag horizontal n'a déplacé
    // la courante → no-op franc. Pas de go, pas de layout() (qui resnaperait avec la transition
    // CSS 500ms → décalage visible de la courante au re-clic). Bug "re-clic décale à gauche".
    if (axis !== 'x') return;
    state.justDragged = Math.abs(dx) > 5; // supprime le click synthétique après un vrai drag
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      cur.style.transition = '';   // rend la main à go()/layout() (transition CSS par défaut)
      go(dx < 0 ? 1 : -1);
    } else {
      // Drag horizontal SOUS le seuil : resnap la courante à sa position de layout SANS
      // animation visible (transition:none le temps de réécrire le transform, puis restaure).
      // Évite le glissement animé 500ms qui faisait "revenir" la diapo et donnait l'illusion
      // d'un décalage. layout() repositionne tout sans transition tant qu'elle est neutralisée.
      cur.style.transition = 'none';
      layout();
      cur.getBoundingClientRect();      // fige l'état resnap (reflow) avant de restaurer
      cur.style.transition = '';
    }
  };

  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

export function closeSlider() {
  if (!root || state.closing) return;
  state.closing = true;
  root.classList.add('is-closing');                   // fondu de sortie des descriptions (CSS)
  const cb = state.onClosed;
  const onFinished = state.onFinished;
  const origin = state.originRect;
  const cur = state.slideEls[state.index];
  const onResize = state.onResize;

  if (cb) cb();   // retour des tuiles (rideau inverse) EN PARALLÈLE du FLIP

  const finish = () => {
    if (onResize) window.removeEventListener('resize', onResize);
    if (root) root.remove();
    root = null;
    state = null;
    if (onFinished) onFinished();   // diapo retirée → app.js révèle la tuile cliquée gelée (relais)
  };

  if (cur && origin && !REDUCED_MOTION) {
    // Fond transparent + on ne garde QUE la diapo courante visible → les tuiles qui
    // reviennent (sous l'overlay) deviennent visibles pendant le FLIP retour.
    root.style.background = 'transparent';
    state.slideEls.forEach((s) => { if (s !== cur) s.style.opacity = '0'; });

    // FLIP retour VERTICAL seul : la courante (taille mosaïque, X = X d'origine) reglisse
    // jusqu'à originRect.top, là où la tuile gelée l'attend. Pas de scale, pas de décalage X.
    const sz = slideSize(state.slides[state.index].type);
    const p = slidePos(0, sz, sz);
    cur.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
    cur.style.transform = `translate(${p.left}px, ${origin.top}px)`;
    setTimeout(finish, FLIP_MS + 40);
  } else {
    finish();   // pas d'origin (ouverture liste clients) ou reduced-motion → fermeture directe
  }
}

function buildSlide(item) {
  const slide = document.createElement('div');
  slide.className = 'slider__slide';
  slide.dataset.src = item.src;
  slide.dataset.type = item.type;       // 'mobile' | 'tablet'

  // Structure DOM IDENTIQUE à une tuile mosaïque (cf. createTile dans app.js) pour hériter
  // du CSS : .tile-frame (passe-partout + radius-outer + box-shadow glow coloré) >
  // .tile-inner (radius-inner + overflow:hidden + ::after = lumière radiale par-dessus) >
  // .slider__scroll (border-radius:inherit → radius-inner) > img.
  const frame = document.createElement('div');
  frame.className = 'tile-frame';
  const inner = document.createElement('div');
  inner.className = 'tile-inner';
  const scroll = document.createElement('div');
  scroll.className = 'slider__scroll';
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = '';
  img.draggable = false;

  // Scrollbar custom IDENTIQUE à la mosaïque (cf. createTile) : track .tile-scrollbar dans le
  // .tile-frame (par-dessus le tile-inner clippé) + fill dont hauteur/position suivent le scroll.
  // `.is-active` ajoutée quand le contenu déborde ; visibilité déclenchée au survol via CSS.
  const scrollbar = document.createElement('div');
  scrollbar.className = 'tile-scrollbar';
  scrollbar.setAttribute('aria-hidden', 'true');
  const scrollbarFill = document.createElement('div');
  scrollbarFill.className = 'tile-scrollbar__fill';
  scrollbar.appendChild(scrollbarFill);
  const updateScrollbar = () => {
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    if (maxScroll <= 0) {
      scrollbar.classList.remove('is-active');
      scrollbarFill.style.height = '0px';
      scrollbarFill.style.transform = 'translateY(0)';
      return;
    }
    scrollbar.classList.add('is-active');
    const trackHeight = scrollbar.clientHeight;
    const thumbHeight = Math.max(20, trackHeight * scroll.clientHeight / scroll.scrollHeight);
    const progress = Math.max(0, Math.min(1, scroll.scrollTop / maxScroll));
    scrollbarFill.style.height = thumbHeight + 'px';
    scrollbarFill.style.transform = `translateY(${progress * (trackHeight - thumbHeight)}px)`;
  };
  scroll.addEventListener('scroll', updateScrollbar, { passive: true });

  // Glow coloré sous la diapo : extrait 3 couleurs de l'image (haut/milieu/bas) une fois
  // chargée et les pose en --tile-glow-1/2/3 sur le .tile-frame (le box-shadow CSS les lit).
  // Le glow n'apparaît qu'AU SURVOL (.slider__slide:hover → @keyframes glow-breathe), iso mosaïque.
  const applyGlow = () => {
    const colors = extractGlowColors(img);
    if (colors && colors.length === 3) {
      frame.style.setProperty('--tile-glow-1', colors[0]);
      frame.style.setProperty('--tile-glow-2', colors[1]);
      frame.style.setProperty('--tile-glow-3', colors[2]);
    }
  };
  // L'image chargée change scrollHeight → re-check la scrollbar en plus du glow.
  const onImgLoaded = () => { applyGlow(); updateScrollbar(); };
  if (img.complete && img.naturalWidth > 0) onImgLoaded();
  else img.addEventListener('load', onImgLoaded, { once: true });
  scroll.appendChild(img);
  inner.appendChild(scroll);
  frame.appendChild(inner);
  frame.appendChild(scrollbar);
  slide.appendChild(frame);

  // Méta sous la diapo, identique à la mosaïque (cf. createTile dans app.js) : largeur
  // = 1 colonne ; pour les tablets, décalée sur la colonne droite (offset colWidth + GAP).
  // colWidth = state.tileSize('mobile').w (lu à jour au resize via re-layout).
  const colWidth = state && state.tileSize ? state.tileSize('mobile').w : slideSize('mobile').w;
  const meta = document.createElement('div');
  meta.className = 'tile-meta';
  meta.style.width = `${colWidth}px`;
  if (item.type === 'tablet') meta.style.left = `${colWidth + GAP}px`;
  const subtitle = document.createElement('p');
  subtitle.className = 'tile-meta__subtitle';
  subtitle.textContent = '↑ Détails';
  const desc = document.createElement('p');
  desc.className = 'tile-meta__desc';
  desc.textContent = projectDesc(item.project);
  meta.appendChild(subtitle);
  meta.appendChild(desc);
  slide.appendChild(meta);
  // Init après attachement DOM (scrollHeight/clientHeight dispo à la frame suivante).
  requestAnimationFrame(updateScrollbar);
  return slide;
}

// Sortie par étapes, partagée par le clic dans le vide ET Échap : si on a navigué, on revient
// d'abord à la maquette d'entrée (la « vue initiale »), PUIS on quitte vers la mosaïque (FLIP
// retour + rideau inverse). Si on est déjà à l'entrée, fermeture directe.
function exitSlider() {
  if (!state || state.closing) return;
  if (state.index !== state.entryIndex) {
    go(state.entryIndex - state.index);                 // 1) retour à la vue initiale (≈ LAYOUT_MS)
    setTimeout(() => closeSlider(), LAYOUT_MS + 40);     // 2) puis fermeture (FLIP + rideau inverse)
  } else {
    closeSlider();
  }
}

// Échap + flèches clavier tant qu'un slider est ouvert.
window.addEventListener('keydown', (e) => {
  if (!root) return;
  if (e.key === 'Escape') exitSlider();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
  else if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   go(-1);
});
