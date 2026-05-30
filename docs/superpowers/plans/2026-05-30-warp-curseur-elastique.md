# Warp squash-stretch + curseur élastique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au portfolio une matière élastique cohérente — les tuiles s'étirent à la vitesse du scroll, le curseur s'étire au geste et porte un glyphe contextuel.

**Architecture:** Une couche de vélocité partagée (`modules/velocity.js`) alimente le warp composé dans `frame()` (scale sur `.tile`). Le curseur est extrait dans `modules/cursor.js` (lerp de position + étirement directionnel + glyphe par délégation `data-cursor`). 100 % CSS/JS vanilla, aucun ajout de dépendance. Orthogonal au voile coloré du focus (commit `5083a08`).

**Tech Stack:** HTML/CSS/JS ESM, esbuild (build), Playwright (tests, `workers=1` en CI), Lighthouse CI.

**Spec source:** `docs/superpowers/specs/2026-05-30-warp-curseur-elastique-design.md`

---

## File Structure

| Fichier | Rôle |
|---|---|
| 🆕 `modules/velocity.js` | Tracker de vélocité de scroll lissée (source unique du warp). Pur, sans DOM. |
| 🆕 `modules/cursor.js` | Curseur : possède `#cursor`, élasticité (lerp + étirement) + glyphe contextuel par délégation. |
| ✏️ `app.js` | `frame()` compose le warp + skip-write corrigé ; `reset()` du tracker aux discontinuités ; `data-cursor` (mosaïque + focus) ; délègue le curseur à `cursor.js` ; `attachTilt` perd la gestion `locked` (garde `hoverPaused`). |
| ✏️ `styles.css` | `transform-origin: center` sur `.tile` ; `#cursor.has-glyph` (disque blanc/glyphe noir) ; `reduced-motion` warp ; bump `?v=`. |
| ✏️ `index.html` | Bump cache-buster `?v=` (assets). |
| 🆕 `tests/velocity.spec.js` | Unitaire du tracker (via import dans la page). |
| 🆕 `tests/warp.spec.js` | E2E warp mosaïque (scale au wheel, retour à 1, reduced-motion). |
| 🆕 `tests/cursor.spec.js` | E2E curseur (glyphe `+`, focus `⭠/⭢`, reduced-motion). |

**Convention de test (existante, à suivre)** : `import { test, expect } from '@playwright/test';`, `await page.goto('/')`, `baseURL` = `http://localhost:8771`, dev server auto (`python3 -m http.server 8771`). Lancer un fichier : `npx playwright test tests/<f>.spec.js --workers=1`.

**Découpage v1 vs phase 2** : Tasks 1→7 + 10 = livraison v1 (warp mosaïque + curseur complet). Tasks 8 (warp focus horizontal) et 9 (overshoot/rebond) sont **optionnelles**, à décider avec l'utilisateur (cf. spec §5 : warp focus = candidat phase 2).

---

## Task 1: Module `velocity.js` (tracker de vélocité lissée)

**Files:**
- Create: `modules/velocity.js`
- Test: `tests/velocity.spec.js`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/velocity.spec.js` :

```js
// @ts-check
import { test, expect } from '@playwright/test';

// Le tracker est un module pur : on l'importe dans le contexte de la page (servi en statique).
test.describe('velocity tracker', () => {
  test('au repos / petit mouvement : normalized = 0 sous vMin', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);            // init (pas de delta)
      t.sample(2, 0.016);            // +2px en 16ms ≈ 125 px/s < vMin
      return t.normalized();
    });
    expect(n).toBe(0);
  });

  test('mouvement rapide : normalized tend vers 1 (avec clamp)', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);
      t.sample(120, 0.016);          // +120px/16ms = 7500 px/s, clampé → ≥ vMax
      return t.normalized();
    });
    expect(n).toBe(1);
  });

  test('reset() neutralise un saut d’offset (pas de pic)', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);
      t.sample(50, 0.016);           // vélocité non nulle
      t.reset(9000);                 // resync sur une grande valeur (simule resize → offset)
      return t.normalized();         // smooth remis à 0
    });
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx playwright test tests/velocity.spec.js --workers=1`
Expected: FAIL — `Failed to fetch dynamically imported module .../modules/velocity.js` (le fichier n'existe pas).

- [ ] **Step 3: Implémenter le module**

Créer `modules/velocity.js` :

```js
// Tracker de vélocité de scroll lissée — source unique du warp.
// Ne mesure QUE le mouvement réel d'offset (molette + swipe + momentum) ; l'auto-scroll
// lent (~30 px/s) reste sous vMin → normalized() = 0 (net au repos).
// reset() neutralise les discontinuités d'offset (resize → offset=0, retour de focus) :
// sans lui, Δoffset/dt produirait un pic de vélocité parasite → warp violent.

