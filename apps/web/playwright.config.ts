import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGINE, E2E_PORT } from "./e2e/origine";

/**
 * Smoke e2e AXIOM (amorce — Lot review). Valide le boot de l'app, l'ouverture d'une
 * fenêtre Launchpad et le rendu du chart. Volontairement MINIMAL et STRUCTUREL : ne
 * dépend PAS de données de marché live (les WS/REST exchange peuvent échouer sans
 * faire échouer le test). Serveur dédié : aucune autre application n'est réutilisée.
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
    baseURL: E2E_ORIGINE,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: E2E_ORIGINE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
