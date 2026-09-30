import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const SYMBOLES = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

/** Données déterministes, y compris le catalogue utilisé par la recherche tactile. */
async function preparer(page: Page, onboarding = true): Promise<void> {
  await bouchonnerReseau(page);
  if (onboarding) await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
  await page.route("**/api.binance.com/api/v3/exchangeInfo*", (route) => route.fulfill({ json: {
    symbols: SYMBOLES.map((symbol) => ({ symbol, status: "TRADING", baseAsset: symbol.slice(0, -4), quoteAsset: "USDT", isSpotTradingAllowed: true, permissions: ["SPOT"] })),
  } }));
  await page.route("**/api.binance.com/api/v3/klines*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const slot = Math.max(0, SYMBOLES.indexOf(params.get("symbol") ?? ""));
    const pas = ({ "1m": 60_000, "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 } as Record<string, number>)[params.get("interval") ?? "1m"] ?? 60_000;
    const fin = Date.UTC(2026, 8, 28, 12);
    const endTime = Number(params.get("endTime") ?? Infinity);
    const lignes = Array.from({ length: 1000 }, (_, index) => {
      const t = fin - (999 - index) * pas;
      const o = [60_000, 3_000, 150, 500][slot]! + index * 0.1;
      return [t, String(o), String(o + 2), String(o - 1), String(o + 1), "10", t + pas - 1, "1000", 4, "5", "500", "0"];
    }).filter((ligne) => Number(ligne[0]) <= endTime).slice(-Number(params.get("limit") ?? 500));
    return route.fulfill({ json: lignes });
  });
}

const navigation = (page: Page) => page.getByRole("navigation", { name: "Navigation du terminal" });
const menuMobile = (page: Page) => page.locator(".axiom-mobile-menu-root").last();

async function ouvrirFonction(page: Page, mnemonic: string): Promise<void> {
  const nav = navigation(page);
  await (await nav.isVisible() ? nav : page.getByRole("banner")).getByRole("button", { name: "Fonctions", exact: true }).tap();
  await page.getByRole("menuitem", { name: new RegExp(`^${mnemonic}\\b`) }).tap();
}

/** Vérifie un contrôle réellement visible et entièrement atteignable sans scroll horizontal. */
async function dansEcran(page: Page, element: Locator): Promise<void> {
  await expect(element).toBeVisible();
  const box = await element.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function etatChart(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/chart-layout.ts')])");
    const [dessin, layout] = await importer();
    const chart = dessin.getActiveChart();
    const state = layout.chartLayoutStore.getState();
    const box = chart?.getDom("candle_pane", "main")?.getBoundingClientRect();
    return { focus: state.focus as number, layout: state.layout as string,
      symbols: state.slots.map((slot: { symbol: string }) => slot.symbol) as string[],
      slotDessin: chart?.getDom()?.closest("[data-chart-slot]")?.getAttribute("data-chart-slot") as string | null,
      count: (chart?.getDataList().length ?? 0) as number,
      from: chart?.getVisibleRange().from as number | undefined,
      overlays: (chart?._chartStore.getOverlayStore().getInstances() ?? []).filter((o: { name: string }) => o.name === "horizontalStraightLine").length as number,
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null };
  });
}

test("320 px : Fonctions ouvre, réduit, restaure et ferme une fenêtre", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await preparer(page);
  await page.goto("/");
  await ouvrirFonction(page, "DATA"); // dernière section : nécessite de parcourir le menu.
  const window = page.getByRole("complementary", { name: "Sources de données" });
  await dansEcran(page, window.getByTitle("Fermer", { exact: true }));
  await window.getByTitle("Réduire", { exact: true }).tap();
  await expect(window).not.toBeVisible();
  await page.getByRole("toolbar", { name: "Fenêtres ouvertes" }).getByRole("button", { name: /^DATA / }).tap();
  await expect(window).toBeVisible();
  await window.getByTitle("Fermer", { exact: true }).tap();
  await expect(window).toHaveCount(0);
  await expect(navigation(page)).toBeVisible();
});

