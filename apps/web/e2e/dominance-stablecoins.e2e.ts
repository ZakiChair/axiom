import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Parcours e2e de la dominance des stablecoins (STABLE.D, demande du 29/10/2026), calqué sur
 * gate-v25-cap-dominance (TOTAL3).
 *
 * POURQUOI ICI : `apps/web` tourne en env vitest NODE (pas de jsdom) ; la recherche, le bandeau,
 * l'encart et le clic des préréglages ne se vérifient que dans un vrai navigateur.
 *
 * DÉTERMINISTE ET HORS LIGNE : CoinMarketCap est simulé en DISTINGUANT l'id de la pièce (825 USDT,
 * 3408 USDC, 4943 DAI, 1027 ETH pour TOTAL3) et le global — la route de gate-v25 sert ETH pour
 * tout id, ce qui masquerait une jointure fausse. Valeurs rondes : TOTAL 1 T$, USDT 60 G$,
 * USDC 30 G$, DAI 10 G$ → 10,00 %. Comme mesuré le 29/10/2026, les pièces publient un pas APRÈS
 * le global : en 1d, la ligne de la veille donne la barre du jour (repli V1), jamais un 0.
 */

const HEURE = 3_600_000;
const JOUR = 86_400_000;
const DEBUT_GLOBAL = Date.UTC(2013, 11, 31);
const LANCEMENT_ETH = Date.UTC(2015, 7, 7);
const TOTAL = 1e12;
/** Premier point et capitalisation constante de chaque pièce servie (USD). */
const PIECES: Record<string, { lancement: number; cap: number }> = {
  "825": { lancement: Date.UTC(2015, 1, 25), cap: 60e9 },
  "3408": { lancement: Date.UTC(2018, 9, 8), cap: 30e9 },
  "4943": { lancement: Date.UTC(2019, 10, 22), cap: 10e9 },
  "1027": { lancement: LANCEMENT_ETH, cap: 1e11 },
};

interface AppelCmc {
  chemin: "global" | "piece";
  id: string | null;
  intervalle: string;
  debut: number;
  fin: number;
  autorisation: boolean;
}

async function simulerCoinMarketCap(page: Page, appels: AppelCmc[]): Promise<void> {
  await page.route("**/extapi/api.coinmarketcap.com/data-api/**", (route) => {
    const url = new URL(route.request().url());
    const debut = Number(url.searchParams.get("timeStart")) * 1000;
    const fin = Number(url.searchParams.get("timeEnd")) * 1000;
    const intervalle = url.searchParams.get("interval") ?? "1d";
    const autorisation = route.request().headers().authorization !== undefined;
    const maintenant = Date.now();
    if (url.pathname.includes("global-metrics")) {
      appels.push({ chemin: "global", id: null, intervalle, debut, fin, autorisation });
      const pas = intervalle === "1h" ? HEURE : intervalle === "4h" ? 4 * HEURE : JOUR;
      const quotes = [];
      // Le global publie le bucket courant (mesuré).
      for (let t = Math.ceil(Math.max(debut, DEBUT_GLOBAL) / pas) * pas; t <= Math.min(fin, maintenant); t += pas) {
        quotes.push({
          timestamp: new Date(t).toISOString(),
          btcDominance: 58,
          ethDominance: t >= LANCEMENT_ETH ? 10 : 0,
          quote: [{ name: "2781", totalMarketCap: TOTAL, altcoinMarketCap: TOTAL * 0.42 }],
        });
      }
      return route.fulfill({ json: { data: { quotes }, status: { error_code: "0" } } });
    }
    const id = url.searchParams.get("id");
    appels.push({ chemin: "piece", id, intervalle, debut, fin, autorisation });
    const piece = PIECES[id ?? ""];
    if (piece === undefined) {
      // Multi-id ou id inconnu : erreur réelle de CMC, servie en HTTP 200.
      return route.fulfill({ json: { status: { error_code: "500", error_message: "The system is busy, please try again later!" } } });
    }
    // interval=4h renvoie du journalier chez CMC (mesuré) : simulé tel quel.
    const pas = intervalle === "1h" ? HEURE : JOUR;
    const derniere = Math.floor(maintenant / pas) * pas - pas; // un pas de retard sur le global
    const points = [];
    for (let t = Math.ceil(Math.max(debut, piece.lancement) / pas) * pas; t <= Math.min(fin, derniere); t += pas) {
      points.push({ s: String(t / 1000), v: [1, 0, piece.cap], c: {} });
    }
    return route.fulfill({ json: { data: { points }, status: { error_code: "0" } } });
  });
}

