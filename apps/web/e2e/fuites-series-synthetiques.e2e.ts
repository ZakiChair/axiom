import { test, expect, type Page, type Route } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Parcours e2e du lot « fuites des séries synthétiques » (demande du 29/10/2026) : une série sans
 * marché perp (STABLE.D) n'interroge plus aucun fournisseur perp — ni le sondage des alertes
 * Funding (Binance fapi, puis Coinalyze), ni le flux de liquidations partagé par la fenêtre LIQ
 * et la heatmap (WS Bybit, amorce Coinalyze) — et un alias pointé (USDT.D) tapé puis validé
 * aussitôt ouvre la série sans aucune requête Twelve Data.
 *
 * HERMÉTIQUE : bouchonnerReseau ferme tout ; les compteurs de routes, déclarés après lui (donc
 * prioritaires), captent les requêtes perp et Twelve Data. Le retour sur BTCUSDT sert de témoin :
 * les mêmes compteurs y voient bien les requêtes reprendre. Le score de régime GLOBAL
 * (store/regime.ts) lit au démarrage le funding et l'OI de BTCUSDT quel que soit le graphe : ces
 * lectures-là ne viennent pas de la série et ne sont pas comptées comme fuites.
 */

/** Points de fuite du contrat : sondage Funding, son repli et l'amorce des liquidations. */
const FUITE_FAPI = /\/fapi\/v1\/premiumIndex\?/;
const FUITE_COINALYZE = /\/v1\/(funding-rate|liquidation-history)\?/;

const JOUR = 86_400_000;

interface Compteurs {
  fapi: string[];
  coinalyze: string[];
  /** Messages envoyés au WS Bybit (abonnements `allLiquidation.<symbole>`). */
  bybit: string[];
  twelveData: string[];
}

async function compterRequetes(page: Page): Promise<Compteurs> {
  const c: Compteurs = { fapi: [], coinalyze: [], bybit: [], twelveData: [] };
  const refuser = (liste: string[]) => (route: Route) => {
    liste.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: "fournisseur bouchonné" } });
  };
  await page.route("**/fapi/v1/**", refuser(c.fapi));
  await page.route("**/coinalyzeapi/**", refuser(c.coinalyze));
  await page.route("**/tdapi/**", refuser(c.twelveData));
  await page.routeWebSocket(/stream\.bybit\.com/, (ws) => {
    ws.onMessage((message) => { c.bybit.push(String(message)); });
  });
  return c;
}

