import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const H = 3_600_000;

async function preparer(page: Page, retenirBtcBybit = false) {
  await bouchonnerReseau(page);
  let historiques = 0;
  let horsBinance = 0;
  let debloquer!: () => void;
  const attente = new Promise<void>((resolve) => { debloquer = resolve; });
  const dernier = Math.floor(Date.now() / H) * H;
  const reglements = (symbol: string, taux: string) => Array.from({ length: 35 }, (_, i) => ({
    symbol, fundingTime: dernier - i * 8 * H, fundingRate: taux, rateType: "Regular",
  })).reverse();
  await page.route("**/extapi/fapi.binance.com/fapi/v1/fundingRate?*", (route) => {
    historiques++;
    const q = new URL(route.request().url()).searchParams;
    const symbol = q.get("symbol") ?? "BTCUSDT";
    const rows = reglements(symbol, "0.0008").filter((r) => r.fundingTime >= Number(q.get("startTime")) && r.fundingTime <= Number(q.get("endTime")));
    return route.fulfill({ json: rows });
  });
  await page.route("**/v5/market/funding/history?*", async (route) => {
    historiques++;
    horsBinance++;
    const q = new URL(route.request().url()).searchParams;
    const symbol = q.get("symbol") ?? "BTCUSDT";
    if (retenirBtcBybit && symbol === "BTCUSDT") await attente;
    return route.fulfill({ json: { retCode: 0, result: { list: reglements(symbol, "0.0016").reverse().map((r) => ({
      symbol, fundingRateTimestamp: String(r.fundingTime), fundingRate: r.fundingRate,
    })) } } });
  });
  await page.route("**/api/v5/public/funding-rate-history?*", (route) => {
    historiques++;
    horsBinance++;
    const q = new URL(route.request().url()).searchParams;
    const instId = q.get("instId") ?? "BTC-USDT-SWAP";
    return route.fulfill({ json: { code: "0", data: reglements("", "0.0024").reverse().map((r) => ({
      instId, fundingTime: String(r.fundingTime), fundingRate: "0.99", realizedRate: r.fundingRate,
    })) } });
  });
  await page.route("https://api.hyperliquid.xyz/info", (route) => {
    const body = route.request().postDataJSON() as { type: string; coin: string; startTime: number };
    if (body.type !== "fundingHistory") return route.fulfill({ status: 503, json: {} });
    historiques++;
    horsBinance++;
    return route.fulfill({ json: Array.from({ length: 220 }, (_, i) => ({
      coin: body.coin, time: dernier - (219 - i) * H, fundingRate: "0.0004",
    })).filter((r) => r.time >= body.startTime) });
  });
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  return { appels: () => historiques, appelsHorsBinance: () => horsBinance, debloquer };
}

async function ouvrirFundx(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Fonctions" }).click();
  await page.getByRole("menuitem", { name: /Funding cross-exchange/ }).click();
  return page.locator('[data-window-id="fundingMatrix"]');
}

test("FUNDX charge l'historique strict au clic, montre couverture et trous, puis change de plage", async ({ page }, testInfo) => {
  const fixture = await preparer(page);
  const fenetre = await ouvrirFundx(page);
  await expect(fenetre.getByRole("button", { name: "Instantané live" })).toBeVisible();
  expect(fixture.appelsHorsBinance()).toBe(0);
  await fenetre.getByRole("button", { name: "Historique 7/30/90 j" }).click();
  await expect(fenetre.getByRole("img", { name: /Dispersion APR historique/ })).toBeVisible();
  await expect(fenetre).toContainText("dispersion calculable");
  await expect(fenetre).toContainText("Trous :");
  await expect(fenetre).toContainText("règlements réalisés");
  await expect(fenetre.getByTestId("funding-derniere-dispersion")).toContainText(/σ [\d.]+ · min [\d.-]+ · max [\d.-]+ points d’APR/);
  await expect(fenetre).toContainText("Échelle :");
  await fenetre.screenshot({ path: process.env.AXIOM_VISUAL_DIR
    ? `${process.env.AXIOM_VISUAL_DIR}/fundx-historique.png`
    : testInfo.outputPath("fundx-historique.png") });
  await expect.poll(fixture.appelsHorsBinance).toBe(3);
  await fenetre.getByRole("button", { name: "30 j" }).click();
  await expect(fenetre.getByRole("button", { name: "30 j" })).toHaveAttribute("aria-pressed", "true");
  await expect(fenetre).toContainText("demandé depuis");
  await fenetre.getByRole("button", { name: "Instantané live" }).click();
  await expect(fenetre.getByRole("img", { name: /Dispersion APR historique/ })).toHaveCount(0);
});

