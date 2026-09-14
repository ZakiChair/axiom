import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

// Vendredi 2026-09-25 08:00 UTC : les échéances Deribit (08:00 UTC) tombent à un nombre entier de jours.
const INSTANT_FIXE = Date.parse("2026-09-25T08:00:00Z");
const SPOT = 100_000;

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("TERM superpose le T-bill US et lit le portage excédentaire à 90 j (Deribit, ETH absent)", async ({ page }) => {
  await page.clock.install({ time: INSTANT_FIXE });

  // BTC : 1 j (exclu du portage), 63 j à 3,60 %/an, 91 j à 5,00 %/an, perpétuel écarté.
  const instruments = [
    ["BTC-26SEP26", "2026-09-26T08:00:00Z", "day"],
    ["BTC-27NOV26", "2026-11-27T08:00:00Z", "month"],
    ["BTC-25DEC26", "2026-12-25T08:00:00Z", "month"],
    ["BTC-PERPETUAL", "2099-01-01T08:00:00Z", "perpetual"],
  ].map(([instrument_name, echeance, settlement_period]) => ({
    instrument_name,
    expiration_timestamp: Date.parse(echeance!),
    settlement_period,
  }));
  const resume = [
    ["BTC-26SEP26", 100_010],
    ["BTC-27NOV26", 100_621.37],
    ["BTC-25DEC26", 101_246.58],
    ["BTC-PERPETUAL", 100_005],
  ].map(([instrument_name, mark_price]) => ({ instrument_name, mark_price }));

  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    const methode = url.pathname.split("/").at(-1);
    const btc = url.searchParams.get("currency") === "BTC" || url.searchParams.get("index_name") === "btc_usd";
    if (!btc) {
      await route.fulfill({ status: 503, json: { error: "ETH absent de la fixture" } });
      return;
    }
    if (methode === "get_instruments") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: instruments } });
      return;
    }
    if (methode === "get_book_summary_by_currency") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: resume } });
      return;
    }
    if (methode === "get_index_price") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: { index_price: SPOT } } });
      return;
    }
    await route.fulfill({ status: 503, json: { error: "fixture Deribit non prévue" } });
  });
  await page.route("**/extapi/home.treasury.gov/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/csv",
      body: 'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr"\n09/24/2026,4.00,4.00,4.00,4.00,4.00,4.00,4.00',
    }),
  );

  await page.goto("/");
  await commande(page, "TERM");
  const fenetre = page.getByRole("complementary", { name: "Structure par terme" });
  await expect(fenetre).toContainText("T-bill US au 24 sept. 2026");

  // 90 j interpolé entre 63 j (3,60 %) et 91 j (5,00 %) : 3,60 + 27/28 × 1,40 = 4,95 % ; − 4,00 = +0.95 pt.
  const tuileBtc = fenetre.getByText("Portage excédentaire 90 j · BTC", { exact: true }).locator("xpath=../..");
  await expect(tuileBtc).toContainText("+0.95 pt");
  await expect(tuileBtc).toContainText("Deribit · BTC-27NOV26 ↔ BTC-25DEC26");
  await expect(tuileBtc).toContainText("T-bill 4.00%");

  // ETH : Deribit en 503, Binance COIN-M en 503 (bouchon) → aucune valeur inventée.
  const tuileEth = fenetre.getByText("Portage excédentaire 90 j · ETH", { exact: true }).locator("xpath=../..");
  await expect(tuileEth).toContainText("—");
  await expect(tuileEth).toContainText("basis indisponible");
  await expect(tuileEth).not.toContainText(" pt");

  await expect(fenetre).toContainText("basis interpolé à 90 j entre les deux échéances encadrantes");
  await expect(fenetre).toContainText("Le T-bill n'est pas le coût de financement réel");
  await expect(fenetre).toContainText("faible face au CME");

  // Survol du bord droit du tracé = échéance 25DEC26 (91 j) : basis 5,00 % − T-bill 4,00 %.
  const canvas = fenetre.locator("canvas").first();
  const boite = await canvas.boundingBox();
  if (boite === null) throw new Error("canvas TERM sans boîte");
  await page.mouse.move(boite.x + boite.width - 12, boite.y + boite.height / 2);
  await expect(fenetre).toContainText("T-bill US : 4.00%");
  await expect(fenetre).toContainText("Portage BTC : +1.00 pt");
  await expect(fenetre).toContainText("Portage ETH : —");

  // Échéance 26SEP26 (1 j) au bord gauche : exclue du portage.
  await page.mouse.move(boite.x + 42, boite.y + boite.height / 2);
  await expect(fenetre).toContainText("Portage BTC : —");
  await expect(fenetre).toContainText("T-bill US : —");
});
