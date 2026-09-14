import { expect, test, type Page } from "@playwright/test";
import type { Chart } from "klinecharts";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { BTCUSDT_1D } from "../src/chart/niveaux/btcusdt1d.fixture";

/**
 * Overlays de niveaux sur le chart maître, réseau fermé : bougies 1d RÉELLES (sonde BTCUSDT
 * du 14/09/2026) et bougies 1m synthétiques oscillant entre 76 000 et 81 000 pour que les
 * niveaux tombent dans l'échelle. Activation par la palette, lignes lues par l'accroche du
 * clic droit (seules les lignes réellement peintes sont accrochables).
 *  - Niveaux clés : alerte au niveau exact, persistance après rechargement.
 *  - Niveaux d'options : chaîne Deribit synthétique, murs γ, deux flips distincts, max pain
 *    de l'échéance dominante fusionné avec le put wall de même prix.
 *  - Bandes implicites : DVOL quotidien bouchonné, activation depuis DIST, bandes jour et
 *    semaine ancrées sur l'ouverture, désactivation par la palette.
 *  - Coût Strategy : trésoreries CoinGecko bouchonnées, activation par la palette, ligne
 *    scellée à BTC, désactivation depuis la tuile de CHAIN.
 */
const MAINTENANT = Date.parse("2026-09-14T18:00:00Z");
const MINUTE = 60_000;

async function bouchonnerBougies(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const limite = Number(params.get("limit") ?? 500);
    if (params.get("interval") === "1d") {
      // Seul BTCUSDT a un historique 1d : un autre symbole ne doit jamais hériter de ses lignes.
      if (params.get("symbol") !== "BTCUSDT") {
        await route.fulfill({ status: 503, json: { error: "fixture absente" } });
        return;
      }
      const lignes = BTCUSDT_1D.map(([t, o, h, l, c]) => [t, String(o), String(h), String(l), String(c), "1", t + 86_399_999, "1", 1, "0", "0", "0"]);
      await route.fulfill({ json: lignes.slice(-limite) });
      return;
    }
    // 1m : onde triangulaire de période 40 bougies entre 76 000 et 81 000.
    const fin = Math.floor(MAINTENANT / MINUTE) * MINUTE;
    const lignes = Array.from({ length: 500 }, (_, i) => {
      const phase = (i % 40) / 20;
      const prix = 76_000 + 5_000 * (phase <= 1 ? phase : 2 - phase);
      const t = fin - (499 - i) * MINUTE;
      return [t, String(prix), String(prix + 40), String(prix - 40), String(prix + 10), "1", t + MINUTE - 1, "1", 1, "0", "0", "0"];
    });
    await route.fulfill({ json: lignes.slice(-limite) });
  });
}

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  // Souris hors de la liste : laissée au milieu du chart par un clic droit, elle survolerait
  // un résultat de la palette et en changerait la sélection avant Entrée.
  await page.mouse.move(0, 0);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  // La liste filtrée doit présenter la commande avant validation (sinon Enter part à vide).
  await expect(page.getByText(texte, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
}

async function attendreChart(page: Page): Promise<void> {
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{ getActiveChart: () => Chart | null }>;
    return (await importer()).getActiveChart()?.getDataList().length ?? 0;
  })).toBe(500);
}

/** Coordonnées client du prix `prix` sur le pane bougies du chart maître (milieu du pane). */
async function pointDuPrix(page: Page, prix: number): Promise<{ x: number; y: number }> {
  return page.evaluate(async (valeur) => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => Chart | null;
    }>;
    const dessin = await importer();
    dessin.setFocusChart(0);
    const chart = dessin.getActiveChart();
    if (!chart) throw new Error("chart maître absent");
    const racine = chart.getDom()!.getBoundingClientRect();
    const pane = chart.getSize("candle_pane")!;
    const px = chart.convertToPixel({ value: valeur }, { paneId: "candle_pane", absolute: true }) as { y?: number };
    if (px.y === undefined || px.y < pane.top || px.y > pane.top + pane.height) throw new Error(`prix ${valeur} hors échelle`);
    return { x: racine.x + pane.left + pane.width / 2, y: racine.y + px.y + 2 };
  }, prix);
}

