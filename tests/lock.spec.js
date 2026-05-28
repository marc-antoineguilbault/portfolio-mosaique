// @ts-check
import { test, expect } from '@playwright/test';

// Courvoisier est un projet confidentiel : il doit rester verrouillé en
// permanence. Aucune saisie ne le déverrouille, et il est exclu du
// déverrouillage global déclenché par n'importe quelle autre tuile.
// Cf. PERMANENT_PROJECTS dans modules/lock.js.
test.describe('Verrou permanent (Courvoisier)', () => {
  test('aucun mot de passe ne déverrouille Courvoisier', async ({ page }) => {
    await page.goto('/');

    const r = await page.evaluate(async () => {
      const lock = await import('/modules/lock.js');

      const makeTile = () => {
        const inner = document.createElement('div');
        const img = document.createElement('img');
        inner.appendChild(img);
        document.body.appendChild(inner);
        return { inner, img };
      };
      const tryPassword = (inner, value) => {
        inner.querySelector('svg.tile-lock')
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const input = inner.querySelector('input.tile-pw');
        input.value = value;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return input;
      };
      const isLocked = (img) => img.classList.contains('tile-img--locked');

      // Une tuile permanente (Courvoisier) + une tuile normale.
      const cv = makeTile();
      const normal = makeTile();
      lock.attachLock(cv.inner, cv.img, 'courvoisier');
      lock.attachLock(normal.inner, normal.img, 'royal-canin');

      const cvLockedInitially = isLocked(cv.img);

      // 1) Tentative directe sur Courvoisier → échec : champ vidé, reste verrouillé.
      const cvInput = tryPassword(cv.inner, 'sesame-ouvre-toi');
      const cvStillLocked = isLocked(cv.img);
      const cvInputCleared = cvInput.value === '';

      // 2) Déverrouillage global via la tuile normale → débloque la normale, PAS Courvoisier.
      tryPassword(normal.inner, 'nimporte-quoi');
      const normalUnlocked = !isLocked(normal.img);
      const cvSurvivesGlobalUnlock = isLocked(cv.img);

      return { cvLockedInitially, cvStillLocked, cvInputCleared, normalUnlocked, cvSurvivesGlobalUnlock };
    });

    expect(r.cvLockedInitially, 'Courvoisier verrouillé dès l\'attache').toBe(true);
    expect(r.cvStillLocked, 'Courvoisier reste verrouillé après tentative directe').toBe(true);
    expect(r.cvInputCleared, 'le champ est vidé après un échec').toBe(true);
    expect(r.normalUnlocked, 'une tuile non-permanente se déverrouille toujours').toBe(true);
    expect(r.cvSurvivesGlobalUnlock, 'Courvoisier survit au déverrouillage global').toBe(true);
  });
});
