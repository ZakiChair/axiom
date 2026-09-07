import { test, expect, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Lot FRONT-DONNÉES — revue 2026-09-04.
 * Réseau entièrement bouchonné (helper parent) ; fixtures posées APRÈS (dernières gagnent).
 * Compteur : store réel (`marketStore`), pas d'attributs DOM de test en prod.
 */

const MINUTE = 60_000;
const MINUIT = Date.UTC(2026, 8, 2, 0, 0, 0, 0);
const VEILLE = MINUIT - 24 * 60 * MINUTE;
const PREMIER_INITIAL = MINUIT + (5 * 60 + 41) * MINUTE;
const LIMIT_INITIAL = 500;
const MANQUANTES_VWAP = 341;
const TOTAL_VWAP = LIMIT_INITIAL + MANQUANTES_VWAP;
const MANQUANTES_PIVOTS = 24 * 60;
const TOTAL_PIVOTS = TOTAL_VWAP + MANQUANTES_PIVOTS;

function tupleBinance(time: number): unknown[] {
  return [
    time,
    "100",
    "101",
    "99",
    "100.5",
    "10",
    time + MINUTE - 1,
    "1000",
    4,
    "5",
    "500",
    "0",
  ];
}

function serieBinance(debut: number, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => tupleBinance(debut + i * MINUTE));
}

type SnapshotBougies = { count: number; first: number | undefined };

async function lireBougiesStore(page: Page): Promise<SnapshotBougies> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/market.ts')") as () => Promise<{
      marketStore: { getState: () => { candles: Array<{ time: number }> } };
    }>;
    const mod = await importer();
    const candles = mod.marketStore.getState().candles;
    const premier = candles[0];
    return { count: candles.length, first: premier?.time };
  });
}

async function attendreCompte(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await lireBougiesStore(page)).count, { timeout: 20_000 })
    .toBe(count);
}

async function attendrePremiere(page: Page, first: number): Promise<void> {
  await expect
    .poll(async () => (await lireBougiesStore(page)).first, { timeout: 20_000 })
    .toBe(first);
}

async function bouchonnerFixtures(page: Page): Promise<void> {
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit") ?? LIMIT_INITIAL);
    const endRaw = url.searchParams.get("endTime");
    if (endRaw === null) {
      await route.fulfill({ json: serieBinance(PREMIER_INITIAL, Math.min(limit, LIMIT_INITIAL)) });
      return;
    }
    const endTime = Number(endRaw);
    if (!Number.isFinite(endTime)) {
      await route.fulfill({ json: [] });
      return;
    }
    const lastOpen = Math.floor(endTime / MINUTE) * MINUTE;
    if (lastOpen < VEILLE) {
      await route.fulfill({ json: [] });
      return;
    }
    const n = Math.min(limit, Math.floor((lastOpen - VEILLE) / MINUTE) + 1);
    if (n <= 0) {
      await route.fulfill({ json: [] });
      return;
    }
    const debut = lastOpen - (n - 1) * MINUTE;
    await route.fulfill({ json: serieBinance(debut, n) });
  });

  await page.route("**/api.kraken.com/0/public/OHLC*", async (route) => {
    const openSec = Math.floor(MINUIT / 1000);
    await route.fulfill({
      json: {
        error: [],
        result: {
          XBTUSDT: [
            [openSec, "100", "101", "99", "100.5", "100.2", "10", 4],
            [openSec + 60, "100.5", "102", "100", "101", "100.8", "12", 5],
          ],
          last: openSec + 60,
        },
      },
    });
  });
}

async function sauterOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "axiom:onboarding:v1",
      JSON.stringify({ completed: true, step: 0 }),
    );
  });
}

/** Catalogue : « ＋ VWAP prix » puis « ＋ VWAP 1 prix » une fois l'instance posée. */
function boutonVwapCatalogue(page: Page) {
  return page.getByRole("button", { name: /^＋\s*VWAP(\s+\d+)?\s+prix/ });
}

