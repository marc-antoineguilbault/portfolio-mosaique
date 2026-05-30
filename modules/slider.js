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
// Durée + easing de l'entrée : plus long et plus linéaire que FLIP_EASE (qui est très front-loaded
// → 88% du mouvement dans les 50% premiers ms → les peeks paraissent instantanés). Material
// standard easing pour un slide-in perceptible jusqu'au bout, même sur les bords.
const ENTRY_MS = 1100;
const ENTRY_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

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
  rels[index] = 0;
  // Répartition gauche/droite + ancrage : on cherche le couple (leftCount, anchorX_ajusté) qui
  // garantit que les DEUX bords du ruban débordent (peek visible de chaque côté). La courante reste
  // au plus près de la tuile cliquée — anchorX n'est shifté que si AUCUN leftCount ne permet le
  // double-overflow à l'anchorX original. Le shift est alors MINIMAL (clamp dans la plage valide
  // la plus proche). Plage valide pour un leftCount k : anchorX ∈ (ext_k − (totalW − W), ext_k).
  // En cas de shift égal entre candidats : le plus centré (ext_k ≈ leftTarget) gagne.
  const maxLeft = Math.max(0, N - 2);
  const leftTarget = anchorX + (totalW - W) / 2;
  // Marge MIN d'overflow visible (px) sur CHAQUE bord : sans elle, le clamp tombe pile à la
  // frontière → bord du ruban juste à 0 ou à W → peek invisible (« touche mais ne déborde pas »).
  // 60px ≈ 4% du viewport 1470, imperceptible sur le shift d'anchor, mais visible côté peek.
  const MIN_OVERFLOW = 60;
  const candidates = [];
  {
    let ext = sizes[index].w / 2;
    for (let k = 0; k <= maxLeft; k++) {
      const lo = ext - (totalW - W) + MIN_OVERFLOW;
      const hi = ext - MIN_OVERFLOW;
      const clamped = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, anchorX));
      candidates.push({ k, clamped, shift: Math.abs(clamped - anchorX), centerErr: Math.abs(ext - leftTarget) });
      ext += GAP + sizes[((index - (k + 1)) % N + N) % N].w;
    }
  }
  candidates.sort((a, b) => a.shift - b.shift || a.centerErr - b.centerErr);
  const chosen = candidates[0];
  const leftCount = chosen.k;
  const rightCount = N - 1 - leftCount;
  // anchorX ajusté (≈ original si aucun shift nécessaire). Mis à jour dans state pour cohérence
  // avec slidePos / drag / navs suivantes. La tuile cliquée reste la référence visuelle de
  // l'ouverture : l'entrance FLIP démarre depuis originRect, pas depuis lefts[index] (cf. openSlider).
  const adjustedAnchorX = chosen.clamped;
  state.anchorX = adjustedAnchorX;
  lefts[index] = adjustedAnchorX - sizes[index].w / 2;
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
  // Wraps : LEAVING (visible avant, va loin hors champ) glisse off-screen en DEUX phases pour ne
  // pas cutter ET garder le bord opposé rempli après la transition :
  //   – phase 1 (transition CSS 500ms) : transform animé vers (prev + Δ) → glisse off-screen avec
  //     le reste du ruban, smooth, à la même vitesse.
  //   – phase 2 (setTimeout après LAYOUT_MS) : SNAP invisible vers la vraie cible logique lefts[i]
  //     (right peek dans le sens forward) → le bord opposé se remplit, état stable.
  // ARRIVING (hors champ avant, arrive en peek visible) : téléport à (cible − Δ) puis animation CSS
  // vers la cible (comportement d'origine, nécessaire pour ne pas voir la diapo traverser l'écran).
  const delta = prev ? lefts[index] - prev[index] : 0;   // 1er layout (prev absent) : aucune wrappée
  const wrappedLeaving = [], wrappedArriving = [];
  for (const i of wrapped) {
    const sz = sizes[i];
    const prevVisible = prev[i] + sz.w > 0 && prev[i] < W;
    (prevVisible ? wrappedLeaving : wrappedArriving).push(i);
  }
  // Annule + APPLIQUE les snaps en attente d'un layout précédent. Application immédiate pour que le
  // transform rendu corresponde à la position logique (sinon une diapo mi-animation aurait son
  // transform désynchronisé de state.lefts et la nouvelle transition partirait du mauvais point).
  state.pendingSnaps = state.pendingSnaps || {};
  for (const i in state.pendingSnaps) {
    const ps = state.pendingSnaps[i];
    clearTimeout(ps.timeoutId);
    const el = state.slideEls[+i];
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translate(${ps.finalLeft}px, ${ps.finalTop}px)`;
      el.getBoundingClientRect();
      el.style.transition = '';
    }
  }
  state.pendingSnaps = {};
  // ARRIVING : téléport hors champ à (cible − Δ) puis animation CSS vers la cible.
  for (const i of wrappedArriving) {
    state.slideEls[i].style.transition = 'none';
    state.slideEls[i].style.transform = `translate(${lefts[i] - delta}px, ${tops[i]}px)`;
  }
  if (wrappedArriving.length) void root.offsetWidth;     // fige les positions de départ (hors écran)
  // Applique les transforms. LEAVING phase 1 : transform animé vers (prev + Δ) hors champ.
  state.slideEls.forEach((slide, i) => {
    if (wrappedArriving.includes(i)) slide.style.transition = '';
    const x = wrappedLeaving.includes(i) ? prev[i] + delta : lefts[i];
    slide.style.transform = `translate(${x}px, ${tops[i]}px)`;
  });
  // LEAVING phase 2 : après la transition, SNAP invisible vers la vraie cible logique lefts[i].
  for (const i of wrappedLeaving) {
    const finalLeft = lefts[i], finalTop = tops[i];
    const timeoutId = setTimeout(() => {
      if (!state || !state.pendingSnaps || !state.pendingSnaps[i]) return;
      delete state.pendingSnaps[i];
      const el = state.slideEls[i];
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${finalLeft}px, ${finalTop}px)`;
      el.getBoundingClientRect();
      el.style.transition = '';
    }, LAYOUT_MS + 20);
    state.pendingSnaps[i] = { timeoutId, finalLeft, finalTop };
  }
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
  // Précharge EAGER toutes les maquettes du projet dès l'ouverture, en parallèle et en priorité
  // haute. Les <img> des diapos puiseront ensuite dans le cache HTTP → nav instantanée même vers
  // une maquette pas encore vue (sinon le navigateur déprioritise les diapos hors-écran et on les
  // voit apparaître au fil des clics).
  for (const item of slides) { const pre = new Image(); pre.fetchPriority = 'high'; pre.src = item.src; }
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

  // ─── Animation d'ouverture (pré-position START AVANT appendChild) ──────────
  // CRUCIAL : on pose les transforms de DÉPART AVANT d'attacher la racine au DOM. Comme ça, quand
  // les diapos deviennent visibles via appendChild, elles APPARAISSENT au start (hors écran pour
  // les voisines, sur la tuile pour la cliquée). Puis une frame plus tard (rAF), on transitionne
  // vers final via CSS transition → le browser peint forcément le start avant la cible.
  // Sans cette pré-position, layout() posait final, appendChild rendait final, et Chrome
  // optimisait en zappant l'état start → cut visible.
  let entranceTargets = null;
  if (originRect && !REDUCED_MOTION) {
    const { slides, index } = state;
    const W = window.innerWidth;
    const centerY = window.innerHeight / 2;
    const curLeft = state.lefts[index];
    entranceTargets = state.slideEls.map((el, i) => {
      const sz = slideSize(slides[i].type);
      const finalLeft = state.lefts[i];
      const finalTop = centerY - sz.h / 2;
      // Cliquée : départ depuis la tuile (originRect) — continuité avec le clic.
      // Voisines : départ depuis le bord de leur côté (gauche depuis la gauche, droite depuis la droite).
      const startLeft = i === index ? originRect.left : (finalLeft < curLeft ? -(sz.w + 60) : W + 60);
      const startTop  = i === index ? originRect.top : finalTop;
      el.style.transition = 'none';
      el.style.transform = `translate(${startLeft}px, ${startTop}px)`;
      // Opacity fade-in : garantit une anim VISIBLE même si le slide reste hors-zone-visible
      // (viewport étroit, peeks fortement coupés → translation horizontale invisible). Le slide
      // apparaît au moins par opacity, pas en cut.
      if (i !== index) el.style.opacity = '0';                // cliquée garde son opacity (FLIP suffit)
      return { finalLeft, finalTop, dist: Math.abs(finalLeft - curLeft) };
    });
  }

  document.body.appendChild(root);

  if (entranceTargets) {
    root.getBoundingClientRect();                          // commit du DOM attaché à l'état start
    let triggered = false;
    const playFinal = () => {                              // pose final + transition (idempotent)
      if (triggered || !state) return;
      triggered = true;
      const W2 = window.innerWidth;
      state.slideEls.forEach((el, i) => {
        const t = entranceTargets[i];
        const delay = i === state.index ? 0 : Math.min(t.dist / W2, 1) * ENTRY_STAGGER_MAX_MS;
        el.style.transition = `transform ${ENTRY_MS}ms ${ENTRY_EASE} ${delay}ms, opacity ${ENTRY_MS}ms ${ENTRY_EASE} ${delay}ms`;
        el.style.transform = `translate(${t.finalLeft}px, ${t.finalTop}px)`;
        if (i !== state.index) el.style.opacity = '1';     // fade-in voisines (cliquée pas touchée)
      });
    };
    // DOUBLE rAF : rAF fire AVANT la prochaine peinture, donc 1 seul rAF set le final
    // avant que le browser ait peint le start → Chrome peint direct à final = CUT.
    // Double rAF garantit qu'une frame est PEINTE au start avant de poser le final.
    requestAnimationFrame(() => requestAnimationFrame(playFinal));
    setTimeout(playFinal, 80);                             // fallback : si rAF throttled
    setTimeout(() => {                                     // cleanup → rend la main à CSS/layout()
      if (!state) return;
      state.slideEls.forEach((el) => { el.style.transition = ''; el.style.opacity = ''; });
    }, ENTRY_MS + ENTRY_STAGGER_MAX_MS + 100);
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
  if (state.pendingSnaps) { for (const ps of Object.values(state.pendingSnaps)) clearTimeout(ps.timeoutId); state.pendingSnaps = {}; }
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
