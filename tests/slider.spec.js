// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Slider projet — ouverture/fermeture', () => {
  // Les tuiles sont positionnées via transform:translate3d (RAF), ce qui fait que
  // Playwright ne peut pas les cliquer normalement ("outside of viewport" basé sur la
  // position DOM de base). On utilise dispatchEvent en page.evaluate pour déclencher
  // un vrai clic sur l'inner de la première tuile non-verrouillée.
  async function clickFirstTile(page) {
    await page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first().waitFor();
    await page.evaluate(() => {
      const inner = document.querySelector('.tile:not([data-project="courvoisier"]) .tile-inner');
      if (!inner) throw new Error('no unlocked tile-inner found');
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  test('clic sur une tuile ouvre le slider sur la maquette cliquée', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);

    await expect(page.locator('body')).toHaveAttribute('data-mode', 'slider');
    const slider = page.locator('.slider');
    await expect(slider).toBeVisible();
    // Une diapo courante est affichée.
    await expect(slider.locator('.slider__slide[aria-current="true"]')).toBeVisible();
  });

  test('clic dans le vide du slider ferme et revient en mosaic', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);
    await expect(page.locator('.slider')).toBeVisible();

    await page.locator('.slider').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.slider')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
  });

  test('Échap ferme le slider', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);
    await expect(page.locator('.slider')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.slider')).toHaveCount(0);
  });

  test('la diapo courante a la structure d\'une tuile (.tile-inner + .slider__scroll)', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);
    await expect(page.locator('.slider')).toBeVisible();
    const current = page.locator('.slider__slide[aria-current="true"]');
    // .tile-frame > .tile-inner > .slider__scroll : le .tile-inner apporte le radius-inner
    // (corrige le bug du radius) + la lumière ::after, comme une tuile mosaïque.
    await expect(current.locator('.tile-frame > .tile-inner')).toHaveCount(1);
    await expect(current.locator('.tile-inner > .slider__scroll')).toHaveCount(1);
  });

  test('la méta (sous-titre + description) est visible sous la diapo courante', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);
    await expect(page.locator('.slider')).toBeVisible();
    const meta = page.locator('.slider__slide[data-pos="current"] .tile-meta');
    const subtitle = meta.locator('.tile-meta__subtitle');
    const desc = meta.locator('.tile-meta__desc');
    // Visibles (pas opacity 0) et textes non vides.
    await expect(subtitle).toBeVisible();
    await expect(desc).toBeVisible();
    await expect(subtitle).toContainText('Détails');
    const descText = (await desc.textContent())?.trim() ?? '';
    expect(descText.length).toBeGreaterThan(0);
    // Garde-fou anti-régression : opacity réellement à 1 (le hover mosaïque ne s'applique pas ici).
    const opacity = await meta.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeGreaterThan(0.9);
  });
});

