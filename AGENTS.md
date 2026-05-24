# Portfolio Mosaïque

Onepage contemplatif : mosaïque type Pinterest qui défile lentement de haut en bas, scroll infini, ratios iPhone 9:19.5 + iPad 3:4 harmonisés par span de colonnes.

## Stack

- HTML/CSS/JS vanilla, zéro dépendance
- Servi en statique : `python -m http.server 8000` à la racine
- Phase 1 : placeholders colorés (pas de vraies images)

## Fichiers

- `index.html` — squelette `viewport > scroller`
- `styles.css` — fond noir, viewport fixed, tuile = div absolute
- `data.js` — pool de projets (id, name, images avec type+seed)
- `app.js` — moteur : layout masonry, boucle rAF, wrap-around, interactions

## Lancer

```bash
cd "Portfolio Mosaïque"
python -m http.server 8000
# Ouvrir http://localhost:8000
```

## Spec & Plan

Voir le worktree d'orchestration `~/.claude` pour les docs de design :
- Spec : `docs/superpowers/specs/2026-05-24-portfolio-mosaique-design.md`
- Plan : `docs/superpowers/plans/2026-05-24-portfolio-mosaique.md`
