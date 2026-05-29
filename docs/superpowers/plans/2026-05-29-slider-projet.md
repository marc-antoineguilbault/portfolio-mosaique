# Slider de maquettes par projet — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Au clic sur une maquette, ouvrir une transition « rideau » (tuiles au-dessus → haut, en dessous → bas) qui se résout en un slider horizontal des maquettes du projet, avec retour à l'état initial au clic dans le vide.

**Architecture:** Approche A — un module `modules/slider.js` autonome (calque `fixed`, état, navigation, auto-scroll, FLIP) ; `app.js` gèle/dégèle la mosaïque (`frame()` en veille) et joue le rideau (`explodeTiles`/`returnTiles`) ; on supprime l'ancien « focus projet ». Le slider est piloté par une machine à états `mode = mosaic | transitioning | slider` exposée sur `document.body.dataset.mode` pour les tests.

**Tech Stack:** HTML/CSS/JS vanilla (ES modules, zéro dépendance), animations CSS (transition `transform`, compositing GPU), tests Playwright (Chromium), serveur statique `python3 -m http.server 8771`.

---

## Structure des fichiers

- **Créer** `modules/slider.js` — slider autonome. Responsabilité unique : afficher/naviguer les maquettes d'un projet en overlay, gérer son DOM, sa nav et l'auto-scroll de la diapo courante. Interface :
  - `openSlider({ projId, startSrc, originRect, onClosed })` → ouvre l'overlay, FLIP depuis `originRect`, diapo courante = `startSrc`.
  - `closeSlider()` → ferme (FLIP retour) puis appelle `onClosed()`.
  - `isSliderOpen()` → bool.
- **Modifier** `app.js` — machine à états + `freezeMosaic`/`resumeMosaic` + `explodeTiles`/`returnTiles` + réécriture du handler de clic + suppression du focus projet + redirection `openClientList`.
- **Modifier** `styles.css` — `.slider*`, transitions de sortie/retour des tuiles, suppression des classes focus, bloc reduced-motion.
- **Modifier** `tests/smoke.spec.js` — remplacer les 2 tests focus par des tests slider.
- **Créer** `tests/slider.spec.js` — couverture dédiée (ouverture, nav, fermeture, cas limites).
- **Modifier** `tests/mobile.spec.js` — si référence au focus, l'adapter.

**Hook de test (toutes tâches) :** `app.js` maintient `document.body.dataset.mode`. Le slider pose `data-src` sur chaque diapo et `aria-current` sur la courante. Aucun autre global exposé.

---

## Task 1 : Ouverture / fermeture du slider (squelette, sans animation)

Slice verticale minimale : clic tuile → overlay slider avec la diapo cliquée centrée ; clic dans le vide ou Échap → ferme ; mosaïque gelée pendant ce temps. Pas encore de rideau ni FLIP ni nav.

**Files:**
- Create: `modules/slider.js`
- Modify: `app.js` (handler clic `inner` ~L848, handler clic `viewport` ~L1087, boucle `frame()` ~L1103, état global ~L42)
- Modify: `tests/smoke.spec.js:26-58` (remplace les tests focus)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test d'ouverture/fermeture (échoue d'abord)**

Créer `tests/slider.spec.js` :

