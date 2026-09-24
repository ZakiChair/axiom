import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

async function demarrer(page: import("@playwright/test").Page) {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
}

const INSTANT_CARRY = Date.UTC(2026, 8, 24, 12);

/**
 * Carnet perp daté `T`, puis « Actualiser les carnets » qui attend l'acquisition NOUVELLE.
 * Le calcul de la première acquisition affiche déjà « Net conditionnel » : l'attendre après
 * le clic peut aboutir avant que React ait écarté l'ancienne cotation, l'horloge avance alors
 * pendant que l'actualisation est encore en vol et celle-ci est rejetée à la réception
 * (« acquisitions non rapprochées ou carnet perp périmé »). Seul le carnet actualisé porte un
 * VWAP de vente perp à 103 : tant qu'il n'est pas rendu, le test n'avance pas l'horloge.
 */
async function routerCarnetPerp(page: import("@playwright/test").Page, T: number) {
  let actualise = false;
  await page.route("**/fapi/v1/depth?*", (route) => route.fulfill({ json: actualise
    ? { T, bids: [["103", "100"]], asks: [["104", "100"]] }
    : { T, bids: [["101", "100"]], asks: [["102", "100"]] } }));
  return async (carry: import("@playwright/test").Locator) => {
    actualise = true;
    await carry.getByRole("button", { name: "Actualiser les carnets" }).click();
    await expect(carry).toContainText("vente perp VWAP 103.0000");
  };
}

test("SCEN garde le mode simple et refuse un modèle multifacteur incomplet", async ({ page }) => {
  await demarrer(page);
  // Archive complète avant boot : survit à un rechargement Vite des modules optimisés.
  await page.addInitScript(() => {
    const positions = ["BTCUSDT", "SOLUSDT"].map((symbole) => ({ id: `fixture:${symbole}`, symbole,
      source: "binance", direction: "long", taille: 1, prixEntree: 100, dateEntree: Date.now() - 86_400_000,
      statut: "ouvert" }));
    localStorage.setItem("axiom:portfolio:v1", JSON.stringify({ positions }));
  });
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: Array.from({ length: 110 }, (_, i) => {
    const t = Date.now() - (110 - i) * 86_400_000;
    return [t, "100", "102", "99", String(100 + (i % 6)), "10", t + 86_399_999, "1000", 5, "5", "500"];
  }) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Stress-test/ }).click();
  const fenetre = page.locator('[data-window-id="scen"]');
  await expect(fenetre.getByRole("button", { name: "1 facteur" })).toBeVisible();
  await fenetre.getByRole("button", { name: "Multifacteur" }).click();
  await expect(fenetre.getByLabel("Scénario multifactoriel")).toContainText("clôtures non synchrones");
  await expect(fenetre.getByLabel("Scénario multifactoriel")).toContainText("facteur absent");
  await fenetre.getByRole("checkbox", { name: /Actions US/ }).uncheck();
  await fenetre.getByRole("checkbox", { name: /Dollar/ }).uncheck();
  await fenetre.getByRole("checkbox", { name: /Taux réel US/ }).check();
  const ligneSol = fenetre.getByText(/SOLUSDT · binance · USDT · prix de valorisation/).locator("..");
  await expect(ligneSol).toContainText("facteur absent");
  await expect(ligneSol).toContainText("P&L inconnu");
  await fenetre.getByRole("checkbox", { name: /Taux réel US/ }).uncheck();
  const ligneBtc = fenetre.getByText(/BTCUSDT · binance · USDT · prix de valorisation/).locator("..");
  await expect(ligneBtc).toContainText("Exposition directe");
  await expect(ligneBtc).not.toContainText("R² 1.000");
});

