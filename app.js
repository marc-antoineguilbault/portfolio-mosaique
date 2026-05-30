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

// Machine à états de la page. Exposée sur body pour les tests.
let mode = 'mosaic'; // 'mosaic' | 'transitioning' | 'slider'
function setMode(m) { mode = m; document.body.dataset.mode = m; }
setMode('mosaic');
let frozen = false;
function freezeMosaic() { frozen = true; }
function resumeMosaic() {
  frozen = false;
  // Filet : si une diapo du slider était survolée à la fermeture, son .tile-inner peut ne
  // jamais recevoir le mouseleave (retiré du DOM) → attachTilt laisserait hoverPaused=true
  // et l'auto-scroll mosaïque resterait figé. On le réarme ici, point de reprise unique.
  hoverPaused = false;
  lastFrameTime = performance.now();
}

const EXIT_MS = 700;
const EXIT_STAGGER_MAX_MS = 60;
const EXIT_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// FOCUS : la cliquée se centre verticalement (X préservé). Les autres maquettes DU MÊME projet
// arrivent depuis la DROITE (off-screen → focus row) sous forme de CLONES. Les tuiles sources
// (dans la mosaïque) sortent par le haut/bas comme toutes les autres. Apparaissent les unes après
// les autres (stagger cumulatif). Click sur cliquée/clone : advance d'1 cran (ruban glisse à
// gauche, ancien cliquée sort, nouveau clone wrap arrive de droite).
const FOCUS_ROW_STAGGER_MS = 150;
let focusList = [];     // [{el, item, x, y, w, h, isClone}, ...] — index 0 = cliquée
let pastSlots = [];     // [{el, x, y, isClone}, ...] — anciennes cliquées qui drift à gauche à chaque advance
let userClickedTile = null;   // la tuile mosaïque que l'user a cliquée à l'origine (pour restauration)
let advancing = false;