/** Marché et bougies du store (convention de corrections-revue : store réel, aucun attribut de test). */
async function lireMarche(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { exchange: string; symbol: string; timeframe: string; candles: Array<{ time: number; close: number }> } };
    }>;
    const etat = (await importer()).marketStore.getState();
    return {
      exchange: etat.exchange,
      symbol: etat.symbol,
      timeframe: etat.timeframe,
      bougies: etat.candles.length,
      derniere: etat.candles.at(-1)?.close ?? null,
      temps: etat.candles.at(-1)?.time ?? null,
      // Lu dans la même évaluation que la bougie (minuit UTC franchi entre-temps : cf. l'appelant).
      maintenant: Date.now(),
    };
  });
}

/** Fait défiler le graphe du slot 0 vers le passé : déclenche la pagination. */
async function defilerVersLePasse(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => { scrollByDistance: (distance: number) => void } | null;
    }>;
    const dessin = await importer();
    dessin.setFocusChart(0);
    dessin.getActiveChart()?.scrollByDistance(100_000);
  });
}

/** Précision et bougies tracées, lues sur l'instance KLineChart du slot 0. */
async function lireGraphe(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => { getPriceVolumePrecision: () => { price: number }; getDataList: () => unknown[] } | null;
    }>;
    const dessin = await importer();
    dessin.setFocusChart(0);
    const chart = dessin.getActiveChart();
    return chart === null ? null : { precision: chart.getPriceVolumePrecision().price, tracees: chart.getDataList().length };
  });
}

