import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const JOUR_MS = 86_400_000;
const METRIQUES_FLUX_CM = "FlowInExNtv,FlowOutExNtv,FlowInExUSD,FlowOutExUSD";

/** 800 jours de flux exchanges BTC Coin Metrics finissant à J-1 (valeurs en chaînes, statut flash) ; dernier flux net −420 BTC. */
function lignesFluxCm(): unknown[] {
  const dernier = Math.floor(Date.now() / JOUR_MS) * JOUR_MS - JOUR_MS;
  return Array.from({ length: 800 }, (_, i) => {
    const net = i === 799 ? -420 : (i % 7) * 100 - 300;
    const entree = 10_000 + net;
    return {
      asset: "btc", time: new Date(dernier - (799 - i) * JOUR_MS).toISOString(),
      FlowInExNtv: String(entree), "FlowInExNtv-status": "flash", FlowOutExNtv: "10000", "FlowOutExNtv-status": "flash",
      FlowInExUSD: String(entree * 60_000), FlowOutExUSD: String(10_000 * 60_000),
    };
  });
}

test("CHAIN : flux commun coalescé, ETF partiel, groupes différés et files ETH", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:bgeometrics:key", "fixture-personnelle");
    localStorage.setItem("axiom:sosovalue:key", "fixture-personnelle");
    const dernier = { time: Date.now(), value: 1 };
    for (const id of ["mvrv", "sopr", "nupl", "puell", "reserveRisk"])
      localStorage.setItem(`axiom:onchain:bg:${id}`, JSON.stringify({ ts: Date.now(), donnee: { points: [dernier], dernier } }));
  });
  const bg: string[] = []; let eth = 0; let etf = 0; let cmFlux = 0;
  const jour = new Date().toISOString().slice(0, 10);
  await page.route("**/community-api.coinmetrics.io/**", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assets") !== "btc" || url.searchParams.get("metrics") !== METRIQUES_FLUX_CM) return route.fallback();
    cmFlux++;
    return route.fulfill({ json: { data: lignesFluxCm() } });
  });
  await page.route("**/bgapi/v1/**", route => {
    const url = new URL(route.request().url()); bg.push(url.pathname);
    const champ = url.pathname.includes("realized-price-sth") ? "realizedPriceSth"
      : url.pathname.includes("realized-price-lth") ? "realizedPriceLth" : "realizedCap";
    return route.fulfill({ json: [{ unixTs: Date.now() / 1000, [champ]: 100 }] });
  });
  await page.route("**/market/products?*", route => route.fulfill({ json: { products: [{ product_id: "BTC-USD", price: "120", price_percentage_change_24h: "1" }] } }));
  await page.route("**/currentEtfDataMetrics", route => route.fulfill({ json: { code: 0, data: {
    dailyNetInflow: { value: 10, status: "1", lastUpdateDate: jour }, list: [{ ticker: "FIX", dailyNetInflow: { value: 10, status: "1" } }],
  } } }));
  await page.route("**/etfs/summary-history?*", route => {
    etf++;
    expect(route.request().method()).toBe("GET");
    if (new URL(route.request().url()).searchParams.get("symbol") === "ETH") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [{ date: jour, total_net_inflow: -10, total_net_assets: 100 }] });
  });
  await page.route("**/stablecoincharts/all", route => route.fulfill({ json: [{ date: Date.now() / 1000, totalCirculatingUSD: { USDT: 1000 } }] }));
  await page.route("**/etheralpha/validatorqueue-com/main/historical_data.json", route => {
    eth++;
    return route.fulfill({ json: [{ date: jour, entry_queue: 100, exit_queue: 0, entry_wait: 2, exit_wait: 0, staked_amount: 4000, staked_percent: 30 }] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  await expect(chain).toContainText("Charger un groupe à la demande");
  await expect(chain).toContainText("Flux de capitaux alignés");
  await expect.poll(() => etf).toBe(3);
  // Le flux net des exchanges vient de Coin Metrics : BGeometrics ne sert plus que les séries réalisées.
  await expect.poll(() => bg.length).toBe(3);
  expect(bg.map((path) => path.split("/").at(-1)).sort()).toEqual([
    "realized-cap", "realized-price-lth", "realized-price-sth",
  ]);
  await expect(chain).toContainText("Flux net exchanges BTC (labels Coin Metrics) · jour");
  await expect(chain).toContainText("Labels Coin Metrics, périmètre révisable · Statut flash");
  await expect(chain).toContainText("Flux ETF ETH");
  await expect(chain).toContainText("indisponible");

  // Les métriques déjà obtenues par le flux commun sont relues depuis le cache par
  // les groupes historiques : aucune seconde collecte ne consomme le quota BG.
  await chain.getByRole("button", { name: "Cohortes", exact: true }).click();
  await expect(chain.getByText("Écart spot : +20.00 %").first()).toBeVisible();
  expect(bg.filter(p => p.includes("realized-price-"))).toHaveLength(2);
  await chain.getByRole("button", { name: "Exchanges", exact: true }).click();
  await expect(chain).toContainText("z-score flux 30 j (730 j)");
  await expect(chain).toContainText("Coin Metrics Community · labels Coin Metrics");
  await expect(chain).toContainText("Statut flash : valeurs récentes révisables");
  await expect(chain).not.toContainText("abonnement BGeometrics requis");
  await expect(chain).not.toContainText("Accès avec abonnement éligible");
  // Un seul téléchargement Coin Metrics pour la vue commune et le groupe Exchanges
  // (coalescence en vol, puis cache 6 h de la série dérivée).
  expect(cmFlux).toBe(1);
  await chain.getByRole("button", { name: "Capital réalisé", exact: true }).click();
  await expect(chain).toContainText("Historique insuffisant : date de référence absente");
  // Le clic Exchanges ne consomme aucun quota BGeometrics, et rien ne se répète seul entre deux actions.
  expect(bg).toHaveLength(3);
  await page.waitForTimeout(500);
  expect(bg).toHaveLength(3);
  expect(cmFlux).toBe(1);
  await chain.getByRole("button", { name: "Historique ETF BTC", exact: true }).click();
  await expect(chain).toContainText("-10.00 %");
  await expect(chain).toContainText("Historique insuffisant ou séance sans flux publié");
  expect(etf).toBe(3);
  await chain.getByRole("button", { name: "Files de staking ETH", exact: true }).click();
  await expect(chain).toContainText("100.00 ETH");
  await expect(chain).toContainText("0.00 ETH");
  await expect(chain).toContainText("Observation quotidienne");
  expect(eth).toBe(1);
});

test("CHAIN : le groupe Exchanges réutilise le flux net Coin Metrics de la vue commune", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:bgeometrics:key", "fixture-personnelle");
    localStorage.setItem("axiom:sosovalue:key", "fixture-personnelle");
    const dernier = { time: Date.now(), value: 1 };
    for (const id of ["mvrv", "sopr", "nupl", "puell", "reserveRisk"])
      localStorage.setItem(`axiom:onchain:bg:${id}`, JSON.stringify({ ts: Date.now(), donnee: { points: [dernier], dernier } }));
  });
  const bg: string[] = []; let cmFlux = 0;
  await page.route("**/community-api.coinmetrics.io/**", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assets") !== "btc" || url.searchParams.get("metrics") !== METRIQUES_FLUX_CM) return route.fallback();
    cmFlux++;
    return route.fulfill({ json: { data: lignesFluxCm() } });
  });
  await page.route("**/bgapi/v1/**", route => {
    const chemin = new URL(route.request().url()).pathname;
    bg.push(chemin);
    const champ = chemin.includes("realized-price-sth") ? "realizedPriceSth"
      : chemin.includes("realized-price-lth") ? "realizedPriceLth" : "realizedCap";
    return route.fulfill({ json: [{ unixTs: Date.now() / 1000, [champ]: 100 }] });
  });
  await page.route("**/etfs/summary-history?*", route => route.fulfill({ json: [] }));
  await page.route("**/currentEtfDataMetrics", route => route.fulfill({ json: { code: 0, data: {
    dailyNetInflow: { value: 10, status: "1", lastUpdateDate: new Date().toISOString().slice(0, 10) },
    list: [{ ticker: "FIX", dailyNetInflow: { value: 10, status: "1" } }],
  } } }));
  await page.route("**/stablecoincharts/all", route => route.fulfill({ json: [{ date: Date.now() / 1000, totalCirculatingUSD: { USDT: 1000 } }] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  await expect.poll(() => bg.length).toBe(3);
  await expect.poll(() => cmFlux).toBe(1);
  // Observation J-1 fraîche : l'alerte flux-capitaux-seuil « exchange-netflow » devient créable.
  await expect(chain.locator("article", { hasText: "Flux net exchanges BTC (labels Coin Metrics) · jour" })
    .getByRole("button", { name: "Créer une alerte" })).toBeEnabled();

  await chain.getByRole("button", { name: "Exchanges", exact: true }).click();
  await expect(chain.getByText(/^[-−]420 BTC$/)).toBeVisible();
  await expect(chain).toContainText("−$25.20M");
  expect(cmFlux).toBe(1);
  expect(bg).toHaveLength(3);
});

const METRIQUES_ETH_CM = "CapMrktCurUSD,CapMVRVCur,SplyCur,SplyExNtv,FlowInExNtv,FlowOutExNtv,FeeTotNtv";

/**
 * 800 jours ETH Coin Metrics finissant à J-1 (7 métriques en chaînes, flux et réserve en statut flash) :
 * flux net −1 000 ETH/j, réserve cohérente sauf une marche de périmètre de +500 000 ETH à J−100 ;
 * offre finale 122 317 100 ETH → prix réalisé 2 258,63 $, spot CM 2 469,92 $, réserve 12,84 % de l'offre.
 */
function lignesEthCm(): unknown[] {
  const dernier = Math.floor(Date.now() / JOUR_MS) * JOUR_MS - JOUR_MS;
  return Array.from({ length: 800 }, (_, i) => ({
    asset: "eth", time: new Date(dernier - (799 - i) * JOUR_MS).toISOString(),
    CapMrktCurUSD: "302112948927.53", CapMVRVCur: "1.093547895553364955", SplyCur: String(120_000_000 + 2_900 * i),
    SplyExNtv: String(16_000_000 - 1_000 * i + (i >= 699 ? 500_000 : 0)), "SplyExNtv-status": "flash",
    FlowInExNtv: "100000", "FlowInExNtv-status": "flash", FlowOutExNtv: "101000", "FlowOutExNtv-status": "flash",
    FeeTotNtv: "170",
  }));
}

async function ouvrirChainSansCle(page: Page) {
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /On-chain/ }).click();
  const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
  const section = chain.locator("section", { has: page.locator("h3", { hasText: "Réseau ETH" }) });
  // Fin du cycle de chargement : le badge « indisponible » du titre n'est évalué qu'après.
  const cycleTermine = () => expect(chain.getByRole("button", { name: /Rafraîchir/ })).toBeEnabled();
  return { chain, section, titre: section.locator("h3").first(), cycleTermine };
}