test("une réponse de l'ancien symbole ne remplace pas le nouvel historique", async ({ page }) => {
  const fixture = await preparer(page, true);
  const fenetre = await ouvrirFundx(page);
  await fenetre.getByRole("button", { name: "Historique 7/30/90 j" }).click();
  await expect.poll(fixture.appels).toBeGreaterThanOrEqual(4);
  await page.evaluate(async () => {
    const chemin = "/src/store/market.ts";
    const { marketStore } = await import(chemin);
    marketStore.getState().setSymbol("ETHUSDT");
  });
  await expect(fenetre).toContainText("ETHUSDT · cohorte ETHUSDT");
  fixture.debloquer();
  await expect(fenetre).not.toContainText("BTCUSDT · cohorte BTCUSDT");
});

test("BTC-PERP Hyperliquid utilise la même cohorte BTC explicite", async ({ page }) => {
  const fixture = await preparer(page);
  const fenetre = await ouvrirFundx(page);
  await page.evaluate(async () => {
    const chemin = "/src/store/market.ts";
    const { marketStore } = await import(chemin);
    marketStore.getState().setMarket({ exchange: "hyperliquid", symbol: "BTC-PERP", timeframe: "1h" });
  });
  await fenetre.getByRole("button", { name: "Historique 7/30/90 j" }).click();
  await expect(fenetre).toContainText("BTC-PERP · cohorte BTCUSDT / BTC-USDT-SWAP / BTC Hyperliquid");
  await expect(fenetre.getByTestId("funding-derniere-dispersion")).toContainText("4/4 venues");
  await expect.poll(fixture.appelsHorsBinance).toBe(3);
});

test("après une dispersion positive puis un trou, le label 0/4 reste dans le pane", async ({ page }, testInfo) => {
  await bouchonnerReseau(page);
  await page.goto("/");
  const peinture = await page.evaluate(async () => {
    const { INDICATEURS_ANALYSE } = await import("/src/components/IndicatorMenu.tsx");
    const { dessinerAnnotationsPane } = await import("/src/chart/annotationsPane.ts");
    const def = INDICATEURS_ANALYSE.find((d) => d.id === "fundingDispersion")!;
    const fraction = 24 * 365 * 100;
    const bougies = [0, 1].map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    const calcul = def.calc(bougies, {}, { hl2: [], hlc3: [], ohlc4: [], source: [], aux: {
      fundingHistBinance: [25 / fraction, undefined], fundingHistBybit: [100 / fraction, undefined],
      fundingHistOkx: [100 / fraction, undefined], fundingHistHl: [100 / fraction, undefined],
    } });
    const canvas = document.createElement("canvas");
    canvas.id = "funding-label-fixture";
    canvas.width = 240; canvas.height = 100;
    canvas.style.cssText = "position:fixed;top:10px;left:10px;z-index:9999;background:#111";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d")!;
    const appels: Array<[string, number, number]> = [];
    const original = ctx.fillText.bind(ctx);
    ctx.fillText = (texte, x, y) => { appels.push([texte, x, y]); original(texte, x, y); };
    dessinerAnnotationsPane(ctx, calcul.annotations!, "pane", { convertirX: (idx) => 80 + idx * 20, convertirY: () => 110 }, { de: 0, a: 2 });
    return { serieTrou: calcul.series.sigma[1] === undefined, serieValide: Number.isFinite(calcul.series.sigma[0]), appels };
  });
  expect(peinture.serieValide).toBe(true);
  expect(peinture.serieTrou).toBe(true);
  expect(peinture.appels).toContainEqual(["0/4 venues", 100, 32]);
  await page.locator("#funding-label-fixture").screenshot({ path: process.env.AXIOM_VISUAL_DIR
    ? `${process.env.AXIOM_VISUAL_DIR}/funding-label-trou.png`
    : testInfo.outputPath("funding-label-trou.png") });
});
