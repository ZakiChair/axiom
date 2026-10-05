import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { E2E_ORIGINE } from "./origine";

/**
 * DES : découverte des perpétuels par ACTIF (demande du 5 octobre 2026). Réseau
 * bouchonné. Le catalogue `future-markets` ne sert qu'un PUMP coté sur les quatre
 * places couvertes (Binance `PUMPUSDT_PERP.A`, Bybit `PUMPFUNUSDT.6`, OKX
 * `PUMPUSDT_PERP.3`, Hyperliquid `PUMP.H`) plus des lignes hors périmètre
 * (Kraken, PUMPBTC, non perp). Vérifie : sous-titre et données Binance par défaut
 * alors que le graphe est sur OKX, sélecteur à exactement quatre places, bascule
 * Bybit (id Coinalyze propre, cadence 8 h), OKX (pas d'appel long/short),
 * Hyperliquid (cadence 1 h, id `PUMP.H`), actif sans perp, catalogue appelé UNE
 * fois sur tout le parcours.
 */

/** Ligne de catalogue `future-markets` (champs réels du snapshot du 5/10/2026). */
function ligneCatalogue(
  symbol: string,
  exchange: string,
  symbolOnExchange: string,
  base: string,
  quote: string,
  opts: { margined?: string; ls?: boolean; perp?: boolean } = {},
) {
  return {
    symbol,
    exchange,
    symbol_on_exchange: symbolOnExchange,
    base_asset: base,
    quote_asset: quote,
    expire_at: null,
    has_buy_sell_data: true,
    is_perpetual: opts.perp ?? true,
    margined: opts.margined ?? "STABLE",
    oi_lq_vol_denominated_in: "BASE_ASSET",
    has_long_short_ratio_data: opts.ls ?? false,
    has_ohlcv_data: true,
  };
}

const CATALOGUE = [
  ligneCatalogue("PUMPUSDT_PERP.A", "A", "PUMPUSDT", "PUMP", "USDT", { ls: true }),
  ligneCatalogue("PUMPFUNUSDT.6", "6", "PUMPFUNUSDT", "PUMP", "USDT", { ls: true }),
  ligneCatalogue("PUMPFUNPERP.6", "6", "PUMPFUNPERP", "PUMP", "USDC"),
  ligneCatalogue("PUMPUSDT_PERP.3", "3", "PUMP-USDT-SWAP", "PUMP", "USDT"),
  ligneCatalogue("PUMP.H", "H", "PUMP", "PUMP", "USD"),
  ligneCatalogue("PUMPBTCUSDT_PERP.A", "A", "PUMPBTCUSDT", "PUMPBTC", "USDT", { ls: true }),
  ligneCatalogue("pf_pumpusd.K", "K", "pf_pumpusd", "PUMP", "USD"),
  ligneCatalogue("PUMP-PERP.C", "C", "PUMP-PERP", "PUMP", "USDC"),
  ligneCatalogue("PUMPSPOT.6", "6", "PUMPSPOT", "PUMP", "USDT", { perp: false }),
  ligneCatalogue("PURR.H", "H", "PURR", "PURR", "USD"),
];

/** OI USD distinct par marché pour suivre la place affichée à l'écran. */
const OI_USD: Record<string, number> = {
  "PUMPUSDT_PERP.A": 5.2e9,
  "PUMPFUNUSDT.6": 8.1e9,
  "PUMPUSDT_PERP.3": 3.4e9,
  "PUMP.H": 1.1e9,
  "PURR.H": 7.5e6,
};