/** Clic droit au prix donné et lecture de l'en-tête du menu d'alerte (menu précédent fermé). */
async function enteteAuPrix(page: Page, prix: number): Promise<string> {
  const menu = page.locator("#axiom-price-alert-menu");
  // Le menu n'écoute Escape qu'après sa première frame : répéter jusqu'à fermeture.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0, { timeout: 250 });
  }).toPass();
  const { x, y } = await pointDuPrix(page, prix);
  await page.mouse.click(x, y, { button: "right" });
  await expect(menu).toBeVisible();
  return (await menu.locator("div").first().textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date(MAINTENANT));
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("niveaux clés : activation palette, lignes accrochables, alerte au niveau exact, persistance", async ({ page }) => {
  // Code des sources servi par Vite à la demande : il ne doit être demandé qu'à l'activation.
  const modulesSources: string[] = [];
  page.on("request", (requete) => {
    if (requete.url().includes("/src/chart/niveaux/")) modulesSources.push(requete.url());
  });
  await bouchonnerBougies(page);
  await page.goto("/");
  await attendreChart(page);

  // Défaut OFF : aucune ligne accrochable, code des sources jamais chargé.
  expect(await enteteAuPrix(page, 77_450)).not.toContain("PDH");
  expect(modulesSources).toEqual([]);

  await commande(page, "NIVCLE");
  await expect.poll(() => enteteAuPrix(page, 77_450), { timeout: 20_000 }).toBe("PDH · Prix 77,450.00");
  expect(modulesSources.some((url) => url.includes("/src/chart/niveaux/composite.ts"))).toBe(true);

  // Familles par défaut J + S : PDC, OJ et OS confondus en une seule ligne.
  expect(await enteteAuPrix(page, 76_842.01)).toBe("PDC·OJ·OS · Prix 76,842.01");
  expect(await enteteAuPrix(page, 80_443.99)).toContain("PWH");
  // Famille mois absente tant qu'elle n'est pas cochée, puis présente.
  expect(await enteteAuPrix(page, 78_581.3)).not.toContain("OM");
  await commande(page, "NIVCLE-M");
  await expect.poll(() => enteteAuPrix(page, 78_581.3)).toContain("OM · Prix 78,581.30");

  // Alerte créée depuis la ligne PDH : niveau exact de la ligne, libellé en message.
  expect(await enteteAuPrix(page, 77_450)).toContain("PDH");
  await page.locator("#axiom-price-alert-menu").getByRole("menuitem", { name: /Alerte croisement ↑/ }).click();
  const alerte = await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/alerts.ts')") as () => Promise<{
      alertsStore: { getState: () => { defs: { message?: string; condition: { type: string; niveau?: number; sens?: string } }[] } };
    }>;
    return (await importer()).alertsStore.getState().defs.at(-1) ?? null;
  });
  expect(alerte?.condition).toEqual({ type: "prix-croise", niveau: 77_450, sens: "hausse" });
  expect(alerte?.message).toBe("PDH BTCUSDT");

  // Persistance : bascule et familles restaurées au rechargement, sans repasser par la palette.
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:sessionUi:v1") ?? "{}"));
  expect(session).toMatchObject({ niveauxCles: true, niveauxClesFamilles: ["J", "S", "M"] });
  await page.reload();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 77_450), { timeout: 20_000 }).toBe("PDH · Prix 77,450.00");
  expect(await enteteAuPrix(page, 78_581.3)).toContain("OM");

  // Overlay scellé au symbole : sur ETHUSDT (sans historique 1d), aucune ligne BTC ne subsiste
  // et l'absence est expliquée par un toast.
  await page.getByRole("banner").getByRole("button", { name: "ETHUSDT", exact: true }).click();
  await expect(page.getByText("Niveaux clés : bougies 1d de ETHUSDT (binance) indisponibles, nouvel essai dans 5 min")).toBeVisible();
  await attendreChart(page);
  expect(await enteteAuPrix(page, 77_450)).not.toContain("PDH");

  // Retour sur BTCUSDT puis désactivation : plus aucune ligne accrochable.
  await page.getByRole("banner").getByRole("button", { name: "BTCUSDT", exact: true }).click();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 77_450)).toContain("PDH");
  await commande(page, "NIVCLE");
  await expect.poll(() => enteteAuPrix(page, 77_450)).not.toContain("PDH");
});

