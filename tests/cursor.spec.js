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
});
