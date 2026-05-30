// @ts-check
import { test, expect } from '@playwright/test';

test.describe('warp mosaïque', () => {
  test('un wheel rapide étire les tuiles (scaleY > 1), puis retour à 1', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor();
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 1800);                 // gros delta → vélocité forte

    // Dans les frames qui suivent, au moins une tuile a un scaleY > 1.
    const stretched = await page.evaluate(() => new Promise((resolve) => {
      let seen = false;
      let n = 0;
      const tick = () => {
        for (const el of document.querySelectorAll('.tile')) {
          const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
          if (m && parseFloat(m[1]) > 1.005) { seen = true; break; }
        }
        if (seen || n++ > 20) resolve(seen); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    expect(stretched).toBe(true);

    // Après stabilisation, le scale revient à ~1 (couvre le bug du skip-write).
    await page.waitForTimeout(800);
    const sy = await page.evaluate(() => {
      const el = document.querySelector('.tile');
      const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    expect(Math.abs(sy - 1)).toBeLessThan(0.012);
  });
});
