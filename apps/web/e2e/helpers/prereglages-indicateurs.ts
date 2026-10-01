import type { Page } from "@playwright/test";
import type { Chart } from "klinecharts";
import type { ActiveIndicator } from "../../src/store/indicators";

/** À installer après bouchonnerReseau : historique fermé, à cadence régulière, sans réseau réel. */
export async function preparerPrereglages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ema = { instanceId: "ema-personnelle", defId: "ema", params: { length: 20 }, couleurIdx: 4 };
    if (!localStorage.getItem("axiom:chartState:v1")) localStorage.setItem("axiom:chartState:v1", JSON.stringify({
      exchange: "binance", symbol: "BTCUSDT", timeframe: "1m", chartType: "candle_solid", indicators: [ema],
    }));
    if (!localStorage.getItem("axiom:indicatorSets:v1")) localStorage.setItem("axiom:indicatorSets:v1", JSON.stringify([
      { id: "personnel", nom: "Mon étude", instances: [ema] },
    ]));
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const fin = Date.UTC(2026, 8, 28, 12);
    const lignes = Array.from({ length: 1000 }, (_, i) => {
      const t = fin - (999 - i) * 60_000;
      const prix = 100 + 8 * Math.sin(i / 11) + i * 0.01;
      const amplitude = 1 + (i % 7) / 10;
      return [t, String(prix), String(prix + amplitude), String(prix - amplitude), String(prix + 0.1), "10", t + 59_999, "1000", 4, "5", "500", "0"];
    }).filter((ligne) => Number(ligne[0]) <= Number(params.get("endTime") ?? Infinity)).slice(-Number(params.get("limit") ?? 500));
    return route.fulfill({ json: lignes });
  });
}

/** Lit le vrai contrôleur KLineCharts : calcul monté, taille et canvas du pane. Aucun moteur simulé. */
export async function lirePaneAnalyse(page: Page, defId: string) {
  return page.evaluate(async (id) => {
    const importer = new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/indicators.ts')])") as () => Promise<[
      { getActiveChart: () => Chart | null },
      { indicatorsStore: { getState: () => { indicators: ActiveIndicator[] } } },
    ]>;
    const [dessin, store] = await importer();
    const instance = store.indicatorsStore.getState().indicators.find((i) => i.defId === id);
    const chart = dessin.getActiveChart();
    if (!instance || !chart) return null;
    const paneId = `axiom_${instance.instanceId}`;
    const indicateur = chart.getIndicatorByPaneId(paneId, `AXIOM_${instance.instanceId}`) as { result?: Array<Record<string, number>> } | null;
    const canvas = chart.getDom(paneId, "main")?.querySelector("canvas");
    return {
      hauteur: chart.getSize(paneId)?.height ?? 0,
      canvas: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
      dernier: indicateur?.result?.at(-1) ?? null,
    };
  }, defId);
}

export async function lireInstances(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/indicators.ts')") as () => Promise<{ indicatorsStore: { getState: () => { indicators: ActiveIndicator[] } } }>;
    return (await importer()).indicatorsStore.getState().indicators;
  });
}
