// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Portfolio smoke', () => {
  test('charge la page avec le label TL visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ui-corner--tl')).toContainText('Marc-Antoine Guilbault');
    await expect(page.locator('.ui-corner--tl')).toContainText('Lead Designer UI');
  });

  test('crée des tiles dans le DOM après init', async ({ page }) => {
    await page.goto('/');
    // Préfill phase 1 doit avoir créé ≥ 5 tiles dans le 1er viewport.
    await expect(page.locator('.tile')).toHaveCount(5, { timeout: 3000 }).catch(() => {});
    const count = await page.locator('.tile').count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('ouvre la liste client au click sur label TL', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await expect(page.locator('.ui-corner__suffix-list')).toBeVisible();
    await expect(page.locator('.ui-corner__suffix-item').first()).toContainText('Liquides Paris');
  });

  test('regression : .tile ne clippe pas la meta (pas de contain:paint)', async ({ page }) => {
    await page.goto('/');
    // Pas de timeout court : la latence du 1er paint des tuiles (init() après app.js + data + modules + AVIF) varie sous charge machine — un cap court rejoue le flake. On laisse le test timeout (30 s), comme le reste de la suite.
    await page.locator('.tile').first().waitFor();
    // contain:paint clipperait .tile-meta (top:100%, sous la tile) → desc invisible au hover.
    const contain = await page.locator('.tile').first().evaluate(
      (el) => getComputedStyle(el).contain
    );
    expect(contain).not.toContain('paint');
    // La meta + sa description doivent exister dans le DOM de la tile.
    const hasMeta = await page.locator('.tile').first().locator('.tile-meta__desc, .tile-meta__line').count();
    expect(hasMeta).toBeGreaterThan(0);
  });

  test('a11y : skip link visible au focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
  });

  test('a11y : label TL focusable + Enter ouvre la liste', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').focus();
    await expect(page.locator('.ui-corner--tl')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ui-corner--tl')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.ui-corner__suffix-list')).toBeVisible();
  });
});
