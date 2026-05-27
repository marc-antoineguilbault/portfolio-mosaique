# Préchargement complet des maquettes au boot — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Précharger les 27 srcs du pool dès le boot pour que `scrollToCurrentImage` marche pour toutes les maquettes et que les images soient en HTTP cache à l'apparition, sans dégrader LCP/INP sur réseau lent.

**Architecture:** Préfill en 2 phases : phase 1 sync (existante + `fetchpriority="high"` sur 1ère tablet), phase 2 idle batché via `requestIdleCallback` avec `fetchpriority="low"`. Fallback `flushPrefillSync` au click ↑↓ si phase 2 pas finie. Skip phase 2 si `saveData` ou réseau 2G.

**Tech Stack:** Vanilla JS (ES modules), aucun framework de test. Tests = vérifications manuelles via DevTools + console assertions.

**Spec source :** [docs/superpowers/specs/2026-05-27-portfolio-prefetch-design.md](../specs/2026-05-27-portfolio-prefetch-design.md)

**File map :**
- Modify: `app.js` (5 zones distinctes, voir tasks)
- Modify: `index.html` (cache buster)

---

## Task 1 : Globals + utilitaires

**Files:**
- Modify: `app.js:286` (zone des globals après `let liveTiles = [];`)

- [ ] **Step 1 : Ajouter les globals et helpers en-tête**

Insérer **juste après la ligne `let liveTiles = [];`** (app.js:286) :

```js
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
```

- [ ] **Step 2 : Vérification syntaxe**

```bash
node --check /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique/app.js
```

Attendu : aucune sortie (pas d'erreur de parse).

> ⚠️ `node --check` peut échouer sur les `import` ESM ; alternative : `node --input-type=module -e "$(cat app.js | head -300)"` ou simplement loader la page et vérifier qu'aucune `SyntaxError` n'apparaît dans la console.

- [ ] **Step 3 : Commit**

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique add app.js
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique commit -m "feat(prefetch): add globals (placedSrcs, prefillHandle) + idle/network helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : `createTile` accepte `fetchPriority`, `fillUntil` promote la 1ère tablet

**Files:**
- Modify: `app.js:728` (signature de `createTile`)
- Modify: `app.js:786-791` (création de `<img>` dans `createTile`)
- Modify: `app.js:915-923` (corps de `fillUntil`)

- [ ] **Step 1 : Modifier la signature de `createTile`**

Remplacer (app.js:728) :

```js
function createTile(item, pos, label) {
```

Par :

```js
function createTile(item, pos, label, fetchPriority = 'auto') {
```

- [ ] **Step 2 : Set `fetchPriority` avant `img.src`**

Remplacer le bloc (app.js:786-791) :

```js
  if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
```

Par :

```js
  if (item.src) {
    const img = document.createElement('img');
    if (fetchPriority !== 'auto') img.fetchPriority = fetchPriority;
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
```

> ⚠️ **Critique** : `fetchPriority` doit être set **avant** `img.src`. Sinon le fetch démarre avec priority par défaut et l'attribut est ignoré (référence MDN).

- [ ] **Step 3 : Modifier `fillUntil` pour promouvoir la 1ère tablet en `high`**

Remplacer (app.js:915-923) :

```js
function fillUntil(targetHeight) {
  let counter = liveTiles.length;
  while (Math.min(...colHeights) < targetHeight) {
    const item = pickRandom();
    const pos = placeNext(item);
    const tile = createTile(item, pos, String(++counter));
    liveTiles.push(tile);
  }
}
```

Par :

```js
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
```

- [ ] **Step 4 : Vérification manuelle — Priority dans DevTools Network**

Démarrer le serveur local :

```bash
cd /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique && python3 -m http.server 8771
```

Ouvrir `http://localhost:8771` dans Chrome, DevTools Network, filtrer `.webp`, hard-reload (Cmd+Shift+R).

Attendu :
- Une (et une seule) image WebP a `Priority: High` dans la colonne Priority.
- Cette image est un tablet (chemin contient `/t01.webp`, `/t02.webp`, etc.).
- Les autres images du fillUntil initial ont `Priority: Auto` (= Medium/Low selon Chrome).

Dans la console DevTools, exécuter :

```js
[...document.querySelectorAll('.tile img')].filter(i => i.fetchPriority === 'high').map(i => i.src)
```

Attendu : 1 résultat, src d'un fichier `/t*.webp`.

- [ ] **Step 5 : Commit**

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique add app.js
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique commit -m "feat(prefetch): createTile accepts fetchPriority, fillUntil promotes 1st tablet to high

LCP candidate heuristic: tablets have ~+35% surface vs mobiles in this mosaic, so
the first placed tablet receives fetchpriority=high. Attribute set before img.src
to ensure the browser picks it up at fetch start (otherwise ignored per MDN).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : `prefillRemainingSources` batché + `flushPrefillSync`

**Files:**
- Modify: `app.js` (ajout juste après la fin de `fillUntil`, ~ligne 924)

- [ ] **Step 1 : Ajouter les 2 fonctions après `fillUntil`**

Insérer juste après la fonction `fillUntil` (avant `function topUpIfNeeded()`) :

```js
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
function flushPrefillSync() {
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
  }
}
```

- [ ] **Step 2 : Vérification manuelle — appel direct via console**

Recharger `http://localhost:8771`. Dans la console DevTools :

```js
flushPrefillSync()
```

> ⚠️ Comme les fonctions sont module-scoped (ESM), `flushPrefillSync` n'est pas accessible depuis la console globale. Pour ce test manuel uniquement, temporairement exposer : `window.flushPrefillSync = flushPrefillSync` en bas de `app.js`, tester, puis retirer **avant le commit**.

Attendu :
- Après l'appel, `document.querySelectorAll('.tile').length` augmente significativement (jusqu'à ~51).
- DevTools Network → nouveau lot de fetches WebP avec `Priority: Low`.