test("FUNDX calcule le carry avec les deux carnets, puis bloque des cotations périmées", async ({ page }) => {
  await page.clock.install({ time: new Date(INSTANT_CARRY - 60_000) });
  await demarrer(page);
  await page.route("**/api/v3/depth?*", (route) => route.fulfill({ json: { lastUpdateId: 1, bids: [["99", "100"]], asks: [["100", "100"]] } }));
  const actualiserCarnets = await routerCarnetPerp(page, INSTANT_CARRY);
  await page.route("**/fapi/v1/premiumIndex?*", (route) => route.fulfill({ json: { symbol: "BTCUSDT", time: INSTANT_CARRY, nextFundingTime: INSTANT_CARRY + 8 * 3_600_000, lastFundingRate: "0.0001" } }));
  await page.route("**/fapi/v1/fundingInfo*", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.clock.pauseAt(INSTANT_CARRY);
  expect(await page.evaluate(() => Date.now())).toBe(INSTANT_CARRY);
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Funding cross-exchange/ }).click();
  const fenetre = page.locator('[data-window-id="fundingMatrix"]');
  await fenetre.getByRole("button", { name: "Historique 7/30/90 j" }).click();
  await expect(fenetre).toContainText("Historique indisponible");
  await fenetre.getByRole("button", { name: "Carry spot/perp" }).click();
  const carry = fenetre.getByLabel("Carry net spot perp");
  await expect(carry).toContainText("heure marché spot inconnue");
  await expect(carry).toContainText("UTC");
  await expect(carry).toContainText("Quantité couverte");
  for (const name of ["Frais achat spot (%)", "Frais vente perp (%)", "Frais vente spot (%)", "Frais rachat perp (%)", "Slippage spot sortie", "Slippage perp sortie"]) await carry.getByRole("spinbutton", { name }).fill("0");
  await actualiserCarnets(carry);
  await expect(carry).toContainText("Net conditionnel");
  await expect(carry).toContainText("funding inversé");
  await expect(carry).toContainText("quatre frais");
  await expect(carry).toContainText("cotations non garanties simultanées");
  await page.clock.fastForward(6_000);
  expect(await page.evaluate(() => Date.now())).toBe(INSTANT_CARRY + 6_000);
  await expect(carry).toContainText("Cotations périmées");
  await expect(carry).not.toContainText("Net conditionnel");
});

test("FUNDX expire une source perp âgée avant la réception spot", async ({ page }) => {
  await page.clock.install({ time: new Date(INSTANT_CARRY - 60_000) });
  await demarrer(page);
  await page.route("**/api/v3/depth?*", (route) => route.fulfill({ json: { lastUpdateId: 1, bids: [["99", "100"]], asks: [["100", "100"]] } }));
  const actualiserCarnets = await routerCarnetPerp(page, INSTANT_CARRY - 4_000);
  await page.route("**/fapi/v1/premiumIndex?*", (route) => route.fulfill({ json: { symbol: "BTCUSDT", time: INSTANT_CARRY, nextFundingTime: INSTANT_CARRY + 8 * 3_600_000, lastFundingRate: "0.0001" } }));
  await page.route("**/fapi/v1/fundingInfo*", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.clock.pauseAt(INSTANT_CARRY);
  expect(await page.evaluate(() => Date.now())).toBe(INSTANT_CARRY);
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Funding cross-exchange/ }).click();
  const fenetre = page.locator('[data-window-id="fundingMatrix"]');
  await fenetre.getByRole("button", { name: "Carry spot/perp" }).click();
  const carry = fenetre.getByLabel("Carry net spot perp");
  await expect(carry).toContainText("Quantité couverte");
  for (const name of ["Frais achat spot (%)", "Frais vente perp (%)", "Frais vente spot (%)", "Frais rachat perp (%)", "Slippage spot sortie", "Slippage perp sortie"]) await carry.getByRole("spinbutton", { name }).fill("0");
  await actualiserCarnets(carry);
  await expect(carry).toContainText("Net conditionnel");
  await page.clock.fastForward(2_000);
  expect(await page.evaluate(() => Date.now())).toBe(INSTANT_CARRY + 2_000);
  await expect(carry).toContainText("Cotations périmées");
  await expect(carry).not.toContainText("Net conditionnel");
});
