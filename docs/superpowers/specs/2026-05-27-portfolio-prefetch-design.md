# Préchargement complet des maquettes au boot — Design

**Date :** 2026-05-27
**Statut :** Validé, prêt pour implémentation
**Périmètre :** `app.js` (modif de `init`, `fillUntil`, `scrollToCurrentImage`, `createTile` + 3 helpers) + cache buster `index.html`

## Contexte

`portfolio-mosaique` est une mosaïque masonry infinie (4 cols desktop / 2 cols mobile) qui cycle 27 maquettes WebP (10 mobile + 17 tablet) réparties sur 9 projets. Placement déterministe (`seededShuffle` + `cycleIdx ++` dans `pickRandom`, cycle TYPE_CYCLE `['mobile','mobile','tablet']`).

Système de cache 3 niveaux dans `frame()` (app.js:1051-1053) :
- `VISIBLE_MARGIN = 200px` : DOM attaché, transforms écrits
- `DETACH_MARGIN = 1500px` : DOM détaché (`tile.el.remove()`), tile conservée dans `liveTiles` avec sa `tile.y`
- `HARD_RECYCLE = 50000px` : tile supprimée définitivement

**Poids des assets (mesuré) :** 9.4 MB total, 27 fichiers, médiane ~200 KB, max **1.2 MB** (`quintessence-paris/t01.webp`).

## Bug à résoudre

Au boot, `fillUntil(h * 3)` (app.js:1119) place ~10 tiles seulement (s'arrête quand toutes les colonnes atteignent 3× viewport height). Les ~17 srcs restantes n'ont pas de tile dans `liveTiles`.

Quand l'utilisateur focus un projet et navigue avec ↑↓ :
1. `navigateToProjectImage(delta)` calcule `currentImageIndex` (app.js:94-100)
2. `scrollToCurrentImage()` (app.js:82-92) cherche `tile.item.src === targetSrc` dans `liveTiles`
3. Si src non placée : `targetY === Infinity` → **no-op silencieux**

Et même si la tile existe, son WebP peut ne pas être en HTTP cache → flash blanc à l'arrivée.

## Objectif

1. **Toute src a une `tile.y` connue avant le 1er click utilisateur** → `scrollToCurrentImage` marche pour n'importe quelle src
2. **Toutes les srcs sont préchargées en HTTP cache** → décompression GPU quasi-instantanée à l'apparition
3. **Sans dégrader LCP/INP** sur réseau lent ni sur mode économie de données

## Budget de performance cible

| Métrique | Cible | Outil de mesure |
|---|---|---|
| LCP (mobile 4G simulé) | < 2.5s | Lighthouse mobile, "Slow 4G" throttling |
| INP (interaction click projet) | < 200ms | Lighthouse + DevTools Performance |
| Idle callback duration | < 50ms par tour | DevTools Performance, marks |
| Cache HTTP complet (4G simulé) | < 10s après TTI | DevTools Network |
| Bug résolu | 100% | Test manuel scénarios |

## Architecture retenue : Option A+ (préfill priorisé en 2 phases, adaptatif)

### Pourquoi pas l'Option A pure (51 tiles sync au boot)

**Pression réseau :** 27 fetches simultanés sur 4G (~10 Mbps réel) = 9.4 MB / 10 Mbps ≈ **7.5s** avant complétion. Chaque fetch reçoit ~1/27e de la bande passante. La 1ère image LCP est noyée. Sur 3G lente, ~47s.

**Référence consensus 2026 :** Google a mesuré une amélioration LCP de **-0.7s** (2.6s → 1.9s) juste en ajoutant `fetchpriority="high"` sur la bonne image (web.dev/fetch-priority). Inversement, distribuer la bande passante sur 27 fetches égaux peut **doubler** le LCP.

**Blocage main thread :** créer 51 tiles d'un coup = createElement + appendChild + splitMetaIntoLines + attachTilt × 51 ≈ 30-80ms. Régression INP au boot.

### Phase 1 — Critical path sync (existante + heuristique LCP)

`fillUntil(h * 3)` reste tel quel pour le placement, mais on prommeut **la 1ère tile tablet créée** en `fetchpriority="high"` (au lieu de la 1ère tile tout court).

**Justification de l'heuristique "1ère tablet" :**
- Mobile : ~340×735px = 250 000 px²
- Tablet : ~720×470px = 338 000 px²
- Tablet a +35% d'aire → LCP candidate plus probable selon les critères du browser (le plus grand bloc d'image visible)
- Une tablet sort au 3ème pick du cycle (`['mobile','mobile','tablet']`), donc disponible dans le 1er viewport
- L'attribut doit être défini **à la création** du `<img>` : `fetchPriority` modifié après que le fetch a démarré est ignoré (MDN)

