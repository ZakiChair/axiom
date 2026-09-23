import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const FIN = Date.UTC(2026, 8, 23, 12);
const bougies = (prix: number) => Array.from({ length: 30 }, (_, i) => [FIN - (29 - i) * 60_000, `${prix}`, `${prix + 2}`, `${prix - 2}`, `${prix + 1}`, "10", FIN - (28 - i) * 60_000 - 1, "1000", 4, "5", "500", "0"]);

async function fixtures(page: Page, binanceIndisponible = false) {
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await bouchonnerReseau(page);
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({ json: { symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((symbol) => ({ symbol, status: "TRADING" })) } }));
  await page.route("**/api.bybit.com/v5/market/instruments-info*", (route) => route.fulfill({ json: { retCode: 0, result: { list: ["BTCUSDT", "ONLYUSDT"].map((symbol) => ({ symbol, status: "Trading" })) } } }));
  await page.route("**/api.kraken.com/0/public/AssetPairs*", (route) => route.fulfill({ json: { error: [], result: {} } }));
  await page.route("**/api.coinbase.com/api/v3/brokerage/market/products*", (route) => route.fulfill({ json: { products: [] } }));
  await page.route("**/www.okx.com/api/v5/public/instruments*", (route) => route.fulfill({ json: { code: "0", data: [] } }));
  await page.route("**/mexcapi/api/v3/exchangeInfo*", (route) => route.fulfill({ json: { symbols: [{ symbol: "AAPLXUSDT", status: "1", isSpotTradingAllowed: true }] } }));
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill(binanceIndisponible ? { status: 503, json: { msg: "Indisponible" } } : { json: bougies(60000) }));
  await page.route("**/api.bybit.com/v5/market/kline*", (route) => route.fulfill({ json: { retCode: 0, result: { list: bougies(61000).map((b) => b.slice(0, 6).map(String)).reverse() } } }));
  await page.route("**/api.bybit.com/v5/market/tickers*", (route) => route.fulfill({ json: { retCode: 0, result: { category: "spot", list: [{ symbol: "BTCUSDT", lastPrice: "61444", prevPrice24h: "60000", price24hPcnt: "0.024", turnover24h: "1000000" }] } } }));
  await page.route("**/mexcapi/api/v3/klines*", (route) => route.fulfill({ json: bougies(200) }));
  await page.route("**/tdapi/time_series*", (route) => route.fulfill({ json: { status: "ok", values: bougies(500).map((b) => ({ datetime: new Date(Number(b[0])).toISOString().replace("T", " ").slice(0, 19), open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] })) } }));
  await page.route("**/api.hyperliquid.xyz/info", (route) => {
    const body = route.request().postDataJSON() as { type?: string };
    return route.fulfill({ json: body.type === "meta" ? { universe: [{ name: "BTC" }] } : body.type === "candleSnapshot" ? bougies(62000).map((b) => ({ t: b[0], T: b[6], s: "BTC", i: "1m", o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], n: 4 })) : [] });
  });
}

async function marche(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { getState: () => { symbol: string; exchange: string; candles: Array<{ close: number }>; dataLoad: { status: string } } } }>;
    const m = (await importer()).marketStore.getState();
    return { symbol: m.symbol, exchange: m.exchange, prix: m.candles.at(-1)?.close, status: m.dataLoad.status };
  });
}

