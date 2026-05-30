# Warp squash-stretch + curseur élastique — Design

- **Date** : 2026-05-30
- **Projet** : portfolio-mosaique
- **Statut** : validé en brainstorming, révisé (critique), prêt pour le plan d'implémentation
- **Stack** : HTML/CSS/JS vanilla, zéro dépendance, build esbuild, déploiement GitHub Pages

## 1. Contexte & intention

Le portfolio est une mosaïque masonry contemplative (scroll infini, fond noir, glow extrait des images, tilt 3D, focus mode à ruban, curseur custom). Il est déjà soigné ; l'objectif est de lui donner une **signature interactive** sans trahir son ADN raffiné.

Un audit + plan ICE avait dégagé quatre pistes de réactivité à la vélocité (« la vitesse devient matière ») : aberration chromatique, warp squash-stretch, curseur à personnalité, shader velocity-distortion WebGL. Une exploration via prototypes animés (compagnon visuel) a **resserré le périmètre à deux features** : l'aberration (même subtile) a été jugée trop « glitch » pour l'élégance du portfolio, et le shader WebGL écarté pour rester fidèle au zéro-dépendance.

**Fil rouge retenu** : une *matière élastique cohérente* — la mosaïque s'étire à la vitesse, le curseur s'étire au geste. Même physique, deux supports.

## 2. Périmètre

### Inclus
1. **Warp squash-stretch** des tuiles, piloté par la vélocité de scroll (mosaïque verticale + ruban du focus mode horizontal), desktop et mobile.
2. **Curseur élastique + glyphe contextuel** : inertie, étirement directionnel, et au survol un disque blanc à glyphe noir (`+` en mosaïque, `⭠ / ⭢` en focus).

### Exclu (et pourquoi)
- **Aberration chromatique** — rendu « glitch RGB » incompatible avec l'élégance contemplative, même à intensité subtile.
- **Shader velocity-distortion (WebGL)** — refactor lourd du moteur DOM + dépendance (OGL/Three.js) contraires au zéro-dépendance.
- **Magnétisme du curseur** — écarté au profit de l'élasticité + glyphe.
- **Glyphes hors maquettes** (mail, nom/rôle, cadenas) — rond nu « pour l'instant » ; l'architecture rendra l'ajout trivial plus tard.

## 3. Décisions de cadrage (journal)

| Décision | Choix |
|---|---|
| Intensité de référence des effets | **Subtile** (proto A) |
| Amplitude du warp | **Douce** (proto A) |
| Personnalité du curseur | Élastique **+** glyphe contextuel (pas de magnétisme) |
| Vocabulaire du curseur | **Un seul caractère** : `+` (maquette mosaïque), `⭠ / ⭢` (maquette en focus) |
| Apparence du curseur au survol | Disque **blanc plein, glyphe noir** (~26 px) |
| Terrain du warp | Mosaïque (vertical) **+** focus mode (horizontal) ; desktop **+** mobile |
| Architecture | Modules dédiés + couche vélocité partagée (approche A) |
| Dépendances | Aucune nouvelle |

## 4. Architecture

### Fichiers
- 🆕 `modules/velocity.js` — tracker de vélocité de scroll lissée (source unique).
- 🆕 `modules/cursor.js` — curseur élastique + glyphe contextuel (extraction de la logique curseur d'`app.js`).
- ✏️ `app.js` — `frame()` compose le warp ; `advance()`/`retreat()` appliquent le warp focus ; pose/recalcule les `data-cursor` ; appelle `velocityTracker.reset()` aux discontinuités ; délègue le curseur à `cursor.js`.
- ✏️ `styles.css` — `transform-origin: center` sur `.tile` ; `@keyframes` du warp focus ; dimensions/transition du curseur pour porter le glyphe ; règles `reduced-motion`.
- Build esbuild inchangé (les nouveaux modules sont bundlés/tree-shakés).

### Modules & interfaces
- **`velocity.js`** → `createVelocityTracker({ lerp, vMin, vMax })` exposant `{ sample(offset, dt) → vSmooth, normalized() → n∈[0,1], reset() }`. Ne mesure que le mouvement réel d'`offset` (molette + swipe + momentum) ; l'auto-scroll lent (~30 px/s) reste sous `vMin` ⇒ `n = 0`.
  - **Garde-fous** : `reset()` (appelé à `resumeMosaic()` et `rebuildLayout()`) remet `vSmooth = 0` et resynchronise `lastOffset` → les sauts d'`offset` non physiques (resize ⇒ `offset = 0`, retour de focus) ne produisent **pas** de pic. Un clamp dur borne `|vRaw|` (p. ex. à `vMax · 2`) pour absorber un `dt` aberrant.
- **Warp** (dans `frame()` d'`app.js`) → lit `n`, calcule `scaleY`/`scaleX`, compose le `scale()` avec le `translate3d` déjà écrit sur chaque `.tile`.
- **`cursor.js`** → `initCursor({ hasHover, reducedMotion })` : possède `#cursor`, fait le lerp de position, l'étirement directionnel, et lit un mapping de glyphes par délégation (`data-cursor` de l'élément survolé).

### Flux de données
```
molette / swipe / momentum → offset (frame) → velocityTracker.sample → v lissée, n
                                                      ├─→ warp scaleY/scaleX (mosaïque, vertical)
                                                      └─→ pseudo-v du shift → warp scaleX (focus, horizontal)
souris → cursor.js : lerp position + étirement directionnel + glyphe (hover [data-cursor])
```

### Point-clé de sûreté
Le warp s'écrit sur `.tile` (translate + scale) ; le tilt 3D reste sur `.tile-frame` (niveau distinct). Ils ne sont jamais actifs simultanément (l'auto-scroll est gelé au hover, donc `n→0`). Le recyclage de tuiles, le focus mode et l'a11y ne sont pas touchés.