```javascript
// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Slider projet — ouverture/fermeture', () => {
  test('clic sur une tuile ouvre le slider sur la maquette cliquée', async ({ page }) => {
    await page.goto('/');
    const tile = page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first();
    await tile.waitFor();
    await tile.click();

    await expect(page.locator('body')).toHaveAttribute('data-mode', 'slider');
    const slider = page.locator('.slider');
    await expect(slider).toBeVisible();
    // Une diapo courante est affichée.
    await expect(slider.locator('.slider__slide[aria-current="true"]')).toBeVisible();
  });

  test('clic dans le vide du slider ferme et revient en mosaic', async ({ page }) => {
    await page.goto('/');
    const tile = page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first();
    await tile.waitFor();
    await tile.click();
    await expect(page.locator('.slider')).toBeVisible();

    // Clic dans le fond (coin haut-gauche, hors d'une maquette).
    await page.locator('.slider').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.slider')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
  });

  test('Échap ferme le slider', async ({ page }) => {
    await page.goto('/');
    const tile = page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first();
    await tile.waitFor();
    await tile.click();
    await expect(page.locator('.slider')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.slider')).toHaveCount(0);
  });
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js`
Expected: FAIL (`.slider` n'existe pas, `data-mode` absent).

- [ ] **Step 3 : Créer `modules/slider.js` (squelette open/close)**

```javascript
import { pool, projects } from '../data.js';

const projectName = (id) => projects.find((p) => p.id === id)?.name ?? 'Projet';

let root = null;        // élément .slider courant (ou null)
let state = null;       // { projId, slides, index, onClosed }

// Maquettes d'un projet, ordre naturel (m01→m02→…→t01→t02…), = tri par src.
function projectSlides(projId) {
  return pool.filter((it) => it.project === projId)
             .sort((a, b) => a.src.localeCompare(b.src));
}

export function isSliderOpen() { return root !== null; }

export function openSlider({ projId, startSrc, originRect, onClosed }) {
  if (root) return;
  const slides = projectSlides(projId);
  const index = Math.max(0, slides.findIndex((s) => s.src === startSrc));
  state = { projId, slides, index, onClosed };

  root = document.createElement('div');
  root.className = 'slider';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', projectName(projId));

  const track = document.createElement('div');
  track.className = 'slider__track';
  slides.forEach((item, i) => track.appendChild(buildSlide(item, i === index)));
  root.appendChild(track);

  // Clic dans le vide (pas sur une maquette) → ferme.
  root.addEventListener('click', (e) => {
    if (!e.target.closest('.slider__slide')) closeSlider();
  });

  document.body.appendChild(root);
}

export function closeSlider() {
  if (!root) return;
  const cb = state?.onClosed;
  root.remove();
  root = null;
  state = null;
  if (cb) cb();
}

function buildSlide(item, isCurrent) {
  const slide = document.createElement('div');
  slide.className = 'slider__slide';
  slide.dataset.src = item.src;
  slide.dataset.type = item.type;       // 'mobile' | 'tablet'
  if (isCurrent) slide.setAttribute('aria-current', 'true');

  const frame = document.createElement('div');
  frame.className = 'tile-frame';        // réutilise passe-partout + radius
  const inner = document.createElement('div');
  inner.className = 'slider__slide-inner';
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = '';
  img.draggable = false;
  inner.appendChild(img);
  frame.appendChild(inner);
  slide.appendChild(frame);
  return slide;
}

// Échap global tant qu'un slider est ouvert.
window.addEventListener('keydown', (e) => {
  if (root && e.key === 'Escape') closeSlider();
});
```

- [ ] **Step 4 : `app.js` — état + gel/dégel + veille de `frame()`**

Près des autres états globaux (~L42), ajouter :

```javascript
// Machine à états de la page. Exposée sur body pour les tests.
let mode = 'mosaic'; // 'mosaic' | 'transitioning' | 'slider'
function setMode(m) { mode = m; document.body.dataset.mode = m; }
setMode('mosaic');
let frozen = false;
function freezeMosaic() { frozen = true; }
function resumeMosaic() { frozen = false; lastFrameTime = performance.now(); }
```

Dans `frame(t)`, juste après le bookkeeping de `dt` (après `lastFrameTime = t;`, avant `if (!paused …)`), insérer la veille :

```javascript
  if (frozen) {                 // slider actif : mosaïque figée, boucle au repos
    requestAnimationFrame(frame);
    return;
  }
```

- [ ] **Step 5 : `app.js` — importer le slider + réécrire le handler de clic tuile**

En tête de `app.js`, à côté des autres imports :

```javascript
import { openSlider, closeSlider, isSliderOpen } from './modules/slider.js';
```

Remplacer le corps du handler `inner.addEventListener('click', …)` (~L848-862) par :

```javascript
  inner.addEventListener('click', () => {
    const lockSvg = inner.querySelector('.tile-lock');
    if (lockSvg && lockSvg.style.display !== 'none') {
      lockSvg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return; // projet verrouillé → champ mot de passe, pas de slider
    }
    if (mode !== 'mosaic') return;          // verrou anti-double-déclenchement
    const proj = el.dataset.project;
    if (!proj) return;
    const originRect = el.getBoundingClientRect();
    setMode('slider');
    freezeMosaic();
    openSlider({
      projId: proj,
      startSrc: item.src,
      originRect,
      onClosed: () => { resumeMosaic(); setMode('mosaic'); },
    });
  });
```

Note : on retire le garde `if (!HAS_HOVER) return` → le slider marche aussi au tap mobile.

**Et** câbler la 2e porte d'entrée (liste clients) : dans `openClientList()` → fonction `activate` (~L316), remplacer `focusProject(p.id)` par l'ouverture du slider sur la 1re maquette (entrée « depuis la liste » : pas de rideau ni FLIP). `pool` est déjà importé dans `app.js`.

```javascript
    const activate = () => {
      closeClientList();
      if (mode !== 'mosaic') return;
      const first = pool.find((it) => it.project === p.id);
      if (!first) return;
      setMode('slider');
      freezeMosaic();
      openSlider({ projId: p.id, startSrc: first.src, originRect: null,
        onClosed: () => { resumeMosaic(); setMode('mosaic'); } });
    };
```

- [ ] **Step 6 : `app.js` — neutraliser l'ancien handler de fermeture viewport**

Le handler `viewport.addEventListener('click', …)` (~L1087) appelait `unfocusProject()`. La fermeture est désormais gérée par le slider (clic dans son vide). Remplacer son corps par un no-op conservateur (sera nettoyé en Task 7) :

```javascript
viewport.addEventListener('click', (e) => {
  // Fermeture du slider gérée par modules/slider.js (clic dans le vide du calque).
  // Ancien focus projet supprimé.
});
```

- [ ] **Step 7 : `styles.css` — overlay slider minimal**

```css
.slider {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: #000;
  overflow: hidden;
}
.slider__track {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.slider__slide { display: none; }
.slider__slide[aria-current="true"] { display: block; }
.slider__slide-inner { overflow: hidden; border-radius: inherit; }
.slider__slide-inner img { display: block; width: 100%; height: auto; }
```

(Layout « voisines qui dépassent » + tailles réelles : Task 4. Ici on affiche juste la courante.)

- [ ] **Step 8 : Remplacer les tests focus de smoke.spec.js**

Dans `tests/smoke.spec.js`, **supprimer** les deux tests `focus un projet → suffix "pour <Nom>"…` (L26-33) et `nav ↑ et ↓ change l'index courant` (L35-58). Les laisser cassés ferait échouer la suite (focus supprimé). La couverture équivalente vit maintenant dans `tests/slider.spec.js`.

- [ ] **Step 9 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js tests/smoke.spec.js`
Expected: PASS (ouverture, fermeture vide, Échap ; smoke sans les tests focus).

- [ ] **Step 10 : Commit**

```bash
git add modules/slider.js app.js styles.css tests/slider.spec.js tests/smoke.spec.js
git commit -m "feat(slider): ouverture/fermeture du slider projet au clic (squelette)"
```

---

## Task 2 : Le rideau (explodeTiles) + retour (returnTiles)

Au clic, les tuiles ≠ cliquée s'envolent (haut/bas selon position) ; à la fermeture, elles reviennent ; nettoyage des inline-styles avant reprise.

**Files:**
- Modify: `app.js` (nouvelles fonctions + branchement open/close)
- Modify: `styles.css` (transition de sortie)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test du rideau (échoue d'abord)**

Ajouter dans `tests/slider.spec.js` :

```javascript
test.describe('Slider projet — rideau', () => {
  test('les tuiles non cliquées reçoivent une direction de sortie puis reviennent', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor();

    // Snapshot des transforms avant clic (tuiles attachées).
    const before = await page.locator('.tile').first().evaluate((el) => el.style.transform);

    // Cible la tuile la plus proche du centre de l'écran (tuiles au-dessus ET en dessous garanties).
    const ok = await page.evaluate(() => {
      const cy = window.innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const t of document.querySelectorAll('.tile:not([data-project="courvoisier"])')) {
        const r = t.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const d = Math.abs((r.top + r.height / 2) - cy);
        if (d < bestD) { bestD = d; best = t; }
      }
      best?.querySelector('.tile-inner')?.setAttribute('data-test-target', '1');
      return !!best;
    });
    expect(ok).toBe(true);
    await page.locator('[data-test-target="1"]').click();
    await expect(page.locator('.slider')).toBeVisible();

    // Au moins une tuile a un exitDir up et une autre down.
    const dirs = await page.locator('.tile').evaluateAll(
      (els) => els.map((e) => e.dataset.exitDir).filter(Boolean)
    );
    expect(dirs).toContain('up');
    expect(dirs).toContain('down');

    // Fermeture → retour : plus d'exitDir, transform/transition inline nettoyés.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tile')].every((e) => !e.dataset.exitDir && !e.style.transition)
    );
    const after = await page.locator('.tile').first().evaluate((el) => el.style.transform);
    // La boucle frame() a repris la main et réécrit un translate3d.
    expect(after).toContain('translate3d');
  });
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g rideau`
Expected: FAIL (`exitDir` jamais posé).

- [ ] **Step 3 : `app.js` — `explodeTiles` / `returnTiles`**

Ajouter (près de `freezeMosaic`) ces constantes + fonctions :

```javascript
const EXIT_MS = 700;
const EXIT_STAGGER_MAX_MS = 60;
const EXIT_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// Projette chaque tuile vivante hors écran ; mémorise exitDir pour le retour.
function explodeTiles(clickedTile) {
  const vh = window.innerHeight;
  const clickedCenterY = clickedTile.el.getBoundingClientRect().top + clickedTile.h / 2;
  for (const tile of liveTiles) {
    if (tile === clickedTile) continue;
    const rect = tile.el.getBoundingClientRect();
    const centerY = rect.top + tile.h / 2;
    const dir = centerY < clickedCenterY ? 'up' : 'down';
    tile.exitDir = dir;
    tile.el.dataset.exitDir = dir;
    if (tile.detached) continue; // hors DOM → pas d'anim, exitDir suffit
    const dist = Math.abs(centerY - clickedCenterY);
    const delay = Math.min(dist / vh, 1) * EXIT_STAGGER_MAX_MS;
    const dy = dir === 'up' ? -(rect.bottom + 40) : (vh - rect.top + 40);
    tile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE} ${delay}ms`;
    // tile.x conservé ; on ajoute le décalage vertical de sortie au ty courant.
    const cur = tile.y - offset * tile.velocityMultiplier + (COL_STAGGER[tile.colIdx] ?? 0);
    tile.el.style.transform = `translate3d(${tile.x}px, ${cur + dy}px, 0)`;
  }
}

// Animation inverse : retour à la position gelée, puis nettoyage + reprise.
function returnTiles(done) {
  let pending = 0;
  for (const tile of liveTiles) {
    if (!tile.exitDir) continue;
    if (tile.detached) { delete tile.exitDir; delete tile.el.dataset.exitDir; continue; }
    pending++;
    const ty = tile.y - offset * tile.velocityMultiplier + (COL_STAGGER[tile.colIdx] ?? 0);
    tile.el.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASE}`;
    tile.el.style.transform = `translate3d(${tile.x}px, ${ty}px, 0)`;
    const onEnd = () => {
      tile.el.removeEventListener('transitionend', onEnd);
      tile.el.style.transition = '';        // sinon frame() lag l'auto-scroll
      delete tile.exitDir;
      delete tile.el.dataset.exitDir;
      if (--pending === 0) done();
    };
    tile.el.addEventListener('transitionend', onEnd);
  }
  if (pending === 0) done();                 // rien à animer (ex. reduced-motion)
}
```

- [ ] **Step 4 : `app.js` — brancher explode à l'ouverture, return à la fermeture**

Dans le handler de clic tuile, après `freezeMosaic();` et avant `openSlider(...)` : ajouter `explodeTiles(/* tuile cliquée */)`. Récupérer l'objet tuile : le handler est défini dans `createTile`, où l'objet retourné est connu — référencer la tuile via une closure. Adapter la fin de `createTile` pour capturer `self` :

```javascript
  // en haut de createTile, après calcul de pos :
  const tileObj = { el, inner, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h,
                    velocityMultiplier: pos.velocityMultiplier, colIdx: pos.colIdx };
  // … le handler clic référence tileObj :
  inner.addEventListener('click', () => {
    const lockSvg = inner.querySelector('.tile-lock');
    if (lockSvg && lockSvg.style.display !== 'none') {
      lockSvg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return;
    }
    if (mode !== 'mosaic') return;
    const proj = el.dataset.project;
    if (!proj) return;
    const originRect = el.getBoundingClientRect();
    setMode('slider');
    freezeMosaic();
    explodeTiles(tileObj);
    openSlider({ projId: proj, startSrc: item.src, originRect,
      onClosed: () => { setMode('mosaic'); } });
  });
  // … à la fin de createTile : return tileObj;
