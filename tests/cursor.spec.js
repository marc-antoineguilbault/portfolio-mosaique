// @ts-check
import { test, expect } from '@playwright/test';

test.describe('curseur élastique', () => {
  test('le rond suit la souris avec inertie (lerp), pas en téléportation', async ({ page }) => {
    await page.goto('/');
    await page.mouse.move(100, 100);
    await page.waitForTimeout(250);                 // laisse le rond rattraper
    await page.mouse.move(900, 600);                // grand saut
    // Juste après le saut, le rond ne doit PAS être déjà arrivé (inertie).
    const lag = await page.evaluate(() => {
      const cur = document.getElementById('cursor');
      const tr = cur.style.transform;
      const m = tr.match(/translate\(\s*([\d.]+)px/);
      return m ? parseFloat(m[1]) : null;
    });
    expect(lag).not.toBeNull();
    expect(lag).toBeLessThan(880);                  // pas encore à x≈900 → il traîne
  });

  test('survol d\'une maquette : data-cursor="+" et le rond porte le glyphe', async ({ page }) => {
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await expect(inner).toHaveAttribute('data-cursor', '+');
    // force:true car la tile est animée par rAF (translate3d change chaque frame) →
    // Playwright ne peut pas attendre la "stabilité" d'un élément en mouvement continu.
    await inner.hover({ force: true });
    await expect(page.locator('#cursor')).toHaveClass(/has-glyph/);
    await expect(page.locator('#cursor')).toHaveText('+');
  });

  test('en focus : la cliquée porte ⭢, retour à + après sortie', async ({ page }) => {
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await inner.click({ force: true });                  // entre en focus (tuile animée → force)
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'focus');
    // La tuile cliquée (source, non-clone) porte maintenant ⭢.
    await expect(page.locator('.tile.is-focused-tile .tile-inner')).toHaveAttribute('data-cursor', '⭢');
    await page.keyboard.press('Escape');                 // sortie focus
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'mosaic');
    await expect(page.locator('.tile.is-focused-tile')).toHaveCount(0);
  });

  test('reduced-motion : glyphe conservé mais pas d\'étirement (ni rotate ni scale)', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    const inner = page.locator('.tile .tile-inner').first();
    await inner.waitFor();
    await inner.hover({ force: true });
    await expect(page.locator('#cursor')).toHaveText('+');          // glyphe conservé
    const tr = await page.evaluate(() => document.getElementById('cursor').style.transform);
    expect(tr).not.toContain('rotate');                            // pas d'élasticité
    expect(tr).not.toContain('scale');
    await ctx.close();
  });
});