async function choisir(page: Page, symbole: string) {
  const input = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await input.fill(symbole);
  await expect(page.getByRole("option", { name: new RegExp(`^${symbole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) }).first()).toBeVisible();
  await input.press("Enter");
}

test("recherche unique : crypto, tradfi, tokenisé et perp gardent leur identité et leurs bougies", async ({ page }) => {
  await fixtures(page); await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", exchange: "binance", prix: 60001, status: "ready" });
  await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveCount(0);
  for (const [symbol, exchange, prix] of [["SPY", "twelvedata", 501], ["AAPLXUSDT", "mexc", 201], ["BTC-PERP", "hyperliquid", 62001], ["ONLYUSDT", "bybit", 61001]] as const) {
    await choisir(page, symbol);
    await expect.poll(() => marche(page)).toMatchObject({ symbol, exchange, prix, status: "ready" });
  }
  await page.getByRole("button", { name: "Deux empilés", exact: true }).last().click();
  await expect(page.getByRole("combobox", { name: "Source du slot", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Symbole du slot" }).fill("SPY");
  await page.getByRole("textbox", { name: "Symbole du slot" }).press("Enter");
  await expect(page.getByTitle("Source sélectionnée automatiquement", { exact: true })).toContainText(/twelvedata|Twelve Data/i);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("axiom:chartLayout:v1") ?? "{}").slots?.[0])).toMatchObject({ symbol: "SPY", exchange: "twelvedata" });
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).last().click();
  await expect(page.getByRole("textbox", { name: "Symbole du slot" })).toHaveValue("SPY");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Symbole du slot" })).toHaveValue("SPY");
  await expect(page.getByTitle("Source sélectionnée automatiquement", { exact: true })).toContainText("twelvedata");
  await page.screenshot({ path: "/tmp/axiom-sources-auto.png", fullPage: true });

});

test("échec historique Binance : repli sur Bybit sans changer actif ni afficher un prix de l’ancienne source", async ({ page }) => {
  await fixtures(page, true); await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", exchange: "bybit", prix: 61001, status: "ready" });
  await expect(page.getByLabel("Source automatique", { exact: true })).toContainText("Bybit");
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("BTCUSDT");
  await expect(page.getByRole("option", { name: /^BTCUSDT\b/ })).toHaveCount(1);
  await search.press("Escape");
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/watchlist.ts')") as () => Promise<{ watchlistStore: { getState: () => { addGroup: (name: string) => void } } }>;
    (await importer()).watchlistStore.getState().addGroup("Autres");
  });
  await page.getByRole("button", { name: "Principal", exact: true }).click();
  await expect(page.getByRole("button", { name: "BTCUSDT", exact: true }).last().locator("..")).toContainText("61,444.00");
  const sourceWatchlist = () => page.evaluate(async () => {
    const importer = new Function("return import('/src/store/watchlist.ts')") as () => Promise<{ watchlistStore: { getState: () => { sources: Record<string, string> } } }>;
    return (await importer()).watchlistStore.getState().sources.BTCUSDT;
  });
  await expect.poll(sourceWatchlist).toBe("bybit");

});

test("synthétique : deux actifs suffisent, les jambes se résolvent automatiquement", async ({ page }) => {
  await fixtures(page); await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ status: "ready" });
  await page.getByRole("button", { name: "SYN", exact: true }).click();
  const jambeA = page.getByRole("textbox", { name: "Jambe A", exact: true });
  await jambeA.click();
  await expect(jambeA).toBeFocused();
  await jambeA.fill("ETHUSDT");
  await page.getByRole("textbox", { name: "Jambe B", exact: true }).fill("GLD");
  await page.getByRole("button", { name: "Charger", exact: true }).click();
  await expect.poll(() => marche(page)).toMatchObject({ exchange: "synthetic", symbol: "binance:ETHUSDT|/|twelvedata:GLD", status: "ready" });
});


test("échec TradFi : conserve SPY et expose l’erreur, sans substituer Bitcoin", async ({ page }) => {
  await fixtures(page);
  await page.route("**/tdapi/time_series*", (route) => route.fulfill({ status: 401, json: { status: "error", message: "Clé personnelle requise" } }));
  await page.goto("/");
  await choisir(page, "SPY");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "SPY", exchange: "twelvedata", status: "error" });
  await expect(page.locator('[data-chart-status="error"]')).toContainText(/401|clé/i);
});

test("construction SYN lente : une navigation plus récente reste prioritaire", async ({ page }) => {
  await fixtures(page);
  let liberer!: () => void;
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", async (route) => {
    await attente;
    await route.fulfill({ json: { symbols: [{ symbol: "ETHUSDT", status: "TRADING" }] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "SYN", exact: true }).click();
  await page.getByRole("button", { name: "Charger", exact: true }).click();
  await page.getByRole("button", { name: "SPY", exact: true }).click();
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "SPY", status: "ready" });
  liberer();
  await expect(page.getByRole("button", { name: "Charger", exact: true })).toBeEnabled();
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "SPY", exchange: "twelvedata", status: "ready" });
});

test("comparaison : refuse un actif hors du marché affiché et garde les ajouts compatibles", async ({ page }) => {
  await fixtures(page); await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ exchange: "binance", status: "ready" });
  await page.getByRole("button", { name: /Comparer \(base 100\)/i }).click();
  const input = page.getByRole("combobox", { name: "Ajouter à comparer", exact: true });
  await input.fill("SPY"); await input.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Cet actif n’est pas disponible pour la comparaison" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retirer SPY", exact: true })).toHaveCount(0);
  await input.fill("ETHUSDT"); await input.press("Enter");
  await expect(page.getByRole("button", { name: "Retirer ETHUSDT", exact: true })).toBeVisible();
});

/** CARDS est absent de Binance : seule la réponse OKX constitue une preuve de prix. */
async function fixturesCards(page: Page, tousCataloguesIndisponibles = false) {
  await fixtures(page);
  let catalogueDisponible = false;
  let prixDisponible = true;
  let appelsCatalogue = 0;
  let appelsPrix = 0;
  const historiques: string[] = [];
  if (tousCataloguesIndisponibles) {
    for (const pattern of ["**/api.binance.com/api/v3/exchangeInfo*", "**/api.bybit.com/v5/market/instruments-info*", "**/mexcapi/api/v3/exchangeInfo*"]) {
      await page.route(pattern, (route) => route.fulfill({ status: 503, json: {} }));
    }
  }
  await page.route("**/www.okx.com/api/v5/public/instruments*", (route) => {
    appelsCatalogue += 1;
    return route.fulfill(catalogueDisponible
      ? { json: { code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] } }
      : { status: 503, json: { code: "500" } });
  });
  for (const pattern of ["**/api.binance.com/api/v3/klines*", "**/api.bybit.com/v5/market/kline*", "**/mexcapi/api/v3/klines*"]) {
    await page.route(pattern, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("symbol") !== "CARDSUSDT") return route.fallback();
      historiques.push(url.host);
      return route.fulfill({ status: 400, json: { msg: "Unknown symbol" } });
    });
  }
  await page.route("**/www.okx.com/api/v5/market/candles*", (route) => {
    if (new URL(route.request().url()).searchParams.get("instId") !== "CARDS-USDT") return route.fulfill({ json: { code: "0", data: [] } });
    historiques.push("okx:CARDS-USDT");
    return route.fulfill({ json: { code: "0", data: Array.from({ length: 30 }, (_, i) => [`${FIN - i * 60_000}`, "0.10", "0.13", "0.09", "0.12", "100", "10", "10", "1"]) } });
  });
  await page.route("**/www.okx.com/api/v5/market/ticker*", (route) => {
    appelsPrix += 1;
    return route.fulfill({ json: { code: "0", data: prixDisponible ? [{ instId: "CARDS-USDT", last: "0.12", open24h: "0.10", vol24h: "1000", volCcy24h: "120" }] : [] } });
  });
  return {
    retablirCatalogue: () => { catalogueDisponible = true; },
    prixDisponible: (value: boolean) => { prixDisponible = value; },
    appelsCatalogue: () => appelsCatalogue,
    appelsPrix: () => appelsPrix,
    historiques,
  };
}

test("CARDS : un catalogue rétabli actualise la recherche ouverte sans rechargement", async ({ page }) => {
  const api = await fixturesCards(page);
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("cardsusdt");
  await expect(page.getByText(/Catalogue partiel/).first()).toBeVisible();
  await expect(page.getByRole("option", { name: /^CARDSUSDT\b/ })).toHaveCount(0);
  api.retablirCatalogue();
  await page.clock.setFixedTime(Date.now() + 31_000);
  // Une autre surface rafraîchit le catalogue commun : le champ ouvert doit suivre.
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/data/marketRouting.ts')") as () => Promise<{ fetchMarketCatalog: () => Promise<unknown> }>;
    await (await importer()).fetchMarketCatalog();
  });
  await expect(page.getByRole("option", { name: /^CARDSUSDT\b/ })).toContainText("OKX");
  await search.press("Enter");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "CARDSUSDT", exchange: "okx", prix: 0.12, status: "ready" });
  expect(api.appelsCatalogue()).toBe(2);
  expect(api.historiques).toContain("okx:CARDS-USDT");
  await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveCount(0);
});

test("CARDS : catalogues en panne, la saisie libre confirme l’historique OKX", async ({ page }) => {
  const api = await fixturesCards(page, true);
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("cardsusdt");
  await expect(page.getByText(/Catalogue partiel/).first()).toBeVisible();
  await search.press("Enter");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "CARDSUSDT", exchange: "okx", prix: 0.12, status: "ready" });
  expect(api.historiques).toContain("okx:CARDS-USDT");
  await expect(page.getByLabel("Source automatique", { exact: true })).toContainText("OKX");
});

test("CARDS : ajout en minuscules, prix confirmé OKX et provenance conservée au clic", async ({ page }) => {
  await fixturesCards(page);
  await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", status: "ready" });
  const add = page.getByPlaceholder("Ajouter (ex. BNBUSDT)");
  await add.fill("cardsusdt"); await add.press("Enter");
  const button = page.getByRole("button", { name: "CARDSUSDT", exact: true });
  await expect(button.locator("..")).toContainText("0.1200");
  const watchSource = () => page.evaluate(async () => {
    const importer = new Function("return import('/src/store/watchlist.ts')") as () => Promise<{ watchlistStore: { getState: () => { sources: Record<string, string> } } }>;
    return (await importer()).watchlistStore.getState().sources.CARDSUSDT;
  });
  await expect.poll(watchSource).toBe("okx");
  // Observer l'identité immédiatement : une transition Binance transitoire serait une régression.
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{ marketStore: { subscribe: (cb: (state: { symbol: string; exchange: string }) => void) => () => void } }>;
    const sources: string[] = [];
    (window as unknown as { sourcesCards: string[] }).sourcesCards = sources;
    (await importer()).marketStore.subscribe((state) => { if (state.symbol === "CARDSUSDT") sources.push(state.exchange); });
  });
  await button.click();
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "CARDSUSDT", exchange: "okx", prix: 0.12, status: "ready" });
  expect(await page.evaluate(() => [...new Set((window as unknown as { sourcesCards: string[] }).sourcesCards)])).toEqual(["okx"]);
});

for (const reprise of ["réessai", "réseau", "focus"] as const) {
  test(`CARDS : ${reprise} relance le catalogue indisponible`, async ({ page }) => {
    const api = await fixturesCards(page);
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
    await search.fill("cardsusdt");
    await expect(page.getByText(/Catalogue partiel/).first()).toBeVisible();
    api.retablirCatalogue();
    if (reprise === "réessai") await page.getByRole("button", { name: "Actualiser les actifs", exact: true }).click();
    else if (reprise === "réseau") await page.evaluate(() => {
      // Une rafale de reconnexions doit produire une seule requête réseau.
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("online"));
    });
    else {
      await search.press("Escape");
      await page.getByPlaceholder("Ajouter (ex. BNBUSDT)").focus();
      await page.clock.setFixedTime(Date.now() + 31_000);
      await search.focus();
    }
    await expect(page.getByRole("option", { name: /^CARDSUSDT\b/ })).toContainText("OKX");
    expect(api.appelsCatalogue()).toBe(2);
  });
}

test("CARDS : un catalogue lent reste exploitable et n’est pas abandonné après quatre secondes", async ({ page }) => {
  await fixturesCards(page);
  await page.route("**/www.okx.com/api/v5/public/instruments*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_500));
    await route.fulfill({ json: { code: "0", data: [{ instId: "CARDS-USDT", instType: "SPOT", state: "live" }] } });
  });
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("CARDSUSDT");
  await expect(page.getByRole("option", { name: /^CARDSUSDT\b/ })).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "CARDSUSDT", exchange: "okx", prix: 0.12, status: "ready" });
});

test("CARDS : la watchlist réessaie un prix absent quand le catalogue revient", async ({ page }) => {
  const api = await fixturesCards(page);
  api.prixDisponible(false);
  await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", status: "ready" });
  const add = page.getByPlaceholder("Ajouter (ex. BNBUSDT)");
  await add.fill("CARDSUSDT"); await add.press("Enter");
  const row = page.getByRole("button", { name: "CARDSUSDT", exact: true }).locator("..");
  await expect.poll(api.appelsPrix).toBeGreaterThan(0);
  await expect(row).not.toContainText("0.1200");
  api.prixDisponible(true); api.retablirCatalogue();
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("CARDSUSDT");
  await page.getByRole("button", { name: "Actualiser les actifs", exact: true }).click();
  await expect(row).toContainText("0.1200");
});

test("CARDS : recherche laissée ouverte, reprise HTTP sans focus ni événement réseau", async ({ page }) => {
  const api = await fixturesCards(page);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("combobox", { name: "Rechercher une paire", exact: true }).fill("CARDSUSDT");
  await expect(page.getByText(/Catalogue partiel/).first()).toBeVisible();
  api.retablirCatalogue();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("option", { name: /^CARDSUSDT\b/ })).toContainText("OKX");
  expect(api.appelsCatalogue()).toBe(2);
});

test("CARDS : prix seul rétabli, les favoris non résolus réessaient sans interaction", async ({ page }) => {
  const api = await fixturesCards(page);
  api.retablirCatalogue(); api.prixDisponible(false);
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", status: "ready" });
  const add = page.getByPlaceholder("Ajouter (ex. BNBUSDT)");
  await add.fill("cardsusdt"); await add.press("Enter");
  const row = page.getByRole("button", { name: "CARDSUSDT", exact: true }).locator("..");
  await expect.poll(api.appelsPrix).toBeGreaterThan(0);
  await expect(row).not.toContainText("0.1200");
  api.prixDisponible(true);
  await page.clock.fastForward(31_000);
  await expect(row).toContainText("0.1200");
});

test("CARDS : une ancienne provenance Binance erronée est réparée après retour du prix OKX", async ({ page }) => {
  const api = await fixturesCards(page);
  api.retablirCatalogue(); api.prixDisponible(false);
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "BTCUSDT", status: "ready" });
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/watchlist.ts')") as () => Promise<{ watchlistStore: { getState: () => { setAll: (symbols: string[], sources: Record<string, string>) => void } } }>;
    (await importer()).watchlistStore.getState().setAll(["CARDSUSDT"], { CARDSUSDT: "binance" });
  });
  const row = page.getByRole("button", { name: "CARDSUSDT", exact: true }).locator("..");
  await expect.poll(api.appelsPrix).toBeGreaterThan(0);
  await expect(row).not.toContainText("0.1200");
  api.prixDisponible(true);
  await page.clock.fastForward(31_000);
  await expect(row).toContainText("0.1200");
  await page.getByRole("button", { name: "CARDSUSDT", exact: true }).click();
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "CARDSUSDT", exchange: "okx", prix: 0.12, status: "ready" });
});

test("USOIL : la suggestion ouvre le pétrole spot canonique, sans confusion avec crypto, action ou ETF", async ({ page }) => {
  await fixtures(page);
  await page.route("**/mexcapi/api/v3/exchangeInfo*", (route) => route.fulfill({ json: { symbols: [{ symbol: "USOILUSDT", status: "1", isSpotTradingAllowed: true }] } }));
  await page.goto("/");
  await expect.poll(() => marche(page)).toMatchObject({ status: "ready" });
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("usoil");
  const first = page.getByRole("listbox", { name: "Résultats de paires" }).getByRole("option").first();
  await expect(first).toContainText("WTI/USD");
  await expect(first).toContainText("Pétrole WTI — spot");
  await expect(first).toContainText("Twelve Data");
  await search.press("Enter");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "WTI/USD", exchange: "twelvedata", status: "ready" });
  for (const symbol of ["WTI", "USO", "AAPL", "SPY", "EUR/USD"]) {
    await choisir(page, symbol);
    await expect.poll(() => marche(page)).toMatchObject({ symbol, exchange: "twelvedata", status: "ready" });
  }
  await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveCount(0);
});

test("USOIL : un abonnement Grow requis reste visible et ne déclenche aucun ETF de remplacement", async ({ page }) => {
  await fixtures(page);
  const symbolsRequested: string[] = [];
  await page.route("**/tdapi/time_series*", (route) => {
    symbolsRequested.push(new URL(route.request().url()).searchParams.get("symbol") ?? "");
    return route.fulfill({ status: 404, json: { status: "error", code: 404, message: "This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing" } });
  });
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
  await search.fill("USOIL");
  await expect(page.getByRole("option", { name: /^WTI\/USD\b/ })).toBeVisible();
  await search.press("Enter");
  await expect.poll(() => marche(page)).toMatchObject({ symbol: "WTI/USD", exchange: "twelvedata", status: "error" });
  await expect(page.locator('[data-chart-status="error"]')).toContainText(/abonnement.*Grow/i);
  expect(symbolsRequested).toContain("WTI/USD");
  expect(symbolsRequested).not.toContain("USO");
});

test("TradFi : le catalogue local reste recherchable pendant une source crypto bloquée", async ({ page }) => {
  await fixtures(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", async (route) => {
    await pending;
    await route.fulfill({ json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }] } });
  });
  try {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Rechercher une paire", exact: true });
    await search.fill("USOIL");
    await expect(page.getByRole("option", { name: /^WTI\/USD\b/ })).toBeVisible();
    await expect(page.getByText("Recherche des actifs disponibles…", { exact: true })).toBeVisible();
    await search.press("Enter");
    await expect.poll(() => marche(page)).toMatchObject({ symbol: "WTI/USD", exchange: "twelvedata", status: "ready" });
    await choisir(page, "SPY");
    await expect.poll(() => marche(page)).toMatchObject({ symbol: "SPY", exchange: "twelvedata", status: "ready" });
  } finally { release(); }
});
