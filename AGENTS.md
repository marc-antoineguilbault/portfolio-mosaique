# Portfolio Mosaïque

Onepage contemplatif : mosaïque type Pinterest qui défile lentement de haut en bas, scroll infini, ratios iPhone 9:19.5 + iPad 3:4 harmonisés par span de colonnes.

## Stack

- HTML/CSS/JS vanilla, zéro dépendance
- Servi en statique pendant la maquette via `mcp__Claude_Preview__preview_start` (cwd = `portfolio-mosaique`) ou `python -m http.server 8000` à la racine
- Phase 1 : placeholders colorés + premières images réelles (`assets/quintessence/`)

## Fichiers

- `index.html` — squelette `viewport > scroller`
- `styles.css` — fond noir, viewport fixed, tuile = div absolute
- `data.js` — pool de projets (id, name, images avec type+seed+src)
- `app.js` — moteur : layout masonry, boucle rAF, wrap-around, interactions
- `assets/` — vraies images des projets

## Lancer

```bash
cd "portfolio-mosaique"
python -m http.server 8000
# Ouvrir http://localhost:8000
```

## Statut

Projet en phase de **maquettage UI**. Vit temporairement dans le worktree `~/.claude/.claude/worktrees/charming-kalam-dfc729/portfolio-mosaique/`. Sera déplacé vers `~/Documents/CLAUDE/Freelance/Portfolio Mosaïque/` + repo GitHub privé `portfolio-mosaique` une fois la maquette validée.

## Spec & Plan

Voir le worktree d'orchestration `~/.claude` pour les docs de design :
- Spec : `docs/superpowers/specs/2026-05-24-portfolio-mosaique-design.md`
- Plan : `docs/superpowers/plans/2026-05-24-portfolio-mosaique.md`