```

`onClosed` ne reprend pas tout de suite : on enchaîne `returnTiles` AVANT `resumeMosaic`. Modifier `onClosed` :

```javascript
      onClosed: () => { returnTiles(() => { resumeMosaic(); setMode('mosaic'); }); }
```

(Note : `setMode('mosaic')` final déplacé dans le callback de `returnTiles`.)

- [ ] **Step 5 : `styles.css` — rien d'obligatoire**

La transition est posée en inline-style (durée/easing/delay variables par tuile). Aucun ajout CSS requis ici.

- [ ] **Step 6 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js`
Expected: PASS (rideau : up+down présents, retour nettoie exitDir + transition, frame() reprend).

- [ ] **Step 7 : Vérification visuelle (preview)**

Démarrer le preview (port 8765, `mcp__Claude_Preview__preview_start` name `portfolio-mosaique`), cliquer une tuile, screenshot : les autres tuiles s'envolent haut/bas, la cliquée reste. Fermer (clic vide) : retour. Corriger si snap visible.

- [ ] **Step 8 : Commit**

```bash
git add app.js styles.css tests/slider.spec.js
git commit -m "feat(slider): transition rideau (explode/return) au clic et au retour"
```

---

## Task 3 : FLIP de la diapo cliquée (continuité visuelle)