/**
 * Chaîne BTC synthétique (IV 45 %, spot 79 000). À 18:00 UTC le calcul du lot (composition des
 * fonctions d'OMON, vérifiée en test unitaire) donne : call wall 80 000, put wall 77 000,
 * flip GEX(S) 76 254,02, flip cumulé 79 507,22, max pain 25SEP26 (Σ OI 1 600) 77 000.
 */
const OPTIONS_BTC = (
  [
    ["BTC-25SEP26-80000-C", 800],
    ["BTC-25SEP26-77000-P", 600],
    ["BTC-25SEP26-84000-C", 100],
    ["BTC-25SEP26-72000-P", 100],
    ["BTC-18SEP26-81000-C", 50],
    ["BTC-18SEP26-76000-P", 50],
  ] as const
).map(([instrument_name, open_interest]) => ({
  instrument_name,
  mark_iv: 45,
  open_interest,
  underlying_price: 79_000,
  interest_rate: 0,
  volume: 1,
  mark_price: 0.01,
}));

test("niveaux d'options : activation palette, murs, flips et max pain accrochables, scellés à BTC", async ({ page }) => {
  const modulesOptions: string[] = [];
  page.on("request", (requete) => {
    if (requete.url().includes("/src/chart/niveaux/niveauxOptions.ts")) modulesOptions.push(requete.url());
  });
  await bouchonnerBougies(page);
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    const optionsBtc = url.pathname.endsWith("/get_book_summary_by_currency")
      && url.searchParams.get("kind") === "option"
      && url.searchParams.get("currency") === "BTC";
    if (optionsBtc) await route.fulfill({ json: { jsonrpc: "2.0", result: OPTIONS_BTC } });
    else await route.fulfill({ status: 503, json: { error: "fixture Deribit absente" } });
  });
  await page.goto("/");
  await attendreChart(page);

  expect(await enteteAuPrix(page, 80_000)).not.toContain("Call wall");
  expect(modulesOptions).toEqual([]);

  await commande(page, "OPTNIV");
  await expect.poll(() => enteteAuPrix(page, 80_000), { timeout: 20_000 }).toBe("Call wall γ · Prix 80,000.00");
  expect(modulesOptions.length).toBeGreaterThan(0);
  // Put wall et max pain de l'échéance dominante au même strike : une seule ligne, deux noms.
  expect(await enteteAuPrix(page, 77_000)).toBe("Put wall γ·Max pain 25SEP26 · Prix 77,000.00");
  // Deux flips aux noms distincts, à 3 000 $ l'un de l'autre.
  expect(await enteteAuPrix(page, 79_507.22)).toBe("Flip cumulé · Prix 79,507.22");
  expect(await enteteAuPrix(page, 76_254.02)).toBe("Flip GEX(S) · Prix 76,254.02");
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:sessionUi:v1") ?? "{}"));
  expect(session).toMatchObject({ niveauxOptions: true, niveauxCles: false });

  // ETHUSDT : chaîne ETH indisponible → toast, et aucune ligne BTC ne subsiste.
  await page.getByRole("banner").getByRole("button", { name: "ETHUSDT", exact: true }).click();
  await expect(page.getByText("Niveaux d'options : chaîne Deribit ETH indisponible, nouvel essai dans 10 min")).toBeVisible();
  await attendreChart(page);
  expect(await enteteAuPrix(page, 80_000)).not.toContain("Call wall");

  // Retour BTC puis désactivation par la palette.
  await page.getByRole("banner").getByRole("button", { name: "BTCUSDT", exact: true }).click();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 80_000)).toContain("Call wall γ");
  await commande(page, "OPTNIV");
  await expect.poll(() => enteteAuPrix(page, 80_000)).not.toContain("Call wall");
});

