# Slider de maquettes par projet (au clic)

## Contexte

Aujourd'hui, un clic sur une tuile (desktop uniquement, gardé par `HAS_HOVER`)
déclenche le **focus projet** (`focusProject()` dans `app.js`) : les tuiles du projet
passent en `tile--project-focused`, les autres en `tile--project-dimmed`, le coin
haut-gauche affiche « pour &lt;Nom&gt; » et une nav `N/M ↑ ↓` fait défiler verticalement
la mosaïque entre les maquettes du projet (éparpillées dans la grille via
`navigateToProjectImage()` / `scrollToCurrentImage()`). Un clic dans le vide
(`viewport` click handler) appelle `unfocusProject()`.

Rappel du moteur : la mosaïque est un scroll vertical infini. `liveTiles` contient des
objets `{el, inner, item, x, y, w, h, velocityMultiplier, colIdx, detached}`. La boucle
`frame()` (rAF) calcule `ty = tile.y - offset*velocityMultiplier + stagger` et écrit
`transform: translate3d(x, ty, 0)` ; elle recycle les tuiles (3 niveaux : visible /
détachée / hard-recycle) et appelle `topUpIfNeeded()`. `offset` avance via `velocity`
(auto-scroll) + molette + tactile.

On **remplace** le focus projet par un **slider horizontal de maquettes**, ouvert par
une transition « rideau » au clic. Le focus projet (dim + nav verticale) est retiré.

## Comportement attendu

1. **Déclenchement (clic sur une tuile).**
   - Tuile verrouillée (`.tile-lock` visible, projet `locked` — ex. Courvoisier) :
     comportement cadenas/mot de passe **inchangé** (délègue à `modules/lock.js`). Le
     slider ne s'ouvre **pas** tant que le projet n'est pas déverrouillé.
   - Sinon : on gèle la mosaïque, on joue la transition rideau, et on ouvre le slider
     du projet (`item.project`) **sur la maquette cliquée** (= diapo courante).
   - Disponible **desktop ET mobile/tactile** (on retire le garde `if (!HAS_HOVER) return`
     du handler de clic). Le clic sur un projet dans la liste du coin TL
     (`openClientList()` → `activate()`) ouvre désormais le slider sur la **1re** maquette
     du projet (au lieu de `focusProject`).

2. **Transition d'ouverture (rideau + FLIP).**
   - `freezeMosaic()` : flag `frozen` qui met `frame()` en **veille** (early-return après le
     bookkeeping de `dt`) → plus d'avance de `offset`, plus de recyclage ni de
     `topUpIfNeeded()`, plus d'écriture de transforms. Les tuiles à l'écran gèlent en place
     et la boucle ne consomme quasi plus de CPU pendant le slider.
   - On mémorise le rect écran de la tuile cliquée `T` (`getBoundingClientRect()`).
   - **Rideau** : chaque tuile vivante `≠ T` est projetée hors écran — vers le **haut**
     si le centre Y de la tuile &lt; centre Y de `T`, vers le **bas** sinon. Direction
     stockée sur la tuile (`tile.exitDir = 'up' | 'down'`) pour le retour. Transition CSS
     sur `transform` (compositing GPU), stagger ∝ distance verticale au point de clic
     (jusqu'à ≈ 60 ms), durée ≈ 0,7 s, easing `cubic-bezier(0.16, 1, 0.3, 1)` (déjà utilisé
     dans le projet). Seules les tuiles **attachées/visibles** sont animées ; les tuiles
     déjà détachées (hors zone DOM) gardent juste leur `exitDir`.
   - **FLIP de la cliquée** : la diapo courante du slider démarre exactement sur le rect
     de `T` (translate + scale inverses) puis s'anime vers sa position centrée. La tuile
     `T` d'origine est masquée (mais gardée en place, gelée, pour le retour).
   - Les diapos voisines (ordre naturel du projet) entrent depuis la droite/gauche en
     dépassant légèrement.

