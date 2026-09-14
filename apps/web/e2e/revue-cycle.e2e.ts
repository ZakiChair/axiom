import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Revue CYCLE, hermétique : historique PriceUSD synthétique (interpolation log-linéaire
 * quotidienne entre prix réels Coin Metrics à 00:00 UTC), BGeometrics et mempool bouchonnés.
 * Correctif A : sommet d'un cycle clos cherché avant son creux baissier.
 * Correctif B : MVRV Z-Score BGeometrics seul, aucune requête Coin Metrics hors PriceUSD.
 */
test.use({ timezoneId: "Europe/Paris" });

const JOUR_MS = 86_400_000;
const ANCRES: readonly (readonly [string, number])[] = [
  ["2010-07-18", 0.09], ["2012-11-28", 12.35], ["2013-12-04", 1_134.93], ["2015-01-14", 175.64],
  ["2016-07-09", 650], ["2017-12-16", 19_640.51], ["2018-12-15", 3_185], ["2020-05-11", 8_600],
  ["2021-11-08", 67_541.76], ["2022-11-09", 15_758], ["2024-03-13", 73_081.58], ["2024-04-20", 64_000],
  ["2025-10-06", 124_824.45], ["2026-06-30", 58_525.08], ["2026-09-13", 76_759.26],
];

/** Lignes Coin Metrics `{ asset, time, PriceUSD }` (5 902 jours, 2010-07-18 → 2026-09-13). */
function lignesPriceUsd(): Record<string, string>[] {
  const lignes: Record<string, string>[] = [];
  const ancres = ANCRES.map(([d, p]) => [Date.parse(`${d}T00:00:00Z`), p] as const);
  for (let k = 0; k < ancres.length - 1; k += 1) {
    const [t0, p0] = ancres[k]!;
    const [t1, p1] = ancres[k + 1]!;
    const n = Math.round((t1 - t0) / JOUR_MS);
    for (let i = 0; i < n; i += 1) {
      const prix = Math.exp(Math.log(p0) + ((Math.log(p1) - Math.log(p0)) * i) / n);
      lignes.push({ asset: "btc", time: new Date(t0 + i * JOUR_MS).toISOString(), PriceUSD: String(prix) });
    }
  }
  const [tf, pf] = ancres[ancres.length - 1]!;
  lignes.push({ asset: "btc", time: new Date(tf).toISOString(), PriceUSD: String(pf) });
  return lignes;
}

async function commande(page: Page, texte: string): Promise<void> {
  await expect(page.getByRole("banner").getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/^Commande/).fill(texte);
  await page.keyboard.press("Enter");
}

/**
 * Bouchonne le réseau et sert PriceUSD ; renvoie les `metrics` Coin Metrics demandés. Les routes
 * posées ensuite par le test (BGeometrics) priment sur le bouchon.
 */
async function preparer(page: Page): Promise<string[]> {
  await bouchonnerReseau(page);
  await page.clock.setFixedTime(new Date("2026-09-14T12:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 }));
  });
  const metriquesCm: string[] = [];
  const lignes = lignesPriceUsd();
  await page.route("**/community-api.coinmetrics.io/**", async (route) => {
    const metriques = new URL(route.request().url()).searchParams.get("metrics") ?? "";
    metriquesCm.push(metriques);
    // Une demande de CapMVRVCur serait servie : un repli afficherait alors 1.70 au lieu de « — ».
    const data = metriques.split(",").includes("CapMVRVCur")
      ? lignes.map((l) => ({ ...l, CapMVRVCur: "1.7" }))
      : lignes;
    await route.fulfill({ json: { data, next_page_url: null } });
  });
  return metriquesCm;
}

async function ouvrirCycle(page: Page): Promise<Locator> {
  await page.goto("/");
  await commande(page, "CYCLE");
  return page.locator('[data-window-id="cycle"]');
}

/** Tuile inline par son libellé (le libellé et son badge partagent un conteneur). */
function tuile(fenetre: Locator, libelle: string): Locator {
  return fenetre.getByText(libelle).locator("..");
}

test("CYCLE : sommet du Cycle 2020 avant son creux, MVRV « — » sans requête Coin Metrics hors PriceUSD", async ({ page }) => {
  const metriquesCm = await preparer(page);
  const fenetre = await ouvrirCycle(page);
  const table = fenetre.getByRole("table", { name: "Cycles BTC" });

  // Correctif A : sommet 2021-11-08 (jour 546, ×7,85) et non l'ATH pré-halving du 2024-03-13 (jour 1402, ×8,50).
  const cycle2020 = table.getByRole("row").filter({ hasText: "Cycle 2020" });
  await expect(cycle2020).toContainText("08/11");
  await expect(cycle2020).toContainText("×7.9");
  await expect(cycle2020).toContainText("546 j");
  await expect(table.getByRole("row").filter({ hasText: "Cycle 2016" })).toContainText("16/12");
  await expect(table.getByRole("row").filter({ hasText: "Cycle 2012" })).toContainText("04/12");
  await expect(fenetre).not.toContainText("368/525/549/481");

  // Correctif B : BGeometrics en 503 → « — », sans badge de zone ni repli Coin Metrics.
  const mvrv = tuile(fenetre, "MVRV Z-Score");
  await expect(mvrv).toContainText("—");
  await expect(mvrv).not.toContainText("1.70");
  await expect(fenetre.getByText("MVRV (ratio)")).toHaveCount(0);
  expect(metriquesCm.length).toBeGreaterThan(0);
  expect(metriquesCm.every((m) => m === "PriceUSD")).toBe(true);
});

test("CYCLE : MVRV Z-Score BGeometrics à J-7 affiché avec la mention « embargo 7 j »", async ({ page }) => {
  const metriquesCm = await preparer(page);
  const requetesBg: string[] = [];
  await page.route("**/bgapi/v1/mvrv-zscore**", async (route) => {
    requetesBg.push(route.request().url());
    const unixTs = Date.UTC(2026, 8, 7) / 1000; // dernière observation accessible : J-7
    await route.fulfill({ json: [{ d: "2026-09-06", unixTs: unixTs - 86_400, mvrvZscore: 1.2 }, { d: "2026-09-07", unixTs, mvrvZscore: 1.23 }] });
  });
  const fenetre = await ouvrirCycle(page);

  const mvrv = tuile(fenetre, "MVRV Z-Score");
  await expect(mvrv).toContainText("1.23");
  await expect(mvrv).toContainText("neutre");
  await expect(mvrv).toContainText("embargo 7 j");
  expect(requetesBg).toHaveLength(1);
  expect(metriquesCm.every((m) => m === "PriceUSD")).toBe(true);
});
