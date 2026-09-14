import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

// Lectures d'options d'OMON sur fixtures hermétiques (chantier « indicateurs gratuits vérifiés »).

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

interface OptionFixture {
  instrument_name: string;
  mark_iv: number;
  mark_price: number;
  underlying_price: number;
  open_interest: number;
  interest_rate: number;
  volume: number;
}

/** Sert la chaîne d'options et le DVOL Deribit ; toute autre méthode répond 503. */
async function routerDeribit(page: Page, options: OptionFixture[], instant: number): Promise<void> {
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    const methode = url.pathname.split("/").at(-1);
    if (methode === "get_book_summary_by_currency" && url.searchParams.get("kind") === "option") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: options } });
      return;
    }
    if (methode === "get_volatility_index_data") {
      await route.fulfill({ json: { jsonrpc: "2.0", result: { data: [[instant, 40, 41, 39, 40]] } } });
      return;
    }
    await route.fulfill({ status: 503, json: { error: "fixture Deribit non prévue" } });
  });
}

/**
 * Trois strikes (95 000, 100 000, 105 000) calls et puts d'une échéance, forward 100 000.
 * `markAtm` = mark (BTC) du call ET du put à 100 000 ; les ailes ont des marks arbitraires.
 */
function echeance(code: string, iv: number, markAtm: number): OptionFixture[] {
  const jambe = (strike: number, cp: "C" | "P", mark_price: number): OptionFixture => ({
    instrument_name: `BTC-${code}-${strike}-${cp}`,
    mark_iv: iv,
    mark_price,
    underlying_price: 100_000,
    open_interest: 10,
    interest_rate: 0,
    volume: 1,
  });
  return [
    jambe(95_000, "C", 0.05 + markAtm),
    jambe(95_000, "P", markAtm / 2),
    jambe(100_000, "C", markAtm),
    jambe(100_000, "P", markAtm),
    jambe(105_000, "C", markAtm / 2),
    jambe(105_000, "P", 0.05 + markAtm),
  ];
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("Term IV : mouvement attendu par échéance (straddle ATM au forward, ±1σ IV, échéance bruitée)", async ({ page }) => {
  const instant = Date.parse("2026-09-15T00:00:00Z");
  await page.clock.setFixedTime(new Date(instant));
  await routerDeribit(
    page,
    [...echeance("16SEP26", 35, 0.01), ...echeance("17SEP26", 50, 0.015), ...echeance("18SEP26", 36, 0.02)],
    instant,
  );

  await page.goto("/");
  await commande(page, "OMON");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "Term IV", exact: true }).click();

  const table = fenetre.getByRole("table", { name: "Mouvement attendu par échéance" });
  await expect(table).toBeVisible();

  // 16SEP26 08:00 UTC : 32 h → bruitée ; straddle 0,02 × 100 000 ; 1σ = 35 × √(32 h / 365 j).
  const proche = table.getByRole("row").filter({ hasText: "$98,000–$102,000" });
  await expect(proche).toHaveCount(1);
  await expect(proche).toContainText("32 h");
  await expect(proche).toContainText("bruité");
  await expect(proche).toContainText("±2.00 %");
  await expect(proche).toContainText("±$2.00K");
  await expect(proche).toContainText("±2.12 %");

  // 17SEP26 : 56 h → non bruitée.
  const milieu = table.getByRole("row").filter({ hasText: "$97,000–$103,000" });
  await expect(milieu).toContainText("±3.00 %");
  await expect(milieu).toContainText("±4.00 %");
  await expect(milieu).not.toContainText("bruité");

  // 18SEP26 : 80 h ; straddle 4 % ; 1σ = 36 × √(80 h / 365 j) ≈ 3,44 %.
  const loin = table.getByRole("row").filter({ hasText: "$96,000–$104,000" });
  await expect(loin).toContainText("3 j");
  await expect(loin).toContainText("±4.00 %");
  await expect(loin).toContainText("±3.44 %");
  await expect(loin).toContainText("36.0 %");
  await expect(loin).not.toContainText("bruité");

  await expect(fenetre).toContainText("F ± straddle ≈ ±0,8σ");
  await expect(fenetre).toContainText("pas ±1σ ni 68 %");
});