test.describe('Slider projet — navigation', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('indicateur N/M et flèches clavier (Liquides Paris = 4 maquettes)', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    const nav = page.locator('.ui-corner__project-nav');
    await expect(nav).toContainText('1/4');
    await page.keyboard.press('ArrowRight');
    await expect(nav).toContainText('2/4');
    await page.keyboard.press('ArrowLeft');
    await expect(nav).toContainText('1/4');
    await page.keyboard.press('ArrowLeft'); // circulaire : boucle vers la dernière
    await expect(nav).toContainText('4/4');
  });

  test('carousel circulaire : à la dernière maquette, la première dépasse à droite', async ({ page }) => {
    await openProject(page, 'Liquides Paris'); // 1/4 = première
    const firstSrc = await page.locator('.slider__slide[data-pos="current"]').getAttribute('data-src');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight'); // → 4/4 (dernière)
    await expect(page.locator('.ui-corner__project-nav')).toContainText('4/4');
    // La voisine de droite (data-pos="next") est la PREMIÈRE maquette (wrap circulaire).
    await expect(page.locator('.slider__slide[data-pos="next"]')).toHaveAttribute('data-src', firstSrc ?? 'x');
  });

  test('bouton → du TL avance d\'une diapo', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await page.locator('.ui-corner__project-nav .ui-corner__nav-btn[aria-label="Maquette suivante"]').click();
    await expect(page.locator('.ui-corner__project-nav')).toContainText('2/4');
  });

  test('clic sur la voisine droite va à elle', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await page.locator('.slider__slide[data-pos="next"]').click();
    await expect(page.locator('.ui-corner__project-nav')).toContainText('2/4');
  });

  test('projet à 1 maquette : pas de boutons nav TL (Royal Canin)', async ({ page }) => {
    await openProject(page, 'Royal Canin');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/1');
    await expect(page.locator('.ui-corner__project-nav .ui-corner__nav-btn')).toHaveCount(0);
  });

  test('TL affiche "pour <Nom>" et TR email restent visibles pendant le slider', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    // Coin TL : contient le nom du projet et l'indicateur N/M
    await expect(page.locator('.ui-corner--tl')).toContainText('pour Liquides Paris');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
    // Coin TR : email toujours présent et visible
    await expect(page.locator('.ui-corner--tr')).toBeVisible();
    await expect(page.locator('.ui-corner--tr')).toContainText('bonjour@marcantoineguilbault.fr');
  });
});

test.describe('Slider projet — rideau', () => {
  test('les tuiles non cliquées reçoivent une direction de sortie puis reviennent', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor();

    // Clique (via dispatchEvent, tuiles RAF) la tuile la plus proche du centre écran
    // → tuiles au-dessus ET en dessous garanties.
    const ok = await page.evaluate(() => {
      const cy = window.innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const t of document.querySelectorAll('.tile:not([data-project="courvoisier"])')) {
        const r = t.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const d = Math.abs((r.top + r.height / 2) - cy);
        if (d < bestD) { bestD = d; best = t; }
      }
      const inner = best && best.querySelector('.tile-inner');
      if (!inner) return false;
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
    expect(ok).toBe(true);
    await expect(page.locator('.slider')).toBeVisible();

    // Au moins une tuile part vers le haut ET une autre vers le bas.
    const dirs = await page.locator('.tile').evaluateAll(
      (els) => els.map((e) => e.dataset.exitDir).filter(Boolean)
    );
    expect(dirs).toContain('up');
    expect(dirs).toContain('down');

    // Fermeture → retour : plus d'exitDir, transition inline nettoyée, frame() a repris.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tile')].every((e) => !e.dataset.exitDir && !e.style.transition)
    );
    const after = await page.locator('.tile').first().evaluate((el) => el.style.transform);
    expect(after).toContain('translate3d');
  });
});

test.describe('Slider projet — drag', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('drag horizontal vers la gauche avance d\'une diapo', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
    const box = await page.locator('.slider__slide[data-pos="current"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.ui-corner__project-nav')).toContainText('2/4');
  });

  test('petit drag (sous le seuil) resnap sans changer de diapo', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    const box = await page.locator('.slider__slide[data-pos="current"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
  });
});

test.describe('Slider projet — auto-scroll', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('la diapo courante est scrollable verticalement', async ({ page }) => {
    await openProject(page, 'Quintessence Paris');
    // Naviguer sur la diapo 2 (m02, ratio 4.3) qui déborde largement quel que soit le viewport.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('2/6');
    const scrollEl = page.locator('.slider__slide[data-pos="current"] .slider__scroll');
    await expect(scrollEl).toBeVisible();
    // Attendre que l'image soit chargée avec ses dimensions réelles.
    await page.locator('.slider__slide[data-pos="current"] img').first().evaluate(
      (img) => img.naturalHeight > 0
        ? null
        : new Promise((r) => { img.onload = img.onerror = r; })
    );
    const overflows = await scrollEl.evaluate((el) => el.scrollHeight > el.clientHeight + 4);
    expect(overflows).toBe(true);
  });
});