function focusTile(clickedTile) {
  const vh = window.innerHeight;
  const W = window.innerWidth;
  const middleY = vh / 2;
  const targetY = (vh - clickedTile.h) / 2;
  clickedTile.focused = true;

  const projId = clickedTile.item.project;
  // PRÉLOAD EAGER de toutes les images du projet — garantit que les clones de la focus row ET
  // les wrap clones d'advance utilisent du cache HTTP plutôt que d'attendre un fetch (blanc
  // visible pendant la transition → user perçoit "rien"). fetchPriority high pour précédence.
  const allInPool = pool.filter((it) => it.project === projId);
  for (const item of allInPool) {
    const pre = new Image();
    pre.fetchPriority = 'high';
    pre.src = item.src;
  }
  // Garantit que TOUTES les maquettes du projet sont dans liveTiles avant de construire la focus
  // row. Sinon, items non-spawnés en mosaïque seraient skip → clones manquants (cas Pozzo Di Borgo,
  // 3 maquettes : si seulement la cliquée est spawnée, M+1/M+2 absents).
  const inLive = new Set(liveTiles.filter((t) => t.item).map((t) => t.item.src));
  for (const item of allInPool) {
    if (inLive.has(item.src)) continue;
    const pos = placeNext(item);
    const tile = createTile(item, pos, String(liveTiles.length + 1), 'high');
    liveTiles.push(tile);
    placedSrcs.add(item.src);
  }
  // TOUTES les tuiles non-cliquée (incluant les sources du même projet) sortent par le haut/bas
  // selon leur position vs vh/2 — uniformité visuelle voulue : pas de traitement spécial qui
  // fasse les sources "disparaître en fondue" différemment des autres projets.

  // TOUTES les tuiles non-cliquée sortent par haut/bas (gérées plus bas avec autres projets).
  if (REDUCED_MOTION) {
    for (const tile of liveTiles) {
      if (tile === clickedTile) continue;
      tile.exitDir = 'up';
      tile.el.style.opacity = '0';
    }
  } else {
    for (const tile of liveTiles) {
      if (tile === clickedTile) continue;
      const rect = tile.el.getBoundingClientRect();
      const centerY = rect.top + tile.h / 2;
      const dir = centerY < middleY ? 'up' : 'down';
      tile.exitDir = dir;
      tile.el.dataset.exitDir = dir;
      if (tile.detached) continue;
      const dist = Math.abs(centerY - middleY);
      const delay = Math.min(dist / vh, 1) * EXIT_STAGGER_MAX_MS;
      const exitY = dir === 'up' ? -(tile.h + 100) : vh + 100;
      tile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE} ${delay}ms`;
      tile.el.style.transform = `translate3d(${tile.x}px, ${exitY}px, 0)`;
    }
  }

  // Focus row : items APRÈS cliquée (clones à droite, focusList) + items AVANT cliquée
  // (clones à gauche, pastSlots). On calcule d'abord toutes les positions cibles SANS DOM,
  // puis on shift toute la rangée si nécessaire pour garder le leftmost dans le viewport.
  userClickedTile = clickedTile;
  const allItems = pool.filter((it) => it.project === projId);
  const cliqueeIdx = allItems.findIndex((it) => it.src === clickedTile.item.src);
  const itemsAfter = allItems.slice(cliqueeIdx + 1);
  const itemsBefore = allItems.slice(0, cliqueeIdx);

  // 1. Positions cibles RAW (cliquée à clickedTile.x, sans ribbonShift).
  const rightPositions = [];
  let edgeRight = clickedTile.x + clickedTile.w;
  for (const item of itemsAfter) {
    const source = liveTiles.find((t) => t.item && t.item.src === item.src);
    if (!source) continue;
    edgeRight += GAP;
    rightPositions.push({ item, source, targetX: edgeRight });
    edgeRight += source.w;
  }
  const leftPositions = [];                                // ordre : M-1 (proche), M-2, … (loin)
  let edgeLeft = clickedTile.x;
  for (let i = itemsBefore.length - 1; i >= 0; i--) {
    const item = itemsBefore[i];
    const source = liveTiles.find((t) => t.item && t.item.src === item.src);
    if (!source) continue;
    edgeLeft -= GAP + source.w;
    leftPositions.push({ item, source, targetX: edgeLeft });
  }

  // 2. Cliquée : RESTE à sa position horizontale originale (clickedTile.x), centrée verticalement.
  // Les items à gauche peuvent déborder hors-écran si la cliquée est près du bord gauche —
  // contrainte explicite : la cliquée ne bouge JAMAIS horizontalement.
  if (REDUCED_MOTION) {
    clickedTile.el.style.transition = 'none';
    clickedTile.el.style.transform = `translate3d(${clickedTile.x}px, ${targetY}px, 0)`;
  } else {
    clickedTile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    clickedTile.el.style.transform = `translate3d(${clickedTile.x}px, ${targetY}px, 0)`;
  }
  focusList = [{
    el: clickedTile.el, item: clickedTile.item, x: clickedTile.x, y: targetY,
    w: clickedTile.w, h: clickedTile.h, isClone: false,
  }];

  // 4. Helper : crée un clone d'une source et anime depuis startX vers targetX.
  const spawnClone = (item, source, targetX, targetTopY, startX, zIdx, delayIdx) => {
    const clone = source.el.cloneNode(true);
    clone.dataset.focusClone = 'true';
    clone.style.opacity = '1';
    clone.style.zIndex = String(100 + zIdx);
    clone.style.transition = 'none';
    clone.style.transform = `translate3d(${startX}px, ${targetTopY}px, 0)`;
    document.body.appendChild(clone);
    if (!REDUCED_MOTION) {
      clone.getBoundingClientRect();
      const delay = (delayIdx + 1) * FOCUS_ROW_STAGGER_MS;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE} ${delay}ms`;
        clone.style.transform = `translate3d(${targetX}px, ${targetTopY}px, 0)`;
      }));
    } else {
      clone.style.transform = `translate3d(${targetX}px, ${targetTopY}px, 0)`;
    }
    return { el: clone, item, x: targetX, y: targetTopY, w: source.w, h: source.h, isClone: true };
  };

  // 4. Clones à DROITE — anim depuis off-screen droit, startX cumulé.
  let prevRightEdge = 0;
  let rightIdx = 0;
  for (const data of rightPositions) {
    const targetX = data.targetX;
    const targetTopY = (vh - data.source.h) / 2;
    const startX = Math.max(W, targetX, prevRightEdge + GAP) + 80;
    prevRightEdge = startX + data.source.w;
    focusList.push(spawnClone(data.item, data.source, targetX, targetTopY, startX, rightIdx, rightIdx));
    rightIdx++;
  }

  // 5. Clones à GAUCHE — anim depuis off-screen gauche, startX cumulé. leftSlots dans l'ordre
  // [M-1, M-2, …]. pastSlots = reverse → [M-N, …, M-1]. Convention : pop pastSlots = M-1 (le plus
  // proche cliquée) → ramené en premier par retreat().
  let prevLeftEdge = 0;
  let leftIdx = 0;
  const leftSlots = [];
  for (const data of leftPositions) {
    const targetX = data.targetX;
    const targetTopY = (vh - data.source.h) / 2;
    const startX = Math.min(-data.source.w - 80, targetX, prevLeftEdge - data.source.w - GAP);
    prevLeftEdge = startX;
    leftSlots.push(spawnClone(data.item, data.source, targetX, targetTopY, startX, leftIdx, leftIdx));
    leftIdx++;
  }
  pastSlots = leftSlots.slice().reverse();
}