function boutonPivotStandardCatalogue(page: Page) {
  return page.getByRole("button", { name: /^＋\s*Pivot Points Standard(\s+\d+)?\s+prix/ });
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await bouchonnerFixtures(page);
  await sauterOnboarding(page);
});

test("VWAP à chaud : 500 bougies dès 05:41 UTC → 841 dès minuit, sans rechargement", async ({
  page,
}) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.goto("/");
  await attendreCompte(page, LIMIT_INITIAL);
  await attendrePremiere(page, PREMIER_INITIAL);
  const navApresBoot = navigations;

  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/CVD, RVOL/).fill("VWAP");
  await boutonVwapCatalogue(page).click();

  await attendreCompte(page, TOTAL_VWAP);
  await attendrePremiere(page, MINUIT);
  expect(navigations).toBe(navApresBoot);
});

test("ré-ajout VWAP : aucune nouvelle requête d'historique (idempotence)", async ({ page }) => {
  const historiques: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v3/klines") && req.url().includes("endTime=")) {
      historiques.push(req.url());
    }
  });

  await page.goto("/");
  await attendreCompte(page, LIMIT_INITIAL);

  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/CVD, RVOL/).fill("VWAP");
  await boutonVwapCatalogue(page).click();
  await attendreCompte(page, TOTAL_VWAP);
  const apresPremier = historiques.length;
  expect(apresPremier).toBeGreaterThan(0);

  await boutonVwapCatalogue(page).click();
  await new Promise((r) => setTimeout(r, 1500));
  expect(historiques.length).toBe(apresPremier);
});

test("VWAP puis pivots : veille entière, store réel, sans rechargement", async ({ page }) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.goto("/");
  await attendreCompte(page, LIMIT_INITIAL);
  const navApresBoot = navigations;

  await page.getByRole("button", { name: /^Indicateurs/ }).click();
  await page.getByPlaceholder(/CVD, RVOL/).fill("VWAP");
  await boutonVwapCatalogue(page).click();
  await attendreCompte(page, TOTAL_VWAP);
  await attendrePremiere(page, MINUIT);

  await page.getByPlaceholder(/CVD, RVOL/).fill("Pivot Points Standard");
  await boutonPivotStandardCatalogue(page).click();
  await attendreCompte(page, TOTAL_PIVOTS);
  await attendrePremiere(page, VEILLE);
  expect(navigations).toBe(navApresBoot);
});

test("limite Kraken visible (PARTIAL) après chargement", async ({ page }) => {
  await page.goto("/");
  await attendreCompte(page, LIMIT_INITIAL);

  await page.getByLabel("Source").selectOption("kraken");
  const badge = page.locator('[data-chart-status="partial"]');
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await expect(badge).toContainText(/720/);
});

test("watchlist : BTCUSDT / ETHUSDT / SOLUSDT lisibles en entier à 1440 px (sidebar 240)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await attendreCompte(page, LIMIT_INITIAL);

  const aside = page.locator("aside");
  await expect(aside).toHaveCSS("width", "240px");
  for (const symbole of ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const) {
    const el = aside.getByText(symbole, { exact: true });
    await expect(el).toBeVisible();
    const marges = await el.evaluate((node) => {
      const texte = node.getBoundingClientRect();
      const panneau = node.closest("aside")!.getBoundingClientRect();
      return { gauche: texte.left - panneau.left, droite: panneau.right - texte.right };
    });
    expect(marges.gauche, `${symbole} déborde à gauche`).toBeGreaterThanOrEqual(0);
    expect(marges.droite, `${symbole} déborde à droite`).toBeGreaterThanOrEqual(0);
  }
  // Les actions hors flux restent utilisables sans souris.
  await aside.getByRole("button", { name: "BTCUSDT", exact: true }).focus();
  const retirer = aside.getByRole("button", { name: "Retirer BTCUSDT" });
  await expect(retirer).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(retirer).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(aside.getByText("BTCUSDT", { exact: true })).toHaveCount(0);
});
