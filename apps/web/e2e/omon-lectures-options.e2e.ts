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

  // Niveau vide = forward arrondi (100 000) : interpolation 0,9 → 0,1 à mi-chemin ; échéance unique, donc
  // prix courant S = forward : K = S → contact certain (F ≠ S couvert par probaImplicite.test.ts).
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
  await expect(fenetre).toContainText("S = prix courant");
});

/** Option CBOE brute (symbole OCC, greeks CBOE). */
function optionCboe(racine: string, cp: "C" | "P", strike: number, oi: number, volume: number, gamma: number, date = "260918") {
  return {
    option: `${racine}${date}${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
    open_interest: oi,
    volume,
    delta: cp === "C" ? 0.5 : -0.5,
    gamma,
    iv: 0.4,
  };
}

test("GEX/DEX Actions : IBIT différé converti en niveaux BTC au dernier échange, ETHA masqué sans bougie Binance", async ({ page }) => {
  // Samedi : marché US fermé, cotation figée au dernier échange du vendredi 16:00 NY (20:00 UTC).
  const instant = Date.parse("2026-09-12T12:00:00Z");
  await page.clock.setFixedTime(new Date(instant));

  // IBIT à 45 $ : bande ±25 % = [33,75 ; 56,25]. Le strike 30 (puts massifs) est hors bande :
  // exclu du GEX (sinon put wall), mais compté dans le P/C de la chaîne complète.
  // GEX/(S²·0,01·100) : 40 → −45 ; 44,5 → −380 (put wall) ; 45 → +100 ; 50 → +490 (call wall).
  // Cumul −45, −425, −325, +165 → flip = 45 + 325/490 × 5 ≈ 48,32 $.
  const ibit = {
    timestamp: "2026-09-11 20:15:00",
    data: {
      current_price: 45,
      iv30: 38.8,
      last_trade_time: "2026-09-11T16:00:00",
      options: [
        optionCboe("IBIT", "C", 30, 0, 10, 0.1),
        optionCboe("IBIT", "P", 30, 5000, 100, 0.1),
        optionCboe("IBIT", "C", 40, 100, 10, 0.05),
        optionCboe("IBIT", "P", 40, 1000, 10, 0.05),
        optionCboe("IBIT", "C", 44.5, 100, 10, 0.2),
        optionCboe("IBIT", "P", 44.5, 2000, 10, 0.2),
        optionCboe("IBIT", "C", 45, 1000, 10, 0.2),
        optionCboe("IBIT", "P", 45, 500, 10, 0.2),
        optionCboe("IBIT", "C", 50, 5000, 10, 0.1),
        optionCboe("IBIT", "P", 50, 100, 10, 0.1),
      ],
    },
  };
  const etha = {
    timestamp: "2026-09-11 20:15:00",
    data: {
      current_price: 20,
      iv30: 52.4,
      last_trade_time: "2026-09-11T16:00:00",
      options: [
        optionCboe("ETHA", "C", 18, 100, 5, 0.1),
        optionCboe("ETHA", "P", 18, 800, 5, 0.1),
        optionCboe("ETHA", "C", 22, 900, 5, 0.1),
        optionCboe("ETHA", "P", 22, 50, 5, 0.1),
      ],
    },
  };
  const cheminsCboe: string[] = [];
  await page.route("https://cdn.cboe.com/api/global/delayed_quotes/options/**", async (route) => {
    const nom = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    cheminsCboe.push(nom);
    if (nom === "IBIT.json") return route.fulfill({ json: ibit });
    if (nom === "ETHA.json") return route.fulfill({ json: etha });
    return route.fulfill({ status: 403, json: { error: "chemin CBOE non prévu" } });
  });
  // Seule la bougie 1m BTCUSDT du dernier échange est servie ; ETHUSDT échoue (conversion masquée).
  const dernierEchangeUtc = Date.UTC(2026, 8, 11, 20, 0, 0);
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const p = new URL(route.request().url()).searchParams;
    if (
      p.get("symbol") === "BTCUSDT" &&
      p.get("interval") === "1m" &&
      p.get("limit") === "1" &&
      p.get("endTime") === String(dernierEchangeUtc)
    ) {
      return route.fulfill({
        json: [[dernierEchangeUtc, "79990", "80010", "79980", "80000", "1", dernierEchangeUtc + 59_999, "80000", 1, "0", "0", "0"]],
      });
    }
    return route.fulfill({ status: 503, json: { error: "bougie non prévue" } });
  });

  await page.goto("/");
  await commande(page, "OMON");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "GEX/DEX", exact: true }).click();
  await fenetre.getByRole("button", { name: "Actions", exact: true }).click();
  await fenetre.getByRole("button", { name: "IBIT", exact: true }).click();

  // Tuiles visibles de la vue GEX/DEX (Smile, toujours montée mais masquée, a ses propres P/C et notionnel).
  const tuile = (label: string) =>
    fenetre.locator("div.rounded-md").filter({ hasText: new RegExp(`^${label}`), visible: true });
  await expect(fenetre).toContainText("différé ~15 min — marché US fermé nuits et week-ends");
  await expect(fenetre).toContainText("dernier échange 2026-09-11 16:00:00 (heure de New York)");

  // Niveaux convertis au ratio 80 000 / 45 ; petits strikes fractionnaires non arrondis.
  await expect(tuile("Spot(?!↔)")).toContainText("≈ $80,000 BTC");
  await expect(tuile("Call wall")).toContainText("$50");
  await expect(tuile("Call wall")).toContainText("≈ $88,889 BTC");
  await expect(tuile("Put wall")).toContainText("$44.5");
  await expect(tuile("Put wall")).toContainText("≈ $79,111 BTC");
  await expect(tuile("Gamma flip")).toContainText("$48.32");
  await expect(tuile("Gamma flip")).toContainText("indicatif");
  await expect(tuile("Gamma flip")).toContainText("≈ $85,896 BTC");
  // P/C de la chaîne complète (strike 30 compris) : OI 8 600 / 6 200 ; volume 140 / 50.
  await expect(tuile("P/C \\(OI\\)")).toContainText("1.39");
  await expect(tuile("P/C \\(Vol\\)")).toContainText("2.80");
  await expect(tuile("IV30 \\(CBOE\\)")).toContainText("38.8 %");
  // Notionnel = 14 800 contrats × 100 × 45 $ ≈ 832,5 BTC au prix de référence.
  await expect(tuile("Notionnel OI")).toContainText("$66.60M");
  await expect(tuile("Notionnel OI")).toContainText("≈ 833 BTC");

  // Infobulle de l'histogramme au bord droit du tracé (strike 50).
  const canvas = fenetre.locator("canvas").filter({ visible: true }).first();
  const boite = await canvas.boundingBox();
  if (boite === null) throw new Error("histogramme GEX absent");
  await page.mouse.move(boite.x + boite.width - 12, boite.y + boite.height / 2);
  await expect(fenetre.getByText("Strike 50", { exact: true })).toBeVisible();
  await expect(fenetre.getByText("≈ BTC : $88,889")).toBeVisible();

  // ETHA : bougie ETHUSDT indisponible → conversion masquée, jamais le spot courant.
  await fenetre.getByRole("button", { name: "ETHA", exact: true }).click();
  await expect(tuile("Spot(?!↔)")).toContainText("$20");
  await expect(tuile("Spot(?!↔)")).toContainText("≈ — ETH");
  await expect(tuile("Call wall")).toContainText("≈ — ETH");
  await expect(fenetre).toContainText("conversion en ETH indisponible");

  expect(cheminsCboe).toContain("IBIT.json");
  expect(cheminsCboe).toContain("ETHA.json");
  // SPX (ticker par défaut) garde « _SPX.json » ; les ETF n'utilisent jamais le préfixe (403).
  expect(cheminsCboe).toContain("_SPX.json");
  expect(cheminsCboe.filter((c) => c === "_IBIT.json" || c === "_ETHA.json")).toEqual([]);
});

test("GEX/DEX Actions : après 16:00 à New York, l'échéance CBOE par défaut saute celle du jour aux gammas résiduels", async ({ page }) => {
  // Lundi 17:00 à New York : l'échéance IBIT du jour (14/09) reste listée (grâce d'un jour) avec
  // des gammas RÉSIDUELS non nuls près du spot (profil relevé sur la chaîne réelle du 14/09 à
  // 18:53 NY) ; la suivante est le mercredi 16/09 (IBIT : lundi, mercredi, vendredi).
  const instant = Date.parse("2026-09-14T21:00:00Z");
  await page.clock.setFixedTime(new Date(instant));
  const jour = Date.UTC(2026, 8, 14);
  const suivante = Date.UTC(2026, 8, 16);

  // 16/09, GEX/(S²·0,01·100) : 40 → −200 (put wall) ; 44 → −50 ; 46 → +600 (call wall) ; 50 → +50.
  // 14/09, résidus : 45 → +1,4548·6747 − 1,4139·1360 ≈ +7 893 (call wall) ; 44 → 0,0744·(2039 − 3496)
  // ≈ −108 (put wall) ; ailes à gamma nul et deltas saturés.
  const residuelle = (cp: "C" | "P", strike: number, oi: number, delta: number, gamma: number) => ({
    ...optionCboe("IBIT", cp, strike, oi, 900, gamma, "260914"),
    delta,
  });
  const ibit = {
    timestamp: "2026-09-14 21:00:00",
    data: {
      current_price: 45,
      iv30: 38.8,
      last_trade_time: "2026-09-14T16:00:00",
      options: [
        residuelle("C", 42, 1772, 1, 0),
        residuelle("C", 44, 2039, 0.9898, 0.0744),
        residuelle("P", 44, 3496, -0.0102, 0.0744),
        residuelle("C", 45, 6747, 0.1339, 1.4548),
        residuelle("P", 45, 1360, -0.8859, 1.4139),
        residuelle("P", 47, 16, -1, 0),
        optionCboe("IBIT", "P", 40, 2000, 10, 0.1, "260916"),
        optionCboe("IBIT", "P", 44, 1000, 10, 0.05, "260916"),
        optionCboe("IBIT", "C", 46, 3000, 10, 0.2, "260916"),
        optionCboe("IBIT", "C", 50, 500, 10, 0.1, "260916"),
      ],
    },
  };
  await page.route("https://cdn.cboe.com/api/global/delayed_quotes/options/**", async (route) => {
    const nom = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    if (nom === "IBIT.json") return route.fulfill({ json: ibit });
    return route.fulfill({ status: 403, json: { error: "chemin CBOE non prévu" } });
  });
  const dernierEchangeUtc = Date.UTC(2026, 8, 14, 20, 0, 0);
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const p = new URL(route.request().url()).searchParams;
    if (p.get("symbol") === "BTCUSDT" && p.get("endTime") === String(dernierEchangeUtc)) {
      return route.fulfill({
        json: [[dernierEchangeUtc, "79990", "80010", "79980", "80000", "1", dernierEchangeUtc + 59_999, "80000", 1, "0", "0", "0"]],
      });
    }
    return route.fulfill({ status: 503, json: { error: "bougie non prévue" } });
  });

  await page.goto("/");
  await commande(page, "OMON");
  const fenetre = page.getByRole("complementary", { name: "Options (smile IV, max pain)" });
  await fenetre.getByRole("button", { name: "GEX/DEX", exact: true }).click();
  await fenetre.getByRole("button", { name: "Actions", exact: true }).click();
  await fenetre.getByRole("button", { name: "IBIT", exact: true }).click();

  const tuile = (label: string) =>
    fenetre.locator("div.rounded-md").filter({ hasText: new RegExp(`^${label}`), visible: true });
  const selecteur = fenetre.getByLabel("Échéance CBOE");
  const mention = fenetre.getByText("Échéance expirée (16:00 NY passée) : greeks CBOE résiduels, murs et flip non significatifs.");

  // Défaut : l'échéance du 16/09, murs convertis au ratio 80 000 / 45.
  await expect(tuile("Call wall")).toContainText("$46");
  await expect(selecteur).toHaveValue(String(suivante));
  await expect(mention).toHaveCount(0);
  await expect(tuile("Call wall")).toContainText("≈ $81,778 BTC");
  await expect(tuile("Put wall")).toContainText("$40");
  await expect(tuile("Put wall")).toContainText("≈ $71,111 BTC");

  // La liste garde l'échéance du jour (grâce d'un jour inchangée).
  await expect(selecteur.locator("option")).toHaveCount(2);
  await expect(selecteur.locator(`option[value="${jour}"]`)).toHaveCount(1);

  // Sélection manuelle du jour : retenue et calculée sur les résidus, sous la mention d'expiration.
  await selecteur.selectOption(String(jour));
  await expect(selecteur).toHaveValue(String(jour));
  await expect(mention).toBeVisible();
  await expect(tuile("Call wall")).toContainText("$45");
  await expect(tuile("Put wall")).toContainText("$44");
});