/** Réponse Coinalyze par endpoint, adaptée au `symbols` demandé. */
function reponseCoinalyze(pathname: string, symbole: string): unknown {
  const t = 1796000000; // secondes epoch (historiques)
  const update = t * 1000; // ms (endpoints « current »)
  if (pathname.endsWith("open-interest")) {
    return [{ symbol: symbole, value: 1, update }];
  }
  // Valeurs DISTINCTES par endpoint : un décalage de dépilage serait visible
  // (funding courant 0.01 %, prédit 0.02 %, historiques autres valeurs).
  if (pathname.endsWith("predicted-funding-rate")) {
    return [{ symbol: symbole, value: 0.02, update }];
  }
  if (pathname.endsWith("funding-rate")) {
    return [{ symbol: symbole, value: 0.01, update }];
  }
  if (pathname.endsWith("open-interest-history") || pathname.endsWith("funding-rate-history")) {
    return [{ symbol: symbole, history: [{ t, o: 9, h: 10, l: 8, c: 9.5 }] }];
  }
  if (pathname.endsWith("long-short-ratio-history")) {
    return [{ symbol: symbole, history: [{ t, r: 1.5, l: 60, s: 40 }] }];
  }
  if (pathname.endsWith("liquidation-history")) {
    return [{ symbol: symbole, history: symbole.endsWith(".H") ? [] : [{ t, l: 12000, s: 5000 }] }];
  }
  return [];
}

/**
 * Pose les bouchons réseau du catalogue PUMP + endpoints Coinalyze/venues.
 * Renvoie les listes d'appels observés (catalogue et données).
 */
async function bouchonnerPumps(page: import("@playwright/test").Page) {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
  const appelsCatalogue: string[] = [];
  const appelsCoinalyze: string[] = [];
  await page.route(
    (url) => url.origin === E2E_ORIGINE && url.pathname === "/coinalyzeapi/v1/future-markets",
    (route) => {
      appelsCatalogue.push(route.request().url());
      return route.fulfill({ json: CATALOGUE });
    },
  );
  await page.route(
    (url) =>
      url.origin === E2E_ORIGINE &&
      url.pathname.startsWith("/coinalyzeapi/v1/") &&
      url.pathname !== "/coinalyzeapi/v1/future-markets",
    (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      const symbole = url.searchParams.get("symbols") ?? "";
      appelsCoinalyze.push(`${pathname}?symbols=${symbole}`);
      // open-interest est appelé deux fois : natif puis convert_to_usd.
      if (pathname.endsWith("open-interest") && url.searchParams.get("convert_to_usd") === "true") {
        return route.fulfill({ json: [{ symbol: symbole, value: OI_USD[symbole] ?? 0, update: 1_796_000_000_000 }] });
      }
      return route.fulfill({ json: reponseCoinalyze(pathname, symbole) });
    },
  );
  // Cadence Binance : fundingInfo (via /extapi) liste PUMPUSDT à 4 h.
  await page.route("**/extapi/fapi.binance.com/fapi/v1/fundingInfo*", (route) =>
    route.fulfill({ json: [{ symbol: "PUMPUSDT", fundingIntervalHours: 4 }] }),
  );
  // Sentiment perp Binance (fapi /futures/data, direct) : quatre flux répondent.
  await page.route("**/futures/data/*", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("openInterestHist")) {
      return route.fulfill({ json: [{ sumOpenInterestValue: "5200000000", timestamp: 1_796_000_000_000 }] });
    }
    if (path.endsWith("takerlongshortRatio")) {
      return route.fulfill({ json: [{ buySellRatio: "1.2", buyVol: "120", sellVol: "100", timestamp: 1_796_000_000_000 }] });
    }
    return route.fulfill({
      json: [{ longShortRatio: "1.50", longAccount: "0.60", shortAccount: "0.40", timestamp: 1_796_000_000_000 }],
    });
  });
  // Cadences Bybit (480 min → 8 h) et OKX (fundingTime → nextFundingTime à 4 h).
  await page.route("**/api.bybit.com/v5/market/instruments-info*", (route) =>
    route.fulfill({ json: { retCode: 0, result: { list: [{ fundingInterval: 480 }] } } }),
  );
  await page.route("**/www.okx.com/api/v5/public/funding-rate*", (route) =>
    route.fulfill({
      json: { code: "0", data: [{ fundingTime: "1700000000000", nextFundingTime: "1700014400000" }] },
    }),
  );
  return { appelsCatalogue, appelsCoinalyze };
}