- [ ] **Step 3 : Commit**

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique add app.js
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique commit -m "feat(prefetch): add idle-batched prefillRemainingSources + sync flush fallback

Phase 2 fills tiles for every pool src not yet placed by fillUntil(h*3),
respecting deadline.timeRemaining() to avoid blocking the main thread > 2ms
per idle frame. flushPrefillSync handles the case where user clicks before
phase 2 completes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : Brancher dans `init` + refactor `scrollToCurrentImage`

**Files:**
- Modify: `app.js:1112-1122` (corps de `init`)
- Modify: `app.js:82-92` (corps de `scrollToCurrentImage`)

- [ ] **Step 1 : Modifier `init` pour scheduler le prefill idle**

Remplacer (app.js:1112-1122) :

```js
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
```

Par :

```js
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
```

- [ ] **Step 2 : Refactor `scrollToCurrentImage` avec helper + fallback flush**

Remplacer (app.js:82-92) :

```js
function scrollToCurrentImage() {
  if (!currentProjectImages.length) return;
  const targetSrc = currentProjectImages[currentImageIndex].src;
  let targetY = Infinity;
  for (const tile of liveTiles) {
    if (tile.item.src === targetSrc && tile.y < targetY) targetY = tile.y;
  }
  if (targetY === Infinity) return;
  const targetOffset = Math.max(minLiveTileY - SCROLL_TOP_Y, targetY - TOP_MARGIN);
  smoothScrollOffset(targetOffset);
}
```

Par :

```js
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
    flushPrefillSync();
    targetY = findMinTileY(targetSrc);
    if (targetY === Infinity) return; // sécurité, ne devrait pas arriver
  }
  const targetOffset = Math.max(minLiveTileY - SCROLL_TOP_Y, targetY - TOP_MARGIN);
  smoothScrollOffset(targetOffset);
}
```

- [ ] **Step 3 : Vérification manuelle — préfill idle se déclenche au boot**

Recharger `http://localhost:8771` (hard reload). Attendre 1 seconde. Dans DevTools console :

```js
document.querySelectorAll('.tile').length
```

Attendu : valeur entre 45 et 60 (au lieu de ~10 avant). Si valeur ~10, vérifier que `requestIdleCallback` est appelé (peut être différé par CPU chargé).

```js
document.querySelectorAll('.tile img[fetchpriority="low"]').length
```

Attendu : valeur entre 35 et 50 (les tiles phase 2).

- [ ] **Step 4 : Vérification manuelle — bug navigation résolu**

Toujours sur `http://localhost:8771`, hard reload, attendre 1s. Click sur le label TL "Marc-Antoine Guilbault" → liste des projets. Click sur **chaque projet l'un après l'autre**, ↑↓ plusieurs fois sur chaque.

Attendu : pour TOUTES les maquettes, le smooth scroll s'active et l'image apparaît rapidement.

- [ ] **Step 5 : Vérification manuelle — flush fallback (CPU throttle)**

DevTools → Performance → CPU 6× slowdown. Recharger immédiatement. **Sans attendre**, click sur un projet de la liste et ↑↓. Le préfill idle n'a peut-être pas eu le temps de finir.

Attendu : le scroll fonctionne quand même (flushPrefillSync se déclenche). DevTools Performance peut montrer un long task de ~20-50ms juste avant le scroll → acceptable.

- [ ] **Step 6 : Commit**

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique add app.js
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique commit -m "feat(prefetch): wire idle prefill in init + add flush fallback in scrollToCurrentImage

Init schedules prefillRemainingSources via requestIdleCallback (skipped if
saveData/2G). scrollToCurrentImage falls back to flushPrefillSync when the
target src has not been placed yet, ensuring navigation always works.

Fixes the silent no-op when user clicked ↑↓ before all sources were placed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 : Cache buster + tests E2E + push

**Files:**
- Modify: `index.html` (2 occurrences de `?v=21`)

- [ ] **Step 1 : Bumper le cache buster `?v=21` → `?v=22`**

Le fix nav précédent a déjà bumpé en `v=21`. On bump à `v=22` pour ce changement.