// ADVANCE : ruban glisse à gauche d'un cran. Cliquée sort à gauche, focus row shift left, nouveau
// clone wrap (image de l'ancienne cliquée) arrive de droite à la dernière position. Click sur
// cliquée OU clone déclenche un advance. Pendant l'anim (advancing=true), nouveau click bloqué.
function advance() {
  if (!focusActive || focusList.length < 2 || advancing) return;
  advancing = true;
  const vh = window.innerHeight;
  const W = window.innerWidth;
  const oldCliquee = focusList[0];

  // Shift UNIFORME de -(cliquée.w + GAP) pour TOUS les slots, cliquée incluse + pastSlots
  // (anciennes cliquées déjà off cliquée slot). Le ruban entier ET les anciennes drift ensemble
  // → pas de pile-up à -127 après plusieurs advances.
  // Plus de cancel WAAPI nécessaire : tous les clones utilisent CSS transitions désormais
  // (pas WAAPI), donc pas de résiduel à canceler. Les CSS transitions s'enchaînent proprement.
  const delta = -(oldCliquee.w + GAP);
  for (let i = 0; i < focusList.length; i++) {
    const slot = focusList[i];
    const newX = slot.x + delta;
    slot.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    slot.el.style.transform = `translate3d(${newX}px, ${slot.y}px, 0)`;
    slot.x = newX;
  }
  for (const past of pastSlots) {
    const newX = past.x + delta;
    past.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    past.el.style.transform = `translate3d(${newX}px, ${past.y}px, 0)`;
    past.x = newX;
  }

  // Pas de wrap clone : le ruban se vide après avoir parcouru toutes les maquettes du projet.
  // Quand focusList.length atteint 1 (seule la dernière maquette comme cliquée), l'advance
  // est bloqué (return early en haut de la fonction sur focusList.length < 2).

  // 4. State : retire l'ancienne cliquée du début. focusList shrink de 1 à chaque advance.
  const removed = focusList.shift();

  // 5. focusedTile pointe maintenant sur la nouvelle cliquée (focusList[0]) pour le click handler.
  focusedTile = { el: focusList[0].el, item: focusList[0].item };

  // 5a. Update du compteur TL ("pour <Projet> (⭠N/Total⭢)") avec la nouvelle cliquée.
  const advProjId = focusList[0].item.project;
  const advProjName = projectNameById.get(advProjId) ?? advProjId;
  const advAllInProj = pool.filter((it) => it.project === advProjId);
  const advIdx = advAllInProj.findIndex((it) => it.src === focusList[0].item.src);
  showProjectLabel(advProjName, advIdx, advAllInProj.length);

  // 5b. Ancienne cliquée → pastSlots (continuera à drift à gauche à chaque advance).
  // On stocke w/h/item aussi pour pouvoir reconstruire le slot lors d'un retreat().
  pastSlots.push({ el: removed.el, item: removed.item, x: removed.x, y: removed.y, w: removed.w, h: removed.h, isClone: removed.isClone });

  // 6. Cleanup post-anim. Marqueurs is-focused-tile pour CSS hide (tuile mosaïque originale).
  setTimeout(() => {
    if (!focusList[0].isClone) focusList[0].el.classList.add('is-focused-tile');
    advancing = false;
  }, EXIT_MS + 50);
}