/**
 * DVOL BTC quotidien sondé le 14/09/2026 : bougie du 13/09 close à 38,89 (IV observée à
 * l'ouverture du jour et du lundi 14/09), bougie du 14/09 en cours (37,92, jamais utilisée).
 * Ancre 76 842,01 → +1σ J 78 406,20 ; +2σ J 79 970,40 ; +1σ S 80 980,47.
 */
const DVOL_BTC = [
  [Date.UTC(2026, 8, 12), 39.8, 40.1, 39.2, 39.4],
  [Date.UTC(2026, 8, 13), 39.4, 39.9, 38.7, 38.89],
  [Date.UTC(2026, 8, 14), 38.89, 39.2, 37.8, 37.92],
];

test("bandes implicites : bouton de DIST, lignes jour et semaine accrochables, scellées à BTC, palette", async ({ page }) => {
  await bouchonnerBougies(page);
  await page.route("https://www.deribit.com/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    const dvolBtc = url.pathname.endsWith("/get_volatility_index_data")
      && url.searchParams.get("currency") === "BTC"
      && url.searchParams.get("resolution") === "86400";
    if (dvolBtc) await route.fulfill({ json: { jsonrpc: "2.0", result: { data: DVOL_BTC, continuation: null } } });
    else await route.fulfill({ status: 503, json: { error: "fixture Deribit absente" } });
  });
  await page.goto("/");
  await attendreChart(page);
  expect(await enteteAuPrix(page, 78_406.2)).not.toContain("σ");

  // Activation depuis DIST, à côté des bandes VaR ; le title dit ce que mesurent les bandes.
  await commande(page, "DIST");
  const dist = page.locator('[role="complementary"][aria-label="Distribution des rendements (VaR)"]');
  const bouton = dist.getByRole("button", { name: "Bandes implicites" });
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  await expect(bouton).toHaveAttribute("title", /amplitude payée par les options, pas une borne — ≈ 78 % des clôtures quotidiennes dans ±1σ \(déc\. 2023 – sept\. 2026\)/);
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
  await dist.getByTitle("Fermer").click();
  await expect(dist).toHaveCount(0);

  await expect.poll(() => enteteAuPrix(page, 78_406.2), { timeout: 20_000 }).toBe("+1σ J (DVOL) · Prix 78,406.20");
  expect(await enteteAuPrix(page, 79_970.4)).toBe("+2σ J (DVOL) · Prix 79,970.40");
  expect(await enteteAuPrix(page, 80_980.47)).toBe("+1σ S (DVOL) · Prix 80,980.47");
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:sessionUi:v1") ?? "{}"));
  expect(session).toMatchObject({ bandesImplicites: true, niveauxCles: false, niveauxOptions: false });

  // ETHUSDT (sans historique 1d dans la fixture) : absence expliquée, aucune bande BTC ne subsiste.
  await page.getByRole("banner").getByRole("button", { name: "ETHUSDT", exact: true }).click();
  await expect(page.getByText("Bandes implicites : bougies 1d de ETHUSDT (binance) indisponibles, nouvel essai dans 5 min")).toBeVisible();
  await attendreChart(page);
  expect(await enteteAuPrix(page, 78_406.2)).not.toContain("σ");

  // Retour BTC puis désactivation par la palette.
  await page.getByRole("banner").getByRole("button", { name: "BTCUSDT", exact: true }).click();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 78_406.2)).toContain("+1σ J (DVOL)");
  await commande(page, "EMOVE");
  await expect.poll(() => enteteAuPrix(page, 78_406.2)).not.toContain("σ");
});

/**
 * Trésoreries CoinGecko (forme de `companies/public_treasury/bitcoin`, même fixture que
 * onchain-complements) : Strategy 845 050 BTC pour 64 267 830 000 $ → coût moyen 76 052,10 $.
 */