## 5. Feature 1 — Warp squash-stretch

### Mosaïque (vertical)
- Lissage : `vSmooth += (vRaw − vSmooth) · 0.15` par frame → montée franche, retour organique au stop (pas de snap).
- Normalisation : `n = clamp((|vSmooth| − V_MIN) / (V_MAX − V_MIN), 0, 1)`, **V_MIN ≈ 200 px/s**, **V_MAX ≈ 2500 px/s** — *à calibrer par type d'input* (cf. §10).
- Warp doux : `scaleY = 1 + n · 0.05`, `scaleX = 1 − n · 0.022`. Étirement symétrique (haut comme bas).
- **Overshoot de décélération** : à l'arrêt, on laisse `n` repasser brièvement légèrement négatif (ressort) → `scaleY` < 1 un court instant, ce qui restitue le **rebond squash** validé au prototype (au lieu d'un retour monotone à 1).
- Composition dans `frame()` : `translate3d(x, ty, 0) scale(sx, sy)`, `transform-origin: center`.
- **⚠️ Correctif du skip-write** : le moteur n'écrit aujourd'hui le transform que si `ty` change (`if (tile._lastTy !== ty)`). Le warp ayant sa **propre dynamique** (à scroll arrêté, `ty` est constant mais `n` décroît encore via le lerp), ce skip figerait le `scale` à sa dernière valeur → **tuiles étirées en permanence**. Le critère devient : écrire si `_lastTy !== ty` **OU** `_lastN !== n`, et continuer tant que `n ≠ 0`. Une fois `n = 0` (état stable), le skip reprend → **coût nul au repos seulement**.
- **Reset** : `velocityTracker.reset()` à `resumeMosaic()` et `rebuildLayout()` (cf. §4) — sinon le `offset = 0` du resize produit un pic.
- Débordement : +5 % ≈ ±10 px répartis ; les gaps (220 px desktop, 80 px mobile) l'absorbent — pas de chevauchement gênant.

### Focus (horizontal)
- Pendant `advance()`/`retreat()`, le `delta` du shift et sa durée (`EXIT_MS = 700 ms`) donnent une **pseudo-vélocité** ⇒ un `scaleX` transitoire (pic en milieu de course, retour à 1).
- **Mécanisme** : `scaleX` appliqué sur le **`.tile-inner` du slot** — niveau dont le `transform` est libre (le tilt vit sur `.tile-frame`, le translate du ruban sur `.tile`), via une `@keyframes` courte déclenchée par une classe le temps du shift. `transform-origin: center`. Dosé **~+3 %**.
- ⚠️ **Point au plus faible ratio valeur/risque** : le ruban est chorégraphié au pixel (transitions scriptées, easings réglés). Si, à l'implémentation, le warp perturbe cette choré, on le **bascule en phase 2** (décision à valider à ce moment-là). Le cœur de la v1 reste **warp mosaïque + curseur**.

### Mobile
Le swipe alimente `offset` via `touchVelocity`/momentum ⇒ le warp fonctionne au swipe rapide sans code spécifique.

### reduced-motion
Warp neutralisé (`scale(1)` constant).

## 6. Feature 2 — Curseur élastique + glyphe

