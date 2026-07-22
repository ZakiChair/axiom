import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G6 : « Screener crowded long/short (funding + ΔOI + L/S) en ≤15 s ».
 *
 * ⚠ RÉSEAU REQUIS : univers Binance spot (REST CORS-ouvert) + funding fapi et
 * OI/L-S futures via le proxy Vite /extapi — daemon toléré absent (proxy dev).
 *
 * Le timeout de 15_000 ms sur l'état « Terminé » ENCODE le critère ≤15 s : ne
 * pas l'augmenter pour absorber un flake — un dépassement est un échec de gate.
 *
 * Un run « Crowded long » peut LÉGITIMEMENT ne matcher aucun symbole (conditions
 * de marché calmes : funding > 0.01 %, ΔOI > 2 %, L/S > 1.5) : on accepte alors
 * l'état vide explicite « Aucun résultat. » (rendu uniquement après un run
 * terminé — l'étage positionnement OI/L-S a tourné dans le chrono). Le chemin
 * « lignes de résultats » est prouvé par gate-g7 (preset Volume anormal, non
 * vide par construction) ; avec des résultats crowded, les colonnes Δ OI / L-S
 * sont exigées en plus.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("preset Crowded long : run complet (funding + ΔOI + L/S) en ≤15 s", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Screener/ }).click();
  const fenetre = page.getByRole("complementary", { name: "Screener d'actifs" });
  await expect(fenetre).toBeVisible({ timeout: 15_000 });

  await fenetre.getByRole("button", { name: "Crowded long" }).click();
  await fenetre.getByRole("button", { name: "Lancer le screen" }).click();

  // ≤15 s chrono pour l'ensemble univers + positionnement (critère G6). L'état
  // « Terminé » exclut l'état « Erreur » (les deux sont mutuellement exclusifs).
  await expect(fenetre.getByText("Terminé")).toBeVisible({ timeout: 15_000 });

  // Lignes de résultats OU état vide honnête (rendu post-run uniquement). Les
  // colonnes Δ OI / L-S ne sont affichées que si au moins une ligne porte les
  // données de positionnement — on ne les exige donc qu'avec des résultats
  // (en-têtes de tri = boutons, le rôle exclut les <option> du builder).
  const lignes = fenetre.locator('button[title^="Ouvrir "]');
  if ((await lignes.count()) === 0) {
    await expect(fenetre.getByText("Aucun résultat.", { exact: true })).toBeVisible();
  } else {
    await expect(lignes.first()).toBeVisible();
    await expect(fenetre.getByRole("button", { name: "Δ OI" })).toBeVisible();
    await expect(fenetre.getByRole("button", { name: "L/S" })).toBeVisible();
  }
});
