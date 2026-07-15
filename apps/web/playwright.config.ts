import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke e2e AXIOM (amorce — Lot review). Valide le boot de l'app, l'ouverture d'une
 * fenêtre Launchpad et le rendu du chart. Volontairement MINIMAL et STRUCTUREL : ne
 * dépend PAS de données de marché live (les WS/REST exchange peuvent échouer sans
 * faire échouer le test). Serveur : `vite dev` (réutilisé s'il tourne déjà en local).
 *
 * Nommage `*.e2e.ts` (hors du glob Vitest `*.{test,spec}`) : la suite unitaire
 * `vitest run` ne ramasse JAMAIS ces fichiers — aucune config Vitest à modifier.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