### Élasticité (`cursor.js`)
- `mousemove` pose une **cible** ; un rAF interne rattrape : `cur += (target − cur) · 0.2` → inertie légère.
- Étirement directionnel : la vélocité du rond (`cur − prev`) oriente une ellipse — `rotate(angle) scale(1 + st, 1 − st · 0.6)`, `st = clamp(vitesse · k, 0, ~0.45)` avec `k ≈ 0.045` (vitesse du rond en px/frame ; valeur issue du proto). Au repos → rond parfait.
- Rendu via `transform` (pas `width`) ⇒ aucun conflit avec la transition CSS existante du rond.

### Glyphe contextuel (délégation d'événements)
- `cursor.js` lit `data-cursor` de l'élément sous le curseur :
  - `.tile-inner` mosaïque → `data-cursor="+"` (statique).
  - **focus** → posé par `app.js` : tout `pastSlots` → **`⭠`**, tout `focusList` → **`⭢`** (la cliquée = `focusList[0]` → `⭢` = advance). **Recalculé à chaque `advance()` / `retreat()` / `loopToStart()`** puisque la cliquée change. La tuile source (mosaïque) voit son `data-cursor="+"` **overridé** quand elle devient cliquée, et **restauré à `+` à `exitFocus()`**.
  - rien ailleurs → rond nu.

### Apparence
- Repos : rond gris translucide (état actuel), nu.
- Au survol d'une zone à glyphe : **disque blanc plein, glyphe noir centré**, ~26 px. Réemploie le blanc déjà présent (ancien état « locked »). Le rouge `#ff3030` reste réservé à l'UI texte.

