# Lissage de vitesse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les déplacements (molette, auto-scroll, momentum tactile, glow, tilt) perceptiblement plus fluides via un damping exponentiel frame-rate-independent, sans refondre le moteur validé.

**Architecture:** Additive. Un socle pur `damp()` (`modules/smoothing.js`) + greffes ciblées dans `frame()` (offset/vélocité), la boucle momentum, le `tick()` curseur, et une valeur CSS. Trois physiques restent distinctes : auto-scroll (vitesse constante), molette (résidu qui fond), momentum (friction).

**Tech Stack:** JS vanilla ESM zéro-dépendance, esbuild (build), Playwright e2e (`--workers=1`). Spec : [docs/superpowers/specs/2026-05-31-lissage-vitesse-design.md](../specs/2026-05-31-lissage-vitesse-design.md).

---

## Notes d'exécution (lire avant de commencer)

- **Git** : commits **locaux uniquement, pas de push** (local-first). Utiliser `git -C "<path>"` (un hook bloque `cd <path> && git`).
- **Vérification du ressenti** : le projet n'a **pas** de runner unit-test (contrainte zéro-dépendance) et valide le ressenti animé **dans Chrome** (pratique établie). Donc : TDD réel pour la fonction pure `damp()` (Task 0) ; pour les patchs d'intégration, vérification = **non-régression `npm test`** + **checks Chrome mesurables** (`preview_eval` sur `offset`/`velocity` + screenshot). C'est un écart assumé au TDD strict, justifié par les pratiques du projet.
- **Tests** : `npx playwright test --workers=1` (la page est CPU-lourde, le parallélisme flake — cf. `playwright.config.js`).
- **Cache-busting** : bump `?v=` dans `index.html` une seule fois en fin de parcours (Task 5).
- **Ordre** : frame/offset (#2) **avant** momentum (#7) — #7 pose `velocity = 0` et dépend du ramp #2 pour remonter.

---

## Task 0 : Socle `damp()` (#4)

**Files:**
- Create: `modules/smoothing.js`
- Create: `tests/smoothing.spec.js`
- Modify: `app.js:4` (ajout import)

- [ ] **Step 1 : Écrire le test (rouge d'abord)**

Create `tests/smoothing.spec.js` :

```js
// @ts-check
import { test, expect } from '@playwright/test';

test.describe('smoothing — damp()', () => {
  test('damp est frame-rate-independent (demi-vie)', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { damp } = await import('/modules/smoothing.js');
      return {
        dtZero: damp(0, 10, 0.1, 0),        // dt=0 → reste à cur
        oneHalfLife: damp(0, 10, 0.1, 0.1), // 1 demi-vie → 50 %
        tenHalfLives: damp(0, 10, 0.1, 1),  // 10 demi-vies → ~99,9 %
        atTarget: damp(10, 10, 0.1, 0.05),  // déjà à la cible → reste
      };
    });
    expect(r.dtZero).toBeCloseTo(0, 6);
    expect(r.oneHalfLife).toBeCloseTo(5, 6);
    expect(r.tenHalfLives).toBeGreaterThan(9.98);
    expect(r.tenHalfLives).toBeLessThan(10);
    expect(r.atTarget).toBeCloseTo(10, 6);
  });
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `npx playwright test smoothing --workers=1`
Expected: FAIL (l'`import('/modules/smoothing.js')` rejette → 404, le module n'existe pas).

- [ ] **Step 3 : Créer le module**

Create `modules/smoothing.js` :

```js
// Damping exponentiel frame-rate-independent (Freya Holmér, "Lerp Smoothing is Broken").
// Ramène `cur` vers `target` ; halfLife = secondes pour couvrir la moitié de la distance.
// 2**(-dt/H) = exp(-ln2 · dt/H) → indépendant de la cadence de rafraîchissement.
export const damp = (cur, target, halfLife, dt) =>
  target + (cur - target) * 2 ** (-dt / halfLife);
```

- [ ] **Step 4 : Lancer → vert**

Run: `npx playwright test smoothing --workers=1`
Expected: PASS (1 test).

- [ ] **Step 5 : Importer dans `app.js`**

Modify `app.js` — après la ligne 4 (`import { attachLock } from './modules/lock.js';`) :

old:
```js
import { attachLock } from './modules/lock.js';
```
new:
```js
import { attachLock } from './modules/lock.js';
import { damp } from './modules/smoothing.js';
```

- [ ] **Step 6 : Non-régression**

Run: `npx playwright test --workers=1`
Expected: tous PASS (l'import ne casse rien).

- [ ] **Step 7 : Commit**

```bash
git -C "<path>" add modules/smoothing.js tests/smoothing.spec.js app.js
git -C "<path>" commit -m "feat(smoothing): socle damp() frame-rate-independent (#4)"
```

---

## Task 1 : Zone frame/offset — molette amortie + delta normalisé + fondu de vélocité (#1, #6, #2)

**Files:**
- Modify: `app.js` (constantes ~48-49 ; déclarations offset/vélocité ~1637-1638 ; handler `wheel` ~1716-1724 ; corps de `frame()` ~1740-1745)

- [ ] **Step 1 : Constantes de demi-vie**

Modify `app.js` — old:
```js
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;
```
new:
```js
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;
const WHEEL_HALFLIFE = 0.09;    // #1 : demi-vie d'absorption du résidu molette (90 ms)
const VELOCITY_HALFLIFE = 0.3;  // #2 : demi-vie du fondu d'auto-scroll (load / reprise)
```

- [ ] **Step 2 : Vélocité initiale à 0 + cible + résidu molette**

Modify `app.js` — old:
```js
let offset = 0;
let velocity = REDUCED_MOTION ? 0 : BASE_VELOCITY;
```
new:
```js
let offset = 0;
let velocity = 0;                                          // #2 : démarre à 0 → fondu d'entrée
const velocityTarget = REDUCED_MOTION ? 0 : BASE_VELOCITY; // #2 : cible du ramp
let wheelResidual = 0;                                     // #1 : dette molette à absorber
```

- [ ] **Step 3 : `normalizeWheel()` + handler `wheel` (résidu)**

Modify `app.js` — old:
```js
viewport.addEventListener('wheel', (e) => {
  // Scroll manuel dans la tile désactivé : le wheel défile toujours la mosaïque.
  // (Le scroll de la tile reste possible uniquement via l'auto-scroll au hover.)
  e.preventDefault();
  offset += e.deltaY * WHEEL_GAIN;
  // Clamp au floor : la plus haute tile s'aligne à ty = SCROLL_TOP_Y au max scroll up.
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) offset = floor;
}, { passive: false });
```
new:
```js
// #6 : normalise deltaY (deltaMode lignes/pages → px) + clamp anti-saut (souris crantée ≈ trackpad).
function normalizeWheel(e) {
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 16;                       // lignes → px
  else if (e.deltaMode === 2) d *= window.innerHeight;  // pages → px
  const cap = window.innerHeight * 0.5;
  return Math.max(-cap, Math.min(cap, d));
}

viewport.addEventListener('wheel', (e) => {
  // Scroll manuel dans la tile désactivé : le wheel défile toujours la mosaïque.
  // (Le scroll de la tile reste possible uniquement via l'auto-scroll au hover.)
  e.preventDefault();
  // #1 : on alimente un résidu absorbé exponentiellement dans frame() (au lieu d'un saut sec).
  wheelResidual += normalizeWheel(e) * WHEEL_GAIN;
}, { passive: false });
```

- [ ] **Step 4 : Structure de `frame()` (ramp + résidu + clamp)**

Modify `app.js` — old:
```js
  if (!paused && !hoverPaused) {
    offset += velocity * dt;
  }
  // Filet de sécurité : snap au floor (= première tile à ty = SCROLL_TOP_Y).
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) offset = floor;
```
new:
```js
  // #2 : ramp de vélocité (hors gate) → fondu d'entrée au load + reprise après momentum.
  velocity = damp(velocity, velocityTarget, VELOCITY_HALFLIFE, dt);
  if (!paused && !hoverPaused) {
    offset += velocity * dt;
  }
  // #1 : absorption exponentielle du résidu molette (hors gate : la molette défile même en survol).
  if (wheelResidual !== 0) {
    const consumed = wheelResidual * (1 - 2 ** (-dt / WHEEL_HALFLIFE));
    offset += consumed;
    wheelResidual -= consumed;
    if (Math.abs(wheelResidual) < 0.5) wheelResidual = 0;
  }
  // Filet de sécurité : snap au floor (= première tile à ty = SCROLL_TOP_Y). Couvre auto-scroll + molette.
  const floor = minLiveTileY - SCROLL_TOP_Y;
  if (offset < floor) { offset = floor; wheelResidual = 0; }
