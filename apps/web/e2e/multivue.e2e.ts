import { test, expect, type Page } from "@playwright/test";
import type { Chart } from "klinecharts";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const MINUTE = 60_000;
const FIN = Date.UTC(2026, 8, 7);
const SYMBOLES = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

/** Même fin, débuts différents : recopier un indice décalerait les dates comparées. */
async function bouchonnerBougies(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const slot = Math.max(0, SYMBOLES.indexOf(params.get("symbol") ?? ""));
    const interval = params.get("interval") ?? "1m";
    const mensuel = interval === "1M";
    const pas = ({ "1m": MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE,
      "30m": 30 * MINUTE, "1h": 60 * MINUTE, "4h": 240 * MINUTE,
      "1d": 1440 * MINUTE, "1w": 10080 * MINUTE } as Record<string, number>)[interval] ?? MINUTE;
    const nombre = mensuel ? [216, 180, 144, 120][slot]! : [480, 360, 300, 240][slot]!;
    const timestamp = (index: number): number => mensuel
      ? Date.UTC(2026, 8 - (nombre - 1) + index, 1)
      : FIN - (nombre - 1 - index) * pas;
    const prix = [60_000, 3_000, 150, 500][slot]!;
    const endTime = Number(params.get("endTime") ?? Infinity);
    const lignes = Array.from({ length: nombre }, (_, index) => {
      const ouverture = prix + index * 0.1;
      return [timestamp(index), String(ouverture), String(ouverture + 2), String(ouverture - 1),
        String(ouverture + 1), "10", timestamp(index + 1) - 1, "1000", 4, "5", "500", "0"];
    }).filter((ligne) => Number(ligne[0]) <= endTime).slice(-Number(params.get("limit") ?? 500));
    await route.fulfill({ json: lignes });
  });
}

/** Pont de dessin déjà utilisé par l'application : aucune instrumentation de production. */
async function lireCharts(page: Page, nombre: number) {
  return page.evaluate(async (count) => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => Chart | null;
    }>;
    const dessin = await importer();
    return Array.from({ length: count }, (_, slot) => {
      dessin.setFocusChart(slot);
      const chart = dessin.getActiveChart();
      if (!chart) return null;
      const donnees = chart.getDataList();
      const plage = chart.getVisibleRange();
      const premierVisible = donnees[Math.max(0, plage.from)];
      const dernierVisible = donnees[Math.min(donnees.length - 1, plage.to - 1)];
      const zone = chart.getDom("candle_pane", "main" as never)?.getBoundingClientRect();
      return { count: donnees.length, first: donnees[0]?.timestamp, last: donnees.at(-1)?.timestamp,
        from: premierVisible?.timestamp, to: dernierVisible?.timestamp, index: plage.from,
        barSpace: chart.getBarSpace(),
        months: donnees.map((bougie) => new Date(bougie.timestamp).getUTCMonth()),
        box: zone ? { x: zone.x, y: zone.y, width: zone.width, height: zone.height } : null };
    });
  }, nombre);
}

async function attendreCharts(page: Page, nombre: number): Promise<void> {
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
  await expect.poll(async () => (await lireCharts(page, nombre)).every((chart) => chart && chart.count > 0)).toBe(true);
}

async function lireMarcheMaitre(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { symbol: string; timeframe: string; exchange: string } };
    }>;
    const state = (await importer()).marketStore.getState();
    return { symbol: state.symbol, timeframe: state.timeframe, exchange: state.exchange };
  });
}

async function attendreMemesDates(page: Page, nombre: number, tolerance = MINUTE): Promise<void> {
  await expect.poll(async () => {
    const charts = await lireCharts(page, nombre);
    const source = charts[0];
    if (source?.from === undefined || source.to === undefined) return Infinity;
    return Math.max(...charts.map((chart) => chart?.from === undefined || chart.to === undefined
      ? Infinity : Math.max(Math.abs(chart.from - source.from!), Math.abs(chart.to - source.to!))));
  }).toBeLessThanOrEqual(tolerance);
}

/** Gestes réels sur le canvas : la molette zoome, le glisser déplace l'historique. */
async function naviguer(page: Page, slot: number, nombre: number): Promise<void> {
  const avant = (await lireCharts(page, nombre))[slot]!;
  const box = avant.box;
  expect(box).toBeTruthy();
  const x = box!.x + box!.width * 0.55;
  const y = box!.y + box!.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -350);
  await expect.poll(async () => (await lireCharts(page, nombre))[slot]!.barSpace).toBeGreaterThan(avant.barSpace);
  const apresZoom = (await lireCharts(page, nombre))[slot]!;
  await page.mouse.down();
  await page.mouse.move(x + Math.min(100, box!.width * 0.2), y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await lireCharts(page, nombre))[slot]!.to).toBeLessThan(apresZoom.to!);
}

