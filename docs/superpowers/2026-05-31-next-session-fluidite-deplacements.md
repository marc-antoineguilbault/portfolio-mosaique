# Prompt — nouvelle session : recherche « lissage de vitesse » + reco ICE fluidité des déplacements

> À coller tel quel au démarrage d'une nouvelle session.

---

Projet : **portfolio-mosaique** (`/Users/marc-antoineguilbault/Documents/CLAUDE/Freelance/portfolio-mosaique`, branche `feat/warp-curseur-elastique`). Onepage contemplative : mosaïque masonry qui défile (scroll infini, fond noir, ratios iPhone 9:19.5 + iPad). Stack : **HTML/CSS/JS vanilla, zéro dépendance**, build esbuild, tests Playwright (`--workers=1`), déploiement GitHub Pages. Docs de design dans `docs/superpowers/specs/` et `docs/superpowers/plans/`.

**Contexte récent (pour ne PAS re-proposer ce qui a été écarté)** : on a exploré un « warp » réactif à la vélocité de scroll **et** un curseur élastique à glyphe → **les deux ont été retirés après tests** (jugés hors-ton avec l'élégance contemplative). Le module `velocity.js` (tracker de vélocité) a été supprimé. Il ne reste qu'un léger squash d'impact (`squash-bump`, −1,5 %) quand on bute aux extrémités du ruban en focus. Le service worker est désactivé en localhost (fix dev). Un voile coloré monochrome teinte le fond au focus.

**Les « déplacements » à rendre plus fluides :**
- **Scroll mosaïque** : auto-scroll permanent (boucle `frame()` en rAF, vitesse linéaire ~30 px/s) + molette (`offset += deltaY * 0.5`) + swipe tactile avec momentum (friction 0.94, `offset` clampé à un floor) ; recyclage de tuiles à 3 niveaux ; chaque tuile positionnée en `translate3d` dans `frame()`.
- **Focus mode** : clic sur une maquette → elle se centre verticalement (transition CSS `translate3d`, `EXIT_MS = 700 ms`, easing `cubic-bezier(0.16, 1, 0.3, 1)`) ; ruban horizontal de clones ; navigation advance/retreat (shift du ruban, mêmes transitions), `loopToStart` (1600 ms, ease-out extrême), rebonds aux extrémités.
- Tilt 3D au hover (lift puis rotateX/Y), glow respirant, scroll auto interne aux maquettes au survol.

**Ta mission :**

1. **Recherche web approfondie (année courante)** sur les **bonnes pratiques de lissage de vitesse / velocity smoothing** pour des déplacements/animations web fluides. Sujets à couvrir : damping *frame-rate-independent* (lerp exponentiel `x += (target - x) * (1 - exp(-k·dt))`), ressorts critiques (stiffness / damping ratio), easing (Penner, cubic-bezier), inertie / momentum / décélération, interpolation, le piège classique du `lerp(a, b, 0.1)` par frame qui dépend du framerate (cf. Freya Holmér « lerp smoothing is broken »), et la **perception** de la fluidité (principes de motion design, 60→120 fps, jank/INP). Vise des sources concrètes et récentes (Codrops, articles spécialisés, GitHub, talks), avec code/exemples. Fais 2-3 requêtes ciblées en parallèle, puis fetch les 2-3 meilleures sources ; relance si les résultats sont vagues ou datés.

2. **Reco ICE priorisée** pour améliorer la **fluidité PERCEPTIBLE des déplacements** listés ci-dessus. Pour chaque idée : **Impact** (1-10 : gain de fluidité ressentie + qualité perçue) × **Confidence** (1-10 : faisabilité réelle) × **Ease** (1-10 : effort dev, 10 = trivial) → **score = I × C × E / 10**, trié décroissant, **top 8 minimum**. Pour chacune : 1 phrase de pitch + 1 phrase d'implémentation technique. Termine par une reco de **sprint « quick wins »** (2-3 idées top score à faire ensemble).

Pistes probables à évaluer (non exhaustif, à challenger par la recherche) : passer les `lerp` par frame à un damping indépendant du framerate ; remplacer les transitions CSS à durée fixe du focus par des ressorts (durée = fonction de la distance) ; lisser la molette (accumulateur + easing au lieu d'un saut brut) ; momentum tactile plus naturel ; respect de `prefers-reduced-motion` ; budget INP/jank.

**Contraintes** : vanilla JS **zéro-dépendance** (si une micro-lib de spring change vraiment la donne, évalue-la mais signale le compromis vs l'ADN du projet) ; respecter le ton **contemplatif / élégant / retenu** (le user préfère le subtil — il a écarté les effets trop voyants) ; **local-first : jamais commit/push sans son accord explicite** ; réponses **en français**, concises, termes techniques précis.
