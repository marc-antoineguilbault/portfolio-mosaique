// @ts-check
import { test, expect } from '@playwright/test';

test.describe('smoothing — damp()', () => {
  test('damp est frame-rate-independent (demi-vie)', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { damp } = await import('/modules/smoothing.js');
      return {
        dtZero: damp(0, 10, 0.1, 0),        // dt=0 → reste à cur
        oneHalfLife: damp(0, 10, 0.1, 0.1), // 1 demi-vie → 50 %
        tenHalfLives: damp(0, 10, 0.1, 1),  // 10 demi-vies → ~99,9 %
        atTarget: damp(10, 10, 0.1, 0.05),  // déjà à la cible → reste
      };
    });
    expect(r.dtZero).toBeCloseTo(0, 6);
    expect(r.oneHalfLife).toBeCloseTo(5, 6);
    expect(r.tenHalfLives).toBeGreaterThan(9.98);
    expect(r.tenHalfLives).toBeLessThan(10);
    expect(r.atTarget).toBeCloseTo(10, 6);
  });
});
