import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

test("DATA vieillit un relevé sans collecte et accepte une observation entre deux ticks", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  const t0 = Date.UTC(2026, 8, 9, 12, 30);
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(t0 + 60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Sources de données/ }).click();
  const publier = () => page.evaluate(async () => {
    const chemin = "/src/store/qualiteMetriques.ts";
    const { enregistrerQualite } = await import(chemin);
    enregistrerQualite("test:horloge", "Relevé test horloge", {
      sourceId: "test", sourceEffective: "Fixture horloge", observeLe: Date.now(), recupereLe: Date.now(),
      cadenceMs: 60_000, ageMaxMs: 60_000, couverture: null, estime: false, acces: "public", statut: "frais",
    });
  });
  await publier();
  const ligne = page.getByRole("listitem").filter({ hasText: "Relevé test horloge" });
  await expect(ligne.getByText("frais", { exact: true })).toBeVisible();
  // Le composant demeure monté, mais son intervalle de dix secondes n'a pas tourné.
  await page.clock.runFor(2_000);
  await publier();
  await expect(ligne.getByText("frais", { exact: true })).toBeVisible();
  await expect(ligne).not.toContainText("futur");
  await page.clock.runFor(70_000);
  await expect(ligne.getByText("perime", { exact: true })).toBeVisible();
  await expect(ligne).toContainText("09/09/2026 12:31 UTC");
});