test("DES : perp découvert par actif sur les quatre places, sélecteur opérationnel", async ({ page }) => {
  const { appelsCatalogue, appelsCoinalyze } = await bouchonnerPumps(page);
  await page.goto("/");
  // Graphe sur OKX/PUMPUSDT : le spot est hors Binance, mais DES trouve les perps PUMP.
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { setMarket: (m: { exchange: "okx"; symbol: string; timeframe: "1m" }) => void } };
    }>;
    (await importer()).marketStore.getState().setMarket({ exchange: "okx", symbol: "PUMPUSDT", timeframe: "1m" });
  });
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });

  // Place par défaut : Binance (première de l'ordre), malgré le spot OKX.
  await expect(des).toContainText("Binance · PUMPUSDT · Coinalyze");
  await expect(des).not.toContainText("Binance uniquement");
  await expect(des).toContainText("$5.20B"); // OI USD du marché Binance
  await expect(des).toContainText("+0.0100%"); // funding courant
  await expect(des).toContainText("+0.0200%"); // funding prédit
  await expect(des).toContainText("APR (règlement 4 h)");
  await expect(des).toContainText("Actif PUMP · 4 places trouvées");
  await expect(des).toContainText("Sentiment perp · Binance · PUMPUSDT");

  // Le sélecteur liste exactement les quatre places couvertes (ni Kraken ni PUMPBTC).
  const selecteur = des.getByLabel("Place du perpétuel");
  await expect(selecteur.locator("option")).toHaveText([
    "Binance · PUMPUSDT",
    "Bybit · PUMPFUNUSDT",
    "OKX · PUMP-USDT-SWAP",
    "Hyperliquid · PUMP",
  ]);

  // Bascule Bybit : nouvel id Coinalyze, OI de la place, cadence 8 h (480 min).
  await selecteur.selectOption("bybit");
  await expect(des).toContainText("Bybit · PUMPFUNUSDT · Coinalyze");
  await expect(des).toContainText("$8.10B");
  await expect(des).toContainText("APR (règlement 8 h)");
  expect(appelsCoinalyze.some((u) => u.includes("symbols=PUMPFUNUSDT.6"))).toBe(true);

  // Bascule OKX : le ratio L/S est lu chez Binance (complément) avec provenance
  // explicite ; aucun appel long-short-ratio-history pour PUMPUSDT_PERP.3.
  await selecteur.selectOption("okx");
  await expect(des).toContainText("OKX · PUMP-USDT-SWAP · Coinalyze");
  await expect(des).toContainText("$3.40B");
  await expect(des).toContainText("APR (règlement 4 h)");
  await expect(des).toContainText("Long / Short agrégé · Binance");
  await expect(des).toContainText("1.50 · L 60.0% / S 40.0%");
  await expect(des).toContainText("Ratio non publié par Coinalyze pour OKX : valeur de Binance.");
  // Référentiels réservés à Binance : aucun « vs historique » ni « réf. en construction ».
  await expect(des).not.toContainText("vs historique");
  await expect(des).not.toContainText("réf. en construction");
  expect(
    appelsCoinalyze.some((u) => u.includes("long-short-ratio-history") && u.includes("PUMPUSDT_PERP.3")),
  ).toBe(false);

  // Bascule Hyperliquid : id `PUMP.H` (casse conservée), cadence 1 h sans requête.
  // L/S ET liquidations sont empruntées à Binance (jamais couvertes chez HL).
  await selecteur.selectOption("hyperliquid");
  await expect(des).toContainText("Hyperliquid · PUMP · Coinalyze");
  await expect(des).toContainText("$1.10B");
  await expect(des).toContainText("APR (règlement 1 h)");
  await expect(des).toContainText("Long / Short agrégé · Binance");
  await expect(des).toContainText("Ratio non publié par Coinalyze pour Hyperliquid : valeur de Binance.");
  await expect(des).toContainText("Liquidations récentes · Binance");
  await expect(des).toContainText(
    "Coinalyze ne couvre pas les liquidations Hyperliquid : liquidations Binance.",
  );
  await expect(des).not.toContainText("vs historique");
  await expect(des).not.toContainText("réf. en construction");
  expect(appelsCoinalyze.some((u) => u.includes("symbols=PUMP.H"))).toBe(true);
  expect(
    appelsCoinalyze.some((u) => u.includes("liquidation-history") && u.includes("PUMP.H")),
  ).toBe(false);

  // Actif absent du catalogue : message explicite, pas de perp supposé.
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { setMarket: (m: { exchange: "okx"; symbol: string; timeframe: "1m" }) => void } };
    }>;
    (await importer()).marketStore.getState().setMarket({ exchange: "okx", symbol: "ZZZUSDT", timeframe: "1m" });
  });
  await expect(des).toContainText("Aucun perpétuel ZZZ sur Binance, Bybit, OKX ni Hyperliquid");

  // Le catalogue n'est demandé qu'UNE fois sur tout le parcours (cache 12 h).
  expect(appelsCatalogue).toHaveLength(1);
});