→ Couvre ~10 tiles, viewport initial complet, ~5-15ms main thread.

### Phase 2 — Préfill idle batché (NOUVEAU)

Après `fillUntil(h * 3)`, `init()` schedule via `requestIdleCallback` un `prefillRemainingSources(deadline)` qui continue `pickRandom` + `placeNext` + `createTile` jusqu'à `placedSrcs.size === pool.length`. Les tiles créées reçoivent `fetchpriority="low"`.

**Batching obligatoire :** la fonction respecte `deadline.timeRemaining()` et se reschedule via `requestIdleCallback` quand le budget descend < 2ms. Évite de bloquer le main thread > 50ms par idle frame.

**Résultat attendu :** sur desktop fibre, phase 2 finie en 1-3 idle frames (~50-150ms après TTI). Sur mobile 4G, le scheduling est étalé sur 200-500ms — sans bloquer interactions.

### Phase 2 — Adaptation réseau (NOUVEAU)

Skip de la phase 2 si l'une de ces conditions est vraie :
- `navigator.connection.saveData === true` (mode économie de données activé)
- `navigator.connection.effectiveType ∈ ['slow-2g', '2g']` (connexion très lente)

Dans ces cas, on ne précharge pas les 17 srcs supplémentaires. Le fallback `flushPrefillSync` reste actif au click ↑↓ → l'utilisateur paye juste un fetch à la demande, ce qui est plus respectueux de son contexte.

### Phase 3 — Scroll infini (inchangée)

`topUpIfNeeded()` continue d'ajouter au-delà quand l'utilisateur scrolle.

### Fallback "safety flush"

Si l'utilisateur clique ↑↓ avant la fin de phase 2 (ou si phase 2 a été skip pour saveData) :
1. `scrollToCurrentImage` détecte que la src cible n'est pas dans `liveTiles`
2. Appelle `flushPrefillSync()` qui :
   - Cancel l'`requestIdleCallback` en cours
   - Boucle sync `pickRandom` + `placeNext` + `createTile` (sans budget) jusqu'à ce que la src cible apparaisse (ou `placedSrcs.size === pool.length`)
3. Re-calcule `targetY` et lance `smoothScrollOffset`