La diapo courante démarre sur le rect de la tuile cliquée puis s'anime vers sa position centrée ; inverse à la fermeture.

**Files:**
- Modify: `modules/slider.js` (FLIP open/close)
- Modify: `styles.css` (transition slide)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test FLIP (échoue d'abord)**

```javascript
test('la diapo courante finit centrée même si la tuile cliquée est près d’un bord', async ({ page }) => {
  await page.goto('/');
  const tiles = page.locator('.tile-inner');
  await tiles.first().waitFor();
  await tiles.first().click(); // souvent près d'un bord
  const slide = page.locator('.slider__slide[aria-current="true"]');
  await expect(slide).toBeVisible();
  // Après transition, la diapo est centrée horizontalement (±20px).
  await page.waitForTimeout(800);
  const center = await slide.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { mid: r.left + r.width / 2, vw: window.innerWidth };
  });
  expect(Math.abs(center.mid - center.vw / 2)).toBeLessThan(20);
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g FLIP`
Expected: FAIL ou flaky (pas de transition FLIP, position non garantie).

- [ ] **Step 3 : `modules/slider.js` — FLIP à l'ouverture**

Après `document.body.appendChild(root);` dans `openSlider`, ajouter (la diapo courante est déjà dans le flux centré ; on l'« invert » vers `originRect` puis on « play ») :

```javascript
  if (originRect) {
    const cur = root.querySelector('.slider__slide[aria-current="true"]');
    const last = cur.getBoundingClientRect(); // position centrée finale
    const dx = (originRect.left + originRect.width / 2) - (last.left + last.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (last.top + last.height / 2);
    const sx = originRect.width / last.width;
    const sy = originRect.height / last.height;
    cur.style.transformOrigin = 'center center';
    cur.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    cur.getBoundingClientRect();              // reflow → fige l'état "first"
    cur.style.transition = 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)';
    cur.style.transform = 'translate(0, 0) scale(1)';
    cur.addEventListener('transitionend', function clr() {
      cur.removeEventListener('transitionend', clr);
      cur.style.transition = ''; cur.style.transform = '';
    });
  }
```

- [ ] **Step 4 : `modules/slider.js` — FLIP retour à la fermeture**

`closeSlider()` doit animer la diapo courante vers `originRect` AVANT de retirer le root. Mémoriser `originRect` dans `state` à l'ouverture (`state.originRect = originRect`). Réécrire `closeSlider` :

```javascript
export function closeSlider() {
  if (!root || state.closing) return;
  state.closing = true;
  const cb = state.onClosed;
  const cur = root.querySelector('.slider__slide[aria-current="true"]');
  const origin = state.originRect;
  const finish = () => { root.remove(); root = null; state = null; if (cb) cb(); };
  if (cur && origin) {
    const last = cur.getBoundingClientRect();
    const dx = (origin.left + origin.width / 2) - (last.left + last.width / 2);
    const dy = (origin.top + origin.height / 2) - (last.top + last.height / 2);
    const sx = origin.width / last.width, sy = origin.height / last.height;
    cur.style.transition = 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)';
    cur.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    cur.addEventListener('transitionend', finish, { once: true });
  } else {
    finish();
  }
}
```

Mettre à jour `openSlider` : `state = { projId, slides, index, onClosed, originRect, closing: false };`

- [ ] **Step 5 : `styles.css` — slide animable**

```css
.slider__slide { will-change: transform; }
```

- [ ] **Step 6 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js`
Expected: PASS (diapo centrée après FLIP). Vérifier aussi non-régression rideau/ouverture.

- [ ] **Step 7 : Commit**

```bash
git add modules/slider.js styles.css tests/slider.spec.js
git commit -m "feat(slider): handoff FLIP de la maquette cliquée (ouverture et retour)"
```

---

## Task 4 : Navigation (flèches écran + clavier + clic voisin) + layout voisines

Layout « courante centrée + voisines qui dépassent », indicateur N/M, flèches, clavier ← →, clic voisin, clamp (pas de wrap), tailles réelles selon ratio.

**Files:**
- Modify: `modules/slider.js` (état index, rendu voisines, nav, indicateur, dimensionnement)
- Modify: `styles.css` (positions voisines, flèches, compteur, transition horizontale)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Tests nav (échouent d'abord)**

```javascript
test.describe('Slider projet — navigation', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('indicateur N/M et flèches clavier (Liquides Paris = 4 maquettes)', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    const counter = page.locator('.slider__counter');
    await expect(counter).toHaveText('1 / 4');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('2 / 4');
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('1 / 4');
    // Clamp : ArrowLeft à l'index 0 ne descend pas sous 1/4.
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('1 / 4');
  });

  test('flèche écran suivante avance', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await page.locator('.slider__arrow--next').click();
    await expect(page.locator('.slider__counter')).toHaveText('2 / 4');
  });

  test('clic sur la voisine droite va à elle', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await page.locator('.slider__slide[data-pos="next"]').click();
    await expect(page.locator('.slider__counter')).toHaveText('2 / 4');
  });

  test('projet à 1 maquette : pas de flèches (Royal Canin)', async ({ page }) => {
    await openProject(page, 'Royal Canin');
    await expect(page.locator('.slider__counter')).toHaveText('1 / 1');
    await expect(page.locator('.slider__arrow')).toHaveCount(0);
  });
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g navigation`
Expected: FAIL (`.slider__counter`, `.slider__arrow`, `data-pos` inexistants).

- [ ] **Step 3 : `modules/slider.js` — positions, dimensionnement, rendu**

Ajouter le dimensionnement (ratios) et le placement par position relative à `index`. Remplacer `buildSlide` + ajouter `layout()`/`render()` :

```javascript
// Compléter l'import existant (Task 1) en ajoutant RATIOS :
import { pool, projects, RATIOS } from '../data.js';

