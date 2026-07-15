import { test, expect } from "@playwright/test";

/**
 * Smoke e2e AXIOM — amorce structurelle (Lot review). Ces tests valident que le
 * terminal DÉMARRE et que ses briques d'UI de base répondent, SANS dépendre de
 * données de marché live (les WS/REST exchange peuvent échouer hors ligne).
 *
 * Avant chaque test : on marque l'onboarding comme terminé (clé
 * `axiom:onboarding:v1`) pour que l'overlay de premier lancement ne masque pas la
 * Toolbar — sinon le menu Fonctions serait inaccessible dans un profil vierge.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("le terminal démarre et rend son canvas de chart", async ({ page }) => {
  await page.goto("/");
  // La Toolbar (menu Fonctions dérivé du registre) est présente.
  await expect(page.getByRole("button", { name: "Fonctions" })).toBeVisible();
  // Le chart principal (KLineChart) monte un <canvas> — preuve que le renderer tourne.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
});

test("le menu Fonctions ouvre une fenêtre Launchpad (COT, sans data live)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  // Item dérivé de WINDOW_REGISTRY (mnémonique COT + libellé).
  await page.getByRole("menuitem", { name: /Rapport COT/ }).click();
  // FloatingWindow expose role="complementary" + aria-label={title}.
  await expect(page.getByRole("complementary", { name: /Rapport COT/ })).toBeVisible({
    timeout: 15_000,
  });
});