/** Graphe = perp Hyperliquid : DES priorise HL mais complète L/S et liquidations chez Binance. */
test("DES : graphe sur PUMP-PERP Hyperliquid → HL par défaut, L/S et liquidations de Binance", async ({
  page,
}) => {
  await bouchonnerPumps(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: {
        getState: () => { setMarket: (m: { exchange: "hyperliquid"; symbol: string; timeframe: "1m" }) => void };
      };
    }>;
    (await importer()).marketStore.getState().setMarket({ exchange: "hyperliquid", symbol: "PUMP-PERP", timeframe: "1m" });
  });
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });

  // Exception Hyperliquid : la place du graphe passe en tête.
  await expect(des).toContainText("Hyperliquid · PUMP · Coinalyze");
  await expect(des).toContainText("$1.10B");
  await expect(des).toContainText("APR (règlement 1 h)");
  // Compléments Binance, avec libellés de provenance.
  await expect(des).toContainText("Long / Short agrégé · Binance");
  await expect(des).toContainText("1.50 · L 60.0% / S 40.0%");
  await expect(des).toContainText("Ratio non publié par Coinalyze pour Hyperliquid : valeur de Binance.");
  await expect(des).toContainText("Liquidations récentes · Binance");
  await expect(des).toContainText(
    "Coinalyze ne couvre pas les liquidations Hyperliquid : liquidations Binance.",
  );
  await expect(des).not.toContainText("vs historique");
  await expect(des).not.toContainText("réf. en construction");
});

/** Actif coté UNIQUEMENT sur Hyperliquid : aucun complément L/S ni liquidations
 *  possible — les tuiles restent « — »/non couvertes, et l'OI/funding/prédit
 *  viennent du perp HL (régression du dépilage par position, revue du 5/10). */
test("DES : actif HL-only (PURR) → L/S et liquidations non couvertes, données HL alignées", async ({
  page,
}) => {
  const { appelsCoinalyze } = await bouchonnerPumps(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: {
        getState: () => { setMarket: (m: { exchange: "hyperliquid"; symbol: string; timeframe: "1m" }) => void };
      };
    }>;
    (await importer()).marketStore.getState().setMarket({ exchange: "hyperliquid", symbol: "PURR-PERP", timeframe: "1m" });
  });
  await page.getByRole("button", { name: "Produits dérivés" }).click();
  const des = page.getByRole("complementary", { name: "Produits dérivés" });

  await expect(des).toContainText("Hyperliquid · PURR · Coinalyze");
  await expect(des).toContainText("$7.50M"); // OI USD de PURR.H, pas d'un historique
  await expect(des).toContainText("+0.0100%"); // funding courant PURR.H
  await expect(des).toContainText("+0.0200%"); // funding PRÉDIT PURR.H (pas le courant)
  await expect(des).toContainText("APR (règlement 1 h)");
  await expect(des).toContainText("Ratio long/short non publié par Coinalyze pour Hyperliquid.");
  await expect(des).toContainText("Liquidations non couvertes par Coinalyze pour Hyperliquid.");
  // Aucun histogramme bicolore : pas de totaux « Longs $ ».
  await expect(des).not.toContainText("Longs $");
  // Aucun appel liquidations ni long/short n'a été émis pour PURR.H.
  expect(appelsCoinalyze.some((u) => u.includes("liquidation-history"))).toBe(false);
  expect(
    appelsCoinalyze.some((u) => u.includes("long-short-ratio-history")),
  ).toBe(false);
});
