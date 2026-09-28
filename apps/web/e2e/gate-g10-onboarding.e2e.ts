import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G10 : « Onboarding ≤5 min : clés optionnelles, 1er playbook, 1 alerte ».
 *
 * ⚠ RÉSEAU REQUIS (specs de gate) ; daemon toléré absent. Contrairement aux
 * autres specs de gate, AUCUNE clé `axiom:onboarding:v1` n'est posée : profil
 * vierge → l'overlay 3 étapes (store/onboarding.ts) doit s'afficher au boot et
 * se dérouler jusqu'au bout (étape clé Coinalyze SAUTÉE — les clés sont
 * optionnelles par critère). Reste au protocole MANUEL : le chrono « ≤5 min »
 * en conditions réelles (lecture humaine des textes).
 */
test("profil vierge : les 3 étapes se déroulent jusqu'à la Toolbar accessible", async ({ page }) => {
  await page.goto("/");

  // — Étape 1/3 : bienvenue + playbook Scalp. —
  const dialog = page.getByRole("dialog", { name: "Bienvenue sur AXIOM" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Appliquer le layout Scalp" }).click();
  await expect(dialog.getByRole("button", { name: "Layout Scalp appliqué ✓" })).toBeVisible();
  // Le playbook a ouvert DES + DOM derrière l'overlay.
  await expect(page.getByRole("complementary", { name: "Produits dérivés" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Carnet d'ordres (DOM / depth)" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Suivant" }).click();

  // — Étape 2/3 : clé Coinalyze OPTIONNELLE — on passe sans saisir de clé. —
  const dialogCle = page.getByRole("dialog", { name: "Clé Coinalyze (optionnel)" });
  await expect(dialogCle).toBeVisible();
  await dialogCle.getByRole("button", { name: "Suivant" }).click();

  // — Étape 3/3 : alerte prix démo puis fin du parcours. —
  const dialogAlerte = page.getByRole("dialog", { name: "Première alerte prix" });
  await expect(dialogAlerte).toBeVisible();
  await dialogAlerte.getByRole("button", { name: "Créer l'alerte démo" }).click();
  await expect(dialogAlerte.getByRole("button", { name: "Alerte démo créée ✓" })).toBeVisible();
  await dialogAlerte.getByRole("button", { name: "Terminer" }).click();

  // Fin : overlay démonté, Toolbar accessible, alerte démo comptée dans le strip.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fonctions" })).toBeVisible();
  await expect(page.getByTitle("Nombre d'alertes actives")).toContainText("1");

  // Persistance : le parcours est marqué terminé (ne se réaffichera plus).
  const persiste = await page.evaluate(() =>
    window.localStorage.getItem("axiom:onboarding:v1"),
  );
  expect(JSON.parse(persiste ?? "{}")).toMatchObject({ completed: true });
});
