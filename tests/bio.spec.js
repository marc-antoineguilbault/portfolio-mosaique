// @ts-check
import { test, expect } from '@playwright/test';

// À l'ouverture de la liste des projets (clic sur la phrase du haut — desktop/hover),
// les noms apparaissent en cascade puis une phrase de bio s'affiche en bas de l'écran,
// alignée en x sur la colonne des noms. Elle est retirée à la fermeture.
test.describe('Bio sous la liste des projets (desktop)', () => {
  test('cascade des noms + bio en bas alignée, retirée à la fermeture', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor({ timeout: 5000 });

    await page.locator('.ui-corner--tl').click();

    // Cascade : les noms ont l'animation d'entrée avec un délai croissant.
    const delays = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.ui-corner__suffix-item')];
      return {
        anim: getComputedStyle(els[0]).animationName,
        first: els[0].style.getPropertyValue('--enter-delay'),
        last: els[els.length - 1].style.getPropertyValue('--enter-delay'),
        count: els.length,
      };
    });
    expect(delays.anim).toBe('suffix-item-in');
    expect(delays.first).toBe('0ms');
    expect(parseInt(delays.last)).toBeGreaterThan(0); // dernier nom décalé

    const bio = page.locator('.ui-bio');
    await expect(bio).toHaveCount(1);
    await expect(bio).toContainText('Je conçois, structure et enrichis');

    // Configurée pour apparaître APRÈS la cascade (animation-delay > 0), de façon
    // déterministe — pas de dépendance au timing réel.
    const animDelay = await bio.evaluate((el) => parseFloat(getComputedStyle(el).animationDelay));
    expect(animDelay).toBeGreaterThan(0.2);

    // Et elle finit bien par devenir visible.
    await expect
      .poll(() => bio.evaluate((el) => parseFloat(getComputedStyle(el).opacity)), { timeout: 4000 })
      .toBeGreaterThan(0.9);

    // Alignée en x sur la colonne des noms, posée en bas du viewport.
    const geo = await page.evaluate(() => {
      const b = document.querySelector('.ui-bio').getBoundingClientRect();
      const u = document.querySelector('.ui-corner__suffix-list').getBoundingClientRect();
      return { dx: Math.abs(b.left - u.left), bottomGap: window.innerHeight - b.bottom };
    });
    expect(geo.dx).toBeLessThanOrEqual(2);
    expect(geo.bottomGap).toBeGreaterThanOrEqual(0);
    expect(geo.bottomGap).toBeLessThanOrEqual(48);

    // Retirée à la fermeture.
    await page.locator('.ui-corner--tl').click();
    await expect(page.locator('.ui-bio')).toHaveCount(0);
  });
});
