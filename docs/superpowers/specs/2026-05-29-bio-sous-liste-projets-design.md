# Phrase de bio sous la liste des projets

## Contexte

Au clic sur la phrase d'identité en haut à gauche (« Marc-Antoine Guilbault, Lead
Designer UI »), la mosaïque se masque et le suffix se transforme en « pour » suivi
d'une liste verticale de tous les noms de projet (`openClientList()` dans `app.js`,
`<ul class="ui-corner__suffix-list">`).

Aujourd'hui les noms apparaissent tous d'un coup (aucune animation séquentielle).
On ajoute : (1) une apparition en cascade des noms, (2) une phrase de bio en bas de
l'écran qui apparaît après le dernier nom.

Desktop uniquement : l'ouverture de la liste est déjà gardée par `HAS_HOVER` ; sur
tactile la liste ne s'ouvre pas, donc la phrase non plus. Aucun code mobile à ajouter.

## Comportement attendu

1. **Cascade des noms.** À l'ouverture, chaque `<li>` de la liste apparaît l'un après
   l'autre (fondu + légère translation verticale), avec un décalage constant `STEP`
   entre items (ordre = ordre de `projects`). Sous `prefers-reduced-motion` : pas de
   stagger, apparition instantanée.

2. **Phrase de bio.**
   - Texte (constante) : « Je maîtrise des systèmes, les ordonne, les décline et les
     enrichis. La rigueur dans chaque détail. »
     (repris de `Portfolio Personnel/app.js` → `STATUSES[0]` (`key: 'interactif'`,
     rôle « Lead Designer Interactif »), champ `bio`.)
   - Position : **fixe, en bas du viewport**. Bord gauche aligné sur la **colonne des
     noms** (même x que « Liquides Paris », donc indenté après « pour »). Le x est
     calculé au runtime via `getBoundingClientRect()` de la liste (ou du 1er item).
   - Style : blanc `#fff`, même famille de police / taille que le texte UI des coins
     (hérité de `.ui-corner`). Retour à la ligne autorisé (max-width raisonnable pour
     ne pas toucher le bord droit).
   - Apparition : **après le dernier nom**. Délai d'entrée ≈ `projects.length × STEP`
     (juste après la fin de la cascade), en fondu. Sous reduced-motion : immédiat.

3. **Fermeture.** À `closeClientList()` (re-clic, sélection d'un projet, Échap), la
   phrase est retirée du DOM et l'état cascade réinitialisé, en cohérence avec le
   nettoyage existant du suffix.

4. **Redimensionnement pendant l'ouverture.** Si la fenêtre est redimensionnée alors
   que la liste est ouverte, recalculer le `left` de la phrase pour rester aligné sur
   la colonne des noms (le x dépend de la largeur du texte « …, pour »).

## Implémentation

### `app.js`
- Constante `BIO_TEXT` (la phrase ci-dessus) et `CASCADE_STEP_MS` (≈ 60 ms, à régler).
- `openClientList()` :
  - Pour chaque `<li>` créé : `li.style.setProperty('--enter-delay', i * STEP + 'ms')`
    et une classe/état déclenchant l'animation d'entrée (cf. CSS).
  - Créer un élément `.ui-bio` (texte = `BIO_TEXT`), l'ajouter à `.ui-overlay`.
    Après insertion DOM, calculer `left = liste.getBoundingClientRect().left` et le
    poser sur `.ui-bio`. Déclencher son apparition avec un délai ≈ `projects.length × STEP`
    (classe `is-visible` posée via `setTimeout`, ou `animation-delay`/`transition-delay`).
  - Sous `REDUCED_MOTION` : delays à 0 (cascade + bio instantanés).
- `closeClientList()` : retirer l'élément `.ui-bio` et réinitialiser l'état.
- Recalcul du `left` de `.ui-bio` sur l'évènement resize existant (uniquement si la
  liste est ouverte).

### `styles.css`
- `.ui-corner__suffix-item` : état initial `opacity: 0` + `translateY(...)` quand la
  liste est en cours d'apparition ; transition/animation vers visible pilotée par
  `--enter-delay`. Gardé pour ne s'appliquer qu'à l'ouverture (classe d'état sur la
  liste / le body), afin de ne pas casser l'état statique existant.
- `.ui-bio` : `position: fixed; bottom: <inset des coins>;` couleur `#fff`, police
  héritée, `max-width` pour le wrap, `opacity: 0` → `1` en fondu (retardé après la
  cascade). `left` posé en JS.
- `@media (prefers-reduced-motion: reduce)` : neutraliser les délais (déjà un bloc
  reduced-motion existant à étendre).

> Accès : `styles.css` est actuellement verrouillé en lecture au niveau macOS
> (`Operation not permitted`). À débloquer avant l'implémentation CSS.

## Hors-scope (YAGNI)
- Aucune animation/comportement mobile (la liste ne s'ouvre pas sur tactile).
- Pas de changement aux noms eux-mêmes (texte, navigation, focus projet) hormis leur
  apparition en cascade.

## Vérification
- Test Playwright (desktop) : ouvrir la liste → la phrase `.ui-bio` existe, contient
  le texte attendu, son `left` ≈ celui de la liste des noms, elle devient visible
  après les noms. À la fermeture : `.ui-bio` retiré.
- Contrôle visuel via screenshot (desktop) : phrase en bas, alignée à la colonne.
- Rejouer la suite existante (smoke + mobile + lock) : aucune régression ; sur mobile
  la liste/phrase n'apparaît pas.
