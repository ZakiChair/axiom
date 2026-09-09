import { expect, test } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

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
  const bg: string[] = []; let eth = 0; let etf = 0;
  const jour = new Date().toISOString().slice(0, 10);
  await page.route("**/bgapi/v1/**", route => {
    const url = new URL(route.request().url()); bg.push(url.pathname);
    if (url.pathname.includes("exchange-")) return route.fulfill({ status: 403, json: { error: "subscription required" } });
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
  await expect.poll(() => bg.length).toBe(5);
  expect(bg.map((path) => path.split("/").at(-1)).sort()).toEqual([
    "exchange-netflow-btc", "exchange-reserve-btc", "realized-cap", "realized-price-lth", "realized-price-sth",
  ]);
  await expect(chain).toContainText("Flux ETF ETH");
  await expect(chain).toContainText("indisponible");

  // Les métriques déjà obtenues par le flux commun sont relues depuis le cache par
  // les groupes historiques : aucune seconde collecte ne consomme le quota BG.
  await chain.getByRole("button", { name: "Cohortes", exact: true }).click();
  await expect(chain.getByText("Écart spot : +20.00 %").first()).toBeVisible();
  expect(bg.filter(p => p.includes("realized-price-"))).toHaveLength(2);
  await chain.getByRole("button", { name: "Exchanges", exact: true }).click();
  await expect(chain).toContainText("abonnement BGeometrics requis");
  await chain.getByRole("button", { name: "Capital réalisé", exact: true }).click();
  await expect(chain).toContainText("Historique insuffisant : date de référence absente");
  // Le 403 sans cache peut être retenté par le clic explicite Exchanges, mais ne doit
  // jamais se répéter seul en boucle entre deux actions utilisateur.
  expect(bg).toHaveLength(7);
  await page.waitForTimeout(500);
  expect(bg).toHaveLength(7);
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

test("CHAIN : le groupe Exchanges réutilise les métriques communes quand leur réponse est disponible", async ({ page }) => {
  await bouchonnerReseau(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:bgeometrics:key", "fixture-personnelle");
    localStorage.setItem("axiom:sosovalue:key", "fixture-personnelle");
    const dernier = { time: Date.now(), value: 1 };
    for (const id of ["mvrv", "sopr", "nupl", "puell", "reserveRisk"])
      localStorage.setItem(`axiom:onchain:bg:${id}`, JSON.stringify({ ts: Date.now(), donnee: { points: [dernier], dernier } }));
  });
  const bg: string[] = [];
  await page.route("**/bgapi/v1/**", route => {
    const chemin = new URL(route.request().url()).pathname;
    bg.push(chemin);
    const champ = chemin.includes("exchange-netflow") ? "exchangeNetflowBtc"
      : chemin.includes("exchange-reserve") ? "exchangeReserveBtc"
        : chemin.includes("realized-price-sth") ? "realizedPriceSth"
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
  await expect.poll(() => bg.length).toBe(5);

  await chain.getByRole("button", { name: "Exchanges", exact: true }).click();
  await expect(chain).toContainText("100.00 BTC");
  expect(bg).toHaveLength(5);
});