test("CHAIN : réseau ETH multi-source — Coin Metrics présent quand Etherscan échoue, un seul fetch", async ({ page }) => {
  await bouchonnerReseau(page); // Etherscan et le reste : 503
  let cmEth = 0;
  await page.route("**/community-api.coinmetrics.io/**", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assets") !== "eth") return route.fallback();
    cmEth++;
    expect(url.searchParams.get("metrics")).toBe(METRIQUES_ETH_CM);
    return route.fulfill({ json: { data: lignesEthCm() } });
  });
  const { chain, titre, section, cycleTermine } = await ouvrirChainSansCle(page);
  await expect(section).toContainText("Réserve exchanges ETH");
  await expect(section).toContainText("Coin Metrics Community");
  await expect(section).toContainText("12.84 % de l'offre");
  await expect(section).toContainText("(périmètre)");
  await expect(section).toContainText("Émission nette ETH (30 j)");
  await expect(section).toContainText("frais totaux 30 j");
  await expect(section).toContainText("Prix réalisé ETH");
  await expect(section).toContainText("$2,258.63");
  await expect(section).toContainText("spot CM $2,469.92");
  await expect(section).toContainText("MVRV 1.09");
  await expect(section).toContainText("flash");
  await expect(section).toContainText("Flux net 30 j");
  await expect(section).toContainText("Périmètre d'adresses révisable");
  await expect(section).not.toContainText("brûl");
  await expect(section).not.toContainText("plus bas");
  // Etherscan reste signalé indisponible dans son bloc, mais la section n'est pas déclarée indisponible.
  await expect(section).toContainText("Etherscan injoignable");
  await cycleTermine();
  await expect(titre).not.toContainText("indisponible");
  const qualite = chain.locator("details", { hasText: "Qualité des blocs" });
  await expect(qualite).toContainText("Réseau ETH · Coin Metrics");
  await expect(qualite).toContainText("Réseau ETH · Etherscan");
  // Un seul téléchargement ETH partagé par toutes les tuiles, sans relance immédiate.
  await page.waitForTimeout(500);
  expect(cmEth).toBe(1);
});