test.describe('Slider projet — entrées & reduced-motion', () => {
  test('la liste clients ouvre le slider sur la 1re maquette', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: 'Gobelins Paris' }).click();
    await expect(page.locator('.slider')).toBeVisible();
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
  });

  test('reduced-motion : ouverture directe sans rideau', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first().waitFor();
    await page.evaluate(() => {
      document.querySelector('.tile:not([data-project="courvoisier"]) .tile-inner')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.slider')).toBeVisible();
    // Aucun exitDir posé (pas de rideau animé).
    const dirs = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.dataset.exitDir).filter(Boolean));
    expect(dirs.length).toBe(0);
  });
});

test.describe('Slider projet — FLIP', () => {
  // Helper : clique la 1re tuile non verrouillée (tuiles RAF → dispatchEvent).
  async function clickFirstTile(page) {
    await page.locator('.tile:not([data-project="courvoisier"]) .tile-inner').first().waitFor();
    await page.evaluate(() => {
      const inner = document.querySelector('.tile:not([data-project="courvoisier"]) .tile-inner');
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  test('après ouverture par clic tuile, la diapo courante finit centrée verticalement', async ({ page }) => {
    await page.goto('/');
    await clickFirstTile(page);
    const slide = page.locator('.slider__slide[aria-current="true"]');
    await expect(slide).toBeVisible();
    await page.waitForTimeout(900); // laisse le FLIP se terminer
    const r = await slide.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { midY: b.top + b.height / 2, vh: window.innerHeight };
    });
    // Recentrage VERTICAL seul : le centre vertical de la diapo ≈ milieu de l'écran.
    // (Le X n'est plus le centre écran mais celui de la tuile cliquée → pas d'assertion sur X.)
    expect(Math.abs(r.midY - r.vh / 2)).toBeLessThan(20);
    // Plus de scale : le .tile-frame n'a aucun transform inline (le transform est sur le .slider__slide).
    const frameTransform = await page.locator('.slider__slide[aria-current="true"] .tile-frame')
      .evaluate((el) => el.style.transform);
    expect(frameTransform === '' || frameTransform === 'none').toBe(true);
  });
});

test.describe('Slider projet — resize & verrou', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('resize pendant le slider recalcule la taille des diapos', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProject(page, 'Liquides Paris');
    const cur = page.locator('.slider__slide[data-pos="current"]');
    const w1 = await cur.evaluate((el) => el.getBoundingClientRect().width);
    // La taille de diapo = taille mosaïque → dépend de la LARGEUR de colonne (donc du viewport
    // en largeur), plus de la hauteur écran. On réduit la largeur et on attend une diapo + étroite.
    await page.setViewportSize({ width: 700, height: 900 });
    // > 150ms (debounce resize mosaïque → recalc colWidth) + 200ms (debounce re-layout slider).
    await page.waitForTimeout(450);
    const w2 = await cur.evaluate((el) => el.getBoundingClientRect().width);
    expect(w2).toBeLessThan(w1); // largeur écran réduite → colonne + étroite → diapo + petite
  });

});

test.describe('Slider projet — espacement', () => {
  test('écart horizontal uniforme entre diapos (mobile↔tablet inclus)', async ({ page }) => {
    // Liquides Paris = 2 mobiles + 2 tablets → l'écart mobile↔tablet doit valoir le même
    // GAP (48px) que mobile↔mobile (régression : rel*step faussait l'espacement mixte).
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: 'Liquides Paris' }).click();
    await expect(page.locator('.slider')).toBeVisible();
    await page.waitForTimeout(100);
    const gaps = await page.evaluate(() => {
      const rects = [...document.querySelectorAll('.slider__slide')].map((s) => s.getBoundingClientRect());
      rects.sort((a, b) => a.left - b.left); // ordre spatial (le layout circulaire ne suit pas l'ordre DOM)
      const g = [];
      for (let i = 0; i < rects.length - 1; i++) g.push(rects[i + 1].left - rects[i].right);
      return g;
    });
    expect(gaps.length).toBeGreaterThanOrEqual(3); // 4 diapos → 3 écarts
    for (const g of gaps) expect(Math.abs(g - 48)).toBeLessThanOrEqual(2);
  });
});