/** Marché du store (convention de dominance-stablecoins : store réel, aucun attribut de test). */
async function lireMarche(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { exchange: string; symbol: string; timeframe: string } };
    }>;
    const { exchange, symbol, timeframe } = (await importer()).marketStore.getState();
    return { exchange, symbol, timeframe };
  });
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("STABLE.D avec heatmap, alerte Funding et fenêtre LIQ : aucune requête perp ; retour sur BTCUSDT : elles reprennent", async ({ page }) => {
  const c = await compterRequetes(page);
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({
    json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] },
  }));
  await page.route("**/api/v3/klines*", (route) => {
    const debut = Date.now() - 200 * JOUR;
    return route.fulfill({ json: Array.from({ length: 200 }, (_, i) => {
      const t = debut + i * JOUR;
      return [t, "60000", "60100", "59900", "60050", "100", t + JOUR - 1, "0", 10, "50", "0", "0"];
    }) });
  });
  // État persisté d'avant le correctif : graphe sur STABLE.D, heatmap active, alerte Funding sur la série.
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:chartState:v1", JSON.stringify({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d", indicators: [] }));
    window.localStorage.setItem("axiom:sessionUi:v1", JSON.stringify({ liqHeatmap: true }));
    window.localStorage.setItem("axiom:alerts:v1", JSON.stringify({ journal: [], defs: [{
      id: "funding-stable-d", symbol: "STABLE.D", source: "synthetic", actif: true, declenchements: [],
      condition: { type: "funding-extreme", sens: "les-deux", seuilAbs: 0.001 },
    }] }));
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const bandeau = page.locator("[data-chart-banner]");
  await expect(bandeau.getByText("STABLE.D", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /^LIQ/ }).click();
  const liq = page.getByRole("complementary", { name: "Liquidations" });
  await expect(liq).toBeVisible({ timeout: 15_000 });
  await expect(liq).toContainText("Pas de marché perp pour cette série : liquidations indisponibles.");
  await expect(liq).not.toContainText("En attente de liquidations");

  // Création : les trois types perp sont désactivés, avec la raison en titre.
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  for (const type of ["funding-extreme", "cvd-spot-perp-div", "liq-cascade"]) {
    const option = aside.locator(`option[value="${type}"]`);
    await expect(option, type).toBeDisabled();
    await expect(option, type).toHaveAttribute("title", /Pas de marché perp pour STABLE\.D/);
  }

  // Laisse passer le sondage Funding du démarrage et l'amorce du flux : rien ne doit partir.
  await page.waitForTimeout(1_500);
  expect(c.fapi.filter((u) => FUITE_FAPI.test(u)), c.fapi.join("\n")).toEqual([]);
  expect(c.coinalyze.filter((u) => FUITE_COINALYZE.test(u)), c.coinalyze.join("\n")).toEqual([]);
  expect(c.bybit).toEqual([]);
  expect([...c.fapi, ...c.coinalyze].filter((u) => u.includes("STABLE.D"))).toEqual([]);

  // « Composer » : une sous-condition ajoutée sur STABLE.D puis retirée (×) ne laisse pas la série
  // pour cible — de retour sur BTCUSDT, les types perp redeviennent disponibles.
  const composer = aside.getByRole("checkbox", { name: "Composer (ET)" });
  await composer.check();
  await aside.getByPlaceholder("Niveau").fill("1");
  await aside.getByRole("button", { name: "+ Ajouter à la composition (0/4)" }).click();
  await aside.locator("li", { hasText: "⋀" }).getByRole("button", { name: "×" }).click();
  await expect(aside.locator("li", { hasText: "⋀" })).toHaveCount(0);

  // Retour sur un perp : la bascule persistée redevient effective, les requêtes reprennent.
  await page.getByRole("combobox", { name: "Rechercher une paire" }).fill("BTCUSDT");
  await page.keyboard.press("Enter");
  await expect(bandeau.getByText("BTCUSDT", { exact: true })).toBeVisible();
  expect(await lireMarche(page)).toMatchObject({ exchange: "binance", symbol: "BTCUSDT" });
  await expect.poll(() => c.bybit.some((m) => m.includes("allLiquidation.BTCUSDT"))).toBe(true);
  await expect.poll(() => c.coinalyze.some((u) => u.includes("liquidation-history") && u.includes("BTCUSDT"))).toBe(true);
  await expect(liq).toContainText("En attente de liquidations");

  // Et une alerte Funding se crée et se sonde sur le vrai perp ; celle de STABLE.D reste inerte.
  await expect(aside.locator('option[value="funding-extreme"]')).toBeEnabled();
  await composer.uncheck();
  await aside.locator("select").filter({ has: page.locator('option[value="funding-extreme"]') }).selectOption("funding-extreme");
  await aside.getByRole("button", { name: "Ajouter sur BTCUSDT" }).click();
  await expect.poll(() => c.fapi.some((u) => u.includes("premiumIndex?symbol=BTCUSDT"))).toBe(true);
  await expect(aside.getByRole("button", { name: /^Alertes/ })).toContainText("2 alertes");

  // Le type Funding reste choisi quand le graphe repasse sur la série : la soumission est refusée
  // avec la raison, et aucune définition n'est créée.
  await page.getByRole("combobox", { name: "Rechercher une paire" }).fill("STABLE.D");
  await page.keyboard.press("Enter");
  await expect(bandeau.getByText("STABLE.D", { exact: true })).toBeVisible();
  await aside.getByRole("button", { name: "Ajouter sur STABLE.D" }).click();
  await expect(aside.getByText("Pas de marché perp pour STABLE.D : alertes Funding, CVD S/P et Cascade liq indisponibles.")).toBeVisible();
  await expect(aside.getByRole("button", { name: /^Alertes/ })).toContainText("2 alertes");
  expect(c.fapi.some((u) => u.includes("STABLE.D"))).toBe(false);
  expect(c.coinalyze.some((u) => u.includes("STABLE.D"))).toBe(false);
  expect(c.bybit.some((m) => m.includes("STABLE.D"))).toBe(false);
});