async function lireReticule(page: Page, slot: number) {
  return page.evaluate(async (cible) => {
    const importerDessin = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => Chart | null;
    }>;
    const importerReticule = new Function("return import('/src/chart/ChartInstance.tsx')") as () => Promise<{
      crosshairSyncStore: { getState: () => { time: number | null; source: number } };
    }>;
    const dessin = await importerDessin();
    dessin.setFocusChart(cible);
    const chart = dessin.getActiveChart()!;
    const conteneur = chart.getDom()!.parentElement!.parentElement!;
    const canvas = Array.from(conteneur.querySelectorAll<HTMLCanvasElement>(":scope > canvas")).at(-1)!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colonne = -1;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 0) { colonne = Math.floor(i / 4) % canvas.width; break; }
    }
    const { time, source } = (await importerReticule()).crosshairSyncStore.getState();
    const position = time === null ? null : chart.convertToPixel({ timestamp: time }, { paneId: "candle_pane", absolute: true }) as { x: number };
    return { time, source, colonne, attendu: position ? position.x * devicePixelRatio : null };
  }, slot);
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await bouchonnerBougies(page);
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
});

test("les unités se synchronisent dans les deux sens sans remplacer les actifs et les options persistent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).last().click();
  const synchroniserTf = page.getByRole("button", { name: "Synchroniser les unités de temps", exact: true });
  const synchroniserVue = page.getByRole("button", { name: "Synchroniser le zoom et le défilement", exact: true });
  const synchroniserReticule = page.getByRole("button", { name: "Synchroniser le réticule", exact: true });
  await expect(synchroniserTf).toHaveAttribute("aria-pressed", "false");
  await expect(synchroniserVue).toHaveAttribute("aria-pressed", "false");
  await expect(synchroniserReticule).toHaveAttribute("aria-pressed", "true");
  const timeframes = page.getByRole("combobox", { name: "Timeframe du slot", exact: true });
  await timeframes.first().selectOption("1h");
  await page.getByRole("button", { name: "1m", exact: true }).click();
  await page.getByRole("textbox", { name: "Symbole du slot", exact: true }).first().click();
  await synchroniserTf.click();
  await expect(synchroniserTf).toHaveAttribute("aria-pressed", "true");
  await expect(timeframes.first()).toHaveValue("1h"); // Le secondaire est au focus.
  await expect.poll(async () => (await lireMarcheMaitre(page)).timeframe).toBe("1h");

  for (const [disposition, nombre] of [["Deux côte à côte", 2], ["Deux empilés", 2], ["Grille 2×2", 4]] as const) {
    await page.getByRole("button", { name: disposition, exact: true }).last().click();
    await expect(timeframes).toHaveCount(nombre - 1);
    for (let i = 0; i < nombre - 1; i++) await expect(timeframes.nth(i)).toHaveValue("1h");
    await page.getByRole("button", { name: "3M", exact: true }).click();
    for (let i = 0; i < nombre - 1; i++) await expect(timeframes.nth(i)).toHaveValue("3M");
    await attendreCharts(page, nombre);
    for (const chart of await lireCharts(page, nombre)) {
      expect(chart?.months.every((mois) => [0, 3, 6, 9].includes(mois))).toBe(true);
    }
    await timeframes.last().selectOption("12M");
    await expect.poll(async () => (await lireMarcheMaitre(page)).timeframe).toBe("12M");
    await attendreCharts(page, nombre);
    for (let i = 0; i < nombre - 1; i++) {
      await expect(timeframes.nth(i)).toHaveValue("12M");
      await expect(page.getByRole("textbox", { name: "Symbole du slot", exact: true }).nth(i)).toHaveValue(SYMBOLES[i + 1]!);
    }
    for (const chart of await lireCharts(page, nombre)) expect(chart?.months.every((mois) => mois === 0)).toBe(true);
    expect(await lireMarcheMaitre(page)).toEqual({ symbol: "BTCUSDT", timeframe: "12M", exchange: "binance" });
    await page.getByRole("button", { name: "1h", exact: true }).click();
  }

  await synchroniserVue.click();
  await synchroniserReticule.click();
  await page.reload();
  await expect(synchroniserTf).toHaveAttribute("aria-pressed", "true");
  await expect(synchroniserVue).toHaveAttribute("aria-pressed", "true");
  await expect(synchroniserReticule).toHaveAttribute("aria-pressed", "false");
  await synchroniserTf.click();
  await timeframes.nth(1).selectOption("5m");
  await attendreCharts(page, 4);
  await expect(timeframes.nth(0)).toHaveValue("1h");
  await expect(timeframes.nth(2)).toHaveValue("1h");
  expect((await lireMarcheMaitre(page)).timeframe).toBe("1h");
  await page.reload();
  await expect(synchroniserTf).toHaveAttribute("aria-pressed", "false");
  await expect(timeframes.nth(1)).toHaveValue("5m");
});