test.describe('Slider projet — sortie (re-clic / clic vide)', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('re-cliquer la maquette courante affiche la suivante', async ({ page }) => {
    await openProject(page, 'Liquides Paris'); // 1/4
    await page.waitForTimeout(900); // laisse le FLIP/snap initial se terminer
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
    const cur = page.locator('.slider__slide[data-pos="current"]');
    const box = await cur.boundingBox();
    await cur.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('.ui-corner__project-nav')).toContainText('2/4'); // → suivante
    await expect(page.locator('.slider')).toBeVisible(); // toujours en vue projet
  });

  test('clic dans le vide : revient à l\'entrée PUIS à la vue mosaïque (un seul clic)', async ({ page }) => {
    await openProject(page, 'Liquides Paris'); // entrée à 1/4
    await page.waitForTimeout(900);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('3/4');
    // UN seul clic dans le vide enchaîne : retour à la maquette d'entrée (1/4) PUIS fermeture.
    await page.locator('.slider').click({ position: { x: 5, y: 5 } });
    // go() est synchrone → la nav repasse immédiatement à 1/4 (retour à l'entrée).
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
    // puis fermeture automatique → vue mosaïque (auto-retry couvre le délai de l'enchaînement).
    await expect(page.locator('.slider')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
  });

  test('Échap : revient à l\'entrée PUIS à la vue mosaïque (comme le clic dans le vide)', async ({ page }) => {
    await openProject(page, 'Liquides Paris'); // entrée à 1/4
    await page.waitForTimeout(900);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('3/4');
    // Échap enchaîne comme le clic dans le vide : retour à l'entrée (1/4) PUIS fermeture.
    await page.keyboard.press('Escape');
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
    await expect(page.locator('.slider')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
  });

  test('micro-mouvement trackpad sous le seuil : aucun glissement animé (resnap instantané)', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    const cur = page.locator('.slider__slide[data-pos="current"]');
    await page.waitForTimeout(900);
    const leftBefore = await cur.evaluate((el) => el.getBoundingClientRect().left);
    const box = await cur.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Micro-drag horizontal SOUS le seuil (verrouille axis='x' mais ne navigue pas). C'est le
    // cas qui reproduit le bug : avant le fix, le pointerup faisait layout() AVEC la transition
    // CSS 500ms active → la courante GLISSAIT visiblement de -dx jusqu'à 0 (décalage à gauche
    // perçu). On échantillonne le `left` RENDU juste après le up : avec le fix le resnap est
    // instantané (transition:none) → left déjà revenu ; avec le bug il est encore décalé.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 12, cy, { steps: 3 });
    await page.mouse.up();
    const leftJustAfter = await cur.evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(leftJustAfter - leftBefore)).toBeLessThanOrEqual(2);
    // Et au repos : position finale inchangée + toujours sur la même diapo.
    await page.waitForTimeout(600);
    const leftSettled = await cur.evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(leftSettled - leftBefore)).toBeLessThanOrEqual(2);
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4');
  });
});

test.describe('Slider projet — tilt 3D au survol', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
  }

  test('survol de la diapo courante applique un transform perspective (attachTilt câblé)', async ({ page }) => {
    await openProject(page, 'Liquides Paris');
    await page.waitForTimeout(900); // FLIP terminé → plus de transform inline résiduel sur le frame
    const frame = page.locator('.slider__slide[data-pos="current"] .tile-frame');
    // attachTilt agit sur le .tile-frame (inner.parentElement) au mouseenter du .tile-inner.
    await page.locator('.slider__slide[data-pos="current"] .tile-inner').hover();
    // Le mouseenter pose un transform `perspective(...) translateY(...)`.
    await expect.poll(async () => frame.evaluate((el) => el.style.transform))
      .toContain('perspective');
  });
});

