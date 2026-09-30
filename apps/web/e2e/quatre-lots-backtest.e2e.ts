import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";

const INSTANT = Date.parse("2026-09-10T00:00:00Z");
const HEURE = 3_600_000;
const CLE = "axiom:backtest:history:v1";

async function ouvrirBT(page: Page) {
  await expect(page.getByRole("button", { name: /^Indicateurs/ })).toBeVisible();
  const fenetre = page.getByRole("complementary", { name: "Backtest" });
  if (!(await fenetre.isVisible())) {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder(/^Commande/).fill("BT");
    await page.keyboard.press("Enter");
  }
  return fenetre;
}

function bougies() {
  return Array.from({ length: 80 }, (_, i) => {
    const temps = INSTANT - (80 - i) * HEURE;
    const close = 100 + 20 * Math.sin(i * Math.PI / 4);
    const open = 100 + 20 * Math.sin((i - 1) * Math.PI / 4);
    return [temps, String(open), String(Math.max(open, close) + 1), String(Math.min(open, close) - 1),
      String(close), "100", temps + HEURE - 1, "10000", 50, "55", "5500", "0"];
  });
}

test.beforeEach(async ({ page }) => {
  await bouchonnerReseau(page);
  await page.clock.install({ time: INSTANT });
  await page.clock.setFixedTime(INSTANT);
  await page.addInitScript(() => localStorage.setItem("axiom:onboarding:v1", JSON.stringify({ completed: true, step: 0 })));
});

test("snapshot du run, versions complètes et comparaison après rechargement", async ({ page }) => {
  let premier = true;
  let liberer!: () => void;
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  await page.route("**/api.binance.com/api/v3/klines*", async (route) => {
    if (premier && new URL(route.request().url()).searchParams.get("limit") === "1000") { premier = false; await attente; }
    await route.fulfill({ json: bougies() });
  });
  await page.goto("/");
  const bt = await ouvrirBT(page);
  await bt.getByRole("button", { name: "Croisement EMA 9/21" }).click();
  await bt.getByRole("button", { name: "Ouvrir versions et historique" }).click();
  await bt.getByLabel("Nom de version complète").fill("Base BTC");
  await bt.getByRole("button", { name: "Sauver version" }).click();
  await bt.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(bt.getByText("Chargement de l'historique…", { exact: true })).toBeVisible();
  await bt.getByLabel("Symbole", { exact: true }).fill("ETHUSDT");
  await bt.getByLabel("Capital initial").fill("20000");
  liberer();
  await expect(bt.getByText("Terminé", { exact: true })).toBeVisible();
  await expect(bt).toContainText("BTCUSDT · 1h · 6 mois");
  await expect(bt).toContainText("La configuration a changé depuis ce run");
  const archive1 = await page.evaluate((cle) => JSON.parse(localStorage.getItem(cle)!), CLE);
  expect(archive1.runs).toHaveLength(1);
  expect(archive1.runs[0].config.symbol).toBe("BTCUSDT");
  expect(archive1.runs[0].config.capitalInitial).toBe(10000);
  expect(archive1.runs[0].fenetreDemandee).toEqual({ debutMs: INSTANT - 182 * 86_400_000, finMs: INSTANT });
  expect(archive1.runs[0].donnees.nbBougies).toBe(80);
  expect(archive1.runs[0]).not.toHaveProperty("trades");
  expect(archive1.runs[0]).not.toHaveProperty("equity");

  await bt.getByRole("button", { name: "Charger", exact: true }).click();
  await expect(bt.getByLabel("Symbole", { exact: true })).toHaveValue("BTCUSDT");
  await expect(bt.getByLabel("Capital initial")).toHaveValue("10000");
  const apresRestauration = await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/backtest.ts')") as () => Promise<{
      backtestStore: { getState: () => unknown }; configCourante: (s: unknown) => unknown;
    }>;
    const module = await importer();
    const etat = module.backtestStore.getState() as { phase: string };
    return { config: module.configCourante(etat), phase: etat.phase };
  });
  expect(apresRestauration.config).toEqual(archive1.versions[0].config);
  expect(apresRestauration.phase).toBe("done");
  await bt.getByLabel("Frais en pourcentage").fill("0.1");
  await bt.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(bt.getByText("Terminé", { exact: true })).toBeVisible();
  await expect(bt.getByText("Runs réussis (2/50)")).toBeVisible();
  const archive2 = await page.evaluate((cle) => JSON.parse(localStorage.getItem(cle)!), CLE);
  expect(new Set(archive2.runs.map((r: { id: string }) => r.id)).size).toBe(2);

  await page.reload();
  const recharge = await ouvrirBT(page);
  await recharge.getByRole("button", { name: "Ouvrir versions et historique" }).click();
  await expect(recharge.getByText("Versions (1/50)")).toBeVisible();
  await expect(recharge.getByText("Runs réussis (2/50)")).toBeVisible();
  const ids = archive2.runs.map((r: { id: string }) => r.id);
  await recharge.getByLabel("Run A").selectOption(ids[0]);
  await recharge.getByLabel("Run B").selectOption(ids[1]);
  await expect(recharge).toContainText("Frais différents");
  await expect(recharge).toContainText("deltas B − A");
  const comparaison = recharge.getByLabel("Comparer deux runs BT").getByRole("table");
  await expect(comparaison).toContainText("EMA");
  await expect(comparaison).toContainText("2026");
  await expect(comparaison).not.toContainText('"type":"comparaison"');
});

