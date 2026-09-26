/**
 * Dessins dont un coin est hors des bougies chargées (revue du 26/09/2026) — klinecharts 9.8.12 réel.
 * Rectangle sauvegardé [01:00 ; 11:00] sur BTCUSDT 1m, backfill de 500 bougies (03:41 → 12:00) :
 * le coin gauche est rejoué en indice extrapolé négatif. Activer les pivots (veille entière
 * requise) déclenche l'extension de session, qui PRÉFIXE l'historique par applyNewData. Le coin
 * gauche doit alors revenir exactement à 01:00, et un coin futur rester à son instant.
 */
import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const MINUTE = 60_000;
const FIN = Date.UTC(2026, 8, 7, 12, 0);
const TOTAL = 5000;
const GAUCHE = Date.UTC(2026, 8, 7, 1, 0);
const DROITE = Date.UTC(2026, 8, 7, 11, 0);
const FUTUR = DROITE + 90 * MINUTE;

async function bouchonnerBougies(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const pas = ({ "1m": MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE, "1h": 60 * MINUTE, "4h": 240 * MINUTE } as Record<string, number>)[params.get("interval") ?? "1m"] ?? MINUTE;
    const endTime = Number(params.get("endTime") ?? Infinity);
    const lignes = Array.from({ length: TOTAL }, (_, i) => {
      const t = FIN - (TOTAL - 1 - i) * pas;
      const o = 60_000 + i * 0.1;
      return [t, String(o), String(o + 2), String(o - 1), String(o + 1), "10", t + pas - 1, "1000", 4, "5", "500", "0"];
    }).filter((l) => Number(l[0]) <= endTime).slice(-Number(params.get("limit") ?? 500));
    await route.fulfill({ json: lignes });
  });
}

/**
 * Décalage, en barres, entre la position dessinée d'un coin et l'indice de son instant (pas de
 * 1 min : l'abscisse attendue d'un instant hors plage ne peut pas venir de convertToPixel, qui
 * le rabattrait sur la première ou la dernière bougie).
 */
async function decalages(page: Page) {
  return page.evaluate(async ({ gauche, futur, minute }) => {
    const dessin = await (new Function("return import('/src/chart/drawing.ts')") as () => Promise<{ setFocusChart: (s: number) => void; getActiveChart: () => any }>)();
    dessin.setFocusChart(0);
    const chart = dessin.getActiveChart();
    const data = chart.getDataList() as Array<{ timestamp: number }>;
    const rects = chart._chartStore.getOverlayStore().getInstances().filter((o: { name: string }) => o.name === "rect");
    const x = (p: object) => (chart.convertToPixel(p, { paneId: "candle_pane" }) as { x: number }).x;
    const barres = (p: object, t: number) => (x(p) - x({ dataIndex: Math.round((t - data[0]!.timestamp) / minute) })) / chart.getBarSpace();
    return {
      bougies: data.length,
      rects: rects.length as number,
      gauches: rects.map((r: { points: object[] }) => barres(r.points[0]!, gauche)),
      futur: rects[1] ? barres(rects[1].points[1]!, futur) : null,
    };
  }, { gauche: GAUCHE, futur: FUTUR, minute: MINUTE });
}

test("un coin antérieur au backfill revient à son instant après l'extension de session", async ({ page }) => {
  await bouchonnerReseau(page);
  await bouchonnerBougies(page);
  await page.addInitScript(({ g, d, f }) => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
    localStorage.setItem("axiom:drawings:v1", JSON.stringify({ "0:binance:BTCUSDT": [
      { name: "rect", points: [{ timestamp: g, value: 60_200 }, { timestamp: d, value: 60_400 }] },
      { name: "rect", points: [{ timestamp: g, value: 60_250 }, { timestamp: f, value: 60_450 }] },
    ] }));
  }, { g: GAUCHE, d: DROITE, f: FUTUR });
  await page.goto("/");
  await expect.poll(async () => (await decalages(page)).rects, { timeout: 30_000 }).toBe(2);
  const avant = await decalages(page);
  expect(avant.bougies).toBe(500);
  for (const d of avant.gauches) expect(Math.abs(d)).toBeLessThan(1);
  expect(Math.abs(avant.futur!)).toBeLessThan(1);

  await page.evaluate(async () => {
    const m = await (new Function("return import('/src/store/indicators.ts')") as () => Promise<{ indicatorsStore: { getState: () => { toggle: (id: string) => void } } }>)();
    m.indicatorsStore.getState().toggle("pivotStandard");
  });
  await expect.poll(async () => (await decalages(page)).bougies, { timeout: 30_000 }).toBeGreaterThan(2000);
  // Avant correctif : −1 661 barres pour le premier rectangle (coin passé rentré dans la plage).
  await expect.poll(async () => (await decalages(page)).gauches.map((d: number) => Math.abs(d) < 1), { timeout: 10_000 }).toEqual([true, true]);
  // Coin futur (12:30, 30 bougies après la dernière) : toujours à son instant.
  const apres = await decalages(page);
  expect(Math.abs(apres.futur!)).toBeLessThan(1);
});