test("« USDT.D » + Entrée avant l'arrivée du catalogue commun : STABLE.D s'ouvre sans aucune requête Twelve Data", async ({ page }) => {
  const c = await compterRequetes(page);
  // Catalogue Binance retenu : le catalogue commun n'arrive pas, seul le catalogue local répond.
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", () => {});

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const champ = page.getByRole("combobox", { name: "Rechercher une paire" });
  await champ.fill("USDT.D");
  await expect(page.getByText("Recherche des actifs disponibles…")).toBeVisible();
  await champ.press("Enter");

  await expect(page.locator("[data-chart-banner]").getByText("STABLE.D", { exact: true })).toBeVisible();
  expect(await lireMarche(page)).toEqual({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
  await page.waitForTimeout(1_000);
  expect(c.twelveData).toEqual([]);
});

test("« COIN » + Entrée avant l'arrivée du catalogue commun : le ticker reste routé vers Twelve Data", async ({ page }) => {
  // Même harnais que « USDT.D ». COIN est une sous-chaîne de l'alias STABLECOINS : le catalogue
  // local interrogé (`catalogueInterroge`) écarte STABLE.D, qu'Entrée choisirait sinon.
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", () => {});

  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const champ = page.getByRole("combobox", { name: "Rechercher une paire" });
  await champ.fill("COIN");
  await expect(page.getByText("Recherche des actifs disponibles…")).toBeVisible();
  await champ.press("Enter");

  await expect.poll(() => lireMarche(page)).toMatchObject({ exchange: "twelvedata", symbol: "COIN" });
});

test("« Créer l'alerte composée » : Funding composé sur un ticker libre, puis graphe passé sur Twelve Data : refus, aucune définition", async ({ page }) => {
  await compterRequetes(page); // Twelve Data et fournisseurs perp bouchonnés (503)
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({
    json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] },
  }));
  await page.route("**/api/v3/klines*", (route) => {
    const debut = Date.now() - 200 * JOUR;
    return route.fulfill({ json: Array.from({ length: 200 }, (_, i) => {
      const t = debut + i * JOUR;
      return [t, "60000", "60100", "59900", "60050", "100", t + JOUR - 1, "0", 10, "50", "0", "0"];
    }) });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const bandeau = page.locator("[data-chart-banner]");
  await expect(bandeau.getByText("BTCUSDT", { exact: true })).toBeVisible();

  // Sur le graphe Binance, un ticker libre saisi garde Funding permis (comme à c2f757d) : la
  // composition Prix ⋀ Funding vise IBM.
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: /^Alertes/ }).click();
  await aside.getByPlaceholder("BTCUSDT", { exact: true }).fill("IBM");
  await aside.getByRole("checkbox", { name: "Composer (ET)" }).check();
  await aside.getByPlaceholder("Niveau").fill("1");
  await aside.getByRole("button", { name: "+ Ajouter à la composition (0/4)" }).click();
  await expect(aside.locator('option[value="funding-extreme"]')).toBeEnabled();
  await aside.locator("select").filter({ has: page.locator('option[value="funding-extreme"]') }).selectOption("funding-extreme");
  await aside.getByRole("button", { name: "+ Ajouter à la composition (1/4)" }).click();
  await expect(aside.locator("li", { hasText: "⋀" })).toHaveCount(2);

  // Le graphe passe sur SPY : l'alerte serait {twelvedata, IBM}. La création est refusée avec le
  // texte du titre des options, qui ne nie pas le marché perp (graphe Twelve Data) ; aucune
  // définition, et la composition reste en place.
  await page.getByRole("combobox", { name: "Rechercher une paire" }).fill("SPY");
  await page.keyboard.press("Enter");
  await expect(bandeau.getByText("SPY", { exact: true })).toBeVisible();
  expect(await lireMarche(page)).toMatchObject({ exchange: "twelvedata", symbol: "SPY" });
  await aside.getByRole("button", { name: "Créer l'alerte composée (2/4)" }).click();
  await expect(aside.getByText("Indisponible depuis un graphe Twelve Data : ouvrez la paire crypto pour créer cette alerte.")).toBeVisible();
  await expect(aside.getByRole("button", { name: /^Alertes/ })).toContainText("0 alerte");
  await expect(aside.locator("li", { hasText: "⋀" })).toHaveCount(2);
});
