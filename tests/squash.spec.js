// @ts-check
import { test, expect } from '@playwright/test';

test.describe('squash', () => {
  test('arrivée : la maquette cliquée reçoit .is-landing en entrant en focus', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click({ force: true });
    await page.locator('.ui-corner__suffix-item').first().click({ force: true });   // ouvre un projet
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'focus');
    await expect(page.locator('.tile.is-focused-tile .tile-inner.is-landing')).toBeAttached({ timeout: 2000 });
  });

  test('bump : buter à l\'extrémité d\'un projet 1-maquette applique .is-bump', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click({ force: true });
    await page.locator('.ui-corner__suffix-item', { hasText: 'Royal Canin' }).click({ force: true }); // 1 seule maquette
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'focus');
    await page.keyboard.press('ArrowRight');   // bute immédiatement (1 maquette) → rebond
    await expect(page.locator('.tile-inner.is-bump').first()).toBeAttached({ timeout: 2000 });
  });
});
