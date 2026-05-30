// @ts-check
import { test, expect } from '@playwright/test';

test.describe('warp mosaïque', () => {
  test('un wheel rapide étire les tuiles visibles (scaleY > 1), puis retour à 1', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor();
    await page.mouse.move(400, 400);

    // scaleY max parmi les tuiles VISIBLES uniquement : frame() ne réécrit pas les tuiles hors
    // VISIBLE_MARGIN (skip-write), qui gardent un scale figé invisible → on les ignore.
    const maxVisibleSy = () => page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      let mx = 1;
      for (const el of document.querySelectorAll('.tile')) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
        const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
        if (m) mx = Math.max(mx, parseFloat(m[1]));
      }
      return mx;
    });

    // Soutient la vélocité par plusieurs wheels, échantillonne après chacun : déterministe
    // (on ne dépend pas d'attraper un pic d'une seule frame — évite le flake de timing).
    let maxSy = 1;
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 800);
      maxSy = Math.max(maxSy, await maxVisibleSy());
    }
    expect(maxSy).toBeGreaterThan(1.005);

    // Sans nouveau scroll, les tuiles dont le CENTRE est dans le viewport reviennent à ~1
    // (elles sont forcément réécrites par frame()). Les tuiles en marge gardent un scale figé
    // par le skip-write — invisible et auto-corrigé au retour : comportement attendu, on les ignore.
    await page.waitForFunction(() => {
      const vh = window.innerHeight;
      for (const el of document.querySelectorAll('.tile')) {
        const r = el.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2;
        if (cy < 0 || cy > vh) continue;
        const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
        const sy = m ? parseFloat(m[1]) : 1;
        if (Math.abs(sy - 1) >= 0.012) return false;
      }
      return true;
    }, null, { timeout: 3000 });
  });

  test('reduced-motion : aucun étirement même au wheel rapide', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.locator('.tile').first().waitFor();
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 1800);
    const maxSy = await page.evaluate(() => new Promise((resolve) => {
      let mx = 1, n = 0;
      const tick = () => {
        for (const el of document.querySelectorAll('.tile')) {
          const m = el.style.transform.match(/scale\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
          if (m) mx = Math.max(mx, parseFloat(m[1]));
        }
        if (n++ > 20) resolve(mx); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await ctx.close();
    expect(maxSy).toBeLessThan(1.005);
  });
});