// RETREAT : inverse de advance — ramène la dernière past à l'avant. Shift uniforme à droite
// de +(last.w + GAP) sur focusList + pastSlots restants. Utilisé par la flèche ⭠ du compteur TL.
function retreat() {
  if (!focusActive || pastSlots.length === 0 || advancing) return;
  advancing = true;
  const last = pastSlots.pop();
  const delta = last.w + GAP;

  // Insert last à index 0 — sa position visuelle actuelle est déjà à gauche de focusList[0].
  // Après shift +delta, last se retrouvera à l'ancienne position de focusList[0].
  focusList.unshift(last);

  // Shift +delta UNIFORME sur tout focusList (including last) + pastSlots restants.
  for (let i = 0; i < focusList.length; i++) {
    const slot = focusList[i];
    const newX = slot.x + delta;
    slot.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    slot.el.style.transform = `translate3d(${newX}px, ${slot.y}px, 0)`;
    slot.x = newX;
  }
  for (const past of pastSlots) {
    const newX = past.x + delta;
    past.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    past.el.style.transform = `translate3d(${newX}px, ${past.y}px, 0)`;
    past.x = newX;
  }

  // Update focusedTile + compteur TL avec la nouvelle (= ancienne) cliquée.
  focusedTile = { el: focusList[0].el, item: focusList[0].item };
  const projId = focusList[0].item.project;
  const projName = projectNameById.get(projId) ?? projId;
  const allInProj = pool.filter((it) => it.project === projId);
  const idx = allInProj.findIndex((it) => it.src === focusList[0].item.src);
  showProjectLabel(projName, idx, allInProj.length);

  setTimeout(() => { advancing = false; }, EXIT_MS + 50);
}

// Retire tous les clones (focusList + pastSlots). Clones de focusList (droite) → anim off-screen
// droite. Clones de pastSlots (gauche, pré-remplis OU drifted par advances) → anim off-screen
// gauche, même delta uniforme pour éviter overlap. pastSlots non-clones (= userClickedTile
// shiftée par advance) → géré par returnTiles en phase 3.
function removeFocusClones() {
  const W = window.innerWidth;

  // Clones à DROITE (focusList).
  const rightClones = focusList.filter((s) => s.isClone);
  if (rightClones.length && !REDUCED_MOTION) {
    const leftmostX = Math.min(...rightClones.map((s) => s.x));
    const delta = W + 80 - leftmostX;
    for (const slot of rightClones) {
      slot.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
      slot.el.style.transform = `translate3d(${slot.x + delta}px, ${slot.y}px, 0)`;
    }
  } else {
    for (const slot of rightClones) slot.el.remove();
  }

  // Clones à GAUCHE (pastSlots) : pré-remplis OU drifted par advances. Même delta uniforme
  // (le rightmost atteint -80 pour sortir entièrement, les autres suivent à la même vitesse).
  const leftClones = pastSlots.filter((s) => s.isClone);
  if (leftClones.length && !REDUCED_MOTION) {
    const rightmostXEnd = Math.max(...leftClones.map((s) => s.x + s.w));
    const delta = -(rightmostXEnd + 80);
    for (const slot of leftClones) {
      slot.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
      slot.el.style.transform = `translate3d(${slot.x + delta}px, ${slot.y}px, 0)`;
    }
  } else {
    for (const slot of leftClones) slot.el.remove();
  }

  setTimeout(() => {
    for (const slot of rightClones) slot.el.remove();
    for (const slot of leftClones) slot.el.remove();
  }, EXIT_MS + 50);
  pastSlots = [];
  focusList = [];
}

