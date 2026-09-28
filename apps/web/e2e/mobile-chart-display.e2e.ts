import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const FIN = Date.UTC(2026, 8, 28, 12);
test.use({ deviceScaleFactor: 3 });

async function preparer(page: Page) {
  await bouchonnerReseau(page);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  let requetes = 0;
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    requetes++;
    const p = new URL(route.request().url()).searchParams;
    const pas = p.get("interval") === "5m" ? 300_000 : 60_000;
    const fin = Math.floor(Math.min(FIN, Number(p.get("endTime") ?? FIN)) / pas) * pas;
    const base = p.get("symbol") === "ETHUSDT" ? 3000 : 60000;
    return route.fulfill({ json: Array.from({ length: 500 }, (_, i) => {
      const t = fin - (499 - i) * pas;
      const o = base + Math.sin(i / 12) * 30 + i / 10;
      return [t, `${o}`, `${o + 4}`, `${o - 3}`, `${o + 2}`, "10", t + pas - 1, "100", 3, "5", "50", "0"];
    }) });
  });
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
  return () => requetes;
}

/** Lecture du vrai moteur ; les références permettent de détecter un remontage silencieux. */
async function lire(page: Page) {
  return page.evaluate(async () => {
    const { getActiveChart } = await new Function("return import('/src/chart/drawing.ts')")();
    const chart = getActiveChart();
    const ref = (window as unknown as { grapheAvant?: unknown }).grapheAvant;
    const candle = chart.getStyles().candle;
    const couleur = getComputedStyle(document.documentElement).getPropertyValue("--serie-1").trim();
    const rgb = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16));
    let pixelsCourbe = 0;
    for (const canvas of chart.getDom("candle_pane", "main").querySelectorAll("canvas") as NodeListOf<HTMLCanvasElement>) {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]! > 200 && rgb.every((c, k) => Math.abs(c - pixels[i + k]!) < 4)) pixelsCourbe++;
    }
    let pixelsTextePrix = 0;
    for (const canvas of chart.getDom("candle_pane", "yAxis").querySelectorAll("canvas") as NodeListOf<HTMLCanvasElement>) {
      const p = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < p.length; i += 4) if (p[i]! > 245 && p[i + 1]! > 245 && p[i + 2]! > 245 && p[i + 3]! > 200) pixelsTextePrix++;
    }
    const indicateurs = [...chart.getIndicatorByPaneId().values()].flatMap((m) => [...(m as Map<string, { result: unknown[] }>).values()]);
    return { memeInstance: !ref || chart === ref, type: candle.type, fond: candle.area.backgroundColor,
      pixelsCourbe, pixelsTextePrix, lissage: candle.area.smooth, anime: candle.area.point.animation, barSpace: chart.getBarSpace(),
      range: chart.getVisibleRange(), count: chart.getDataList().length,
      dessin: chart.getOverlayById("preuve-rendu")?.points,
      indicateurs: indicateurs.filter((i) => i.result.length > 0).length };
  });
}