3. **Slider établi.**
   - Calque `position: fixed; inset: 0`, fond noir. À ce stade les tuiles non cliquées
     sont déjà hors écran (rideau) et la cliquée est passée au slider : l'écran derrière le
     calque est donc vide — le fond noir du calque suffit.
   - **Ordre** : les maquettes du projet dans l'ordre naturel (tri par `src` :
     `m01 → m02 → … → t01 → t02 …`, identique à `currentProjectImages`). La maquette
     cliquée est l'index courant ; précédentes à gauche, suivantes à droite.
   - **Layout** : diapo courante centrée ; voisines décalées de ±(largeur diapo + gap),
     partiellement visibles (dépassent). Ratios conservés (`RATIOS.mobile` 9:19.5 portrait,
     `RATIOS.tablet` paysage) ; hauteur cible ≈ hauteur écran − marges, largeur déduite du
     ratio. On conserve le `tile-frame` (passe-partout noir + radius) pour la cohérence DA.
   - **Auto-scroll vertical** de la **diapo courante** : réutilise le mécanisme de
     `attachScroll()`. Desktop = au survol (comme la mosaïque) ; mobile (pas de hover) =
     défilement continu lent. Les voisines restent figées en haut. Changement de diapo →
     reset/relais de l'auto-scroll sur la nouvelle courante.
   - **Navigation (tous moyens combinés)** :
     - Flèches `←` `→` à l'écran + indicateur **N / M** (réutilise le coin TL
       « pour &lt;Nom&gt; » repensé horizontal).
     - Clavier `←` `→` (et **Échap** = fermer).
     - Clic sur une diapo voisine qui dépasse → va à elle.
     - Glisser souris + swipe tactile **horizontal** → navigue, avec suivi du
       pointeur et **snap** à la diapo la plus proche au relâché. Le geste **vertical**
       (mobile) laisse passer le scroll vertical de la diapo courante (2 axes distincts).
     - Pas de wrap : clamp à la 1re / dernière diapo.

4. **Fermeture & retour.**
   - Déclencheurs : clic dans le **vide** du calque (hors d'une maquette), touche **Échap**.
   - La diapo courante refait un **FLIP** vers le rect de la tuile cliquée d'origine
     (toujours à sa place, gelée), puis `returnTiles()` : chaque tuile revient de sa
     direction de sortie (`exitDir`), transition inverse. Au `transitionend`, on **nettoie**
     les `transition` / `transform` inline posés sur les tuiles (sinon `frame()` réécrirait
     `transform` à chaque frame avec une transition résiduelle → auto-scroll en retard),
     puis `resumeMosaic()` : la boucle reprend exactement à l'`offset` gelé et réécrit les
     `translate3d` aux mêmes valeurs → aucun saut visuel.
   - Résultat : **mosaïque rigoureusement identique à l'état initial** (tuiles parties vers
     le haut reviennent du haut, et inversement).

5. **Cas limites.**
   - **Projet à 1 maquette** (Royal Canin, Porsche) : slider à 1 diapo → pas de flèches,
     pas de voisines, pas de nav ; explode + centre + clic-out/Échap = retour.
   - **Projet verrouillé** (Courvoisier) : cf. point 1 — cadenas, pas de slider.
   - **`prefers-reduced-motion`** (`REDUCED_MOTION`) : pas de rideau animé ni d'auto-scroll
     → ouverture en cross-fade court, lecture verticale en scroll manuel. Cohérent avec les
     gardes reduced-motion existantes.
   - **Resize pendant le slider** : recalcul des tailles de diapos (le slider écoute
     `resize`). La mosaïque gelée sera de toute façon reconstruite au retour
     (`rebuildLayout()` existant).
   - **Verrou `transitioning`** : pendant l'ouverture/fermeture, les clics et déclencheurs
     de nav sont ignorés (anti-double-déclenchement).

## Implémentation

### `modules/slider.js` (nouveau)
Module autonome du slider. Responsabilités : DOM du calque, état (index courant), layout
des diapos, navigation (clavier / clic voisin / drag / swipe / flèches), auto-scroll de la
diapo courante, ouverture/fermeture.
- API : `openSlider({ projId, startSrc, originRect, onClosed })`, `closeSlider()`.
- État interne : `slides` (liste des images du projet, ordre naturel), `index`, `mode`.
- Construit les diapos depuis `pool.filter(i => i.project === projId)` triées par `src`
  (réutilise la logique de `currentProjectImages`). Chaque diapo = un `tile-frame` +
  contenu scrollable **allégé** : on réutilise `attachScroll()` + la scrollbar custom, mais
  **sans** le tilt 3D ni le glow/contour curseur (affordances de survol propres à la
  mosaïque, hors sujet dans un slider focalisé).