```

- [ ] **Step 5 : Non-régression + check Chrome**

Run: `npx playwright test --workers=1` → tous PASS.

Check Chrome (`preview_start` puis `preview_eval`) :
- **Fondu au load** : recharger, mesurer `velocity` (l'exposer temporairement via `window.__v = velocity` dans `frame()` n'est PAS requis ; sinon observer que la mosaïque démarre lentement puis accélère). Critère : démarrage doux visible, pas de saut.
- **Molette glissée** : `preview_eval` dispatch d'un `WheelEvent` sur `#viewport` (`deltaY: 300`), puis snapshot/screenshot ~200 ms après → l'offset bouge de façon continue (pas de saut sec). Vérifier que survoler une tuile (`hoverPaused`) n'empêche pas la molette de défiler.
- **Edge** : plusieurs gros `deltaY` négatifs d'affilée → le scroll up clampe au floor sans à-coup ni gap noir.

- [ ] **Step 6 : Commit**

```bash
git -C "<path>" add app.js
git -C "<path>" commit -m "feat(scroll): molette amortie + delta normalisé + fondu de vélocité (#1 #6 #2)"
```

---

## Task 2 : Zone momentum — friction dt + raccord auto-scroll (#3, #7)

**Files:**
- Modify: `app.js` (constantes momentum ~1659-1660 ; `stopMomentum` ~1662-1666 ; `startMomentum` ~1669 ; `step` ~1671-1684)