### Remplacement du « locked »
Le comportement actuel (rond qui rétrécit en point blanc 8 px au survol d'une tuile) est **remplacé** par l'affichage du glyphe. `attachTilt` **conserve** `hoverPaused` (pause auto-scroll) mais **ne touche plus** `cursorEl.classList` ; `cursor.js` gère l'apparence via la délégation `data-cursor`.

### Tactile / reduced-motion
- **Tactile** : pas de curseur (déjà géré par `HAS_HOVER`) — feature desktop, inchangée.
- **reduced-motion** : glyphe conservé (signal d'état, comme le « lock » l'était) mais **élasticité coupée** (position directe, pas d'étirement). La délégation `data-cursor` fonctionne aussi en `reduced-motion`, ce qui remplace bien l'ancien `locked` géré par `attachTilt`.

## 7. Perf
- Warp = un `scale()` ajouté à un `transform` déjà écrit ; **aucun nouvel élément ni listener**. Pendant la décélération (`n` décroît à `ty` constant), `frame()` écrit le transform à chaque frame (critère `_lastTy || _lastN`) — un `style.transform` par tuile visible, négligeable. Une fois `n = 0`, le skip reprend ⇒ coût nul au repos. Vélocité = un calcul scalaire/frame. `will-change: transform` déjà posé.
- Curseur = 1 rAF de lerp (GPU) + délégation d'événements (pas N listeners).
- Vigilance : `scale` sur des images peut induire du repaint mobile ⇒ on mesure via Lighthouse CI (budget existant) et on baisse `0.05` (`KY`) si besoin.

## 8. A11y
- `reduced-motion` couvert (warp off, curseur sans élasticité, glyphe gardé).
- Warp purement visuel : aucune incidence sémantique.
- Glyphe curseur décoratif (`#cursor` hors arbre a11y) ; l'info réelle reste portée par les boutons `⭠ ⭢` du compteur (déjà `aria-label`). Nav clavier inchangée.

## 9. Tests (Playwright + Lighthouse, comme l'existant — `workers=1`)
- `velocity.js` : unitaire — lissage, normalisation, seuils `V_MIN`/`V_MAX`, et **`reset()` neutralise un saut d'`offset`** (pas de pic).
- Warp : `scale ≈ 1` au repos ; après un wheel synthétique, `scale > 1` **vérifié dans la frame suivante** (la décroissance lerp rend l'assertion sensible au temps → lire juste après l'event, ou exposer `n` pour l'assertion) ; **le `scale` revient à 1** après stabilisation (couvre le bug du skip-write) ; `reduced-motion` ⇒ jamais de scale ; **non-régression** scroll + focus mode.
- Curseur : `data-cursor="+"` sur `.tile-inner` ; glyphe affiché au hover ; bascule `⭠/⭢` cohérente après `advance/retreat` ; `reduced-motion` ⇒ pas d'élasticité.
- Smoke : mosaïque + focus + lock intacts.
- Lighthouse CI : pas de régression de perf (budget existant).

## 10. Risques & points de vigilance
- **Calibration des seuils par type d'input** : molette (gros deltas espacés — un seul cran peut déjà dépasser `V_MAX`), trackpad (petits deltas fréquents), swipe mobile produisent des vélocités d'ordres de grandeur différents. `V_MIN`/`V_MAX` ne sont pas une valeur unique → calibrer (voire segmenter) par type d'input, le lissage absorbant les pics isolés.
- **Discontinuités d'`offset`** (resize ⇒ `offset = 0`, retour de focus) : neutralisées par `velocityTracker.reset()` + clamp, sinon pic de warp parasite.
- **Warp focus horizontal** : le plus délicat (transitions scriptées) ⇒ dosé très léger, **candidat phase 2** s'il perturbe la chorégraphie.
- **Repaint mobile** du `scale` sur images ⇒ mesurer, ajuster les constantes.
- **Extraction du curseur** : découpler `attachTilt` (qui garde `hoverPaused`) de l'apparence du curseur, sans dupliquer le `mousemove` global qui alimente le contour lumineux (`--cursor-x/y`) — `app.js` garde `mouseX/mouseY/cursorDirty`, `cursor.js` gère l'élément `#cursor`.
- **Effet de bord cosmétique** : le `scale` de la tuile étire aussi son contour lumineux `::before` (gradient en % de la tuile) — sans gravité, à vérifier visuellement.

## 11. Hors scope / pistes futures
- Glyphes contextuels sur les autres zones (mail → ✉, nom/rôle, cadenas → 🔓).
- Les pistes ICE écartées (aberration, shader WebGL, audio, variabilité, etc.) restent documentées dans le plan ICE d'origine pour d'éventuelles phases ultérieures.

## 12. Révision critique — 2026-05-30
Relecture adversariale confrontée au code réel (`frame()`, `rebuildLayout()`, focus mode). Corrections intégrées :
1. **(majeur)** Le skip-write `_lastTy` cassait la décroissance du warp → tuiles figées étirées à l'arrêt. Critère étendu à `_lastTy || _lastN`, boucle tant que `n ≠ 0` (§5, §7).
2. **(majeur)** Resets d'`offset` (resize, retour focus) → pics de vélocité parasites. Ajout `velocityTracker.reset()` + clamp (§4, §5, §9, §10).
3. **(moyen)** Warp focus : mécanisme précisé (`scaleX` sur `.tile-inner` via `@keyframes`) + signalé comme candidat phase 2 si conflit avec la choré (§5).
4. **(moyen)** Glyphe focus : recalcul `data-cursor` (`pastSlots → ⭠`, `focusList → ⭢`) à chaque navigation + override/restore du `+` (§6).
5. **(mineur)** Seuils `V_MIN`/`V_MAX` à calibrer par type d'input (§5, §10).
6. **(mineur)** Overshoot de décélération ajouté pour retrouver le rebond squash du proto validé (§5).
7. **(mineur)** Stratégie de test du warp précisée (sensibilité au temps) (§9).
8. **(mineur)** Note `attachTilt` : conserve `hoverPaused`, perd la gestion du `locked` (§6).
9. **(intégration)** Prise en compte du commit voile `5083a08` (voile coloré au focus, `box-shadow` retiré en focus, `.ui-grad-bg` retiré) — cf. §13.

## 13. Coexistence avec le voile coloré (commit `5083a08`)
Le code de base inclut désormais un **voile coloré monochrome du fond au focus** (teinte par projet dérivée des couleurs glow). La feature warp + curseur est **orthogonale** ; points d'intégration vérifiés :
- **Hooks focus du voile** : `focusTile()` appelle `applyBackdrop(focusList[0].item)` (pose `--backdrop-tint` sur `documentElement`) ; `exitFocus()` appelle `resetBackdrop()`. Le voile **ne touche pas** `advance/retreat/loopToStart` (teinte figée par projet, elle ne suit pas la navigation). Mon plan modifie `focusTile` (init `data-cursor`), `advance/retreat/loopToStart` (warp focus + recalcul glyphes) et `exitFocus` (restore `+`) → **préserver impérativement les appels `applyBackdrop`/`resetBackdrop` existants**.
- **CSS** : `body { background-color: var(--backdrop-tint, #000); transition: background-color 900ms }` et `body[data-mode="focus"] .tile-frame { box-shadow: none }`. Mon warp focus agit sur `.tile-inner` (pas `.tile-frame`) et ne touche pas le background → **aucun conflit**.
- **Dépendances** : le voile réutilise `extractGlowColors` / `__glowCache` / `colorFromSeed` ; la feature warp + curseur n'y touche pas.
- **Versions d'assets** : le voile a bumpé `app.js?v=135`, `styles.css?v=43` (manuels dans `index.html`) ; l'implémentation devra les bumper à nouveau (ou s'appuyer sur le hash de contenu du build).
