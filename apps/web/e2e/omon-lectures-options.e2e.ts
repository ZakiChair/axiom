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

test("Term IV : mouvement attendu par échéance (straddle ATM au forward, ±1σ IV, échéance bruitée) et vol forward", async ({ page }) => {
  const instant = Date.parse("2026-09-15T00:00:00Z");
  await page.clock.setFixedTime(new Date(instant));
  await routerDeribit(
    page,
    [
      ...echeance("16SEP26", 35, 0.01),
      ...echeance("17SEP26", 50, 0.015),
      ...echeance("18SEP26", 36, 0.02),
      ...echeance("25SEP26", 40, 0.03),
    ],
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

  // Vol forward (IV ATM au spot commun 100 000) ; calendrier ECO hors réseau = FOMC statiques,
  // décision du 16/09 à 18:30 UTC dans ]16SEP 08:00 ; 17SEP 08:00].
  // 16→17 : (50²·56 − 35²·32)/24 = 4200 → 64,8 % ; move 1σ = 64,8/√365 ≈ 3,39 % ;
  // σ base = 18→25 (seule fenêtre ≤ 7 j sans événement) = √[(40²·248 − 36²·80)/168] ≈ 41,77 % ;
  // part FOMC ≈ √(4200 − 1744,8)/√365 ≈ 2,59 %.
  await expect(proche.getByRole("cell").last()).toHaveText("64.8 %±3.39 %FOMC ≈±2.59 %");
  // 17→18 : (36²·80 − 50²·56)/24 < 0 → incohérence, jamais un zéro.
  await expect(milieu.getByRole("cell").last()).toHaveText("—var. < 0");
  // 18→25 : 7 j sans événement ; move 1σ = 41,77 × √(7/365) ≈ 5,78 %.
  await expect(loin.getByRole("cell").last()).toHaveText("41.8 %±5.78 %");
  // Dernière échéance : aucune fenêtre suivante.
  const derniere = table.getByRole("row").filter({ hasText: "$94,000–$106,000" });
  await expect(derniere.getByRole("cell").last()).toHaveText("—");

  await expect(fenetre).toContainText("variance additive entre échéances consécutives");
  await expect(fenetre).toContainText("±2,5 à 3 pts d'incertitude sur σ fwd");
});

test("Smile : P(clôture > K à T) risque-neutre (Breeden-Litzenberger centré) et P(toucher) log-normal en infobulle", async ({ page }) => {
  const instant = Date.parse("2026-09-15T00:00:00Z");
  await page.clock.setFixedTime(new Date(instant));
  // 16SEP26 (32 h), forward 100 000, IV 35 : prix de call USD reconstruits (put OTM sous F) :
  // C(95k) = 0,005·F + 5 000 = 5 500 ; C(100k) = 1 000 ; C(105k) = 500
  // → pentes 0,9 au milieu 97 500 et 0,1 au milieu 102 500.
  await routerDeribit(page, echeance("16SEP26", 35, 0.01), instant);

  await page.goto("/");
  await commande(page, "OMON");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  const niveau = fenetre.getByLabel("Niveau de prix");
  const tuile = fenetre.getByTitle(/^P\(toucher avant T\), modèle log-normal : /);

  // Niveau vide = forward arrondi (100 000) : interpolation 0,9 → 0,1 à mi-chemin ; K = F → contact certain.
  await expect(niveau).toHaveAttribute("placeholder", "100000");
  await expect(tuile).toContainText("P(clôture > K à T), risque-neutre");
  await expect(tuile).toContainText("50.0 %");
  await expect(tuile).toHaveAttribute("title", "P(toucher avant T), modèle log-normal : 100.0 %");

  // Au milieu 97 500 : 0,9 ; P(toucher) = 2·Φ(−|ln 0,975| / (0,35·√(32 h / 365 j))) ≈ 23,1 %.
  await niveau.fill("97500");
  await expect(tuile).toContainText("90.0 %");
  await expect(tuile).toHaveAttribute("title", "P(toucher avant T), modèle log-normal : 23.1 %");

  // Hors de la grille des milieux : absence affichée, jamais un zéro.
  await niveau.fill("110000");
  await expect(tuile).toContainText("—");
  await expect(tuile).not.toContainText("%");

  // Infobulle du smile au strike survolé (centre du tracé → 100 000).
  const canvas = fenetre.locator("canvas").first();
  const boite = await canvas.boundingBox();
  if (boite === null) throw new Error("canvas du smile absent");
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
  await expect(fenetre.getByText("Strike 100K")).toBeVisible();
  await expect(fenetre.getByText("P(clôture > K à T) : 50.0 %")).toBeVisible();
  await expect(fenetre.getByText("P(toucher) log-normal : 100.0 %")).toBeVisible();

  await expect(fenetre).toContainText("mesure risque-neutre, pas une probabilité réelle");
});