test("Notes conserve un brouillon en passant à une autre fenêtre", async ({ page }) => {
  await preparer(page);
  await page.goto("/");
  await ouvrirFonction(page, "NOTE");
  const note = page.getByPlaceholder(/^Note \(markdown/);
  await note.fill("Brouillon téléphone à conserver");
  await ouvrirFonction(page, "ECO");
  await expect(note).not.toBeVisible();
  await page.getByRole("toolbar", { name: "Fenêtres ouvertes" }).getByRole("button", { name: /^NOTE / }).tap();
  await expect(note).toHaveValue("Brouillon téléphone à conserver");
  await expect(note).toBeVisible();
});

test("Panneaux : watchlist, création et suppression confirmée d’une alerte", async ({ page }) => {
  await preparer(page);
  await page.goto("/");
  await navigation(page).getByRole("button", { name: "Panneaux", exact: true }).tap();
  const aside = page.getByRole("dialog", { name: "Panneaux du terminal" });
  await expect(aside.getByRole("button", { name: /^Watchlist/ })).toBeVisible();
  await aside.getByRole("button", { name: /^Alertes/ }).first().tap();
  await aside.getByPlaceholder("Niveau", { exact: true }).fill("123456");
  await aside.getByRole("button", { name: /^Ajouter sur/ }).tap();
  await expect(aside.getByText("Prix franchit 123456 à la hausse")).toBeVisible();
  await aside.getByRole("button", { name: "Supprimer l'alerte BTCUSDT", exact: true }).tap();
  await aside.getByRole("button", { name: "Confirmer la suppression de l'alerte BTCUSDT", exact: true }).tap();
  await expect(aside.getByText("Prix franchit 123456 à la hausse")).toHaveCount(0);
  await aside.getByRole("button", { name: "Fermer les panneaux" }).tap();
  await expect(aside).not.toBeVisible();
});

test("Options : ajouter un indicateur puis parcourir et fermer les stratégies au toucher", async ({ page }) => {
  await preparer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Options", exact: true }).tap();
  await page.getByRole("button", { name: /^Indicateurs/ }).tap();
  await menuMobile(page).getByPlaceholder(/^Rechercher/).fill("EMA");
  await menuMobile(page).getByRole("button", { name: "Ajouter EMA", exact: true }).tap();
  await menuMobile(page).getByRole("button", { name: "Fermer Indicateurs" }).tap();
  await page.getByRole("button", { name: /^Stratégies/ }).tap();
  await menuMobile(page).getByPlaceholder(/^Rechercher/).fill("squeeze");
  await expect(menuMobile(page).getByText(/squeeze/i).last()).toBeVisible();
  await menuMobile(page).getByRole("button", { name: "Fermer Stratégies" }).tap();
  await page.getByRole("button", { name: "Fermer les options" }).tap();
  await expect(page.getByRole("button", { name: /^Indicateurs \(1\)/ })).toBeVisible();
});

test("320 px : recherche d’actif et constructeur SYN restent utilisables", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await preparer(page);
  await page.goto("/");
  await page.getByRole("combobox", { name: /rechercher/i }).tap();
  await menuMobile(page).getByRole("combobox", { name: /rechercher/i }).fill("ETHUSDT");
  await menuMobile(page).getByRole("option", { name: /^ETHUSDT/ }).first().tap();
  await expect(page.locator("[data-chart-banner]")).toContainText("ETHUSDT");
  await page.getByRole("button", { name: "SYN", exact: true }).tap();
  await menuMobile(page).getByRole("textbox", { name: "Jambe A" }).fill("BTCUSDT");
  await menuMobile(page).getByRole("textbox", { name: "Jambe B" }).fill("ETHUSDT");
  await menuMobile(page).getByRole("button", { name: "Charger", exact: true }).scrollIntoViewIfNeeded();
  await dansEcran(page, menuMobile(page).getByRole("button", { name: "Charger", exact: true }));
  await menuMobile(page).getByRole("button", { name: "Charger", exact: true }).tap();
  await expect(page.locator("[data-chart-banner]")).toContainText("BTCUSDT / ETHUSDT");
});