- [ ] **Step 1 : Deux seuils + commentaire friction**

Modify `app.js` — old:
```js
const MOMENTUM_FRICTION = 0.94;   // décrément par frame ≈16ms (≈0.94^60 ≈ 0.024 en 1s)
const MOMENTUM_MIN_PX_PER_S = 30; // sous ce seuil on arrête
```
new:
```js
const MOMENTUM_FRICTION = 0.94;   // 0,94 par frame @60fps, normalisé par dt dans step() (#3)
const MOMENTUM_START_MIN = 30;    // #7 : vélocité min pour DÉCLENCHER le momentum (sélectif)
const MOMENTUM_STOP_MIN = 8;      // #7 : vélocité d'ARRÊT — éteint quasi à zéro → raccord doux
```

- [ ] **Step 2 : `stopMomentum` pose `velocity = 0`**

Modify `app.js` — old:
```js
function stopMomentum() {
  if (momentumRaf) cancelAnimationFrame(momentumRaf);
  momentumRaf = null;
  touchVelocity = 0;
}
```
new:
```js
function stopMomentum() {
  if (momentumRaf) cancelAnimationFrame(momentumRaf);
  momentumRaf = null;
  touchVelocity = 0;
  velocity = 0; // #7 : l'auto-scroll reprend en fondu via le ramp #2
}
```

- [ ] **Step 3 : `startMomentum` utilise le seuil de déclenchement**

