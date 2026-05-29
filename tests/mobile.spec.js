// @ts-check
import { test, expect, devices } from '@playwright/test';

// Sur tactile / mobile UNIQUEMENT (hover: none), deux interactions sont désactivées :
//  - tap sur une maquette ne doit pas révéler le texte de la meta ;
//  - tap sur la phrase du haut ne doit pas ouvrir la liste des projets.
// Cf. app.js (handler TL gardé par HAS_HOVER) + styles.css (reveal gardé @media hover:hover).

// On émule un mobile (hover:none, tactile) sous le projet chromium : on retire
// defaultBrowserType ('webkit') qui ne peut pas être posé dans un describe.
const { defaultBrowserType, ...iPhone } = devices['iPhone 13'];
test.use(iPhone);

test.describe('Mobile (tactile) — interactions désactivées', () => {
  test('phrase du haut inerte + révélation meta gardée par hover', async ({ page }) => {
    await page.goto('/');
    // Pas de timeout court : la latence du 1er paint des tuiles (init() après app.js + data + modules + AVIF) varie sous charge machine — un cap court rejoue le flake. On laisse le test timeout (30 s), comme le reste de la suite.
    await page.locator('.tile').first().waitFor();

    // Contexte bien tactile (pas de hover).
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);

    // 1) Phrase du haut : pas de sémantique bouton, et le tap n'ouvre pas la liste.
    const tl = page.locator('.ui-corner--tl');
    expect(await tl.getAttribute('role')).toBeNull();
    await tl.tap();
    await page.waitForTimeout(300);
    await expect(page.locator('.ui-corner__suffix-list')).toHaveCount(0);

    // 2) Révélation du texte de la meta : aucune règle "nue" (.tile:hover ... opacity:1)
    //    hors @media (hover: hover) → sur tactile, un tap (hover collant) ne révèle rien.
    const bareReveal = await page.evaluate(() => {
      let bare = 0;
      const walk = (rules, inHover) => {
        for (const r of rules) {
          if (r.type === CSSRule.MEDIA_RULE) {
            const cond = r.conditionText || (r.media && r.media.mediaText) || '';
            walk(r.cssRules, inHover || /hover\s*:\s*hover/.test(cond));
          } else if (r.selectorText && r.selectorText.includes('.tile-meta__line-inner')
                     && r.selectorText.includes(':hover') && r.style.opacity === '1' && !inHover) {
            bare++;
          }
        }
      };
      for (const s of document.styleSheets) { try { walk(s.cssRules, false); } catch { /* cross-origin */ } }
      return bare;
    });
    expect(bareReveal).toBe(0);
  });
});