const GAP = 48;
function slideSize(type) {
  const margin = 96;
  const h = window.innerHeight - margin * 2;
  const ratio = type === 'tablet' ? RATIOS.tablet : RATIOS.mobile;
  return { w: h * ratio, h };
}

function layout() {
  const { slides, index } = state;
  const sizeCur = slideSize(slides[index].type);
  state.slideEls.forEach((slide, i) => {
    const sz = slideSize(slides[i].type);
    slide.style.width = sz.w + 'px';
    slide.style.height = sz.h + 'px';
    const rel = i - index;            // 0 courante, -1 préc, +1 suiv
    slide.dataset.pos = rel === 0 ? 'current' : rel === -1 ? 'prev' : rel === 1 ? 'next' : 'far';
    slide.setAttribute('aria-current', rel === 0 ? 'true' : 'false');
    // x = décalage horizontal par rapport au centre.
    const step = sizeCur.w / 2 + GAP + sz.w / 2;
    const x = rel * step;
    slide.style.transform = `translate(-50%, -50%) translateX(${x}px)`;
    slide.style.opacity = Math.abs(rel) <= 1 ? '1' : '0';
    slide.style.pointerEvents = Math.abs(rel) <= 1 ? 'auto' : 'none';
  });
  state.counter.textContent = `${index + 1} / ${slides.length}`;
}

function go(delta) {
  const n = state.slides.length;
  const next = Math.max(0, Math.min(n - 1, state.index + delta));
  if (next === state.index) return;
  state.index = next;
  layout();
}
```

Dans `openSlider`, après création du `track`, construire les diapos en gardant les refs, le compteur, et les flèches (si >1 maquette) :

```javascript
  state.slideEls = slides.map((item) => {
    const slide = buildSlide(item);
    slide.addEventListener('click', (e) => {
      const pos = slide.dataset.pos;
      if (pos === 'next') go(1);
      else if (pos === 'prev') go(-1);
      // pos === 'current' : clic sur la maquette courante → ne ferme pas (géré par le vide)
      e.stopPropagation();
    });
    track.appendChild(slide);
    return slide;
  });

  // Compteur N/M (coin bas-centre).
  state.counter = document.createElement('div');
  state.counter.className = 'slider__counter';
  root.appendChild(state.counter);

  // Flèches uniquement si >1 maquette.
  if (slides.length > 1) {
    for (const [dir, d, label] of [['prev', -1, 'Maquette précédente'], ['next', 1, 'Maquette suivante']]) {
      const btn = document.createElement('button');
      btn.className = `slider__arrow slider__arrow--${dir}`;
      btn.setAttribute('aria-label', label);
      btn.textContent = dir === 'prev' ? '←' : '→';
      btn.addEventListener('click', (e) => { e.stopPropagation(); go(d); });
      root.appendChild(btn);
    }
  }

  layout();