- FLIP d'ouverture/fermeture sur la diapo courante à partir de `originRect`.
- Appelle `onClosed()` (fourni par `app.js`) à la fin de la fermeture pour
  `returnTiles()` + `resumeMosaic()`.

### `app.js`
- État : `mode = 'mosaic' | 'transitioning' | 'slider'`.
- `freezeMosaic()` / `resumeMosaic()` : flag `frozen` ; quand `frozen`, `frame()` fait un
  early-return (veille) après le bookkeeping de `dt` — aucune écriture de transform, aucun
  recyclage, aucun `topUpIfNeeded()`.
- `explodeTiles(clickedTile)` : calcule `exitDir` par tuile (centre Y vs centre Y de la
  cliquée), pose `transition` + `transform` de sortie (stagger ∝ distance, durée ≈ 0,7 s) ;
  ignore les tuiles déjà détachées (set `exitDir` seul).
- `returnTiles()` : animation inverse vers la position d'origine, puis au `transitionend`
  nettoie les `transition` / `transform` inline avant `resumeMosaic()` (cf. § Fermeture).
- Handler de clic tuile (`inner` click, ~ligne 848) : garde le branchement cadenas ; retire
  `if (!HAS_HOVER) return` ; remplace `focusProject/unfocusProject` par
  `freezeMosaic()` + `explodeTiles()` + `openSlider({...})`.
- `viewport` click handler (~ligne 1087) : la fermeture est désormais gérée par le slider
  (clic dans le vide du calque) — retirer le branchement `unfocusProject`.
- **Suppression** du focus projet (après vérification des usages — certains helpers de
  scroll peuvent être partagés) : `focusProject`, `unfocusProject`,
  `navigateToProjectImage`, `renderProjectNav`, `typewriteProjectNav` + les helpers de
  nav verticale (`scrollToCurrentImage`, `findMinTileY`, `scrollToFirstProjectTile`,
  `smoothScrollOffset` s'il n'est plus utilisé ailleurs) + état `currentFocusedProject` /
  classes `tile--project-focused` / `tile--project-dimmed` (et CSS associé). Conserver
  `preloadProjectAndNeighbors` (préchargement des srcs du projet), réorienté vers
  l'ouverture du slider.
- `openClientList()` → `activate()` : remplacer `focusProject(p.id)` par l'ouverture du
  slider sur la 1re maquette du projet.

### `styles.css`
- `.slider`, `.slider__slide`, `.slider__slide--current`, états voisines, indicateur/flèches,
  fond. Réutilise `--frame-padding` / `--tile-radius-*` pour la cohérence.
- Transitions rideau côté tuiles : classe d'état + variables (`--exit-dir`, durée, stagger).
- Retirer les règles `.tile--project-focused` / `.tile--project-dimmed` (focus supprimé).
- Bloc `@media (prefers-reduced-motion: reduce)` : neutraliser rideau + auto-scroll slider.

## Hors-scope (YAGNI)
- Pas de wrap circulaire (clamp aux bornes).
- Pas de deep-linking / URL par maquette, pas de zoom dans une maquette.
- Pas de miniatures/pagination en plus de l'indicateur `N / M`.
- Pas d'auto-play (slider explicitement non automatique).

## Vérification
- **Playwright** (desktop + mobile) :
  - Clic tuile (projet déverrouillé) → calque slider visible, diapo courante = `src` cliquée.
  - Nav flèches / clavier `←` `→` / swipe → change la diapo + met à jour `N / M`.
  - Clic dans le vide / `Échap` → calque retiré, mosaïque reprend (mode `mosaic`).
  - Projet à 1 maquette → pas de flèches.
  - Projet verrouillé → champ mot de passe, pas de slider.
  - Smoke : aucune erreur console ; rejouer la suite existante (mosaïque, lock, liste
    clients) → aucune régression.
- **Visuel** (screenshot, desktop + mobile) : rideau qui s'ouvre, diapo centrée + voisines
  qui dépassent, retour identique à l'état initial.