Blocking main thread acceptable car déclenché par interaction utilisateur (l'animation smoothScroll de 700ms masque les ~5-30ms de blocking).

## Flow d'ensemble

```
init()
  ├─ computeLayout()
  ├─ fillUntil(h * 3)             ── Phase 1 : ~10 tiles, 1ère tablet en fetchpriority="high"
  ├─ placedSrcs.add(...phase 1)
  └─ if (!saveData && !slowNet)
       └─ idle(prefillRemainingSources)   ── Phase 2 : batch via deadline.timeRemaining()

frame() (chaque rAF)
  └─ cache 3 niveaux inchangé
       └─ détache tiles hors DETACH_MARGIN (1500px) ── ~40 tiles phase 2 détachées dès frame 1

scrollToCurrentImage() (au click ↑↓)
  └─ findMinTileY(targetSrc)
       ├─ found → smoothScrollOffset
       └─ Infinity → flushPrefillSync() puis retry
```

## Notes design

- **Pas de `pool.forEach(item => new Image())` séparé** : les `<img>` des tiles font déjà le fetch. Les re-pioches partagent le HTTP cache du browser.
- **Pas de `<link rel="preload">` :** créerait des fetches doublon. La priorisation se fait via `fetchpriority` directement sur les `<img>`.
- **`loading="lazy"` natif inutile :** les tiles entrent dans le viewport via `transform`, pas via scroll natif → le browser ne déclenche pas le lazy load. (`decoding="async"` déjà en place app.js:791.)
- **Polyfill `requestIdleCallback` :** Safari < 17 → fallback `setTimeout(fn, 1)` avec stub `timeRemaining: () => 50`.
- **`tile.el.remove()` n'annule pas le fetch en cours** sur Chrome/Safari modernes : la requête réseau continue, l'image rejoint le cache HTTP. (Comportement non spec mais consensus implem.)

## Modifications de code

### `app.js` — globals (ajouts près de `liveTiles`, ~ligne 286)

```js
let liveTiles = [];
const placedSrcs = new Set();
let prefillHandle = null;

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

### `app.js` — `createTile` (app.js:728, 786-791)

Avant :
```js
function createTile(item, pos, label) {
  // ...
  if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
```

Après :
```js
function createTile(item, pos, label, fetchPriority = 'auto') {
  // ...
  if (item.src) {
    const img = document.createElement('img');
    if (fetchPriority !== 'auto') img.fetchPriority = fetchPriority;
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
```

**Important :** `fetchPriority` doit être set **avant** `img.src`, sinon le fetch démarre avec priority par défaut et la modif est ignorée.

### `app.js` — `fillUntil` (app.js:915-923)

Avant :
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

Après :
```js
let lcpPromoted = false;

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

### `app.js` — nouveau `prefillRemainingSources` (batché) + `flushPrefillSync`

```js
function prefillRemainingSources(deadline) {
  prefillHandle = null;
  let counter = liveTiles.length;
  const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
  let iterSinceCheck = 0;

  while (placedSrcs.size < pool.length) {
    // Tous les 3 itérations, vérifier le budget (createTile = ~1-2ms).
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

function flushPrefillSync() {
  if (prefillHandle !== null) {
    cancelIdle(prefillHandle);
    prefillHandle = null;
  }
  // Boucle sync sans budget — l'utilisateur attend déjà le smoothScroll de 700ms.
  let counter = liveTiles.length;
  const safety = pool.length * 3; // 81 max — protège contre boucle infinie hypothétique
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

### `app.js` — `init` (app.js:1112-1122)

Avant :
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

Après :
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

### `app.js` — `scrollToCurrentImage` (app.js:82-92)

Avant :
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

Après :
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
    if (targetY === Infinity) return; // sécurité (jamais atteint si pool.length sources accessibles)
  }
  const targetOffset = Math.max(minLiveTileY - SCROLL_TOP_Y, targetY - TOP_MARGIN);
  smoothScrollOffset(targetOffset);
}
```

### `app.js` — `rebuildLayout` (app.js:1126-1149)

**Vérif :** `rebuildLayout` itère sur `liveTiles` et repositionne les 51 tiles existantes. `placedSrcs` n'est pas reset → `prefillRemainingSources` ne re-créera rien. Le `fillUntil(h * 2)` en fin de `rebuildLayout` est no-op (déjà 51 tiles). **Aucune modif requise.**

### `index.html` — cache buster

`?v=20` → `?v=21` sur `styles.css` et `app.js`.

## Vérifications de cohérence avec l'existant

- **`frame()` cache 3 niveaux** : inchangé. Détache ~41 tiles phase 2 hors DETACH_MARGIN dès le 1er frame post-init. Tile détachée garde `tile.y` exploitable par `findMinTileY`.
- **`tileEnterIdx` (cascade < 30)** : continue de fonctionner. Tiles 31-51 (phase 2) auront `enterDelayMs = 0` mais sont hors viewport → invisible.
- **`rebuildLayout()` (resize)** : repositionne les 51 tiles. `placedSrcs` non reset → cohérent.
- **`HARD_RECYCLE = 50000px`** : si scroll très loin et tile recyclée, elle sera re-créée par `topUpIfNeeded`. `placedSrcs.has(src)` reste true → on n'appellera pas `prefillRemainingSources` à nouveau, mais le HTTP cache du browser servira le 2e fetch.
- **`currentFocusedProject`** : nouvelles tiles phase 2 adoptent `tile--project-focused`/`tile--project-dimmed` (app.js:872-876). Pas de régression.
- **`pickRandom` cycle déterministe** : `cycleIdx` continue d'incrémenter pendant phase 2. Si l'utilisateur recharge la page, l'ordre des tiles 1-51 est identique → couleurs glow, layouts reproductibles.

## Risques résiduels & mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| `requestIdleCallback` pas appelé avant ↑↓ click | Faible (typewriter du nav = 200-500ms tampon) | `flushPrefillSync` |
| `fetchpriority` ignoré par browser ancien (Safari < 17.2) | Faible | Dégradation gracieuse : `auto` partout, pas pire qu'aujourd'hui |
| 51 tiles DOM totales : empreinte mémoire | Faible | Cache 3 niveaux détache ~41 immédiatement, DOM actif ~10 tiles |
| `tile.el.remove()` annule fetch en cours sur browser exotique | Très faible | Risque accepté ; le `flushPrefillSync` recrée la tile à la demande, browser refait le fetch |
| LCP candidate n'est pas la 1ère tablet (autre tile visible plus grande) | Faible-Moyenne | Heuristique acceptable ; à mesurer avec Lighthouse, ajuster si régression |
| Lighthouse "Avoid an excessive DOM size" warning | Moyenne | 51 nodes top-level + sub-DOM tile ≈ 500 nodes — sous le seuil 1500. Si dépassé, refactor lazy DOM en option B (hors scope) |
| `navigator.connection` indisponible (Safari) | Moyenne | `shouldSkipPrefill` retourne `false` → comportement par défaut (préfill actif). Conservateur. |
| Phase 2 saturée par une page lourde concurrente (autre onglet) | Faible | `requestIdleCallback` est par nature opportuniste — délai acceptable |

## Tests de validation

### 1. Bug navigation résolu
- Hard-reload (DevTools → "Empty Cache and Hard Reload")
- Click immédiat sur n'importe quel projet de la liste client
- ↑↓ plusieurs fois → scroll smooth doit fonctionner pour toutes les maquettes
- **Critère :** 0 no-op, image visible quasi-instantanément à l'arrivée

### 2. Préchargement HTTP complet
- DevTools Network, conserver après reload
- Filtrer par `.webp`
- **Critère :** 27 fetches dans les 10 premières secondes (4G simulé) ou 2s (no throttling)
- **Critère :** tiles phase 2 ont `Priority: Low` dans la colonne Priority de Network
- **Critère :** la tile marquée `fetchpriority="high"` (1ère tablet) a `Priority: High`

### 3. Cache HTTP persisté après idle
- Hard-reload, attendre 10 secondes sans interaction
- DevTools Network → reload sans vider le cache
- **Critère :** les 27 srcs apparaissent en `(disk cache)` ou `(memory cache)` dans la colonne Size

### 4. LCP — Lighthouse mobile
- Lighthouse "Performance" + "Mobile" + "Slow 4G" throttling
- **Critère :** LCP < 2.5s (idéalement amélioré vs ancien comportement)
- **Critère :** INP < 200ms
- **Critère :** TBT (Total Blocking Time) < 200ms

### 5. Safety flush au click avant fin phase 2
- DevTools Performance → CPU 6× slowdown
- Hard-reload, click immédiat sur un projet, ↑↓ instantané
- **Critère :** scroll smooth fonctionne (flush sync se déclenche)
- **Critère :** pas de jank > 50ms (idéalement < 30ms)

### 6. Adaptation réseau (saveData)
- DevTools Network → throttle "Custom" → Save-Data ON
- Hard-reload
- **Critère :** seulement les ~10 tiles phase 1 dans Network au boot (pas les 17 supplémentaires)
- **Critère :** click ↑↓ déclenche le flush et fetch à la demande

### 7. Cache buster
- Vérifier `?v=21` dans `index.html` pour `styles.css` et `app.js`

## Workflow déploiement

- Commit + push direct sur `main` → GitHub Pages déploie en ~35s
- Tests Lighthouse mobile sur `https://marcantoineguilbault.fr`
- Vérification manuelle scénarios 1, 2, 5 sur mobile réel (4G ou Wifi)

## Open questions (à valider en post-implémentation, hors scope MVP)

- **Si LCP régresse**, mesurer quelle tile est réellement LCP via DevTools Performance → Web Vitals → LCP element. Ajuster heuristique (peut nécessiter promouvoir 2 tiles : 1ère mobile visible + 1ère tablet).
- **Si phase 2 visible perceptuellement** (apparition saccadée de tiles en bas de viewport au scroll user), envisager limiter phase 2 à `placedSrcs.size === pool.length` ET `colHeights >= h * 5` pour mieux étaler.
