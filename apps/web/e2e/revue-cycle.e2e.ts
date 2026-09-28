import { expect, test, type Locator, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

/**
 * Revue CYCLE, hermétique : historique PriceUSD synthétique (interpolation log-linéaire
 * quotidienne entre prix réels Coin Metrics à 00:00 UTC), BGeometrics et mempool bouchonnés.
 * Correctif A : sommet d'un cycle clos cherché avant son creux baissier.
 * Correctif B : MVRV Z-Score BGeometrics seul, aucune requête Coin Metrics hors PriceUSD.
 * Lot 5 : distance à l'ATH alignée sur le pic, comparée au même J+N depuis les pics passés.
 * Lot 6 : modèles de prix (multiple 200 semaines, prix / SMA 2 ans, Pi Cycle Bottom).
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

/** Tuile empilée par son libellé exact (libellé et badge en en-tête, valeur puis pied dessous). */
function tuileEmpilee(section: Locator, libelle: string): Locator {
  return section.getByText(libelle, { exact: true }).locator("../..");
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

test("CYCLE : distance à l'ATH alignée sur le pic et repli au même J+N depuis les pics passés", async ({ page }) => {
  await preparer(page);
  const fenetre = await ouvrirCycle(page);
  const table = fenetre.getByRole("table", { name: "Cycles BTC" });

  // Fixture : ATH 124 824,45 $ le 2025-10-06, dernier point 2026-09-13 (J+342), plus bas le 2026-06-30.
  const jours = tuile(fenetre, "Jours depuis l'ATH");
  await expect(jours).toContainText("342 j");
  await expect(jours).toContainText("2025-10-06");
  await expect(jours).toHaveAttribute("title", /124.824 \$ le 2025-10-06/);
  const repliMax = tuile(fenetre, "Repli max depuis l'ATH");
  await expect(repliMax).toContainText("-53.1 %");
  await expect(repliMax).toContainText("2026-06-30");

  // Colonne alignée sur le pic : même J+342 depuis 2013-12-04, 2017-12-16, 2021-11-08 ; cycle courant = repli actuel.
  await expect(table.getByRole("columnheader", { name: "Repli à J+342 post-pic" })).toBeVisible();
  const ligne = (cycle: string): Locator => table.getByRole("row").filter({ hasText: cycle });
  await expect(ligne("Cycle 2012")).toContainText("-79.2 %");
  await expect(ligne("Cycle 2016")).toContainText("-81.9 %");
  await expect(ligne("Cycle 2020")).toContainText("-74.3 %");
  await expect(ligne("Cycle 2024")).toContainText("-38.5 %");
  await expect(ligne("Cycle 2024")).toContainText("max -53.1 %");
  // Les 4 lignes tiennent sans défilement interne : la sous-ligne « max » ne coupe pas le cycle courant.
  const corps = table.getByRole("rowgroup");
  const hauteurs = await corps.evaluate((e) => ({ visible: e.clientHeight, contenu: e.scrollHeight }));
  expect(hauteurs.contenu).toBeLessThanOrEqual(hauteurs.visible + 1);

  // Aucune projection des cycles passés sur le courant ; le chart garde sa hauteur (le corps défile).
  await expect(fenetre).not.toContainText("fenêtre des planchers");
  expect((await fenetre.locator("canvas").boundingBox())!.height).toBeGreaterThanOrEqual(200);
});

test("CYCLE : modèles de prix (multiple 200 semaines, prix / SMA 2 ans, Pi Cycle Bottom) sans écraser le chart", async ({ page }) => {
  const metriquesCm = await preparer(page);
  const fenetre = await ouvrirCycle(page);
  const section = fenetre.locator("section").filter({ hasText: "Modèles de prix" });

  // Attendus calculés hors implémentation sur la fixture (e2e-attendus) : SMA 1 400 j, SMA 730 j,
  // EMA 150 j contre 0,745 × SMA 471 j ; la fixture produit un épisode synthétique en 2026.
  const multiple = tuileEmpilee(section, "Multiple 200 semaines");
  await expect(multiple).toContainText("1.10");
  await expect(multiple).toContainText("pct 24");
  await expect(multiple).toContainText("31 j au-dessus");
  await expect(multiple).toContainText("Prix / SMA 2 ans 0.84");
  await expect(multiple).toContainText("231 j en dessous");
  const pi = tuileEmpilee(section, "Pi Cycle Bottom");
  await expect(pi).toContainText("+2.8%");
  await expect(pi).toContainText("pas de signal");
  await expect(pi).toContainText("dernier signal 2026-07-05");
  await expect(section).toContainText("n = 4 signaux");
  await expect(section).toContainText("2022-07-26 → 2023-04-01");
  // Note tirée des épisodes : signal 2022 présent ; l'épisode du 2026-07-05 tombe 5 j après le plus bas.
  await expect(section).toContainText("celui de 2022 précédait le creux de 4 mois");
  await expect(section).not.toContainText("a pas été signalé");
  await expect(section).toContainText("ne prévoit");
  await expect(section).not.toContainText("5×");

  // Le chart garde sa hauteur malgré la section ; seules des requêtes PriceUSD vont à Coin Metrics.
  expect((await fenetre.locator("canvas").boundingBox())!.height).toBeGreaterThanOrEqual(200);
  expect(metriquesCm.length).toBeGreaterThan(0);
  expect(metriquesCm.every((m) => m === "PriceUSD")).toBe(true);
});

test.describe("à l'ouest d'UTC", () => {
  test.use({ timezoneId: "America/New_York" });

  test("CYCLE : date du sommet en UTC, identique à la note des pics quotidiens", async ({ page }) => {
    await preparer(page);
    const fenetre = await ouvrirCycle(page);
    const table = fenetre.getByRole("table", { name: "Cycles BTC" });
    const ligne = (cycle: string): Locator => table.getByRole("row").filter({ hasText: cycle });
    await expect(ligne("Cycle 2020")).toContainText("546 j");
    await expect(ligne("Cycle 2012")).toContainText("04/12");
    await expect(ligne("Cycle 2016")).toContainText("16/12");
    await expect(ligne("Cycle 2020")).toContainText("08/11");
    await expect(fenetre).toContainText("2013-12-04, 2017-12-16, 2021-11-08");
  });
});
