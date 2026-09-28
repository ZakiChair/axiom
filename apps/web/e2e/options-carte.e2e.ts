import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const NOW = Date.parse("2026-09-28T12:00:00Z");
async function ouvrir(page: Page) {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("get_index_price")) return route.fulfill({ json: { result: { index_price: 100_000 } } });
    if (url.pathname.endsWith("get_volatility_index_data")) return route.fulfill({ json: { result: { data: [[NOW, 50, 50, 50, 50]] } } });
    const result = [
      ["02OCT26", 100000, "C", 30], ["02OCT26", 100000, "P", 10],
      ["02OCT26", 90000, "P", 50],
      ["30OCT26", 100000, "C", 10], ["30OCT26", 100000, "P", 10],
      ["30OCT26", 140000, "C", 30],
    ].map(([e, k, cp, oi]) => ({ instrument_name: `BTC-${e}-${k}-${cp}`, underlying_price: 100000,
      mark_iv: 50, open_interest: oi, interest_rate: 0, volume: 1, mark_price: 0.03, creation_timestamp: NOW }));
    return route.fulfill({ json: { result } });
  });
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("OMON");
  await page.keyboard.press("Enter");
  const f = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await f.getByRole("button", { name: "GEX/DEX", exact: true }).click();
  return f;
}

test("carte nette : zéro distinct du vide, détail persistant et navigation clavier", async ({ page }) => {
  const f = await ouvrir(page);
  await f.getByRole("button", { name: "Carte des expositions", exact: true }).click();
  const carte = f.getByRole("region", { name: "Carte des expositions nettes" });
  await expect(carte).toBeVisible();
  await expect(carte.getByRole("button", { name: /30 oct.*0 à \+5.*GEX \$0/ })).toBeVisible();
  await expect(carte.getByRole("button", { name: /02 oct.*\+30 % et plus.*aucun strike calculable/ })).toContainText("—");
  const cellule = carte.getByRole("button", { name: /02 oct.*−15 à −5.*GEX/ });
  await cellule.focus();
  await page.keyboard.press("Enter");
  const detail = f.getByRole("region", { name: "Détail de la cellule" });
  await expect(detail).toContainText("$90,000");
  await expect(detail).toContainText("GEX");
  await expect(detail).toContainText("DEX");
  await page.mouse.move(0, 0);
  await expect(detail).toContainText("$90,000");
  await f.getByRole("button", { name: "DEX", exact: true }).click();
  await expect(carte).toContainText("DEX en USD notionnels");
  await expect(detail).toContainText("$90,000");
  await expect(carte).toContainText("Échelle commune");
});

test("graphique par défaut : cadrage explicite, sélection clavier et nets inchangés", async ({ page }) => {
  const f = await ouvrir(page);
  const graphique = f.getByRole("img", { name: "GEX net par strike" });
  await expect(graphique).toBeVisible();
  await expect(f.getByRole("img", { name: "GEX net par échéance" })).toBeVisible();
  await expect(f).toContainText("2 strikes affichés sur 3");
  const net = await f.getByRole("group", { name: "GEX net", exact: true }).textContent();
  const echeances = await f.getByRole("img", { name: "GEX net par échéance" }).innerHTML();
  const detail = f.getByRole("region", { name: "Détail du strike" });
  await graphique.locator('[data-strike="100000"]').hover();
  await expect(detail).toContainText("$100,000");
  await graphique.locator('[data-strike="100000"]').click();
  await page.mouse.move(0, 0);
  await expect(detail).toContainText("$100,000");
  const curseur = f.getByRole("slider", { name: "Strike sélectionné" });
  await curseur.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(detail).toContainText("$90,000");
  await expect(detail).toContainText("GEX");
  await expect(detail).toContainText("DEX");
  await page.mouse.move(0, 0);
  await expect(detail).toContainText("$90,000");
  await f.getByRole("button", { name: "Tous les strikes", exact: true }).click();
  await expect(f).toContainText("3 strikes affichés sur 3");
  await expect(f.getByRole("group", { name: "GEX net", exact: true })).toHaveText(net!);
  expect(await f.getByRole("img", { name: "GEX net par échéance" }).innerHTML()).toBe(echeances);
  await f.getByRole("button", { name: "DEX", exact: true }).click();
  await expect(f.getByRole("img", { name: "DEX net par strike" })).toBeVisible();
  await expect(f.getByRole("img", { name: "DEX net par échéance" })).toBeVisible();
});

test("sensibilité GEX et DEX : vraie courbe métrique et curseur au clavier", async ({ page }) => {
  const f = await ouvrir(page);
  await f.getByRole("button", { name: "Sensibilité au prix", exact: true }).click();
  const graphique = f.getByRole("img", { name: /Sensibilité GEX/ });
  await expect(graphique).toBeVisible();
  const curseur = f.getByRole("slider", { name: "Prix simulé" });
  await expect(curseur).toHaveValue("20");
  await curseur.focus();
  await page.keyboard.press("ArrowRight");
  await expect(curseur).toHaveValue("21");
  await expect(f.getByRole("region", { name: "Lecture du prix simulé" })).toContainText("$100,750");
  await f.getByRole("button", { name: "DEX", exact: true }).click();
  await expect(f.getByRole("img", { name: /Sensibilité DEX/ })).toBeVisible();
  await expect(f).toContainText("IV, OI, temps restant et ratio forward/index constants");
});
