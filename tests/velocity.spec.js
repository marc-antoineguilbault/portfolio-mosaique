// @ts-check
import { test, expect } from '@playwright/test';

// Le tracker est un module pur : on l'importe dans le contexte de la page (servi en statique).
test.describe('velocity tracker', () => {
  test('au repos / petit mouvement : normalized = 0 sous vMin', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);            // init (pas de delta)
      t.sample(2, 0.016);            // +2px en 16ms ≈ 125 px/s < vMin
      return t.normalized();
    });
    expect(n).toBe(0);
  });

  test('mouvement rapide : normalized tend vers 1 (avec clamp)', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);
      t.sample(120, 0.016);          // +120px/16ms = 7500 px/s, clampé → ≥ vMax
      return t.normalized();
    });
    expect(n).toBe(1);
  });

  test('reset() neutralise un saut d\'offset (pas de pic)', async ({ page }) => {
    await page.goto('/');
    const n = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 1, vMin: 200, vMax: 2500 });
      t.sample(0, 0.016);
      t.sample(50, 0.016);           // vélocité non nulle
      t.reset(9000);                 // resync sur une grande valeur (simule resize → offset)
      return t.normalized();         // smooth remis à 0
    });
    expect(n).toBe(0);
  });

  test('warpFactor : overshoot sous 0 (rebond squash) après l\'arrêt du scroll', async ({ page }) => {
    await page.goto('/');
    const minW = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 0.5, vMin: 200, vMax: 2500 });
      let off = 0;
      // scroll soutenu : la cible warp monte
      for (let i = 0; i < 20; i++) { off += 600; t.sample(off, 0.016); }
      // arrêt : offset constant → la cible retombe à 0, le ressort doit dépasser sous 0
      let m = Infinity;
      for (let i = 0; i < 150; i++) { t.sample(off, 0.016); m = Math.min(m, t.warpFactor()); }
      return m;
    });
    expect(minW).toBeLessThan(0);          // overshoot négatif = squash
  });

  test('warpFactor : se fige à exactement 0 au repos (coût nul)', async ({ page }) => {
    await page.goto('/');
    const w = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker();
      let off = 0;
      for (let i = 0; i < 10; i++) { off += 600; t.sample(off, 0.016); }
      for (let i = 0; i < 400; i++) { t.sample(off, 0.016); }   // long repos
      return t.warpFactor();
    });
    expect(w).toBe(0);                     // exactement 0 → skip-write réactivé, coût nul
  });

  test('warpAt : la vague verticale retarde le warp (courant > retardé pendant la montée)', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { createVelocityTracker } = await import('/modules/velocity.js');
      const t = createVelocityTracker({ lerp: 0.5, vMin: 200, vMax: 2500 });
      let off = 0;
      for (let i = 0; i < 15; i++) { off += 600; t.sample(off, 0.016); }  // montée du warp
      return { now: t.warpAt(0), delayed: t.warpAt(10) };
    });
    // En montée, le warp « courant » (tuiles du haut) dépasse le warp retardé (tuiles du bas).
    expect(r.now).toBeGreaterThan(r.delayed);
  });
});
