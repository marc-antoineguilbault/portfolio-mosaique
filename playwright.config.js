// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Page CPU-lourde : la mosaïque tourne dans une boucle requestAnimationFrame permanente
  // (app.js, fonction frame()). Le défaut Playwright en local (50% des cœurs = 4 ici) lance
  // 4 pages animées en parallèle → sur-souscription CPU : le main thread sature, l'input CDP
  // des clics n'est plus traité et .click()/.goto() partent en timeout 30s (flake observé sur
  // TOUTE la suite sous parallélisme, pas seulement le nav). Preuve : workers=1 → 10/10 ;
  // workers=4 → jusqu'à ~9 échecs/20. On plafonne à 2 workers en local (marge CPU, ~2× plus
  // rapide que séquentiel) et 1 en CI (déterministe). Ce N'EST PAS un retry qui masque le bug :
  // on supprime la cause (la contention), le golden path reste exercé tel quel.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:8771',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8771',
    url: 'http://localhost:8771',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