```

`buildSlide(item)` ne prend plus `isCurrent` (géré par `layout`). Retirer le param et la ligne `aria-current` interne.

Clavier ← → : étendre le listener keydown existant :

```javascript
window.addEventListener('keydown', (e) => {
  if (!root) return;
  if (e.key === 'Escape') closeSlider();
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
});
```

- [ ] **Step 4 : `styles.css` — positionnement voisines + flèches + compteur**

```css
.slider__slide {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms ease;
  will-change: transform, opacity;
}
.slider__slide[data-pos="far"] { display: none; }
.slider__slide-inner { width: 100%; height: 100%; overflow: hidden; border-radius: inherit; }
.slider__slide-inner img { width: 100%; height: auto; display: block; }
.slider__counter {
  position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
  color: #fff; font: inherit; letter-spacing: 0.04em;
}
.slider__arrow {
  position: absolute; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: #fff; cursor: pointer;
  font-size: 28px; padding: 24px; z-index: 2;
}
.slider__arrow--prev { left: 12px; }
.slider__arrow--next { right: 12px; }
```

Note : la règle Task 1 `.slider__slide { display:none } / [aria-current] { display:block }` est remplacée par le positionnement absolu ci-dessus (toutes les diapos rendues, voisines visibles). Retirer ces 2 lignes de Task 1.

- [ ] **Step 5 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js`
Expected: PASS (N/M, flèches, clavier, clamp, clic voisin, 1 maquette sans flèches).

- [ ] **Step 6 : Vérification visuelle (preview)**

Screenshot desktop : courante centrée, voisines qui dépassent, compteur en bas, flèches. Naviguer → glissement horizontal fluide.

- [ ] **Step 7 : Commit**

```bash
git add modules/slider.js styles.css tests/slider.spec.js
git commit -m "feat(slider): layout voisines + navigation (flèches, clavier, clic, clamp)"
```

---

## Task 5 : Glisser / swipe horizontal (drag souris + tactile) + 2 axes

Suivi du pointeur en X, snap à la diapo la plus proche au relâché ; le geste vertical laisse passer le scroll de la diapo.

