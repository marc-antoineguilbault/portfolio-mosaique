# Lissage de vitesse — fluidité perceptible des déplacements

- **Date** : 2026-05-31
- **Branche** : `feat/warp-curseur-elastique`
- **Statut** : design validé, prêt pour le plan d'implémentation

## Contexte

Le moteur (`app.js`, ~1900 lignes) est déjà bien architecturé côté performance : tout le rendu passe par `translate3d` (compositor, S-tier), la boucle `frame()` est **dt-based** (`offset += velocity * dt`, [app.js:1741](../../../app.js)), `dt` est clampé à 100 ms, les `mousemove` sont coalescés et les écritures de transform skippées si inchangées.

Le sujet n'est donc **pas la performance brute** mais la **qualité perçue du mouvement aux entrées**, qui sont brutes ou frame-dependent :

- **Molette** appliquée en saut sec (`offset += e.deltaY * WHEEL_GAIN`, [app.js:1720](../../../app.js)).
- **Auto-scroll** qui démarre instantanément à `BASE_VELOCITY` (pas de fondu d'entrée).
- **Friction du momentum** frame-dependent (`touchVelocity *= 0.94` sans `dt`, [app.js:1677](../../../app.js)) → s'arrête ~2× plus vite à 120 Hz qu'à 60.
- **Glow** lissé en frame-dependent (`current += dx * 0.08`, [app.js:1231](../../../app.js)).

Principe de correction (recherche — Freya Holmér, *Lerp Smoothing is Broken*) : le **damping exponentiel frame-rate-independent**, exprimé en **demi-vie** (temps pour couvrir la moitié de la distance restante) :

```
damp(cur, target, halfLife, dt) = target + (cur − target) · 2^(−dt / halfLife)
```

## Décisions actées

1. **Architecture additive** (vs système unifié) : on ne refond pas `frame()` (validé, ressenti calibré dans Chrome). On ajoute un socle `damp()` partagé et on greffe chaque lissage là où il manque. Trois physiques restent distinctes : auto-scroll (vitesse constante), molette (résidu qui fond), momentum (friction).
2. **#5 requalifié** : le tilt 3D n'est **pas** brut — il est déjà lissé par `transition: transform 1.2s` sur `.tile-frame` ([styles.css:371](../../../styles.css)). On ne l'amortit donc PAS en JS. Décision (comparaison validée en démo) : **réduire cette transition à 0,6 s** pour un tilt plus présent.
3. **Local-first** : aucun commit/push sans accord explicite.

## Critères de succès

- Molette : défilement glissé, sans saut perceptible, mais réactif (pas d'élastique mou).
- Premier chargement : l'auto-scroll naît en fondu (0 → 30 px/s).
- Mobile : momentum cohérent à 60 et 120 Hz ; raccord fin de swipe → auto-scroll sans à-coup.
- Tilt : suit le curseur de plus près (0,6 s) tout en restant contemplatif.
- Tout lissage frame-rate-independent. Aucune régression des tests Playwright (`--workers=1`). `prefers-reduced-motion` préservé.

## Les 8 patchs

Numérotation conforme à la reco ICE. Trois zones de travail cohérentes + un socle.

### #4 — Socle `damp()` *(zone : neuf — à faire en premier)*

Nouveau fichier `modules/smoothing.js` :

```js
// Damping exponentiel frame-rate-independent (Freya Holmér, "Lerp Smoothing is Broken").
// Ramène `cur` vers `target` ; halfLife = secondes pour couvrir la moitié de la distance.
// 2**(-dt/H) = exp(-ln2 · dt/H) → indépendant de la cadence de rafraîchissement.
export const damp = (cur, target, halfLife, dt) =>
  target + (cur - target) * 2 ** (-dt / halfLife);
```

Câblage : `import { damp } from './modules/smoothing.js';` en tête d'`app.js` (ESM natif en dev, bundlé par esbuild au build — cf. [app.js:1-4](../../../app.js)).

### #1 — Molette amortie (résidu exponentiel) *(zone : frame/offset)*

`offset += e.deltaY * WHEEL_GAIN` ([app.js:1720](../../../app.js)) → saut sec. On accumule un **résidu** que `frame()` consomme exponentiellement.

- Près de `offset` (~[app.js:1637](../../../app.js)) : `let wheelResidual = 0;` + `const WHEEL_HALFLIFE = 0.09;` (90 ms).
- Handler `wheel` ([app.js:1716](../../../app.js)) : remplacer `offset += e.deltaY * WHEEL_GAIN;` par `wheelResidual += normalizeWheel(e) * WHEEL_GAIN;` (cf. #6).
- **Placement dans `frame()`** — ordre critique ([app.js:1740-1745](../../../app.js)) :

```js
// 1. Ramp de vélocité (#2) — TOUJOURS, hors du gate de pause :
velocity = damp(velocity, velocityTarget, VELOCITY_HALFLIFE, dt);
// 2. Auto-scroll — DANS le gate (gelé en pause / survol de tuile) :
if (!paused && !hoverPaused) offset += velocity * dt;
// 3. Résidu molette — HORS du gate (la molette doit défiler même en survol) :
if (wheelResidual !== 0) {
  const consumed = wheelResidual * (1 - 2 ** (-dt / WHEEL_HALFLIFE));
  offset += consumed;
  wheelResidual -= consumed;
  if (Math.abs(wheelResidual) < 0.5) wheelResidual = 0; // snap fin de course
}
// 4. Clamp floor — APRÈS tout, couvre auto-scroll + molette :
const floor = minLiveTileY - SCROLL_TOP_Y;
if (offset < floor) { offset = floor; wheelResidual = 0; } // vide la dette contre le mur
```

Le résidu **hors du gate** reproduit le comportement actuel : le `wheel` défile même en survol de tuile (`hoverPaused`), l'auto-scroll non.

### #2 — Ramp de vélocité (fondu d'entrée + reprise) *(zone : frame/offset)*

`velocity` démarre direct à `BASE_VELOCITY` ([app.js:1638](../../../app.js)) → pas de fondu.

- `let velocity = 0;` + `const velocityTarget = REDUCED_MOTION ? 0 : BASE_VELOCITY;` + `const VELOCITY_HALFLIFE = 0.3;`
- Ramp appliqué dans `frame()` **hors du gate** (cf. structure sous #1) : `velocity = damp(velocity, velocityTarget, VELOCITY_HALFLIFE, dt)`.
- **Portée du fondu** : au **load** (0 → 30 px/s, ~95 % en ~1,3 s) et à la **sortie de momentum** (#7 pose `velocity = 0`). **Pas** après un simple survol de tuile — la reprise y reste immédiate (sinon défilement « hésitant » au butinage). `reduced-motion` : `velocityTarget = 0` → aucun mouvement.

### #3 — Friction du momentum normalisée par dt *(zone : momentum)*

`touchVelocity *= MOMENTUM_FRICTION` ([app.js:1677](../../../app.js)) frame-dependent.

- Remplacer `touchVelocity *= MOMENTUM_FRICTION;` par `touchVelocity *= Math.pow(MOMENTUM_FRICTION, dt * 60);` (0,94/frame @60fps, identique à toute cadence).
- **Clamper `dt` dans `step()`** (cohérence avec `frame()`) : `const dt = Math.min((now - lastT) / 1000, 0.1);` ([app.js:1672](../../../app.js)) — sinon un lag (onglet, GC) tuerait le momentum d'un coup.

### #5 — Tilt : durée de transition 1,2 s → 0,6 s *(zone : CSS)*

`.tile-frame { transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1); }` ([styles.css:371](../../../styles.css)) rend le tilt très traînant.

- Changer en `transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);`
- **Couplage assumé** (validé) : cette transition gère aussi le lift d'entrée (`mouseenter`, [app.js:1258](../../../app.js)) et le retour (`mouseleave`, [app.js:1298](../../../app.js)) → tous deux passent à 0,6 s.
- **Aucune modif JS** pour ce patch. Ne PAS amortir le tilt en JS (déjà lissé par CSS).

### #6 — Delta molette normalisé (souris / trackpad) *(zone : frame/offset, couplé #1)*

`e.deltaY` varie selon device et `deltaMode`.

```js
const MAX_WHEEL_STEP = () => window.innerHeight * 0.5; // clamp anti-saut, par event
function normalizeWheel(e) {
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 16;                  // lignes → px
  else if (e.deltaMode === 2) d *= window.innerHeight; // pages → px
  const cap = MAX_WHEEL_STEP();
  return Math.max(-cap, Math.min(cap, d));
}
```

Alimente `wheelResidual` (#1).

### #7 — Raccord momentum → auto-scroll *(zone : momentum)*

À la coupe du momentum (sous `MOMENTUM_MIN_PX_PER_S = 30`, [app.js:1678](../../../app.js)), discontinuité : la vitesse totale chute brusquement du seuil vers `BASE_VELOCITY`.

- **Séparer deux seuils** (aujourd'hui un seul `MOMENTUM_MIN_PX_PER_S = 30` sert au déclenchement ET à l'arrêt, [app.js:1660](../../../app.js)) :
  - `MOMENTUM_START_MIN = 30` — déclenchement (`startMomentum`, [app.js:1669](../../../app.js)) : garde le momentum sélectif (pas de micro-dérive après un tap quasi-immobile).
  - `MOMENTUM_STOP_MIN = 8` — arrêt (`step`, [app.js:1678](../../../app.js)) : le momentum s'éteint quasi à zéro avant la coupe (avec la friction propre #3) → discontinuité négligeable.
- Dans `stopMomentum()` ([app.js:1662](../../../app.js)) : poser `velocity = 0;` → #2 ré-accélère l'auto-scroll en fondu. `stopMomentum` couvre aussi `touchstart`/`touchcancel`, donc un tap simple déclenche aussi un fondu de reprise (cohérent et voulu).

### #8 — Glow curseur normalisé par dt *(zone : tick/curseur)*

Le `tick()` ([app.js:1228](../../../app.js)) n'a pas de `dt` ; `currentX += dx * 0.08` ([app.js:1231](../../../app.js)) est frame-dependent.

- `const GLOW_HALFLIFE = 0.14;` (reproduit l'actuel `0.08`/frame @60fps → `0.92^n = 0.5` ⟹ demi-vie ≈ 0,14 s ; tunable).
- Passer le timestamp rAF au tick :

```js
let lastTickT = 0;
function tick(now) {
  const dt = lastTickT ? Math.min((now - lastTickT) / 1000, 0.1) : 1 / 60;
  lastTickT = now;
  currentX = damp(currentX, targetX, GLOW_HALFLIFE, dt);
  currentY = damp(currentY, targetY, GLOW_HALFLIFE, dt);
  // … écritures --gx/--gy et condition de continuation ([app.js:1233-1240]) inchangées
}
```

- `rAF` fournit `now` automatiquement (aucun autre appelant de `tick`). Reset `lastTickT = 0` au `mouseenter` ([app.js:1247](../../../app.js)) pour éviter un grand `dt` après une pause.

## Ordre d'implémentation

1. **Socle** — #4 (`smoothing.js` + import).
2. **Zone momentum** — #3, #7 (petites, isolées).
3. **Zone tick/curseur** — #8 (refactor `tick()` + `dt`).
4. **Zone frame/offset** — #6, #1, #2 (interagissent, ensemble).
5. **CSS** — #5 (trivial, indépendant).

## Garde-fous

- **Perception** : demi-vie **≤ 120 ms** sur les interactions directes (molette 90 ms, glow 120 ms) — au-delà, ressenti « élastique mou ». **Exception assumée** : le tilt à 0,6 s (effet d'ambiance contemplatif, validé en démo, pas un suivi 1:1).
- **reduced-motion** : `velocityTarget = 0` ; tilt/glow déjà court-circuités via `REDUCED_MOTION`/`HAS_HOVER`.
- **Focus mode non touché** : les transitions CSS du centrage, `loopToStart`, rebonds (déjà dt-independent, validées) restent inchangées.

## Tests & vérification

- `npm test` (Playwright `--workers=1`) : aucune régression. **Couverture vérifiée** — les 5 specs (`bio`, `lock`, `mobile`, `smoke`, `squash`) n'assertent ni le scroll molette, ni la vélocité, ni le momentum, ni la durée de transition du tilt. Le passage molette synchrone → asynchrone et le fondu de vélocité ne sont donc couverts par aucune assertion. À relancer malgré tout après implémentation.
- Vérif Chrome (ressenti) : molette (glissé vs saut), fondu au load, swipe + momentum (DevTools touch), hover tilt 0,6 s, glow. Golden path **et** edge (molette rapide à fond → clamp floor sans à-coup).
- Dev : bump `?v=N` dans `index.html` (app.js + styles.css) après modif (cache-busting manuel ; le build auto-hash en prod).
- **Pas de commit/push sans accord.**

## Hors scope

- `will-change: transform, width, height, background` ([styles.css:266](../../../styles.css)) : `width/height/background` non-compositables → à réduire en `will-change: transform` (après les 8, sur accord).
- Spring critically-damped sur le focus : écarté (le `cubic-bezier(0.16,1,0.3,1)` est validé).
- **Wheel pendant le focus mode** (`frozen`) : le résidu molette s'accumule sans être consommé (`frame()` sort tôt, [app.js:1736](../../../app.js)) puis se relâche au retour — **comportement préexistant** (l'`offset += deltaY` direct actuel a le même effet). Correctif possible (ignorer `wheel` si `mode !== 'mosaic'`) mais hors des 8.

## Références

- Freya Holmér — *Lerp Smoothing is Broken* (formule `damp` exponentielle) : https://www.youtube.com/watch?v=LSNQuFEDOyQ
- Motion — *Web Animation Performance Tier List* (compositor, `will-change`) : https://motion.dev/blog/web-animation-performance-tier-list
- Gist — spring solver vanilla (évalué, non retenu : `damp` exponentiel suffit) : https://gist.github.com/pushkine/1b595fda102bec88e012c4e4c0cd6d1a