Modifier `index.html` lignes 7 et 25 :

```html
<link rel="stylesheet" href="styles.css?v=22">
```

```html
<script type="module" src="app.js?v=22"></script>
```

- [ ] **Step 2 : Test E2E — Préchargement HTTP complet**

Recharger `http://localhost:8771` (hard reload). DevTools Network, filtrer `.webp`, conserver après reload.

Attendu :
- Après ~2-5 secondes (no throttling) : **27 fetches** WebP visibles dans Network.
- 1 fetch a `Priority: High`.
- ~35-50 fetches ont `Priority: Low` (sur 51 tiles, dont 27 srcs uniques + repioches).

Si le compte de fetches est < 27 distincts, vérifier que le préfill idle se déclenche (peut être pollué par une extension Chrome ou un autre tab).

- [ ] **Step 3 : Test E2E — Cache HTTP persisté**

Sans vider le cache, recharger la page (Cmd+R, pas hard reload).

Attendu : la colonne Size de Network affiche `(disk cache)` ou `(memory cache)` pour les 27 WebP. Pas de re-fetch réseau.

- [ ] **Step 4 : Test E2E — Adaptation saveData**

DevTools → Network → throttle Custom → cocher "Save-Data" header. Si l'option n'est pas dispo dans ton Chrome, simuler dans la console avant le reload :

```js
Object.defineProperty(navigator.connection, 'saveData', { value: true, configurable: true });
```

Puis hard reload (l'override sera perdu, donc le test n'est valide que si on peut le persister via DevTools Network throttling).

Attendu : seulement ~10 fetches WebP au boot (phase 2 skippée). Le click ↑↓ sur un projet déclenche les fetches restants à la demande via flush.

> ⚠️ Si saveData n'est pas testable proprement, skip ce test et noter dans le commit message qu'il reste à valider sur device mobile réel avec Mode économie de données activé.

- [ ] **Step 5 : Test E2E — LCP Lighthouse mobile**

DevTools → Lighthouse → mode "Mobile" + catégorie "Performance" + throttling "Simulated throttling" (4G). Hard reload puis Generate report.

Attendu :
- LCP < 2.5s (idéalement amélioré vs la version pre-prefetch grâce au `fetchpriority="high"` sur la 1ère tablet)
- TBT (Total Blocking Time) < 200ms
- INP : non mesuré par Lighthouse statique mais surveiller via DevTools Performance lors du click projet

> Note : si LCP régresse vs avant, identifier le LCP element via DevTools → Performance → Web Vitals → LCP. Si c'est une mobile et non une tablet, ajuster l'heuristique (out of scope ce plan, ouvrir une issue).

- [ ] **Step 6 : Commit + push**

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique add index.html
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique commit -m "chore(prefetch): bump cache buster to v=22 for prefetch rollout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique push
```

- [ ] **Step 7 : Validation sur GitHub Pages (T+35s)**

Attendre ~35 secondes pour le déploiement GitHub Pages, puis tester sur `https://marcantoineguilbault.fr` :
1. Hard reload (Cmd+Shift+R)
2. Vérifier dans DevTools Network que 27 WebP sont fetched
3. Click sur n'importe quel projet de la liste, ↑↓ sur toutes les maquettes → scroll smooth pour chacune
4. Tester sur mobile réel (4G si possible) pour valider le ressenti perçu

Si une régression visible apparaît (LCP qui s'écroule, scroll jank au boot), rollback :

```bash
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique revert HEAD~4..HEAD
git -C /Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique push
```

---

## Récap des commits attendus (DRY check)

1. `feat(prefetch): add globals (placedSrcs, prefillHandle) + idle/network helpers`
2. `feat(prefetch): createTile accepts fetchPriority, fillUntil promotes 1st tablet to high`
3. `feat(prefetch): add idle-batched prefillRemainingSources + sync flush fallback`
4. `feat(prefetch): wire idle prefill in init + add flush fallback in scrollToCurrentImage`
5. `chore(prefetch): bump cache buster to v=22 for prefetch rollout`

5 commits, branche `main` directe (workflow GitHub Pages = pas de PR pour ce repo).

## Self-Review (rappel pour l'exécutant)

Avant de commit la Task 5, relire les changements de `app.js` :
- `placedSrcs.add(item.src)` est bien dans `fillUntil` ET `prefillRemainingSources` ET `flushPrefillSync` (3 endroits, sinon `Set.size` ne traque pas).
- `lcpPromoted` est bien lu et modifié dans `fillUntil` uniquement (phase 2 ne promote pas).
- `prefillHandle` est bien set à `null` à 3 endroits (au début de `prefillRemainingSources`, dans `flushPrefillSync` après cancel, et au reschedule via `idle(...)` qui le réassigne).
- `findMinTileY` est défini **avant** son 1er appel dans `scrollToCurrentImage` (file order).
- `shouldSkipPrefill` est défini **avant** son 1er appel dans `init` (file order).
- Le `window.flushPrefillSync` temporaire du Task 3 Step 2 a bien été retiré.