// Retour focus : cliquée revient à sa position mosaïque, autres reviennent depuis leur sortie.
function returnTiles(done) {
  const animated = [];
  for (const tile of liveTiles) {
    const wasExited = !!tile.exitDir;
    const wasFocused = !!tile.focused;
    if (!wasExited && !wasFocused) continue;
    delete tile.exitDir;
    delete tile.focused;
    delete tile.el.dataset.exitDir;
    if (REDUCED_MOTION) { tile.el.style.opacity = ''; tile.el.style.transition = 'none'; tile.el.style.transform = ''; continue; }
    if (tile.detached) continue;
    const ty = tile.y - offset * tile.velocityMultiplier + (COL_STAGGER[tile.colIdx] ?? 0);
    tile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    tile.el.style.transform = `translate3d(${tile.x}px, ${ty}px, 0)`;
    animated.push(tile);
  }
  if (animated.length === 0) { done(); return; }
  // Nettoyage déterministe par timeout plutôt que par transitionend : si le transform ne
  // change pas (retour déclenché pendant le délai de stagger de la sortie), l'event
  // transitionend ne part jamais → done() jamais appelé → mosaïque gelée à vie.
  setTimeout(() => {
    for (const tile of animated) tile.el.style.transition = '';  // sinon frame() lag l'auto-scroll
    done();
  }, EXIT_MS + 50);
}

// ─── Focus mode : état global + sortie ────────────────────────────────────────
let focusActive = false;
let focusedTile = null;
function exitFocus() {
  if (!focusActive) return;
  focusActive = false;
  focusedTile = null;
  clearProjectLabel();

  // Track projId AVANT de null userClickedTile (utile en phase 3 pour fader les sources).
  const projId = userClickedTile?.item?.project;
  // SNAPSHOT des éléments marqués is-focused-tile AVANT que removeFocusClones (phase 2) ne vide
  // focusList. Sinon, phase 3b itère une liste vide et la classe persiste sur M0 → CSS hide
  // l'exclut au focus suivant du même projet (M0 reste visible derrière la nouvelle vue).
  const focusedEls = focusList.filter((s) => !s.isClone).map((s) => s.el);
  const pastFocusedEls = pastSlots.filter((s) => !s.isClone).map((s) => s.el);

  // Exit en 3 phases :
  //   1. Reverse shift : ramener M-0 (userClickedTile) à sa position originale → toutes les
  //      focus tiles glissent vers la droite ensemble.
  //   2. Clones disparaissent vers la droite.
  //   3. Tuiles des autres projets reviennent (returnTiles) + sources du même projet fadent in
  //      à la même vitesse (sinon snap visible quand on remove data-focus-proj).
  // reverseShift : ramène M0 à sa position originale. Le slot CONTENANT M0 peut être dans
  // focusList (open + retreats) OU dans pastSlots (open + advances). Search dans les deux.
  // À l'open initial, M0 = focusList[0] avec x = userClickedTile.x → reverseShift = 0.
  const m0CurrentSlot = userClickedTile
    ? (focusList.find((s) => s.el === userClickedTile.el)
       || pastSlots.find((s) => s.el === userClickedTile.el))
    : null;
  const reverseShift = m0CurrentSlot ? (userClickedTile.x - m0CurrentSlot.x) : 0;

  // Phase 3a : M0 (userClickedTile) retourne à sa position Y mosaïque.
  // Phase 3b (après) : autres projets reviennent + sources du même projet fadent in.
  const phase3b = () => {
    // NB : on NE delete PAS userClickedTile.focused ici — returnTiles doit la traiter pour
    // clear la transition inline (set par phase3a). Sans ce nettoyage, frame() trigger une
    // nouvelle CSS transition à chaque rAF → tuile cliquée scrolle avec lag/saccade visible.
    // Le re-set du transform par returnTiles avec la MÊME valeur ne déclenche pas de transition.
    delete document.body.dataset.focusProj;
    // focusList est vide ici (phase 2 l'a vidé) → on utilise les snapshots pris en début d'exit.
    for (const el of focusedEls) el.classList.remove('is-focused-tile');
    for (const el of pastFocusedEls) el.classList.remove('is-focused-tile');
    userClickedTile = null;
    returnTiles(() => { resumeMosaic(); setMode('mosaic'); });
  };

  const phase3a = () => {
    // M0 retourne à sa position Y mosaïque AVANT que les autres apparaissent.
    if (userClickedTile && !REDUCED_MOTION) {
      const tile = liveTiles.find((t) => t.el === userClickedTile.el) || userClickedTile;
      const ty = tile.y - offset * tile.velocityMultiplier + (COL_STAGGER[tile.colIdx] ?? 0);
      userClickedTile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
      userClickedTile.el.style.transform = `translate3d(${userClickedTile.x}px, ${ty}px, 0)`;
      setTimeout(phase3b, EXIT_MS + 50);
    } else {
      phase3b();
    }
  };

  const phase2 = () => {
    removeFocusClones();
    setTimeout(phase3a, EXIT_MS / 2);
  };

  if (Math.abs(reverseShift) > 1 && !REDUCED_MOTION) {
    for (const slot of focusList) {
      slot.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
      slot.el.style.transform = `translate3d(${slot.x + reverseShift}px, ${slot.y}px, 0)`;
      slot.x += reverseShift;
    }
    for (const past of pastSlots) {
      past.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
      past.el.style.transform = `translate3d(${past.x + reverseShift}px, ${past.y}px, 0)`;
      past.x += reverseShift;
    }
    setTimeout(phase2, EXIT_MS + 50);
  } else {
    phase2();
  }
}
// Escape OU click hors d'une maquette focus → sortie. Click SUR cliquée OU clone → advance.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && focusActive) exitFocus();
});
document.addEventListener('click', (e) => {
  if (!focusActive) return;
  // Click sur un clone (les clones n'ont pas de handler inner → seul ce handler global les voit).
  if (e.target.closest('[data-focus-clone="true"]')) { advance(); return; }
  // Click sur la cliquée actuelle (descendant de focusList[0].el). Le handler inner avec
  // stopPropagation gère le cas où la cliquée est la tuile mosaïque originale. Pour les advances
  // suivants où la cliquée est un clone, la branche ci-dessus l'attrape.
  if (focusList[0] && focusList[0].el.contains(e.target)) { advance(); return; }
  // Click ailleurs → exit.
  exitFocus();
});