const SPOT_TRESORERIES = 79_175.91;
const TRESORERIES_BTC = {
  total_holdings: 941_581,
  total_value_usd: 941_581 * SPOT_TRESORERIES,
  market_cap_dominance: 4.48,
  companies: (
    [
      ["Strategy", "MSTR.US", 845_050, 64_267_830_000],
      ["Twenty One Capital", "XXI.US", 43_514, 0],
      ["Linekong Interactive", "8267.HK", 17, 17 * 634.71],
      ["Metaplanet", "3350.T", 43_000, 3_810_765_023.48],
      ["Société B", "B.US", 10_000, 600_000_000],
    ] as const
  ).map(([name, symbol, total_holdings, total_entry_value_usd]) => ({
    name,
    symbol,
    country: "XX",
    total_holdings,
    total_entry_value_usd,
    total_current_value_usd: total_holdings * SPOT_TRESORERIES,
  })),
};

test("coût Strategy : activation palette, ligne accrochable, scellée à BTC, bouton de la tuile CHAIN", async ({ page }) => {
  // Source du chart et module CHAIN : chargés à la seule activation.
  const modules: string[] = [];
  page.on("request", (requete) => {
    if (/\/src\/(chart\/niveaux\/prixRevient|data\/onchain\/tresoreriesBtc)\.ts/.test(requete.url())) modules.push(requete.url());
  });
  await bouchonnerBougies(page);
  let appels = 0;
  await page.route("**/api.coingecko.com/api/v3/companies/public_treasury/bitcoin*", async (route) => {
    appels += 1;
    await route.fulfill({ json: TRESORERIES_BTC });
  });
  await page.goto("/");
  await attendreChart(page);
  expect(await enteteAuPrix(page, 76_052.1)).not.toContain("Coût Strategy");
  expect(modules).toEqual([]);

  await commande(page, "TRESCOUT");
  await expect.poll(() => enteteAuPrix(page, 76_052.1), { timeout: 20_000 }).toBe("Coût Strategy · Prix 76,052.10");
  expect(modules.some((url) => url.includes("/src/chart/niveaux/prixRevient.ts"))).toBe(true);
  expect(modules.some((url) => url.includes("/src/data/onchain/tresoreriesBtc.ts"))).toBe(true);
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("axiom:sessionUi:v1") ?? "{}"));
  expect(session).toMatchObject({ prixRevientTresoreries: true, niveauxCles: false, niveauxOptions: false, bandesImplicites: false });

  // ETHUSDT : coût en dollar par BTC, non éligible → toast, et aucune ligne BTC ne subsiste.
  await page.getByRole("banner").getByRole("button", { name: "ETHUSDT", exact: true }).click();
  await expect(page.getByText("Coût Strategy : BTC coté en dollar seulement (trésoreries CoinGecko), pas ETHUSDT")).toBeVisible();
  await attendreChart(page);
  expect(await enteteAuPrix(page, 76_052.1)).not.toContain("Coût Strategy");

  await page.getByRole("banner").getByRole("button", { name: "BTCUSDT", exact: true }).click();
  await attendreChart(page);
  await expect.poll(() => enteteAuPrix(page, 76_052.1)).toBe("Coût Strategy · Prix 76,052.10");

  // Désactivation depuis la tuile Strategy de CHAIN, qui reflète la bascule de la palette.
  await page.keyboard.press("Escape"); // menu d'alerte laissé ouvert par le dernier clic droit
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  const bouton = chain
    .locator("section", { has: page.locator("h3", { hasText: "Trésoreries d'entreprises BTC" }) })
    .getByRole("button", { name: "Ligne sur le chart" });
  await expect(bouton).toHaveAttribute("aria-pressed", "true");
  await expect(bouton).toHaveAttribute("title", /pas un seuil de liquidation/);
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-pressed", "false");
  await chain.getByTitle("Fermer").click();
  await expect(chain).toHaveCount(0);
  await expect.poll(() => enteteAuPrix(page, 76_052.1)).not.toContain("Coût Strategy");
  // Un seul appel CoinGecko : chart et tuile partagent le cache 6 h du module CHAIN.
  expect(appels).toBe(1);
});
