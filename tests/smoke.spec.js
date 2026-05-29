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

  test('focus un projet → suffix "pour <Nom>" + nav (↑ N/M ↓)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: 'Liquides Paris' }).click();
    // Le typewriter prend ~500ms à finir.
    await expect(page.locator('.ui-corner__suffix')).toContainText('pour Liquides Paris', { timeout: 2000 });
    await expect(page.locator('.ui-corner__project-nav')).toContainText('1/4', { timeout: 2000 });
  });

  test('nav ↑ et ↓ change l\'index courant', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ui-corner--tl').click();
    await page.locator('.ui-corner__suffix-item', { hasText: 'Liquides Paris' }).click();

    const nav = page.locator('.ui-corner__project-nav');
    const nextBtn = nav.locator('.ui-corner__nav-btn[aria-label="Maquette suivante"]');

    // Le <button> cliquable n'existe qu'à la toute fin du typewriter du nav : typewriteProjectNav()
    // ne remplace le texte animé par les vrais boutons (renderProjectNav) qu'une fois l'animation
    // terminée. Attendre que le bouton soit visible est donc le signal d'état fiable « typewriter
    // fini » — robuste sous charge, là où le waitForTimeout(800) fixe partait parfois trop tôt.
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await expect(nav).toContainText('1/4');

    await nextBtn.click();
    await expect(nav).toContainText('2/4');

    // navigateToProjectImage() recrée le nav (nav.replaceChildren) à chaque clic → on ré-attend
    // l'actionnabilité du bouton fraîchement rendu avant le 2e clic plutôt que de cliquer à l'aveugle.
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();
    await expect(nav).toContainText('3/4');
  });

  test('regression : .tile ne clippe pas la meta (pas de contain:paint)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tile').first().waitFor({ timeout: 3000 });
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