test.describe('Slider projet — débordement des deux bords', () => {
  async function openProject(page, name) {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: name }).click();
    await expect(page.locator('.slider')).toBeVisible();
    await page.waitForTimeout(900); // laisse le layout/FLIP initial se poser
  }

  // À CHAQUE maquette, le carousel circulaire doit déborder des DEUX bords de l'écran : une voisine
  // dépasse à gauche (left < 0) ET une autre à droite (right > innerWidth) → « hors champ », pas de
  // vide noir. La courante reste ANCRÉE sur la tuile ; la répartition gauche/droite des voisines
  // vise à centrer le ruban autour d'elle. Avant le fix, le compte fixe (rightCount = ceil((N-1)/2))
  // laissait un vide à un bord quand une voisine était le mobile (étroit). On teste les projets à
  // ≥ 4 maquettes (ouverts centrés via la liste) ; les projets à 2-3 maquettes ne peuvent pas
  // toujours couvrir les deux bords quand ils sont ouverts centrés (off-center / clic : validé à l'œil).
  for (const { name, count } of [{ name: 'Liquides Paris', count: 4 }, { name: 'Gobelins Paris', count: 4 }]) {
    test(`${name} : chaque maquette déborde à gauche ET à droite`, async ({ page }) => {
      await openProject(page, name);
      for (let i = 0; i < count; i++) {
        const { minLeft, maxRight, vw } = await page.evaluate(() => {
          const rects = [...document.querySelectorAll('.slider__slide')].map((s) => s.getBoundingClientRect());
          return {
            minLeft: Math.min(...rects.map((r) => r.left)),
            maxRight: Math.max(...rects.map((r) => r.right)),
            vw: window.innerWidth,
          };
        });
        expect(minLeft, `index ${i}/${count} : une maquette doit déborder à gauche (left < 0)`).toBeLessThan(0);
        expect(maxRight, `index ${i}/${count} : une maquette doit déborder à droite (right > vw)`).toBeGreaterThan(vw);
        if (i < count - 1) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(600); // > transition layout 500ms
        }
      }
    });
  }
});

test.describe('Slider projet — wrap circulaire sans traversée', () => {
  test('la diapo qui change de bord est téléportée (ne traverse pas l\'écran)', async ({ page }) => {
    // Pozzo Di Borgo = 3 maquettes (1 mobile + 2 tablet) : c'est le cas où le saut du wrap
    // était < largeur écran et passait sous l'ancien seuil → la diapo traversait visiblement.
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: 'Pozzo' }).click();
    await expect(page.locator('.slider')).toBeVisible();
    await page.waitForTimeout(900);
    const before = await page.locator('.slider__slide').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    await page.keyboard.press('ArrowRight'); // go(1) → une diapo wrappe d'un bord à l'autre
    await page.waitForTimeout(120);          // ~24% d'une transition de 500ms
    const mid = await page.locator('.slider__slide').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    await page.waitForTimeout(600);
    const after = await page.locator('.slider__slide').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    const vw = await page.evaluate(() => window.innerWidth);
    let checked = 0;
    for (let i = 0; i < before.length; i++) {
      // Diapo qui "wrappe" = grand saut total (> moitié écran). Elle est téléportée hors écran à
      // droite PUIS glisse depuis le bord → à 120ms elle est déjà du côté droit (mid > vw/2),
      // jamais à gauche/au centre en train de traverser (le bug).
      if (Math.abs(after[i] - before[i]) > vw / 2) {
        expect(mid[i]).toBeGreaterThan(vw / 2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // un wrap a bien eu lieu (sinon le test ne prouve rien)
  });
});