Modify `app.js` — old:
```js
  if (Math.abs(touchVelocity) < MOMENTUM_MIN_PX_PER_S) return;
```
new:
```js
  if (Math.abs(touchVelocity) < MOMENTUM_START_MIN) return; // #7 : déclenchement sélectif
```

- [ ] **Step 4 : `step` — clamp dt + friction normalisée + seuil d'arrêt**

Modify `app.js` — old:
```js
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
```
new:
```js
  function step(now) {
    const dt = Math.min((now - lastT) / 1000, 0.1); // #3 : clamp dt (cohérence frame())
    lastT = now;
    offset += touchVelocity * dt;
    const floor = minLiveTileY - SCROLL_TOP_Y;
    if (offset < floor) { offset = floor; stopMomentum(); return; }
    touchVelocity *= Math.pow(MOMENTUM_FRICTION, dt * 60); // #3 : friction frame-rate-independent
    if (Math.abs(touchVelocity) > MOMENTUM_STOP_MIN) {     // #7 : seuil d'arrêt bas → raccord doux
      momentumRaf = requestAnimationFrame(step);
    } else {
      stopMomentum();
    }
  }
```

- [ ] **Step 5 : Non-régression + check Chrome (émulation tactile)**

Run: `npx playwright test --workers=1` → tous PASS.

Check Chrome : `preview_resize` mobile, simuler `touchstart`/`touchmove`/`touchend` (swipe vers le haut) via `preview_eval`, observer le momentum décélérer en douceur et se raccorder à l'auto-scroll **sans à-coup** (la vitesse ne chute pas brusquement). Vérifier qu'un tap quasi-immobile ne déclenche **pas** de dérive (seuil de déclenchement = 30).

- [ ] **Step 6 : Commit**

```bash
git -C "<path>" add app.js
git -C "<path>" commit -m "feat(momentum): friction normalisée dt + raccord doux à l'auto-scroll (#3 #7)"
```

---

## Task 3 : Zone tick/curseur — glow normalisé par dt (#8)

**Files:**
- Modify: `app.js` (constante glow ~1204 ; `tick()` ~1228-1241 ; `mouseenter` reset ~1262)

- [ ] **Step 1 : Constante en demi-vie**

Modify `app.js` — old:
```js
// Smoothing du trail : par frame (≈60fps), current += (target - current) * SMOOTH.
// 0.08 ≈ 400ms pour rattraper 98% du chemin → trail traînant, plus marqué.
const CURSOR_LIGHT_SMOOTH = 0.08;
```
new:
```js
// Smoothing du trail, frame-rate-independent (damp exponentiel). Demi-vie en secondes.
// 0.14 reproduit l'ancien 0.08/frame @60fps (0.92^n = 0.5 ⟹ n ≈ 8,3 frames ≈ 0,14 s).
const GLOW_HALFLIFE = 0.14;
```

- [ ] **Step 2 : `tick(now)` avec dt + damp**

Modify `app.js` — old:
```js
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
```
new:
```js
  let lastTickT = 0;
  function tick(now) {
    const dt = lastTickT ? Math.min((now - lastTickT) / 1000, 0.1) : 1 / 60;
    lastTickT = now;
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    currentX = damp(currentX, targetX, GLOW_HALFLIFE, dt);
    currentY = damp(currentY, targetY, GLOW_HALFLIFE, dt);
    inner.style.setProperty('--gx', (currentX * 100) + '%');
    inner.style.setProperty('--gy', (currentY * 100) + '%');
    // Tant qu'on est en survol OU qu'il reste un delta à rattraper, on continue.
    if (active || Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }
```

- [ ] **Step 3 : Reset `lastTickT` au `mouseenter`**

Modify `app.js` — old:
```js
    active = true;
    if (rafId === null) rafId = requestAnimationFrame(tick);
  });
```
new:
```js
    active = true;
    lastTickT = 0; // #8 : reset dt → pas de grand saut après une pause du tick
    if (rafId === null) rafId = requestAnimationFrame(tick);
  });
```