test("ratios : le menu de comparaison et les statistiques se referment sans couvrir le graphe", async ({ page }) => {
  await preparer(page);
  await page.goto("/");
  await expect(page.locator('[data-chart-status]')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Détails du marché et ratios" }).tap();
  await page.getByRole("button", { name: "Choisir l'actif de comparaison", exact: true }).tap();
  await menuMobile(page).getByRole("menuitem", { name: /÷SOL/ }).tap();
  await expect(page.locator("[data-chart-banner]")).toContainText("BTCUSDT / SOLUSDT");
  await expect(page.locator('[data-chart-status]')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Détails du marché et ratios" }).tap();
  await expect(page.getByRole("button", { name: "Détails du marché et ratios" })).toHaveAttribute("aria-expanded", "false");
});

test("quatre vues : focus dessin, instruments et disposition conservés entre portrait, paysage et bureau", async ({ page }, testInfo) => {
  await preparer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Vues ▾", exact: true }).tap();
  await page.locator("#chart-grid-controls").getByRole("button", { name: "Grille 2×2", exact: true }).tap();
  await page.getByRole("button", { name: /^Vue 3 :/ }).tap();
  await expect.poll(async () => (await etatChart(page)).count).toBeGreaterThan(0);
  const avant = await etatChart(page);
  expect(avant).toMatchObject({ focus: 2, layout: "2x2", slotDessin: "2", symbols: ["ETHUSDT", "SOLUSDT", "BNBUSDT"] });
  await navigation(page).getByRole("button", { name: "Dessins", exact: true }).tap();
  await page.getByRole("button", { name: /^Ligne horizontale/ }).tap();
  const box = (await etatChart(page)).box!;
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect.poll(async () => (await etatChart(page)).overlays).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("axiom:drawings:v1") ?? "{}");
    return saved["2:binance:SOLUSDT"]?.length ?? 0;
  })).toBe(1);
  for (const viewport of [{ width: 844, height: 390 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await etatChart(page)).slotDessin).toBe("2");
    const apres = await etatChart(page);
    expect(apres).toMatchObject({ layout: "2x2", symbols: avant.symbols, overlays: 1 });
    if (viewport.width === 844) await page.screenshot({ path: testInfo.outputPath("graphe-paysage.png") });
  }
  await expect(page.locator('[data-chart-slot="2"]')).toBeVisible();
  await expect(page.locator('[data-chart-slot="0"]')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("graphe-portrait.png") });
});

test("le glissement tactile déplace réellement les bougies du graphique", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Le geste multipoint natif utilise CDP ; WebKit couvre les taps et rotations.");
  await preparer(page);
  await page.goto("/");
  await expect.poll(async () => (await etatChart(page)).count).toBeGreaterThan(0);
  const avant = await etatChart(page);
  const box = avant.box!;
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width * 0.4;
  const y = box.y + box.height * 0.65;
  // Dépasser la marge droite initiale (80 px) : `from` reste borné tant qu'elle
  // est visible. Le geste finit à 80 % du pane, toujours dans le canvas.
  const distance = box.width * 0.4;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) await session.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: [{ x: x + distance * step / 8, y }],
  });
  // Vérifier le pan doigt posé, sans dépendre de l'inertie après relâchement.
  await expect.poll(async () => (await etatChart(page)).from).toBeLessThan(avant.from!);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
});

test("les fenêtres retrouvent leur géométrie bureau après un aller-retour téléphone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await preparer(page);
  await page.goto("/");
  await ouvrirFonction(page, "NOTE");
  const geometrie = () => page.evaluate(async () => {
    const importer = new Function("return import('/src/store/windowManager.ts')");
    const w = (await importer()).windowManagerStore.getState().windows.notes;
    return { x: w.x, y: w.y, width: w.width, height: w.height };
  });
  const avant = await geometrie();
  await page.setViewportSize({ width: 320, height: 740 });
  const window = page.getByRole("complementary", { name: "Notes / journal" });
  await dansEcran(page, window.getByTitle("Fermer", { exact: true }));
  expect(await geometrie()).toEqual(avant);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(geometrie).toEqual(avant);
});

test("Réglages, recherche de commande et onboarding sont fermables au toucher", async ({ page }) => {
  await preparer(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Passer l'onboarding" }).tap();
  await navigation(page).getByRole("button", { name: "Réglages", exact: true }).tap();
  await page.getByPlaceholder("Clé API Twelve Data", { exact: true }).fill("clé-factice-test-local");
  await page.getByRole("button", { name: "Fermer les réglages" }).tap();
  await expect(page.getByRole("dialog", { name: "Réglages", exact: true })).not.toBeVisible();
  await navigation(page).getByRole("button", { name: "Recherche", exact: true }).tap();
  await page.getByRole("textbox", { name: "Saisie de commande" }).fill("NOTE");
  await dansEcran(page, page.getByRole("button", { name: "Fermer les commandes" }));
  await page.getByRole("button", { name: "Fermer les commandes" }).tap();
  await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toHaveCount(0);
});