test("bornes intrabar, fin réelle sans funding et comparaison des archives après rechargement", async ({ page }) => {
  const candles = Array.from({ length: 80 }, (_, i) => {
    const time = INSTANT - (80 - i) * HEURE;
    return [time, "100", i === 79 ? "150" : "100", i === 79 ? "50" : "100", "100", "100", time + HEURE - 1, "10000", 50, "55", "5500", "0"];
  });
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: candles }));
  await page.goto("/");
  const bt = await ouvrirBT(page);
  await page.evaluate(async () => {
    const { backtestStore } = await import("/src/store/backtest.ts");
    backtestStore.setState({
      symbol: "BTCUSDT", tf: "1h", modeFunding: "aucun", intrabar: true,
      direction: "long", tailleFixe: 1000, fraisPct: 0, slippagePct: 0,
      stopPct: 5, targetPct: null, stopAtr: null, risquePct: null,
      reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
      reglesSortie: [],
    });
  });
  await bt.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(bt.getByText("Terminé", { exact: true })).toBeVisible();
  await expect(bt.getByText("≤ -5.00%", { exact: true })).toHaveCount(2);
  await expect(bt.getByText("≥ +0.00%", { exact: true })).toHaveCount(2);
  await expect(bt).toContainText("1 trade à excursions partielles");
  const premiere = await page.evaluate((cle) => JSON.parse(localStorage.getItem(cle)!), CLE);
  expect(premiere.runs[0].stats.nbExcursionsPartielles).toBe(1);
  expect(premiere.runs[0].donnees.finDonneesMs).toBe(INSTANT);

  await page.evaluate(async () => {
    const { backtestStore } = await import("/src/store/backtest.ts");
    backtestStore.getState().setIntrabar(false);
  });
  await bt.getByRole("button", { name: "Lancer le backtest" }).click();
  await expect(bt.getByText("Terminé", { exact: true })).toBeVisible();
  const finReelle = await page.evaluate(async () => {
    const { backtestStore } = await import("/src/store/backtest.ts");
    const resultat = backtestStore.getState().resultat;
    return { dureeMs: resultat.trades[0].dureeMs, expositionPct: resultat.stats.expositionPct };
  });
  expect(finReelle.dureeMs).toBe(79 * HEURE);
  expect(finReelle.expositionPct).toBe(98.75);
  const archives = await page.evaluate((cle) => JSON.parse(localStorage.getItem(cle)!), CLE);
  expect(archives.runs).toHaveLength(2);
  const partiel = archives.runs.find((r: { stats: { nbExcursionsPartielles?: number } }) => r.stats.nbExcursionsPartielles === 1);
  const complet = archives.runs.find((r: { stats: { nbExcursionsPartielles?: number } }) => r.stats.nbExcursionsPartielles === undefined);
  expect(partiel).toBeDefined();
  expect(complet).toBeDefined();

  await page.reload();
  const recharge = await ouvrirBT(page);
  await recharge.getByRole("button", { name: "Ouvrir versions et historique" }).click();
  await recharge.getByLabel("Run A").selectOption(partiel.id);
  await recharge.getByLabel("Run B").selectOption(complet.id);
  await expect(recharge).toContainText("MAE/MFE : bornes confirmées, delta non calculable");
  const table = recharge.getByLabel("Comparaison des runs BT");
  await expect(table).toContainText("≤ -5.00");
  await expect(table).toContainText("≥ 0.00");
  for (const label of ["MAE %", "MFE %"]) {
    const ligne = table.getByText(label, { exact: true }).locator("../..");
    await expect(ligne).toContainText("—");
  }
});