- [ ] **Step 4 : Non-régression + check Chrome**

Run: `npx playwright test --workers=1` → tous PASS.

Check Chrome : survoler une tuile, bouger la souris ; le halo (`--gx/--gy`) suit avec le même traînage qu'avant (≈0,14 s), sans saccade. Vérifier qu'au ré-survol après une pause il n'y a pas de saut brusque du halo.

- [ ] **Step 5 : Commit**

```bash
git -C "<path>" add app.js
git -C "<path>" commit -m "feat(glow): trail curseur normalisé par dt (#8)"
```

---

## Task 4 : CSS — durée du tilt 1,2 s → 0,6 s (#5)

**Files:**
- Modify: `styles.css:371`

- [ ] **Step 1 : Réduire la transition `.tile-frame`**

Modify `styles.css` — old:
```css
  transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
```
new:
```css
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
```

- [ ] **Step 2 : Non-régression + check Chrome**

Run: `npx playwright test --workers=1` → tous PASS (aucun test n'assert cette durée).

Check Chrome : survoler une tuile et bouger la souris ; le tilt suit le curseur de plus près (0,6 s) ; le lift d'entrée et le retour au `mouseleave` sont aussi plus rapides (couplage assumé). Comparer au ressenti voulu (« proposé » de la démo).

- [ ] **Step 3 : Commit**

```bash
git -C "<path>" add styles.css
git -C "<path>" commit -m "tune(tilt): durée de transition 1,2s -> 0,6s (#5)"
```

---

## Task 5 : Vérification globale + cache-busting

**Files:**
- Modify: `index.html` (bump `?v=`)

- [ ] **Step 1 : Suite complète**

Run: `npx playwright test --workers=1`
Expected: tous PASS (smoke, bio, lock, mobile, squash, smoothing).

- [ ] **Step 2 : Bump cache-busting**

Modify `index.html` — incrémenter les deux versions :
- old: `<link rel="stylesheet" href="styles.css?v=53">` → new: `href="styles.css?v=54"`
- old: `<script type="module" src="app.js?v=145"></script>` → new: `src="app.js?v=146"`

- [ ] **Step 3 : Vérif Chrome — golden path + edge**

`preview_start` (config `portfolio-mosaique`, `autoPort` actif). Vérifier en une passe :
- **Molette** : défilement glissé sans saut ; molette en survol de tuile défile bien.
- **Load** : fondu d'entrée de l'auto-scroll (0 → 30 px/s).
- **Tilt** : 0,6 s, plus présent.
- **Glow** : traînage inchangé, sans saccade.
- **Mobile** (`preview_resize` mobile) : swipe + momentum doux, raccord sans à-coup.
- **Edge** : molette rapide à fond → clamp floor sans gap noir ni NaN.
- `preview_screenshot` pour archive.

- [ ] **Step 4 : Commit**

```bash
git -C "<path>" add index.html
git -C "<path>" commit -m "chore: bump cache-busting (?v) après lissage de vitesse"
```

---

## Couverture spec (self-review)

| Patch spec | Task | Statut |
|---|---|---|
| #4 socle `damp()` | Task 0 | ✓ + test |
| #1 molette amortie | Task 1 | ✓ |
| #6 delta normalisé | Task 1 | ✓ |
| #2 ramp de vélocité | Task 1 | ✓ |
| #3 friction dt | Task 2 | ✓ |
| #7 raccord momentum | Task 2 | ✓ |
| #8 glow dt | Task 3 | ✓ |
| #5 tilt 0,6 s | Task 4 | ✓ |
| Garde-fous / reduced-motion | préservés (velocityTarget=0 ; tilt/glow déjà court-circuités) |
| Cache-bust + vérif globale | Task 5 | ✓ |
