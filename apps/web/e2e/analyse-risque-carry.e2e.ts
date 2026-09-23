import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

async function demarrer(page: import("@playwright/test").Page) {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
}

test("SCEN garde le mode simple et refuse un modèle multifacteur incomplet", async ({ page }) => {
  await demarrer(page);
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: Array.from({ length: 110 }, (_, i) => {
    const t = Date.now() - (110 - i) * 86_400_000;
    return [t, "100", "102", "99", String(100 + (i % 6)), "10", t + 86_399_999, "1000", 5, "5", "500"];
  }) }));
  await page.goto("/");
  await page.evaluate(async () => {
    const { portfolioStore } = await import("/src/store/portfolio.ts");
    portfolioStore.getState().ajouter({ symbole: "BTCUSDT", source: "binance", direction: "long", taille: 1, prixEntree: 100 });
    portfolioStore.getState().ajouter({ symbole: "SOLUSDT", source: "binance", direction: "long", taille: 1, prixEntree: 100 });
  });
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
  await page.clock.install({ time: new Date(Date.now() + 2_000) });
  await demarrer(page);
  await page.route("**/api/v3/depth?*", (route) => route.fulfill({ json: { lastUpdateId: 1, bids: [["99", "100"]], asks: [["100", "100"]] } }));
  await page.route("**/fapi/v1/depth?*", (route) => route.fulfill({ json: { T: Date.now(), bids: [["101", "100"]], asks: [["102", "100"]] } }));
  await page.route("**/fapi/v1/premiumIndex?*", (route) => route.fulfill({ json: { symbol: "BTCUSDT", time: Date.now(), nextFundingTime: Date.now() + 8 * 3_600_000, lastFundingRate: "0.0001" } }));
  await page.route("**/fapi/v1/fundingInfo*", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
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
  await carry.getByRole("button", { name: "Actualiser les carnets" }).click();
  await expect(carry).toContainText("Net conditionnel");
  await expect(carry).toContainText("funding inversé");
  await expect(carry).toContainText("quatre frais");
  await expect(carry).toContainText("cotations non garanties simultanées");
  await page.clock.fastForward(6_000);
  await expect(carry).toContainText("Cotations périmées");
  await expect(carry).not.toContainText("Net conditionnel");
});

test("FUNDX expire une source perp âgée avant la réception spot", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await demarrer(page);
  await page.route("**/api/v3/depth?*", (route) => route.fulfill({ json: { lastUpdateId: 1, bids: [["99", "100"]], asks: [["100", "100"]] } }));
  await page.route("**/fapi/v1/depth?*", (route) => route.fulfill({ json: { T: Date.now() - 4_000, bids: [["101", "100"]], asks: [["102", "100"]] } }));
  await page.route("**/fapi/v1/premiumIndex?*", (route) => route.fulfill({ json: { symbol: "BTCUSDT", time: Date.now(), nextFundingTime: Date.now() + 8 * 3_600_000, lastFundingRate: "0.0001" } }));
  await page.route("**/fapi/v1/fundingInfo*", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Funding cross-exchange/ }).click();
  const fenetre = page.locator('[data-window-id="fundingMatrix"]');
  await fenetre.getByRole("button", { name: "Carry spot/perp" }).click();
  const carry = fenetre.getByLabel("Carry net spot perp");
  await expect(carry).toContainText("Quantité couverte");
  for (const name of ["Frais achat spot (%)", "Frais vente perp (%)", "Frais vente spot (%)", "Frais rachat perp (%)", "Slippage spot sortie", "Slippage perp sortie"]) await carry.getByRole("spinbutton", { name }).fill("0");
  await carry.getByRole("button", { name: "Actualiser les carnets" }).click();
  await expect(carry).toContainText("Net conditionnel");
  await page.clock.fastForward(2_000);
  await expect(carry).toContainText("Cotations périmées");
  await expect(carry).not.toContainText("Net conditionnel");
});
