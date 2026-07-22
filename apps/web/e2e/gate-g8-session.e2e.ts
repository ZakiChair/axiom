import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G8 : « P&L session + alerte count visibles SANS ouvrir de fenêtre ».
 *
 * ⚠ RÉSEAU REQUIS (specs de gate) ; daemon toléré absent. Le SessionStrip est
 * du chrome pur (stores locaux) : seul son RENDU au boot est le critère — les
 * valeurs de P&L restent « — » sans position, et c'est attendu.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("le SessionStrip (P&L jour, alertes, santé) est visible au boot, aucune fenêtre ouverte", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByRole("status", { name: "Session : P&L jour, alertes, santé" });
  await expect(strip).toBeVisible();

  // P&L de session (bouton vers le portefeuille) + compteur d'alertes + santé.
  await expect(strip.getByRole("button", { name: /P&L jour/ })).toBeVisible();
  await expect(strip.getByTitle("Nombre d'alertes actives")).toContainText("0");
  await expect(strip.getByText("Santé", { exact: true })).toBeVisible();

  // « Sans ouvrir de fenêtre » : aucune fenêtre flottante montée sur profil
  // vierge. Sélecteur sur l'attribut EXPLICITE role= de FloatingWindow — le
  // rôle implicite de l'<aside> (panneaux latéraux) n'est pas une fenêtre.
  await expect(page.locator('[role="complementary"]')).toHaveCount(0);
});