// ─── Label projet dans le coin TL ────────────────────────────────────────────
// Affiche "pour <Nom> (⭠N/Total⭢)" dans le suffix du coin TL pendant le focus.
// Le compteur indique la position de la maquette courante dans la séquence du projet.
// Flèches cliquables : ⭠ retreat (recule dans le ribbon), ⭢ advance. Désactivées
// aux extrémités (idx=0 → ⭠ off, idx=total-1 → ⭢ off).
function showProjectLabel(name, idx, total) {
  const suffix = document.querySelector('.ui-corner__suffix');
  const nav = document.querySelector('.ui-corner__project-nav');
  if (suffix) {
    suffix.replaceChildren();
    suffix.appendChild(document.createTextNode(' pour '));
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ui-corner__suffix-name';
    nameSpan.textContent = name;
    suffix.appendChild(nameSpan);
    if (idx != null && total != null && total > 1) {
      const counter = document.createElement('span');
      counter.className = 'ui-corner__project-counter';

      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'ui-corner__project-arrow ui-corner__project-arrow--prev';
      prev.textContent = '⭠';
      prev.setAttribute('aria-label', 'Maquette précédente');
      prev.disabled = (idx === 0);
      prev.addEventListener('click', (e) => {
        e.stopPropagation();      // évite que le TL ouvre la liste clients OU que doc ferme le focus
        if (!prev.disabled) retreat();
      });

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'ui-corner__project-arrow ui-corner__project-arrow--next';
      next.textContent = '⭢';
      next.setAttribute('aria-label', 'Maquette suivante');
      next.disabled = (idx === total - 1);
      next.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!next.disabled) advance();
      });

      counter.appendChild(document.createTextNode(' ('));
      counter.appendChild(prev);
      counter.appendChild(document.createTextNode(`${idx + 1}/${total}`));
      counter.appendChild(next);
      counter.appendChild(document.createTextNode(')'));

      suffix.appendChild(counter);
    }
  }
  if (nav) nav.replaceChildren();
}

