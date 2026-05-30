# Warp squash-stretch + curseur élastique — Design

- **Date** : 2026-05-30
- **Projet** : portfolio-mosaique
- **Statut** : validé en brainstorming, prêt pour le plan d'implémentation
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
- ✏️ `app.js` — `frame()` compose le warp ; `advance()`/`retreat()` appliquent le warp focus ; pose les `data-cursor` dynamiques ; délègue le curseur à `cursor.js`.
- ✏️ `styles.css` — `transform-origin: center` sur `.tile` ; dimensions/transition du curseur pour porter le glyphe ; règles `reduced-motion`.
- Build esbuild inchangé (les nouveaux modules sont bundlés/tree-shakés).

### Modules & interfaces
- **`velocity.js`** → `createVelocityTracker({ lerp, vMin, vMax })` renvoyant un objet `{ sample(offset, dt) → vSmooth, normalized() → n∈[0,1], signed() }`. Ne mesure que le mouvement réel d'`offset` (molette + swipe + momentum) ; l'auto-scroll lent (~30 px/s) reste sous `vMin` ⇒ `n = 0`.
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
- Normalisation : `n = clamp((|vSmooth| − V_MIN) / (V_MAX − V_MIN), 0, 1)`, **V_MIN ≈ 200 px/s**, **V_MAX ≈ 2500 px/s**.
- Warp doux : `scaleY = 1 + n · 0.05`, `scaleX = 1 − n · 0.022`. Étirement symétrique (haut comme bas).
- Composition : `translate3d(x, ty, 0) scale(sx, sy)`, `transform-origin: center`. Tant que `n = 0`, `scale(1)` ⇒ le skip-write `_lastTy` reste actif (coût nul au repos).
- Débordement : +5 % ≈ ±10 px répartis ; les gaps (220 px desktop, 80 px mobile) l'absorbent — pas de chevauchement gênant.

### Focus (horizontal)
- Pendant `advance()`/`retreat()`, le `delta` du shift et sa durée (`EXIT_MS = 700 ms`) donnent une **pseudo-vélocité** ⇒ un `scaleX` transitoire (pic en milieu de course, retour à 1), appliqué sur un niveau interne du slot, `transform-origin: center`.
- Dosé **encore plus léger** (~+3 %) pour préserver la chorégraphie du ruban. Point le plus délicat ; non-régression à tester.

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
  - clones / cliquée en focus → `data-cursor` **posé dynamiquement par `app.js`** selon la position (gauche `⭠` / cliquée·droite `⭢`), réutilisant la logique du click handler (`retreat` si à gauche, `advance` sinon).
  - rien ailleurs → rond nu.

### Apparence
- Repos : rond gris translucide (état actuel), nu.
- Au survol d'une zone à glyphe : **disque blanc plein, glyphe noir centré**, ~26 px. Réemploie le blanc déjà présent (ancien état « locked »). Le rouge `#ff3030` reste réservé à l'UI texte.

### Remplacement du « locked »
Le comportement actuel (rond qui rétrécit en point blanc 8 px au survol d'une tuile) est **remplacé** par l'affichage du glyphe. `attachTilt` ne touche plus `cursorEl.classList` ; `cursor.js` gère l'apparence.

### Tactile / reduced-motion
- **Tactile** : pas de curseur (déjà géré par `HAS_HOVER`) — feature desktop, inchangée.
- **reduced-motion** : glyphe conservé (signal d'état, comme le « lock » l'était), élasticité coupée (position directe, pas d'étirement).

## 7. Perf
- Warp = un `scale()` ajouté à un `transform` déjà écrit ; aucun nouvel élément ni listener ; `n = 0` ⇒ aucun write (skip `_lastTy`). Vélocité = un calcul scalaire/frame. `will-change: transform` déjà posé.
- Curseur = 1 rAF de lerp (GPU) + délégation d'événements (pas N listeners).
- Vigilance : `scale` sur images peut induire du repaint mobile ⇒ mesurer via Lighthouse CI (budget existant), baisser `KY` si nécessaire.

## 8. A11y
- `reduced-motion` couvert (warp off, curseur sans élasticité, glyphe gardé).
- Warp purement visuel : aucune incidence sémantique.
- Glyphe curseur décoratif (`#cursor` hors arbre a11y) ; l'info réelle reste portée par les boutons `⭠ ⭢` du compteur (déjà `aria-label`). Nav clavier inchangée.

## 9. Tests (Playwright + Lighthouse, comme l'existant)
- `velocity.js` : unitaire — lissage, normalisation, seuils `V_MIN`/`V_MAX`.
- Warp : `scale ≈ 1` au repos / `> 1` après un wheel rapide simulé ; `reduced-motion` ⇒ pas de scale ; **non-régression** scroll + focus mode.
- Curseur : `data-cursor="+"` sur `.tile-inner` ; glyphe affiché au hover ; `reduced-motion` ⇒ pas d'élasticité.
- Smoke : mosaïque + focus + lock intacts.
- Lighthouse CI : pas de régression de perf (budget existant).

## 10. Risques & points de vigilance
- **Warp focus horizontal** : le plus délicat (transitions scriptées, pas de vélocité continue) ⇒ doser très léger, tester la non-régression de la chorégraphie.
- **Repaint mobile** du `scale` sur images ⇒ mesurer, ajuster les constantes.
- **Extraction du curseur** : découpler proprement `attachTilt` (qui gère aussi `hoverPaused`) de l'apparence du curseur, sans dupliquer le listener `mousemove` global qui alimente le contour lumineux (`--cursor-x/y`).

## 11. Hors scope / pistes futures
- Glyphes contextuels sur les autres zones (mail → ✉, nom/rôle, cadenas → 🔓).
- Les pistes ICE écartées (aberration, shader WebGL, audio, variabilité, etc.) restent documentées dans le plan ICE d'origine pour d'éventuelles phases ultérieures.
