import { test, expect } from "@playwright/test";

/**
 * Gate e2e du lot v2.4 — onglet « Macro » du menu Indicateurs + bouton de dénominateur.
 *
 * POURQUOI ICI et pas en unitaire : `apps/web` tourne en env vitest NODE (pas de jsdom,
 * et aucune dépendance de rendu ne peut être ajoutée — BUILD-CONTRACT). Le comportement
 * d'onglet et de bouton n'est donc vérifiable QUE dans un vrai navigateur.
 *
 * STRUCTUREL, sans donnée de marché live : les libellés testés (bandeau de ratio,
 * onglets, cases macro) sont dérivés du SYMBOLE et des stores, pas des WS/REST exchange
 * — la suite passe hors ligne.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
});

test("les mesures macro ont quitté la sidebar pour l'onglet Macro du menu Indicateurs", async ({
  page,
}) => {
  await page.goto("/");

  // La sidebar n'expose plus la section « Masse monétaire ». Assertion SCOPÉE à <aside> :
  // le libellé subsiste ailleurs (aide de la clé FRED dans les Réglages, commande MACRO).
  await expect(page.locator("aside").getByText("Masse monétaire")).toHaveCount(0);

  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  // Onglet « Techniques » actif par défaut : le catalogue est là, pas les mesures macro.
  await expect(page.getByPlaceholder(/CVD, RVOL/)).toBeVisible();
  await expect(page.getByText("Cap. totale crypto")).toHaveCount(0);

  await page.getByRole("button", { name: /^Macro/ }).click();
  await expect(page.getByText("Cap. totale crypto")).toBeVisible();
  await expect(page.getByText("Stablecoins (supply)")).toBeVisible();
  await expect(page.getByText("M2 (US · FRED)")).toBeVisible();
  // Onglet inactif DÉMONTÉ (pas seulement masqué) : le champ de recherche a disparu.
  await expect(page.getByPlaceholder(/CVD, RVOL/)).toHaveCount(0);
});

test("cocher une mesure macro met à jour le compteur de l'onglet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByRole("button", { name: /^Macro/ }).click();

  // Le <label> enveloppe sa case : cliquer le libellé bascule la case.
  await page.getByText("Cap. totale crypto").click();
  await expect(page.getByRole("button", { name: "Macro 1" })).toBeVisible();
});

test("bandeau : ÷BTC absent sur BTCUSDT, ÷ETH pose le ratio et le menu bascule sur ÷SOL", async ({
  page,
}) => {
  await page.goto("/");

  // Marché par défaut BTCUSDT : ÷BTC n'a pas de sens (base déjà BTC) → bouton absent.
  await expect(page.getByRole("button", { name: "÷BTC" })).toHaveCount(0);

  // Le bouton scindé propose ETH (préférence par défaut) et pose le ratio SYN.
  await page.getByRole("button", { name: "÷ETH" }).click();
  await expect(page.getByText("BTCUSDT / ETHUSDT")).toBeVisible({ timeout: 15_000 });

  // Depuis un ratio ACTIF, le menu recompose depuis la jambe A (pas depuis le SYN).
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await page.getByRole("button", { name: "÷SOL" }).click();
  await expect(page.getByText("BTCUSDT / SOLUSDT")).toBeVisible({ timeout: 15_000 });

  // ÷SOL est maintenant le ratio actif : un clic dessus détoggle vers la jambe A.
  await page.getByRole("button", { name: "÷SOL" }).click();
  await expect(page.getByText("BTCUSDT / SOLUSDT")).toHaveCount(0);
});
