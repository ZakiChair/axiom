import { test, expect } from "@playwright/test";

/**
 * Gate G100 — G4 : « Alertes edge créables en UI : prix, RSI/ind, funding z, var% ».
 *
 * ⚠ RÉSEAU REQUIS (specs de gate) ; daemon toléré absent — la CRÉATION d'alerte
 * est purement front (store alerts), seule l'évaluation runtime dépend des flux.
 *
 * Couverture automatisée : création d'une alerte PRIX et d'une alerte FUNDING
 * extrême via le formulaire du panneau latéral, apparition dans la liste
 * (libellés `decrireCondition` de @axiom/alerts).
 * Reste au protocole MANUEL : le clic-droit sur le canvas du chart → « alerte à
 * ce niveau » (B4) — geste canvas à coordonnée-prix non déterministe en e2e —
 * ainsi que le DÉCLENCHEMENT effectif (G5, onglet fermé/daemon).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("créer une alerte prix puis une alerte funding via le panneau Alertes", async ({ page }) => {
  await page.goto("/");
  const aside = page.locator("aside");

  // La section Alertes est repliée par défaut (accordéon SidebarSection).
  await aside.getByRole("button", { name: /^Alertes/ }).click();

  // — Alerte PRIX (type par défaut) : niveau saisi, symbole = actif courant. —
  await aside.getByPlaceholder("Niveau").fill("123456");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();
  await expect(aside.getByText("Prix franchit 123456 à la hausse")).toBeVisible();

  // — Alerte FUNDING extrême : sélection du type, seuils par défaut (0.1 % / |z|≥2). —
  await aside
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="funding-extreme"]') })
    .selectOption("funding-extreme");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).click();
  await expect(aside.getByText(/Funding extrême \(long\/short crowded/)).toBeVisible();

  // Le badge de la section reflète les 2 alertes créées.
  await expect(aside.getByRole("button", { name: /Alertes 2 alertes/ })).toBeVisible();
});