for (const largeur of [390, 1280]) {
  test(`${largeur}px : Bougies, Courbe et Aire conservent dessin, données, zoom et indicateurs ; footprint réversible`, async ({ page }, info) => {
    await page.setViewportSize({ width: largeur, height: largeur === 390 ? 844 : 900 });
    const requetes = await preparer(page);
    await page.evaluate(async () => {
      const [{ getActiveChart }, { indicatorsStore }] = await new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/indicators.ts')])")();
      indicatorsStore.getState().add("ema"); indicatorsStore.getState().add("rsi");
      const chart = getActiveChart();
      chart.setBarSpace(12);
      chart.scrollByDistance(90);
      const c = chart.getDataList().at(-20);
      chart.createOverlay({ name: "horizontalStraightLine", id: "preuve-rendu", points: [{ timestamp: c.timestamp, value: c.close }] });
      (window as unknown as { grapheAvant: unknown }).grapheAvant = chart;
    });
    await expect.poll(async () => (await lire(page)).indicateurs).toBeGreaterThanOrEqual(2);
    const avant = await lire(page);
    const n = requetes();
    const commandes = page.getByRole("group", { name: "Commandes du graphique 1", exact: true });
    for (const [label, type] of [["Courbe", "area"], ["Aire", "area"], ["Bougies", "candle_solid"]] as const) {
      await commandes.getByRole("button", { name: label, exact: true }).tap();
      await expect.poll(async () => (await lire(page)).type).toBe(type);
      if (type === "area") await expect.poll(async () => (await lire(page)).pixelsCourbe).toBeGreaterThan(40);
      const apres = await lire(page);
      expect(apres).toMatchObject({ memeInstance: true, count: avant.count, barSpace: avant.barSpace, range: avant.range, dessin: avant.dessin, indicateurs: avant.indicateurs });
      expect(requetes()).toBe(n);
      if (label === "Courbe") expect(apres.fond).toBe("transparent");
      if (label === "Aire") expect(Array.isArray(apres.fond)).toBe(true);
      expect(apres.lissage).toBe(false); expect(apres.anime).toBe(false);
    }
    await commandes.getByRole("button", { name: "Aire", exact: true }).tap();
    await page.evaluate(async () => (await new Function("return import('/src/store/orderflow.ts')")()).orderflowStore.getState().setEnabled(true));
    await expect(page.getByText(/Footprint : bougies/)).toBeVisible();
    await expect.poll(async () => (await lire(page)).type).toBe("candle_solid");
    await expect(commandes.getByRole("button", { name: "Aire", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(async () => (await new Function("return import('/src/store/orderflow.ts')")()).orderflowStore.getState().setEnabled(false));
    await expect.poll(async () => (await lire(page)).type).toBe("area");
    await expect.poll(async () => (await lire(page)).pixelsCourbe).toBeGreaterThan(40);
    expect((await lire(page)).dessin).toEqual(avant.dessin);
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: info.outputPath(`courbe-${largeur}.png`) });
    // La preuve de conservation ci-dessus garde un cadrage ancien où le dernier prix
    // peut être hors axe. Cette seconde capture contrôle sa lisibilité au présent.
    await page.evaluate(async () => (await new Function("return import('/src/chart/drawing.ts')")()).getActiveChart().scrollToRealTime());
    // Régression WebKit DPR3 : les chiffres du dernier prix doivent être peints,
    // pas seulement leur fond vert (60,031.61 mesure 54,48 px avec la police sombre).
    expect(await page.evaluate(() => devicePixelRatio)).toBe(3);
    await expect.poll(async () => (await lire(page)).pixelsTextePrix).toBeGreaterThan(40);
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    await page.screenshot({ path: info.outputPath(`aire-dernier-prix-${largeur}.png`) });

  });
}

test("commandes de la seconde vue : unité et rendu locaux, rotation sans perte d’identité", async ({ page }) => {
  await preparer(page);
  await page.getByRole("button", { name: "Vues ▾", exact: true }).tap();
  await page.getByRole("button", { name: "Deux côte à côte", exact: true }).click();
  await page.getByRole("button", { name: /^Vue 2 : ETHUSDT/ }).tap();
  await expect(page.locator('[data-chart-slot="1"] [data-chart-status]')).toHaveCount(0);
  const vue = page.locator('[data-chart-slot="1"]');
  await vue.getByRole("combobox", { name: "Timeframe du slot" }).selectOption("5m");
  await expect(vue.locator("[data-chart-status]")).toHaveCount(0);
  await vue.getByRole("button", { name: "Courbe", exact: true }).tap();
  await expect.poll(async () => (await lire(page)).type).toBe("area");
  for (const size of [{ width: 844, height: 390 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect(vue.getByRole("combobox", { name: "Timeframe du slot" })).toHaveValue("5m");
    await expect(vue.getByRole("button", { name: "Courbe", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  const maitre = await page.evaluate(async () => (await new Function("return import('/src/store/market.ts')")()).marketStore.getState().timeframe);
  expect(maitre).toBe("1m");
  await page.getByRole("button", { name: /^Vue 1 : BTCUSDT/ }).tap();
  await expect.poll(async () => (await lire(page)).type).toBe("candle_solid");
});

test("footprint conservé : les sources sans trades restent libres de choisir Courbe et Aire", async ({ page }) => {
  await preparer(page);
  await page.route("**/tdapi/time_series*", (route) => route.fulfill({ json: { status: "ok", values: Array.from({ length: 100 }, (_, i) => ({
    datetime: new Date(FIN - (99 - i) * 60_000).toISOString().replace("T", " ").slice(0, 19),
    open: `${200 + i}`, high: `${202 + i}`, low: `${199 + i}`, close: `${201 + i}`, volume: "10",
  })) } }));
  const commandes = page.getByRole("group", { name: "Commandes du graphique 1", exact: true });
  await commandes.getByRole("button", { name: "Aire", exact: true }).tap();
  await page.evaluate(async () => (await new Function("return import('/src/store/orderflow.ts')")()).orderflowStore.getState().setEnabled(true));
  await expect.poll(async () => (await lire(page)).type).toBe("candle_solid");
  const changer = (exchange: string, symbol: string) => page.evaluate(async ({ exchange, symbol }) => {
    (await new Function("return import('/src/store/market.ts')")()).marketStore.getState().setMarket({ exchange, symbol, timeframe: "1m" });
  }, { exchange, symbol });
  for (const [exchange, symbol] of [["twelvedata", "GLD"], ["synthetic", "binance:BTCUSDT|/|binance:ETHUSDT"]]) {
    await changer(exchange!, symbol!);
    await expect.poll(() => page.evaluate(async () => {
      const s = (await new Function("return import('/src/store/market.ts')")()).marketStore.getState();
      return `${s.exchange}:${s.dataLoad.status}`;
    })).toBe(`${exchange}:ready`);
    for (const label of ["Courbe", "Aire"]) {
      await commandes.getByRole("button", { name: label, exact: true }).tap();
      await expect.poll(async () => (await lire(page)).pixelsCourbe).toBeGreaterThan(40);
      await expect(page.getByText(/Footprint : bougies/)).toHaveCount(0);
    }
  }
  await changer("binance", "BTCUSDT");
  await expect.poll(async () => (await lire(page)).type).toBe("candle_solid");
  await expect(commandes.getByRole("button", { name: "Aire", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Footprint : bougies/)).toBeVisible();
});

test("replay en pause : changer le rendu conserve le curseur et les bougies causales", async ({ page }) => {
  const requetes = await preparer(page);
  await page.evaluate(async (curseur) => {
    const { replayStore } = await new Function("return import('/src/store/replay.ts')")();
    replayStore.setState({ symbole: "BTCUSDT", jour: "2026-09-28", tf: "1m",
      statut: { etat: "pret", symbole: "BTCUSDT", jour: "2026-09-28" } });
    replayStore.getState().start();
    replayStore.getState().seek(curseur);
  }, FIN);
  const etat = () => page.evaluate(async () => {
    const [{ replayStore }, { getActiveChart }] = await new Function("return Promise.all([import('/src/store/replay.ts'), import('/src/chart/drawing.ts')])")();
    const r = replayStore.getState();
    const candles = getActiveChart().getDataList();
    return { active: r.active, playing: r.playing, gen: r.gen, curseur: r.curseur,
      count: candles.length, dernier: candles.at(-1)?.timestamp };
  });
  await expect.poll(async () => (await etat()).dernier).toBe(FIN - 60_000);
  const avant = await etat();
  expect(avant).toMatchObject({ active: true, playing: false, curseur: FIN });
  const n = requetes();
  for (const mode of ["Courbe", "Aire"]) {
    await page.getByRole("group", { name: "Commandes du graphique 1", exact: true }).getByRole("button", { name: mode, exact: true }).tap();
    await expect.poll(async () => (await lire(page)).pixelsCourbe).toBeGreaterThan(40);
    expect(await etat()).toEqual(avant);
    expect(requetes()).toBe(n);
  }
  await page.evaluate(async () => (await new Function("return import('/src/store/replay.ts')")()).replayStore.getState().stop());
  await expect.poll(async () => (await etat()).dernier).toBe(FIN);
  await expect.poll(async () => (await lire(page)).type).toBe("area");
  expect((await etat()).active).toBe(false);
});