test("CHAIN : un échec Coin Metrics ETH n'efface pas les tuiles Etherscan", async ({ page }) => {
  await bouchonnerReseau(page); // Coin Metrics : 503
  await page.route("**/ethscanapi/**", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const result = action === "ethsupply" ? "122041617227161976986449678"
      : action === "gasoracle" ? { SafeGasPrice: "0.5", ProposeGasPrice: "0.6", FastGasPrice: "0.7" }
        : { TotalNodeCount: "7000" };
    return route.fulfill({ json: { status: "1", message: "OK", result } });
  });
  const { chain, titre, section, cycleTermine } = await ouvrirChainSansCle(page);
  await expect(section).toContainText("Réseau ETH Coin Metrics indisponible.");
  await expect(section).toContainText("Gas recommandé");
  await expect(section).toContainText("0.70 Gwei");
  await expect(section).toContainText("122.04M");
  await cycleTermine();
  await expect(titre).not.toContainText("indisponible");
  await expect(chain.locator("details", { hasText: "Qualité des blocs" })).toContainText("Coin Metrics ETH indisponible et aucun cache exploitable.");
});

for (const [joursEtf, badgeEtf] of [[4, null], [6, "source en retard"]] as const) {
  test(`CHAIN : badges de fraîcheur BGeometrics — tuiles et repli ETF observé il y a ${joursEtf} j`, async ({ page }) => {
    await bouchonnerReseau(page); // SoSoValue et /bgapi non fournis : 503, jamais de réseau réel
    await page.addInitScript((jours) => {
      const JOUR = 86_400_000;
      localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
      const cache = (id: string, ageCache: number, ageObservation: number) => {
        const points = [3, 2, 1, 0].map((i) => ({ time: Date.now() - ageObservation - i * JOUR, value: 100 + i }));
        localStorage.setItem(`axiom:onchain:bg:${id}`, JSON.stringify({ ts: Date.now() - ageCache, donnee: { points, dernier: points.at(-1) } }));
      };
      cache("mvrv", 0, 7 * JOUR); // récupéré à l'instant, embargo 7 j de l'offre gratuite
      cache("nupl", 0, 4 * JOUR); // sous embargo mais observé il y a 4 j : source en retard
      cache("sopr", 25 * 3_600_000, 3_600_000); // cache expiré resservi après échec
      cache("etfFlow", 0, jours * JOUR); // repli ETF BTC (SoSoValue indisponible)
    }, joursEtf);
    await page.goto("/");
    await page.getByRole("button", { name: "Fonctions" }).click();
    await page.getByRole("menuitem", { name: /On-chain/ }).click();
    const chain = page.getByRole("complementary", { name: "On-chain", exact: true });
    const tuile = (libelle: string) =>
      chain.locator("div.flex-col", { has: page.locator("span.uppercase", { hasText: new RegExp(`^${libelle}$`) }) }).last();

    await expect(tuile("MVRV Z-Score")).toContainText("embargo 7 j");
    await expect(tuile("MVRV Z-Score")).not.toContainText("source en retard");
    await expect(tuile("MVRV Z-Score")).not.toContainText("cache périmé");
    await expect(chain).toContainText("Offre gratuite BGeometrics : les 7 derniers jours sont réservés aux abonnés"); // raison MVRV (Qualité des blocs)
    await expect(tuile("NUPL")).toContainText("source en retard");
    await expect(tuile("NUPL")).not.toContainText("embargo 7 j");
    await expect(chain).toContainText("les 7 derniers jours sont réservés aux abonnés BGeometrics");
    await expect(tuile("SOPR")).toContainText("cache périmé");
    await expect(tuile("SOPR")).not.toContainText("source en retard");

    const repliEtf = chain.locator("div", { hasText: /^bitcoin-data\.com \(repli\)/ }).last();
    await expect(repliEtf).toBeVisible();
    await expect(repliEtf).not.toContainText("cache périmé");
    if (badgeEtf === null) await expect(repliEtf).not.toContainText("source en retard");
    else await expect(repliEtf).toContainText(badgeEtf);
  });
}