export function createVelocityTracker({ lerp = 0.15, vMin = 200, vMax = 2500 } = {}) {
  let last = null;        // dernier offset échantillonné (null = non initialisé)
  let smooth = 0;         // vélocité lissée, px/s (signée)
  const CLAMP = vMax * 2; // borne dure : absorbe un dt aberrant / un saut d'1 frame

  return {
    // À appeler une fois par frame avec l'offset courant et le dt (s).
    sample(offset, dt) {
      if (last === null || dt <= 0) { last = offset; return smooth; }
      let raw = (offset - last) / dt;
      if (raw > CLAMP) raw = CLAMP;
      else if (raw < -CLAMP) raw = -CLAMP;
      smooth += (raw - smooth) * lerp;
      last = offset;
      return smooth;
    },
    // Vélocité normalisée 0→1 (magnitude), sous vMin = 0, au-dessus de vMax = 1.
    normalized() {
      const a = Math.abs(smooth);
      if (a <= vMin) return 0;
      const n = (a - vMin) / (vMax - vMin);
      return n > 1 ? 1 : n;
    },
    // Resynchronise sans produire de vélocité. Passer l'offset courant (resize/reprise focus).
    reset(offset) {
      smooth = 0;
      last = (offset === undefined ? null : offset);
    },
  };
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx playwright test tests/velocity.spec.js --workers=1`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add modules/velocity.js tests/velocity.spec.js
git commit -m "feat(warp): module velocity.js — tracker de vélocité lissée + reset"
```

---

## Task 2: Warp mosaïque dans `frame()` (scale + skip-write corrigé + reset)

**Files:**
- Modify: `app.js` (import en tête ; `frame()` ≈ L1714 ; `rebuildLayout()` ≈ L1833 ; `resumeMosaic()` ≈ L81)
- Modify: `styles.css` (`.tile` ≈ L300)
- Test: `tests/warp.spec.js`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/warp.spec.js` :

```js
// @ts-check
import { test, expect } from '@playwright/test';

function readScale(transform) {
  const m = transform.match(/scale\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  return m ? { sx: parseFloat(m[1]), sy: parseFloat(m[2]) } : { sx: 1, sy: 1 };
}

test.describe('warp mosaïque', () => {
  test('un wheel rapide étire les tuiles (scaleY > 1), puis retour à 1', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor();
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 1800);                 // gros delta → vélocité forte

    // Dans les frames qui suivent, au moins une tuile a un scaleY > 1.
    const stretched = await page.evaluate(() => new Promise((resolve) => {
      let seen = false;
      let n = 0;
      const tick = () => {
        for (const el of document.querySelectorAll('.tile')) {
          const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
          if (m && parseFloat(m[1]) > 1.005) { seen = true; break; }
        }
        if (seen || n++ > 20) resolve(seen); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    expect(stretched).toBe(true);

    // Après stabilisation, le scale revient à ~1 (couvre le bug du skip-write).
    await page.waitForTimeout(800);
    const sy = await page.evaluate(() => {
      const el = document.querySelector('.tile');
      const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    expect(Math.abs(sy - 1)).toBeLessThan(0.012);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx playwright test tests/warp.spec.js --workers=1`
Expected: FAIL — `stretched` reste `false` (aucun scale appliqué).

- [ ] **Step 3: CSS — `transform-origin` sur `.tile`**

Dans `styles.css`, bloc `.tile { ... }` (≈ L300, celui qui contient `will-change: transform;`), ajouter la ligne `transform-origin: center;` :

```css
.tile {
  position: absolute;
  will-change: transform;
  transform-origin: center;   /* warp : le scale s'étire depuis le centre de la tuile */
  user-select: none;
  /* …reste inchangé… */
}
```

- [ ] **Step 4: app.js — import + création du tracker**

En tête de `app.js`, après les imports existants (après la ligne `import { attachLock } from './modules/lock.js';`), ajouter :

```js
import { createVelocityTracker } from './modules/velocity.js';
```

Puis, près de la déclaration de `let offset = 0;` (chercher `let offset = 0;`), ajouter juste après :

```js
// Warp : vélocité de scroll lissée → étirement des tuiles. Constantes douces (spec).
const velocityTracker = createVelocityTracker({ lerp: 0.15, vMin: 200, vMax: 2500 });
const WARP_KY = 0.05;   // étirement vertical max (+5 %)
const WARP_KX = 0.022;  // pincement horizontal max (−2,2 %)
```

- [ ] **Step 5: app.js — échantillonner la vélocité dans `frame()`**

Dans `frame(t)` (≈ L1714), juste après le calcul de l'offset auto-scroll et le clamp au floor (chercher la ligne `if (offset < floor) offset = floor;` qui précède la boucle des tiles), ajouter l'échantillonnage et le calcul du scale :

```js
  // Warp : vélocité lissée → facteur d'étirement n∈[0,1] (REDUCED_MOTION → pas de warp).
  velocityTracker.sample(offset, dt);
  const warpN = REDUCED_MOTION ? 0 : velocityTracker.normalized();
  const warpSY = 1 + warpN * WARP_KY;
  const warpSX = 1 - warpN * WARP_KX;
```

- [ ] **Step 6: app.js — composer le scale + corriger le skip-write**

Toujours dans `frame()`, remplacer le bloc skip-write actuel (≈ L1778) :

```js
    if (tile._lastTy !== ty) {
      tile.el.style.transform = `translate3d(${tile.x}px, ${ty}px, 0)`;
      tile._lastTy = ty;
    }
```

par (écrit si `ty` OU le warp a changé — sinon le scale resterait figé étiré à l'arrêt du scroll, `ty` ne bougeant plus) :

```js
    if (tile._lastTy !== ty || tile._lastWarp !== warpN) {
      tile.el.style.transform =
        `translate3d(${tile.x}px, ${ty}px, 0) scale(${warpSX}, ${warpSY})`;
      tile._lastTy = ty;
      tile._lastWarp = warpN;
    }
```

- [ ] **Step 7: app.js — reset du tracker aux discontinuités d'offset**

Dans `rebuildLayout()` (≈ L1833), juste après la ligne `offset = 0;`, ajouter :

```js
  velocityTracker.reset(0);   // le saut offset→0 du resize ne doit pas produire de pic de warp
```

Dans `resumeMosaic()` (≈ L81), juste après `lastFrameTime = performance.now();`, ajouter :

```js
  velocityTracker.reset(offset);   // reprise mosaïque après focus : pas de faux pic
```

- [ ] **Step 8: Lancer le test pour vérifier qu'il passe**

Run: `npx playwright test tests/warp.spec.js --workers=1`
Expected: PASS.

- [ ] **Step 9: Non-régression rapide**

Run: `npx playwright test tests/smoke.spec.js --workers=1`
Expected: PASS (la mosaïque et la liste client fonctionnent toujours).

- [ ] **Step 10: Commit**

```bash
git add app.js styles.css tests/warp.spec.js
git commit -m "feat(warp): étirement des tuiles à la vélocité de scroll (mosaïque) + skip-write n"
```

---

## Task 3: `reduced-motion` — warp neutralisé (test de garantie)

**Files:**
- Test: `tests/warp.spec.js` (ajout)
- (Aucune modif code : `frame()` met déjà `warpN = 0` si `REDUCED_MOTION`, cf. Task 2 Step 5.)

- [ ] **Step 1: Écrire le test qui échoue (puis passe sans code)**

Ajouter dans `tests/warp.spec.js`, à l'intérieur du `describe` :

```js
  test('reduced-motion : aucun étirement même au wheel rapide', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.locator('.tile').first().waitFor();
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 1800);
    const maxSy = await page.evaluate(() => new Promise((resolve) => {
      let mx = 1, n = 0;
      const tick = () => {
        for (const el of document.querySelectorAll('.tile')) {
          const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
          if (m) mx = Math.max(mx, parseFloat(m[1]));
        }
        if (n++ > 20) resolve(mx); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await ctx.close();
    expect(maxSy).toBeLessThan(1.005);
  });
```

- [ ] **Step 2: Lancer le test**

Run: `npx playwright test tests/warp.spec.js --workers=1`
Expected: PASS (le code de Task 2 force déjà `warpN = 0` en reduced-motion ; aucune tuile n'a de `scale(...)` ≠ 1, donc `maxSy` reste à 1).

> Si ce test échoue, c'est que `frame()` applique un scale malgré `REDUCED_MOTION` — revérifier le Step 5 de Task 2.

- [ ] **Step 3: Commit**

```bash
git add tests/warp.spec.js
git commit -m "test(warp): garantit l'absence de warp en reduced-motion"
```

---

## Task 4: Module `cursor.js` — élasticité + extraction depuis `app.js`

**Files:**
- Create: `modules/cursor.js`
- Modify: `app.js` (mousemove ≈ L1182 ; appel `initCursor` ; import en tête)
- Test: `tests/cursor.spec.js`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/cursor.spec.js` :

```js
// @ts-check
import { test, expect } from '@playwright/test';

test.describe('curseur élastique', () => {
  test('le rond suit la souris avec inertie (lerp), pas en téléportation', async ({ page }) => {
    await page.goto('/');
    await page.mouse.move(100, 100);
    await page.waitForTimeout(250);                 // laisse le rond rattraper
    await page.mouse.move(900, 600);                // grand saut
    // Juste après le saut, le rond ne doit PAS être déjà arrivé (inertie).
    const lag = await page.evaluate(() => {
      const cur = document.getElementById('cursor');
      const tr = cur.style.transform;
      const m = tr.match(/translate\(\s*([\d.]+)px/);
      return m ? parseFloat(m[1]) : null;
    });
    expect(lag).not.toBeNull();
    expect(lag).toBeLessThan(880);                  // pas encore à x≈900 → il traîne
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: FAIL — actuellement `app.js` positionne le curseur **directement** au mousemove (`lag` ≈ 900, pas d'inertie).

- [ ] **Step 3: Implémenter `modules/cursor.js`**

Créer `modules/cursor.js` :

```js
// Curseur élastique + glyphe contextuel. Possède l'élément #cursor.
// - Élasticité : position rattrapée par lerp (inertie) + étirement directionnel (ellipse) ∝ vitesse.
// - Glyphe : délégation — au survol d'un [data-cursor], le rond devient disque blanc à glyphe noir.
// Desktop only (hasHover). reduced-motion : position directe + glyphe, mais pas d'élasticité.

const LERP = 0.2;          // inertie : 0.2 ≈ rattrapage doux
const STRETCH_K = 0.045;   // étirement ∝ vitesse (px/frame)
const STRETCH_MAX = 0.45;  // plafond d'étirement

export function initCursor({ hasHover, reducedMotion }) {
  const cur = document.getElementById('cursor');
  if (!cur || !hasHover) return;   // tactile : pas de curseur (déjà masqué en CSS)

  let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
  let cx = tx, cy = ty;

  window.addEventListener('mousemove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (reducedMotion) {
      // position directe (pas d'inertie), centrée
      cur.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -50%)`;
    }
  });

  // Glyphe contextuel par délégation : suit l'élément [data-cursor] survolé.
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-cursor]');
    setGlyph(el ? el.getAttribute('data-cursor') : '');
  });
  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-cursor]');
    if (!to) setGlyph('');
  });

  function setGlyph(g) {
    if (g) { cur.textContent = g; cur.classList.add('has-glyph'); }
    else { cur.textContent = ''; cur.classList.remove('has-glyph'); }
  }

  if (reducedMotion) return;   // pas de boucle d'élasticité

  function tick() {
    const px = cx, py = cy;
    cx += (tx - cx) * LERP;
    cy += (ty - cy) * LERP;
    const vx = cx - px, vy = cy - py;
    const st = Math.min(Math.hypot(vx, vy) * STRETCH_K, STRETCH_MAX);
    const ang = Math.atan2(vy, vx);
    cur.style.transform =
      `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${ang}rad) scale(${1 + st}, ${1 - st * 0.6})`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
```

- [ ] **Step 4: app.js — importer et brancher `initCursor`, retirer le positionnement direct**

En tête de `app.js`, ajouter l'import (sous les autres) :

```js
import { initCursor } from './modules/cursor.js';
```

Dans le listener `window.addEventListener('mousemove', ...)` (≈ L1182), **retirer** la ligne qui positionne le curseur (le transform passe sous `cursor.js`). Avant :

```js
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursorDirty = true;
  // Transform = compositing GPU pur (pas de layout). translate(-50%, -50%) centre le rond.
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
});
```

Après (on garde `mouseX/mouseY/cursorDirty` pour le contour lumineux `--cursor-x/y` ; `cursor.js` gère désormais le transform de `#cursor`) :

```js
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursorDirty = true;
});
```

Puis, à la fin du fichier (après l'appel `init();`), brancher le curseur :

```js
initCursor({ hasHover: HAS_HOVER, reducedMotion: REDUCED_MOTION });
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: PASS (le rond traîne derrière le saut → `lag < 880`).

- [ ] **Step 6: Commit**

```bash
git add modules/cursor.js app.js tests/cursor.spec.js
git commit -m "feat(cursor): module cursor.js — curseur élastique (lerp + étirement), extrait d'app.js"
```

---

## Task 5: Glyphe `+` en mosaïque (style disque blanc/glyphe noir + retrait du `locked`)

**Files:**
- Modify: `app.js` (`createTile` ≈ L1301 ; `attachTilt` ≈ L1194, L1203-1204, L1236, L1287)
- Modify: `styles.css` (`#cursor` ≈ L250, `#cursor.locked` ≈ L269)
- Test: `tests/cursor.spec.js` (ajout)

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `tests/cursor.spec.js` :

```js
  test('survol d’une maquette : data-cursor="+" et le rond porte le glyphe', async ({ page }) => {
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await expect(inner).toHaveAttribute('data-cursor', '+');
    await inner.hover();
    await expect(page.locator('#cursor')).toHaveClass(/has-glyph/);
    await expect(page.locator('#cursor')).toHaveText('+');
  });
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: FAIL — `.tile-inner` n'a pas d'attribut `data-cursor`.

- [ ] **Step 3: app.js — poser `data-cursor="+"` sur chaque `.tile-inner`**

Dans `createTile()` (≈ L1301), juste après la création de `inner` (chercher `const inner = document.createElement('div'); inner.className = 'tile-inner';`), ajouter :

```js
  inner.dataset.cursor = '+';   // glyphe curseur en mosaïque (ouvrir)
```

- [ ] **Step 4: app.js — `attachTilt` ne gère plus `locked` (garde `hoverPaused`)**

Dans `attachTilt()` (≈ L1194), **supprimer** les 3 manipulations de `cursorEl.classList` (désormais gérées par `cursor.js` via `data-cursor`) :

Branche reduced-motion (≈ L1203-1204) — supprimer ces deux lignes :

```js
    inner.addEventListener('mouseenter', () => cursorEl.classList.add('locked'));
    inner.addEventListener('mouseleave', () => cursorEl.classList.remove('locked'));
```

Le `return;` reduced-motion qui suivait reste. (La branche reduced-motion d'`attachTilt` ne fait alors plus rien d'utile pour le curseur ; le glyphe est pris en charge par la délégation de `cursor.js`, qui marche aussi en reduced-motion.)

Dans la branche normale, au `mouseenter` (≈ L1236), supprimer la ligne :

```js
    cursorEl.classList.add('locked');
```

(garder `hoverPaused = true;` et le reste juste en dessous.)

Au `mouseleave` (≈ L1287), supprimer la ligne :

```js
    cursorEl.classList.remove('locked');
```

(garder `hoverPaused = false;` et le reste.)

- [ ] **Step 5: styles.css — disque blanc / glyphe noir (remplace `.locked`)**

Dans `styles.css`, ajouter au bloc `#cursor` (≈ L250) les propriétés de centrage du glyphe (flex), sans toucher au reste :

```css
#cursor {
  /* …propriétés existantes… */
  display: flex;
  align-items: center;
  justify-content: center;
  font: 600 15px/1 -apple-system, system-ui, sans-serif;
  color: #000;
}
```

Remplacer la règle `#cursor.locked { … }` (≈ L269) par :

```css
/* Survol d'une zone à glyphe (data-cursor) : disque blanc plein, glyphe noir. */
#cursor.has-glyph {
  width: 26px;
  height: 26px;
  background: #fff;
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: PASS.

- [ ] **Step 7: Non-régression curseur/lock**

Run: `npx playwright test tests/lock.spec.js tests/smoke.spec.js --workers=1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app.js styles.css tests/cursor.spec.js
git commit -m "feat(cursor): glyphe '+' en mosaïque (disque blanc/glyphe noir), remplace l'état locked"
```

---

## Task 6: Glyphes `⭠/⭢` en focus + override/restore du `+`

**Files:**
- Modify: `app.js` (`focusTile` ≈ L185 ; `advance` ≈ L408 ; `retreat` ≈ L478 ; `loopToStart` ≈ L382 ; `exitFocus` ≈ L607)
- Test: `tests/cursor.spec.js` (ajout)

**Logique** : tous les slots de `pastSlots` → `data-cursor="⭠"` (clic = retreat), tous ceux de `focusList` → `data-cursor="⭢"` (clic = advance, y compris la cliquée `focusList[0]`). À recalculer après chaque navigation. Le `data-cursor` est posé sur le `.tile-inner` de chaque slot (les clones en héritent `"+"` par `cloneNode` → on l'écrase). À la sortie, on restaure `"+"` sur les `.tile-inner` des slots **non-clones** (les clones sont retirés du DOM).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `tests/cursor.spec.js` :

```js
  test('en focus : la cliquée porte ⭢, retour à + après sortie', async ({ page }) => {
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await inner.click();                                  // entre en focus
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'focus');
    // La tuile cliquée (source, non-clone) porte maintenant ⭢.
    await expect(page.locator('.tile.is-focused-tile .tile-inner')).toHaveAttribute('data-cursor', '⭢');
    await page.keyboard.press('Escape');                 // sortie focus
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
    // Restauration du + sur la tuile source.
    await expect(page.locator('.tile.is-focused-tile')).toHaveCount(0);
  });
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: FAIL — la cliquée garde `data-cursor="+"` (pas de logique focus).

- [ ] **Step 3: app.js — helper `updateFocusGlyphs()`**

Ajouter dans `app.js`, juste avant `function focusTile(` (≈ L185) :

```js
// Glyphe curseur en focus : pastSlots (à gauche, clic = recule) → ⭠ ; focusList (cliquée + droite,
// clic = avance) → ⭢. Posé sur le .tile-inner de chaque slot (écrase le "+" hérité des clones).
function updateFocusGlyphs() {
  for (const slot of pastSlots) {
    slot.el.querySelector('.tile-inner')?.setAttribute('data-cursor', '⭠');
  }
  for (const slot of focusList) {
    slot.el.querySelector('.tile-inner')?.setAttribute('data-cursor', '⭢');
  }
}
```

- [ ] **Step 4: app.js — appeler `updateFocusGlyphs()` à la construction et à chaque navigation**

Dans `focusTile()`, juste après la ligne `pastSlots = leftSlots.slice().reverse();` et **avant** `applyBackdrop(focusList[0].item);` (≈ L350-351) :

```js
  updateFocusGlyphs();
```

Dans `advance()` : à la toute fin de la fonction, juste avant la fermeture (après le bloc `pendingAdvanceCleanup = setTimeout(...)`), ajouter `updateFocusGlyphs();`.

Dans `retreat()` : de même, juste avant `pendingRetreatCleanup = setTimeout(...)` (après la mise à jour de `focusedTile`/label), ajouter `updateFocusGlyphs();`.

Dans `loopToStart()` : après la boucle qui ré-empile `focusList` et met à jour le label (avant le `setTimeout` final), ajouter `updateFocusGlyphs();`.

- [ ] **Step 5: app.js — restaurer `+` à la sortie**

Dans `exitFocus()` (≈ L607), dans la closure `phase3b` (celle qui fait `for (const el of focusedEls) el.classList.remove('is-focused-tile');`), ajouter la restauration du glyphe sur les éléments sources non-clones :

```js
    for (const el of focusedEls) el.querySelector?.('.tile-inner')?.setAttribute('data-cursor', '+');
    for (const el of pastFocusedEls) el.querySelector?.('.tile-inner')?.setAttribute('data-cursor', '+');
```

(à placer à côté des `el.classList.remove('is-focused-tile')` existants ; `focusedEls`/`pastFocusedEls` sont déjà les snapshots des slots non-clones.)

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: PASS.

- [ ] **Step 7: Non-régression focus (clics maquette, advance/retreat, voile)**

Run: `npx playwright test --workers=1`
Expected: PASS (toute la suite — focus mode et voile intacts).

- [ ] **Step 8: Commit**

```bash
git add app.js tests/cursor.spec.js
git commit -m "feat(cursor): glyphes ⭠/⭢ en focus + restauration du + à la sortie"
```

---

## Task 7: `reduced-motion` curseur (position directe, glyphe conservé)

**Files:**
- Test: `tests/cursor.spec.js` (ajout)
- (Aucune modif code : `cursor.js` gère déjà `reducedMotion` — position directe au mousemove + glyphe par délégation, pas de boucle d'élasticité, cf. Task 4.)

- [ ] **Step 1: Écrire le test**

Ajouter dans `tests/cursor.spec.js` :

```js
  test('reduced-motion : glyphe conservé, mais pas d’étirement (pas de rotate/scale)', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await inner.hover();
    await expect(page.locator('#cursor')).toHaveText('+');           // glyphe conservé
    const tr = await page.evaluate(() => document.getElementById('cursor').style.transform);
    expect(tr).not.toContain('rotate');                              // pas d'élasticité
    expect(tr).not.toContain('scale');
    await ctx.close();
  });
```

- [ ] **Step 2: Lancer le test**

Run: `npx playwright test tests/cursor.spec.js --workers=1`
Expected: PASS (en reduced-motion, `cursor.js` n'écrit qu'un `translate(...)`, et le glyphe vient de la délégation).

- [ ] **Step 3: Commit**

```bash
git add tests/cursor.spec.js
git commit -m "test(cursor): garantit glyphe sans élasticité en reduced-motion"
```

---

## Task 10: Bump des versions d'assets + suite complète + Lighthouse

> (Tasks 8 et 9 sont optionnelles — voir plus bas. Cette task clôt la v1.)

**Files:**
- Modify: `index.html` (cache-busters `?v=`)

- [ ] **Step 1: Bump des cache-busters**

Dans `index.html`, incrémenter les versions (le voile était à `styles.css?v=43`, `app.js?v=135`) :
- `styles.css?v=43` → `styles.css?v=44`
- `app.js?v=135` → `app.js?v=136`

(Note : le build `scripts/build.js` remplace de toute façon `?v=` par un hash de contenu pour le déploiement ; ce bump ne sert qu'au dev local / cohérence.)

- [ ] **Step 2: Suite Playwright complète**

Run: `npx playwright test --workers=1`
Expected: PASS — toute la suite (smoke, mobile, bio, lock, velocity, warp, cursor).

- [ ] **Step 3: Lighthouse (perf, non-régression)**

Run: `npm run build && npx lhci autorun` *(ou la commande Lighthouse du projet ; cf. `.lighthouserc.json`)*
Expected: budgets respectés. Si la perf mobile régresse à cause du `scale` sur images, baisser `WARP_KY` (Task 2, Step 4) et re-mesurer.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "chore: bump assets v44/v136 (warp + curseur élastique)"
```

---

## Task 8 (OPTIONNELLE — phase 2) : Warp focus horizontal

> À implémenter **seulement** après validation utilisateur (spec §5 : candidat phase 2 — risque sur la chorégraphie du ruban). Cœur v1 = Tasks 1→7,10.

**Files:**
- Modify: `styles.css` (nouvelle `@keyframes` + classe)
- Modify: `app.js` (`advance` ≈ L408, `retreat` ≈ L478 — déclencher la classe sur les `.tile-inner` des slots)

- [ ] **Step 1: CSS — keyframe d'étirement horizontal**

Dans `styles.css`, ajouter :

```css
/* Warp focus : étirement horizontal transitoire du contenu pendant un advance/retreat.
   Sur .tile-inner (transform libre — le tilt est sur .tile-frame, le translate sur .tile). */
@keyframes warp-focus-h {
  0%   { transform: scaleX(1) scaleY(1); }
  45%  { transform: scaleX(1.03) scaleY(0.992); }
  100% { transform: scaleX(1) scaleY(1); }
}
body[data-mode="focus"] .tile-inner.is-warping {
  animation: warp-focus-h 700ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: center;
}
@media (prefers-reduced-motion: reduce) {
  body[data-mode="focus"] .tile-inner.is-warping { animation: none; }
}
```

- [ ] **Step 2: app.js — helper de déclenchement**

Ajouter près d'`updateFocusGlyphs` :

```js
// Warp focus : relance l'anim d'étirement horizontal sur les .tile-inner des slots visibles.
function pulseFocusWarp() {
  if (REDUCED_MOTION) return;
  for (const slot of [...focusList, ...pastSlots]) {
    const el = slot.el.querySelector('.tile-inner');
    if (!el) continue;
    el.classList.remove('is-warping');
    void el.offsetWidth;              // reflow → permet de rejouer l'animation
    el.classList.add('is-warping');
  }
}
```

- [ ] **Step 3: app.js — appeler dans advance/retreat**

Au début de `advance()` et de `retreat()`, juste après le passage `advancing = true;`, appeler `pulseFocusWarp();`.

- [ ] **Step 4: Test de non-régression de la choré**

Run: `npx playwright test --workers=1`
Expected: PASS (advance/retreat/clics maquette toujours fonctionnels — cf. `tests/` focus). Vérifier visuellement (preview) que le ruban n'est pas perturbé.

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "feat(warp): étirement horizontal léger du ruban en focus (phase 2)"
```

---

## Task 9 (OPTIONNELLE — polish) : Overshoot de décélération (rebond squash)

> Fidélité au prototype validé (léger rebond compressé à l'arrêt). Optionnel ; à n'ajouter que si le warp lerp seul manque de « rebond ».

**Files:**
- Modify: `modules/velocity.js` (variante ressort)

- [ ] **Step 1:** Remplacer le lissage lerp par un ressort critique léger dans `sample()` : suivre une cible `target = raw normalisé` avec vitesse `v += (target - smoothPos)·k - v·damping`, ce qui produit un léger dépassement sous 0 à l'arrêt (→ `scaleY < 1` transitoire dans `frame()`). Garder `normalized()`/`reset()`. Re-tester `tests/velocity.spec.js` (adapter les seuils) + `tests/warp.spec.js`.

- [ ] **Step 2: Commit** : `git commit -am "feat(warp): overshoot de décélération (rebond squash)"`

---

## Self-Review (rempli à l'écriture du plan)

**1. Couverture spec :**
- §5 Warp mosaïque (vertical) → Task 2 ✓ ; reset discontinuités → Task 2 Step 7 ✓ ; skip-write `_lastN` → Task 2 Step 6 ✓ ; reduced-motion → Task 3 ✓ ; overshoot → Task 9 (optionnel) ✓.
- §5 Warp focus (horizontal) → Task 8 (phase 2) ✓.
- §6 Curseur élasticité → Task 4 ✓ ; glyphe `+` mosaïque + disque blanc/noir + retrait locked → Task 5 ✓ ; glyphes `⭠/⭢` focus + recalcul + override/restore → Task 6 ✓ ; reduced-motion curseur → Task 7 ✓ ; tactile (no-op) → `cursor.js` garde `if (!hasHover) return` (Task 4) ✓.
- §4 Modules/interfaces (`createVelocityTracker`, `initCursor`) → Tasks 1, 4 ✓.
- §7 Perf (skip-write) → Task 2 ✓. §8 a11y → Tasks 3, 7 ✓. §9 Tests → fichiers de test à chaque task ✓. §10 calibration seuils → Task 2 Step 4 (constantes en tête, tunables) + note Lighthouse Task 10 ✓.
- §13 Coexistence voile → Task 6 préserve `applyBackdrop`/`resetBackdrop` (on insère `updateFocusGlyphs()` à côté, sans les retirer) ✓.

**2. Placeholders :** aucun « TBD »/« etc. » dans les steps de code (Tasks 1-7,10) ; Tasks 8-9 explicitement marquées optionnelles avec code/approche fournis.

**3. Cohérence des types/noms :** `createVelocityTracker` / `velocityTracker.sample|normalized|reset` cohérents (Tasks 1↔2) ; `initCursor({hasHover, reducedMotion})` (Task 4) ; `data-cursor` toujours sur `.tile-inner` (Tasks 5↔6) ; `has-glyph` (Task 4 setGlyph ↔ Task 5 CSS) ; `_lastWarp`/`warpN` (Task 2) ; `updateFocusGlyphs`/`pulseFocusWarp` (Tasks 6, 8).