async function ouvrirParRecherche(page: Page, requete: string): Promise<void> {
  await page.getByRole("combobox", { name: "Rechercher une paire" }).fill(requete);
  await page.getByRole("option", { name: /^STABLE\.D\b/ }).click();
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  // Le graphe par défaut (BTCUSDT) charge ses bougies : l'application démarre comme en usage réel.
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({
    json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING" }, { symbol: "ETHUSDT", status: "TRADING" }] },
  }));
  await page.route("**/api/v3/klines*", (route) => {
    const debut = Date.now() - 200 * JOUR;
    route.fulfill({ json: Array.from({ length: 200 }, (_, i) => {
      const t = debut + i * JOUR;
      return [t, "60000", "60100", "59900", "60050", "100", t + JOUR - 1, "0", 10, "50", "0", "0"];
    }) });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("STABLE.D s'ouvre par l'alias USDT.D : % au bandeau, CoinMarketCap · daily, aucun ÷BTC, bougies tracées", async ({ page }) => {
  const appels: AppelCmc[] = [];
  await simulerCoinMarketCap(page, appels);
  const avantChargement = Date.now();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

  await ouvrirParRecherche(page, "USDT.D");

  const bandeau = page.locator("[data-chart-banner]");
  await expect(bandeau.getByText("STABLE.D", { exact: true })).toBeVisible();
  await expect(bandeau.getByText("CoinMarketCap · daily", { exact: true })).toBeVisible();
  await expect(bandeau).toContainText("10.00 %");
  await expect(bandeau.getByTitle("(USDT+USDC+DAI) ÷ capitalisation crypto totale, en %")).toHaveText("STABLE.D");
  await expect(bandeau).not.toContainText("Vol");
  // Un % divisé par des dollars n'a pas de sens : ni ÷BTC, ni bouton scindé (÷ETH, ÷Or, devises).
  await expect(page.getByRole("button", { name: "÷BTC" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choisir l'actif de comparaison" })).toHaveCount(0);

  await expect.poll(async () => (await lireMarche(page)).bougies).toBeGreaterThan(400);
  const marche = await lireMarche(page);
  expect(marche).toMatchObject({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
  // Dernière barre : global du jour, ligne des pièces de la veille → barre du MINUIT UTC DU JOUR
  // (repli V1), 10 %, jamais 0. Minuit franchi pendant le test : l'un ou l'autre jour.
  expect(marche.derniere).toBeCloseTo(10, 9);
  expect([avantChargement, marche.maintenant].map((t) => Math.floor(t / JOUR) * JOUR)).toContain(marche.temps);
  const graphe = await lireGraphe(page);
  expect(graphe?.precision).toBe(2);
  expect(graphe?.tracees).toBe(marche.bougies);

  // Trois appels detail/chart distincts (un id chacun), jamais de multi-id, jamais de clé.
  for (const id of ["825", "3408", "4943"]) {
    expect(appels.some((a) => a.chemin === "piece" && a.id === id && a.intervalle === "1d"), id).toBe(true);
  }
  expect(appels.every((a) => !(a.id ?? "").includes(","))).toBe(true);
  expect(appels.some((a) => a.chemin === "global" && a.intervalle === "1d")).toBe(true);
  expect(appels.some((a) => a.autorisation)).toBe(false);

  // Encart de lecture : O/H/L/C en %, Δ et amplitude en points.
  const zone = await page.locator('[data-unite="%"]').boundingBox();
  expect(zone).not.toBeNull();
  await page.mouse.move(zone!.x + zone!.width * 0.5, zone!.y + zone!.height * 0.45);
  const encart = page.locator("[data-candle-readout]");
  await expect(encart).toBeVisible();
  await expect(encart).toContainText("10.00 %");
  await expect(encart).toContainText("+0.00 pt");
  await page.mouse.move(1, 1);

  // 4h : global en 4h, pièces lues en 1h (interval=4h renvoie du journalier chez CMC).
  const avant4h = appels.length;
  await page.getByRole("button", { name: "4h", exact: true }).click();
  await expect(bandeau.getByText("CoinMarketCap · 4h", { exact: true })).toBeVisible();
  await expect(bandeau).toContainText("10.00 %");
  const pages4h = appels.slice(avant4h);
  expect(pages4h.some((a) => a.chemin === "global" && a.intervalle === "4h")).toBe(true);
  for (const id of ["825", "3408", "4943"]) {
    expect(pages4h.some((a) => a.chemin === "piece" && a.id === id && a.intervalle === "1h"), id).toBe(true);
  }
  expect(appels.some((a) => a.chemin === "piece" && a.intervalle === "4h")).toBe(false);

  // 4h : pagination vers le passé par pages de 1 000 bougies, jamais 10 000 (17 requêtes).
  await expect.poll(async () => (await lireMarche(page)).bougies).toBeGreaterThanOrEqual(500);
  const avantPagination4h = (await lireMarche(page)).bougies;
  await defilerVersLePasse(page);
  await expect.poll(
    () => appels.some((a) => a.chemin === "global" && a.intervalle === "4h" && (a.fin - a.debut) / (4 * HEURE) + 1 === 1_000),
  ).toBe(true);
  await expect.poll(async () => (await lireMarche(page)).bougies).toBeGreaterThan(avantPagination4h);
  expect(appels.some((a) => a.chemin === "global" && a.intervalle === "4h" && (a.fin - a.debut) / (4 * HEURE) + 1 > 1_000)).toBe(false);

  // 1h : pagination vers le passé par pages de 1 000 bougies (global + 3 pièces par page).
  await page.getByRole("button", { name: "1h", exact: true }).click();
  await expect(bandeau.getByText("CoinMarketCap · 1h", { exact: true })).toBeVisible();
  await expect.poll(async () => (await lireMarche(page)).bougies).toBeGreaterThanOrEqual(500);
  const avantPagination = (await lireMarche(page)).bougies;
  await defilerVersLePasse(page);
  await expect.poll(
    () => appels.some((a) => a.chemin === "global" && a.intervalle === "1h" && (a.fin - a.debut) / HEURE + 1 === 1_000),
  ).toBe(true);
  await expect.poll(async () => (await lireMarche(page)).bougies).toBeGreaterThan(avantPagination);
  // Aucune page de 10 000 bougies (11 requêtes) pour la dominance en intrajournalier.
  expect(appels.some((a) => a.chemin === "global" && a.intervalle === "1h" && (a.fin - a.debut) / HEURE + 1 > 1_000)).toBe(false);
});

test("panne CoinMarketCap : l'overlay affiche le message explicite de STABLE.D (aucun repli)", async ({ page }) => {
  // Aucune route CMC : bouchonnerReseau répond 503 à /extapi, comme un CoinMarketCap injoignable.
  // Prouve que l'erreur traverse chargerAvecRepli (candidat unique) jusqu'à l'overlay sans être
  // remplacée par le message générique.
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

  await ouvrirParRecherche(page, "STABLE.D");

  const overlay = page.getByRole("alert").filter({ hasText: "Données indisponibles" });
  await expect(overlay).toContainText(
    "Dominance stablecoins indisponible : CoinMarketCap public ne répond pas — aucun repli, ni CCData ni CoinGecko ne publient ces capitalisations",
  );
  await expect(overlay).not.toContainText("La source n’a pas pu fournir l’historique demandé.");
  await expect(overlay.getByRole("button", { name: "Réessayer" })).toBeVisible();
});

test("module de STABLE.D introuvable (redéploiement) : l'overlay demande de recharger la page, sans accuser la source", async ({ page }) => {
  // L'ancien nom haché n'existe plus après un déploiement : l'import() du module paresseux échoue.
  await page.route("**/dominanceStablecoins.ts*", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();

  await ouvrirParRecherche(page, "STABLE.D");

  const overlay = page.getByRole("alert").filter({ hasText: "Données indisponibles" });
  await expect(overlay).toContainText("Dominance stablecoins non chargée (réseau ou mise à jour d'AXIOM) ; rechargez la page.");
  await expect(overlay).not.toContainText("La source n’a pas pu fournir l’historique demandé.");
});

test("préréglages SYN autonomes (bogue bf25024) et commande ⌘K ouvrent la série ; STABLE.D refusée comme jambe", async ({ page }) => {
  const appels: AppelCmc[] = [];
  await simulerCoinMarketCap(page, appels);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const bandeau = page.locator("[data-chart-banner]");

  // Préréglage TOTAL : inerte avant la correction, il ouvre maintenant la série.
  await page.getByRole("button", { name: "SYN", exact: true }).click();
  await page.getByRole("button", { name: "TOTAL", exact: true }).click();
  await expect(bandeau.getByText("TOTAL", { exact: true })).toBeVisible();
  await expect(bandeau.getByText("CoinMarketCap · daily", { exact: true })).toBeVisible();

  // Préréglage de la dominance.
  await page.getByRole("button", { name: "SYN", exact: true }).click();
  await page.getByRole("button", { name: "USDT+USDC+DAI dominance", exact: true }).click();
  await expect(bandeau.getByText("STABLE.D", { exact: true })).toBeVisible();
  await expect(bandeau).toContainText("10.00 %");
  expect(await lireMarche(page)).toMatchObject({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });

  // Constructeur SYN : une dominance n'est jamais une jambe (un % ÷ des dollars).
  await page.getByRole("button", { name: "SYN", exact: true }).click();
  await page.getByRole("textbox", { name: "Jambe A" }).fill("STABLE.D");
  await page.getByRole("textbox", { name: "Jambe B" }).fill("BTCUSDT");
  await page.getByRole("button", { name: "Charger" }).click();
  await expect(page.getByText("STABLE.D est une série en %, non composable", { exact: true })).toBeVisible();
  expect(await lireMarche(page)).toMatchObject({ symbol: "STABLE.D" }); // aucun SYN composé
  await page.getByRole("button", { name: "SYN", exact: true }).click(); // referme le panneau
  await expect(page.getByRole("textbox", { name: "Jambe A" })).toHaveCount(0);

  // ⌘K : depuis un autre marché, « stable.d » ouvre la série en 1d, avec le toast « Annuler ».
  await page.getByRole("combobox", { name: "Rechercher une paire" }).fill("TOTAL3");
  await page.getByRole("option", { name: /^TOTAL3\b/ }).click();
  await expect(bandeau.getByText("TOTAL3", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill("stable.d");
  await page.keyboard.press("Enter");
  await expect(bandeau.getByText("STABLE.D", { exact: true })).toBeVisible();
  await expect(page.getByText("Paire changée → STABLE.D")).toBeVisible();
  expect(await lireMarche(page)).toMatchObject({ exchange: "synthetic", symbol: "STABLE.D", timeframe: "1d" });
});