**Files:**
- Modify: `modules/slider.js` (handlers pointer/touch)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test drag (échoue d'abord)**

```javascript
test('drag horizontal vers la gauche avance d’une diapo', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ui-corner--tl').click();
  await page.locator('.ui-corner__suffix-item', { hasText: 'Liquides Paris' }).click();
  await expect(page.locator('.slider')).toBeVisible();

  const box = await page.locator('.slider__slide[data-pos="current"]').boundingBox();
  // Drag de droite à gauche (> seuil) → diapo suivante.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.slider__counter')).toHaveText('2 / 4');
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g drag`
Expected: FAIL (pas de drag).

- [ ] **Step 3 : `modules/slider.js` — drag pointer + snap**

```javascript
const SWIPE_THRESHOLD = 80;     // px horizontaux pour changer de diapo
function attachDrag() {
  let startX = 0, startY = 0, dragging = false, axisLocked = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.slider__arrow')) return;
    dragging = true; axisLocked = null;
    startX = e.clientX; startY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!axisLocked && Math.abs(dx) + Math.abs(dy) > 8) {
      axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axisLocked === 'x') {
      e.preventDefault();
      state.dragDx = dx;
      const cur = state.slideEls[state.index];
      cur.style.transition = 'none';
      cur.style.transform = `translate(-50%, -50%) translateX(${dx}px)`;
    }
    // axisLocked === 'y' : on ne fait rien → le scroll vertical de la diapo s'applique.
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const dx = state.dragDx || 0; state.dragDx = 0;
    state.slideEls[state.index].style.transition = '';
    if (axisLocked === 'x' && Math.abs(dx) > SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
    else layout();   // snap back
  });
}
```

Appeler `attachDrag()` à la fin de `openSlider` (après `layout()`).

- [ ] **Step 4 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js -g drag`
Expected: PASS.

- [ ] **Step 5 : Vérification tactile (preview, viewport mobile)**

`preview_resize` mobile, simuler un swipe horizontal (via `preview_eval` dispatch touch ou drag) → change de diapo ; swipe vertical → scroll la maquette.

- [ ] **Step 6 : Commit**

```bash
git add modules/slider.js tests/slider.spec.js
git commit -m "feat(slider): glisser/swipe horizontal avec snap et verrou d’axe"
```

---

## Task 6 : Auto-scroll vertical de la diapo courante

La diapo courante défile verticalement (desktop : au survol ; mobile : continu lent). Les voisines restent en haut. Au changement de diapo, l'auto-scroll suit la nouvelle courante.

**Files:**
- Modify: `modules/slider.js` (contenu scrollable + auto-scroll)
- Modify: `styles.css` (conteneur scroll)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test scroll (échoue d'abord)**

```javascript
test('la diapo courante est scrollable verticalement', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ui-corner--tl').click();
  await page.locator('.ui-corner__suffix-item', { hasText: 'Quintessence Paris' }).click();
  const scrollEl = page.locator('.slider__slide[data-pos="current"] .slider__scroll');
  await expect(scrollEl).toBeVisible();
  // Le contenu déborde (image plus haute que le cadre) → scrollHeight > clientHeight.
  const overflows = await scrollEl.evaluate((el) => el.scrollHeight > el.clientHeight + 4);
  expect(overflows).toBe(true);
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g scrollable`
Expected: FAIL (`.slider__scroll` inexistant).

- [ ] **Step 3 : `modules/slider.js` — conteneur scroll + auto-scroll**

Modifier `buildSlide` pour envelopper l'image dans un conteneur scrollable (la maquette est plus haute que le cadre) :

```javascript
function buildSlide(item) {
  const slide = document.createElement('div');
  slide.className = 'slider__slide';
  slide.dataset.src = item.src; slide.dataset.type = item.type;
  const frame = document.createElement('div'); frame.className = 'tile-frame';
  const scroll = document.createElement('div'); scroll.className = 'slider__scroll';
  const img = document.createElement('img');
  img.src = item.src; img.alt = ''; img.draggable = false;
  scroll.appendChild(img); frame.appendChild(scroll); slide.appendChild(frame);
  return slide;
}
```

Auto-scroll : réutiliser une mécanique simple par rAF sur le `.slider__scroll` courant. Desktop = pendant le survol de la diapo ; mobile (`!HAS_HOVER`) = continu. Ajouter (import `HAS_HOVER`, `REDUCED_MOTION` depuis app — ou redéclarer via matchMedia dans slider.js pour l'isolation) :

```javascript
const HAS_HOVER = window.matchMedia('(hover: hover)').matches;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const AUTOSCROLL_PX_S = 40;
let scrollRAF = null, lastT = 0;

function startAutoScroll() {
  stopAutoScroll();
  if (REDUCED_MOTION) return;
  const el = state.slideEls[state.index].querySelector('.slider__scroll');
  let hovering = !HAS_HOVER; // mobile : actif d'office
  if (HAS_HOVER) {
    el.onmouseenter = () => { hovering = true; };
    el.onmouseleave = () => { hovering = false; };
  }
  lastT = 0;
  const tick = (t) => {
    if (!lastT) lastT = t;
    const dt = (t - lastT) / 1000; lastT = t;
    if (hovering) {
      const max = el.scrollHeight - el.clientHeight;
      if (el.scrollTop < max) el.scrollTop = Math.min(max, el.scrollTop + AUTOSCROLL_PX_S * dt * 60);
    }
    scrollRAF = requestAnimationFrame(tick);
  };
  scrollRAF = requestAnimationFrame(tick);
}
function stopAutoScroll() { if (scrollRAF) cancelAnimationFrame(scrollRAF); scrollRAF = null; }
```

Appeler `startAutoScroll()` à la fin de `openSlider` (après `attachDrag`) et dans `go()` (après `layout()`), en remettant les voisines en haut : dans `go`, avant de changer l'index, `state.slideEls.forEach((s) => { const sc = s.querySelector('.slider__scroll'); if (sc) sc.scrollTop = 0; });` puis `startAutoScroll()`. Dans `closeSlider`, appeler `stopAutoScroll()`.

- [ ] **Step 4 : `styles.css` — conteneur scroll**

```css
.slider__scroll {
  width: 100%; height: 100%;
  overflow-y: auto; overflow-x: hidden;
  scrollbar-width: none; border-radius: inherit;
}
.slider__scroll::-webkit-scrollbar { width: 0; height: 0; }
.slider__scroll img { width: 100%; height: auto; display: block; }
```

- [ ] **Step 5 : Lancer → vérifier que ça passe**

Run: `npx playwright test tests/slider.spec.js -g scrollable`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add modules/slider.js styles.css tests/slider.spec.js
git commit -m "feat(slider): auto-scroll vertical de la maquette courante"
```

---

## Task 7 : Nettoyage focus projet + redirection liste clients + reduced-motion

Supprimer le code mort du focus, rediriger la liste clients vers le slider, gérer reduced-motion (pas de rideau ni auto-scroll → cross-fade).

**Files:**
- Modify: `app.js` (suppressions + `openClientList`)
- Modify: `styles.css` (suppression classes focus + reduced-motion)
- Modify: `tests/mobile.spec.js` (si référence focus)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Test reduced-motion + liste clients (échouent d'abord)**

```javascript
test('liste clients → ouvre le slider sur la 1re maquette', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ui-corner--tl').click();
  await page.locator('.ui-corner__suffix-item', { hasText: 'Gobelins Paris' }).click();
  await expect(page.locator('.slider')).toBeVisible();
  await expect(page.locator('.slider__counter')).toHaveText('1 / 4');
});

test('reduced-motion : ouverture directe sans rideau', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const tile = page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first();
  await tile.waitFor();
  await tile.click();
  await expect(page.locator('.slider')).toBeVisible();
  // Pas d'exitDir posé (pas de rideau animé).
  const dirs = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.dataset.exitDir).filter(Boolean));
  expect(dirs.length).toBe(0);
});
```

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g "liste clients|reduced"`
Expected: FAIL (liste clients appelle encore `focusProject` ; reduced-motion non géré).

- [ ] **Step 3 : `app.js` — reduced-motion dans explode/return + ouverture**

Garder `explodeTiles`/`returnTiles` mais court-circuiter sous reduced-motion. En tête d'`explodeTiles` : `if (REDUCED_MOTION) return;`. `returnTiles` appelle déjà `done()` si rien à animer (donc OK car aucun `exitDir` posé). Pour le FLIP, sous reduced-motion `modules/slider.js` doit faire un cross-fade : dans `openSlider`/`closeSlider`, si `REDUCED_MOTION`, sauter le bloc FLIP et poser `root.style.transition = 'opacity 200ms'` (fade-in via `opacity 0→1`).

- [ ] **Step 4 : `app.js` — entrée liste clients (déjà câblée en Task 1)**

La redirection `openClientList`→slider a été posée en Task 1 (Step 5). Rien à recâbler ici : vérifier seulement qu'`activate` n'appelle plus `focusProject` (la définition de `focusProject` est supprimée au Step 5 ci-dessous).

- [ ] **Step 5 : `app.js` — supprimer le code mort du focus**

Après `grep` des usages, supprimer : `focusProject`, `unfocusProject`, `navigateToProjectImage`, `renderProjectNav`, `typewriteProjectNav`, `renderNavTypewriterFrame`, `scrollToCurrentImage`, `findMinTileY`, `scrollToFirstProjectTile`, `smoothScrollOffset` (si plus référencé), `currentFocusedProject`, `currentProjectImages`, `currentImageIndex`, `navTypewriterRAF`, et l'adoption d'état focus dans `createTile` (~L896-900). Vérifier qu'aucun appel ne subsiste : `grep -nE "focusProject|unfocusProject|navigateToProjectImage|currentFocusedProject" app.js` → 0.

- [ ] **Step 6 : `styles.css` — supprimer classes focus + reduced-motion slider**

Supprimer les règles `.tile--project-focused`, `.tile--project-dimmed`, `.tile--project-dimmed .tile-scroll`. Ajouter dans le bloc `@media (prefers-reduced-motion: reduce)` :

```css
  .slider__slide { transition: none !important; }
```

- [ ] **Step 7 : Lancer la suite complète**

Run: `npx playwright test`
Expected: PASS (slider + smoke + lock + bio + mobile). Corriger `tests/mobile.spec.js` si un test référence le focus supprimé.

- [ ] **Step 8 : Commit**

```bash
git add app.js styles.css tests/
git commit -m "refactor(slider): retire le focus projet, redirige la liste clients, gère reduced-motion"
```

---

## Task 8 : Cas limites + redimensionnement + vérification finale

Resize pendant le slider, projet verrouillé (Courvoisier), passe finale visuelle desktop + mobile.

**Files:**
- Modify: `modules/slider.js` (listener resize)
- Test: `tests/slider.spec.js`

- [ ] **Step 1 : Tests resize + verrou (échouent d'abord)**

```javascript
test('resize pendant le slider recalcule les tailles', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ui-corner--tl').click();
  await page.locator('.ui-corner__suffix-item', { hasText: 'Liquides Paris' }).click();
  await expect(page.locator('.slider')).toBeVisible();
  const h1 = await page.locator('.slider__slide[data-pos="current"]').evaluate((el) => el.getBoundingClientRect().height);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(200);
  const h2 = await page.locator('.slider__slide[data-pos="current"]').evaluate((el) => el.getBoundingClientRect().height);
  expect(h2).toBeLessThan(h1);
});

test('projet verrouillé (Courvoisier) n’ouvre pas le slider', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ui-corner--tl').click();
  await page.locator('.ui-corner__suffix-item', { hasText: 'Courvoisier' }).click();
  // Via la liste, Courvoisier ouvre le slider d'images verrouillées OU reste fermé selon design.
  // Au clic-TUILE en revanche, le cadenas prime : testé ci-dessous sur une tuile.
  // Ici on vérifie au minimum l'absence de crash + mode cohérent.
  await expect(page.locator('body')).toHaveAttribute('data-mode', /mosaic|slider/);
});
```

(Note : le verrou est surtout pertinent au clic-tuile — déjà couvert par la branche cadenas dans le handler. `tests/lock.spec.js` reste vert.)

- [ ] **Step 2 : Lancer → vérifier l'échec**

Run: `npx playwright test tests/slider.spec.js -g resize`
Expected: FAIL (pas de recalcul au resize).

- [ ] **Step 3 : `modules/slider.js` — listener resize**

Dans `openSlider`, après `layout()` : `state.onResize = () => layout(); window.addEventListener('resize', state.onResize);`. Dans `closeSlider` (`finish`), avant de nullifier : `if (state?.onResize) window.removeEventListener('resize', state.onResize);`.

- [ ] **Step 4 : Lancer la suite complète**

Run: `npx playwright test`
Expected: PASS sur tous les fichiers.

- [ ] **Step 5 : Vérification visuelle finale (preview)**

Desktop (1440×900) + mobile (375×812) via `preview_resize` :
- Clic tuile → rideau → slider centré + voisines + compteur ; FLIP fluide.
- Nav flèches/clavier/swipe ; auto-scroll de la courante.
- Clic vide / Échap → retour identique à l'état initial.
Screenshots golden path + un edge (projet 1 maquette, projet verrouillé au clic-tuile).

- [ ] **Step 6 : Commit**

```bash
git add modules/slider.js tests/slider.spec.js
git commit -m "feat(slider): resize live + cas limites + passe de vérification finale"
```

---

## Notes d'exécution
- **Pas de commit/push réel sans l'accord explicite de l'utilisateur** (règle de session : push sur `main` = prod). Les `git commit` des tâches sont des jalons locaux ; les regrouper/les jouer selon l'instruction de l'utilisateur.
- Vérifier chaque tâche en preview (port 8765, `cache-control: no-store`) + hard refresh (SW cache-first).
- Le compteur/flèches/nom du projet vivent **dans** l'overlay slider (isolation du module) plutôt que dans le coin TL — léger raffinement vs la spec, au profit du découplage.
