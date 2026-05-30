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
});