for (const [disposition, nombre] of [["Deux côte à côte", 2], ["Deux empilés", 2], ["Grille 2×2", 4]] as const) {
  test(`zoom et défilement partagent les dates avec des historiques différents — ${disposition}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: disposition, exact: true }).last().click();
    await attendreCharts(page, nombre);
    const initiaux = await lireCharts(page, nombre);
    expect(initiaux.map((chart) => chart?.count)).toEqual([480, 360, 300, 240].slice(0, nombre));
    expect(initiaux[0]!.first).toBeLessThan(initiaux[1]!.first!);
    const synchroniser = page.getByRole("button", { name: "Synchroniser le zoom et le défilement", exact: true });
    await synchroniser.click();
    await expect(synchroniser).toHaveAttribute("aria-pressed", "true");
    await naviguer(page, 0, nombre);
    await expect.poll(async () => (await lireCharts(page, nombre))[0]!.barSpace).toBeGreaterThan(initiaux[0]!.barSpace);
    await attendreMemesDates(page, nombre);
    const apresMaitre = await lireCharts(page, nombre);
    expect(apresMaitre[0]!.from).not.toBe(initiaux[0]!.from);
    expect(apresMaitre[0]!.index).not.toBe(apresMaitre[1]!.index);
    await naviguer(page, nombre - 1, nombre);
    await attendreMemesDates(page, nombre);
    await expect.poll(async () => (await lireCharts(page, nombre))[0]!.barSpace).toBeGreaterThan(apresMaitre[0]!.barSpace);
    if (nombre === 4) {
      const avantResize = (await lireCharts(page, nombre))[0]!;
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect.poll(async () => (await lireCharts(page, nombre))[0]!.box!.width).not.toBe(avantResize.box!.width);
      await attendreMemesDates(page, nombre);
      for (const chart of await lireCharts(page, nombre)) {
        expect(Math.abs(chart!.from! - avantResize.from!)).toBeLessThanOrEqual(MINUTE);
        expect(Math.abs(chart!.to! - avantResize.to!)).toBeLessThanOrEqual(MINUTE);
      }
      await page.screenshot({ path: test.info().outputPath("grille-synchronisee.png") });
    }
    await synchroniser.click();
    await expect(synchroniser).toHaveAttribute("aria-pressed", "false");
    const avantArret = await lireCharts(page, nombre);
    await naviguer(page, nombre - 1, nombre);
    await expect.poll(async () => (await lireCharts(page, nombre))[nombre - 1]!.barSpace).toBeGreaterThan(avantArret[nombre - 1]!.barSpace);
    const apresArret = await lireCharts(page, nombre);
    expect(apresArret[0]!.from).toBe(avantArret[0]!.from);
    expect(apresArret[0]!.to).toBe(avantArret[0]!.to);
    expect(apresArret[0]!.barSpace).toBe(avantArret[0]!.barSpace);
  });
}

test("la navigation trimestrielle conserve les mêmes dates calendaires entre actifs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).last().click();
  await page.getByRole("button", { name: "Synchroniser les unités de temps", exact: true }).click();
  await page.getByRole("button", { name: "3M", exact: true }).click();
  await attendreCharts(page, 2);
  const initiaux = await lireCharts(page, 2);
  expect(initiaux.map((chart) => chart?.count)).toEqual([72, 60]);
  await page.getByRole("button", { name: "Synchroniser le zoom et le défilement", exact: true }).click();
  const trimestreMax = 92 * 24 * 60 * MINUTE;
  await naviguer(page, 0, 2);
  await attendreMemesDates(page, 2, trimestreMax);
  const apresMaitre = await lireCharts(page, 2);
  expect(apresMaitre[0]!.barSpace).toBeGreaterThan(initiaux[0]!.barSpace);
  expect(Math.abs(apresMaitre[0]!.index - apresMaitre[1]!.index - 12)).toBeLessThanOrEqual(1);
  await naviguer(page, 1, 2);
  await attendreMemesDates(page, 2, trimestreMax);
  await expect.poll(async () => (await lireCharts(page, 2))[0]!.barSpace).toBeGreaterThan(apresMaitre[0]!.barSpace);
});

test("le réticule partagé suit la date puis s’efface à la sortie et à la désactivation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).last().click();
  await attendreCharts(page, 2);
  const synchroniser = page.getByRole("button", { name: "Synchroniser le réticule", exact: true });
  await expect(synchroniser).toHaveAttribute("aria-pressed", "true");
  const box = (await lireCharts(page, 2))[0]!.box!;
  const survoler = async () => page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5);
  const attendreLigne = async () => {
    await expect.poll(async () => {
      const reticule = await lireReticule(page, 1);
      return reticule.colonne >= 0 && reticule.attendu !== null && reticule.source === 0
        && Math.abs(reticule.colonne - reticule.attendu) <= 2;
    }).toBe(true);
  };
  await survoler();
  await attendreLigne();
  const avantDefilement = (await lireReticule(page, 1)).time;
  // Un défilement impératif (clavier, par exemple) déplace les bougies sans mousemove.
  const dateSousCurseur = await page.evaluate(async ({ x, y }) => {
    const importer = new Function("return import('/src/chart/drawing.ts')") as () => Promise<{
      setFocusChart: (slot: number) => void;
      getActiveChart: () => Chart | null;
    }>;
    const dessin = await importer();
    dessin.setFocusChart(0);
    const chart = dessin.getActiveChart()!;
    chart.scrollByDistance(80);
    const positions = chart.convertFromPixel([{ x, y }], { paneId: "candle_pane" });
    return (Array.isArray(positions) ? positions[0] : positions)?.timestamp;
  }, { x: box.width * 0.65, y: box.height * 0.5 });
  expect(dateSousCurseur).toBeDefined();
  expect(dateSousCurseur).not.toBe(avantDefilement);
  await expect.poll(async () => (await lireReticule(page, 1)).time).toBe(dateSousCurseur);
  await attendreLigne();
  await page.mouse.move(1, 1);
  await expect.poll(async () => (await lireReticule(page, 1)).colonne).toBe(-1);
  await survoler();
  await attendreLigne();
  await synchroniser.click();
  await expect(synchroniser).toHaveAttribute("aria-pressed", "false");
  await survoler();
  await expect.poll(async () => (await lireReticule(page, 1)).colonne).toBe(-1);
  await synchroniser.click();
  await survoler();
  await attendreLigne();
});

test("unités longues disponibles et persistées dans les vues double et quadruple", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).last().click();
  const timeframes = page.getByRole("combobox", { name: "Timeframe du slot", exact: true });
  for (const tf of ["1w", "1M", "3M", "6M", "12M"]) {
    await expect(timeframes.first().locator(`option[value="${tf}"]`)).toHaveCount(1);
    await timeframes.first().selectOption(tf);
    await expect(timeframes.first()).toHaveValue(tf);
  }
  await page.getByRole("button", { name: "Grille 2×2", exact: true }).last().click();
  await expect(timeframes).toHaveCount(3);
  await timeframes.nth(1).selectOption("1w");
  await timeframes.nth(2).selectOption("3M");
  await page.reload();
  await expect(timeframes.nth(0)).toHaveValue("12M");
  await expect(timeframes.nth(1)).toHaveValue("1w");
  await expect(timeframes.nth(2)).toHaveValue("3M");
});

test("le menu secondaire respecte les unités disponibles pour sa source", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deux empilés", exact: true }).last().click();
  const source = page.getByRole("combobox", { name: "Source du slot", exact: true });
  const timeframe = page.getByRole("combobox", { name: "Timeframe du slot", exact: true });
  await source.selectOption("kraken");
  await expect(timeframe.locator('option[value="1w"]')).toHaveCount(1);
  await expect(timeframe.locator('option[value="1M"]')).toHaveCount(0);
  await timeframe.selectOption("1w");
  await source.selectOption("coinbase");
  await expect(timeframe.locator('option[value="1w"]')).toHaveCount(0);
  await expect(timeframe).toHaveValue("1m");
});