function clearProjectLabel() {
  const suffix = document.querySelector('.ui-corner__suffix');
  const nav = document.querySelector('.ui-corner__project-nav');
  if (suffix) suffix.replaceChildren();
  if (nav) nav.replaceChildren();
}
// ──────────────────────────────────────────────────────────────────────────

// ─── Typewriter du suffixe " pour <client>" du label TL au CLIC ──────────
// La partie statique "Marc-Antoine Guilbault, Lead Designer UI" ne bouge pas ;
// seul le span .ui-corner__suffix s'écrit/efface lettre par lettre.
const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
const projectDescById = new Map(projects.map((p) => [p.id, p.desc]));

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
      if (mode !== 'mosaic') return;
      // Cherche dans liveTiles la 1re tuile du projet présente à l'écran. Si trouvée → focus.
      // Sinon : on ferme juste la liste (l'utilisateur scrollera la mosaïque pour trouver).
      const tile = liveTiles.find((t) => t.item && t.item.project === p.id);
      if (!tile) return;
      setMode('focus');
      freezeMosaic();
      focusActive = true;
      focusedTile = tile;
      const projName = projectNameById.get(p.id) ?? p.name;
      showProjectLabel(projName);
      focusTile(tile);
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
    if (e.target.closest('a, .ui-corner__suffix-item, .ui-corner__project-arrow')) return;
    if (clientListOpen) closeClientList();
    else { openClientList(); }
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
      else { openClientList(); }
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

  // Objet tuile construit avant le handler pour que le handler puisse le référencer.
  // C'est cet objet qui sera poussé dans liveTiles : tile === clickedTile fonctionne
  // dans focusTile car c'est la même référence.
  const tileObj = { el, inner, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h,
                    velocityMultiplier: pos.velocityMultiplier, colIdx: pos.colIdx };

  // Au clic : focus la maquette (centre Y, X préservé) + autres tuiles sortent par le haut
  // ou le bas selon leur position vs vh/2. Si la tuile est verrouillée → cadenas (mdp).
  inner.addEventListener('click', (e) => {
    const lockSvg = inner.querySelector('.tile-lock');
    if (lockSvg && lockSvg.style.display !== 'none') {
      lockSvg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return; // projet verrouillé → champ mot de passe, pas de focus
    }
    // En mode focus : click sur la tuile mosaïque originale = advance (slider next).
    if (mode === 'focus') {
      if (focusActive && userClickedTile && userClickedTile.el === el) {
        e.stopPropagation();
        advance();
      }
      return;
    }
    if (mode !== 'mosaic') return;          // verrou anti-double-déclenchement
    const proj = el.dataset.project;
    if (!proj) return;
    e.stopPropagation();                    // évite que le listener global ferme aussitôt
    setMode('focus');
    freezeMosaic();
    focusActive = true;
    focusedTile = tileObj;
    // Marqueurs pour le CSS focus-mode : data-focus-proj sur body + classe is-focused-tile sur
    // la cliquée. Le CSS hide TOUS les .tile[data-project=proj] sauf la cliquée et les clones —
    // robuste aux tuiles spawnées après le focusTile (sinon iteration JS ratait les nouvelles).
    document.body.dataset.focusProj = proj;
    tileObj.el.classList.add('is-focused-tile');
    const projName = projectNameById.get(proj) ?? proj;
    const allInProj = pool.filter((it) => it.project === proj);
    const projIdx = allInProj.findIndex((it) => it.src === tileObj.item.src);
    showProjectLabel(projName, projIdx, allInProj.length);
    focusTile(tileObj);
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
  return tileObj;
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

// Flush sync : force le préfill de tout le pool (ou jusqu'à targetSrc si fourni).
// Boucle sans budget ; si targetSrc est fourni, s'arrête dès que cette src est placée.
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
  if (frozen) {                 // slider actif : mosaïque figée, boucle au repos
    requestAnimationFrame(frame);
    return;
  }
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
