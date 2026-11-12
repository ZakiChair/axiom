import { expect, test, type Page } from "@playwright/test";
import { bouchonnerReseau } from "./helpers/reseau-bouchonne";
import { HORLOGE_AXIS_SR, preparerAxisSr } from "./helpers/axis-sr-telephone";
import { luEnEntier } from "./helpers/axis-alertes-telephone";

/**
 * Amorce du backtest au téléphone (BT-1, 12 novembre 2026). Cas de référence : BTCUSDT 4h,
 * 3 000 bougies de la fixture servies par une route qui respecte `endTime` et `limit`, date
 * figée par `figerDate` une demi-heure après la dernière clôture, AXIS persisté sur le graphe.
 *
 * Fonctions → BT → « AXIS confluence (4h) » → 3 mois → Lancer : les trades du run sont ceux
 * d'un suiveur de l'état d'AXIS lu sur le VRAI graphe (décision à la clôture, fill à
 * l'ouverture suivante), soit 4 sur cette fixture ; la note du run dit les bougies mesurées et
 * l'amorce, et se lit en entier à 390 puis 320 px, thème par défaut puis Bloomberg.
 *
 * Témoin : sur le code d'avant (calcul à froid de la plage seule), ce parcours reçoit 2 trades
 * pour 4 attendus. L'égalité avec le graphe tient sur cette fixture (961 bougies d'amorce côté
 * graphe, 1 500 côté BT) ; ce n'est pas une propriété générale.
 */
test.describe.configure({ timeout: 120_000 });

const JOUR = 86_400_000;
const NOTE = "539 bougies mesurées · BTCUSDT 4h · Binance spot · amorce 1500 bougies · référence BTCUSDT chargée (3000 bougies)";

interface Graphe { temps: number[]; etat: Array<number | null> }

/** Temps des bougies et état d'AXIS du VRAI graphe actif (sortie masquée `etat` de l'instance montée). */
async function lireGraphe(page: Page): Promise<Graphe | null> {
  return page.evaluate(async () => {
    const importer = new Function("return Promise.all([import('/src/chart/drawing.ts'), import('/src/store/indicators.ts')])") as () => Promise<[
      { getActiveChart: () => { getDataList: () => Array<{ timestamp: number }>; getIndicatorByPaneId: (pane: string, nom: string) => unknown } | null },
      { indicatorsStore: { getState: () => { indicators: Array<{ defId: string; instanceId: string }> } } },
    ]>;
    const [dessin, store] = await importer();
    const chart = dessin.getActiveChart();
    const instance = store.indicatorsStore.getState().indicators.find((i) => i.defId === "stratAxis");
    if (!chart || !instance) return null;
    const monte = chart.getIndicatorByPaneId("candle_pane", `AXIOM_${instance.instanceId}`) as { extendData?: { series?: Record<string, Array<number | undefined>> } } | null;
    const etat = monte?.extendData?.series?.etat;
    if (etat === undefined) return null;
    return { temps: chart.getDataList().map((b) => b.timestamp), etat: etat.map((v) => v ?? null) };
  });
}

/**
 * Trades d'un suiveur de l'état du graphe sur la plage, règles du preset (entrée état ≥ 1,
 * sortie état ≤ 0) : décision à la clôture, depuis la dernière bougie avant la plage, fill à
 * l'ouverture suivante ; position ouverte à la fin : sortie « fin-donnees » sur la dernière.
 */
function tradesDuGraphe(g: Graphe, depuis: number): Array<[number, number, string]> {
  const debut = g.temps.findIndex((t) => t >= depuis);
  const trades: Array<[number, number, string]> = [];
  let entree: number | null = null;
  for (let i = debut - 1; i < g.temps.length - 1; i++) {
    const v = g.etat[i];
    if (v === null || v === undefined) continue;
    if (entree === null) {
      if (v >= 1) entree = g.temps[i + 1]!;
    } else if (v <= 0) {
      trades.push([entree, g.temps[i + 1]!, "regle"]);
      entree = null;
    }
  }
  if (entree !== null) trades.push([entree, g.temps.at(-1)!, "fin-donnees"]);
  return trades;
}

/** Thème posé par son store (le graphe peut être sous la fenêtre BT). */
async function poserTheme(page: Page, theme: "dark" | "bloomberg"): Promise<void> {
  await page.evaluate(async (id) => {
    const importer = new Function("return import('/src/store/theme.ts')") as () => Promise<{ themeStore: { getState: () => { setTheme: (t: string) => void } } }>;
    (await importer()).themeStore.getState().setTheme(id);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Phase, erreur et avancement du run, lus dans le store du backtest. */
async function etatDuRun(page: Page): Promise<{ phase: string; error: string | null; progress: unknown }> {
  return page.evaluate(async () => {
    const importer = new Function("return import('/src/store/backtest.ts')") as () => Promise<{ backtestStore: { getState: () => {
      phase: string; error: string | null; progress: unknown } } }>;
    const s = (await importer()).backtestStore.getState();
    return { phase: s.phase, error: s.error, progress: s.progress };
  });
}

test("AXIS confluence sur 3 mois : les 4 cycles du graphe, la note de l'amorce lue en entier à 390 et 320 px", async ({ page }, testInfo) => {
  // Erreurs de la page et des workers, rapportées si le run n'aboutit pas.
  const erreursPage: string[] = [];
  page.on("pageerror", (e) => erreursPage.push(`page : ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") erreursPage.push(`console : ${m.text()}`); });
  page.on("worker", (w) => w.on("close", () => erreursPage.push(`worker fermé : ${w.url()}`)));
  await bouchonnerReseau(page);
  await preparerAxisSr(page, [{ defId: "stratAxis", params: {} }]);
  await page.goto("/");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0, { timeout: 30_000 });

  // AXIS sur le graphe : il remonte de lui-même à son amorce, 1 500 bougies. État lu AVANT le BT.
  await expect.poll(async () => (await lireGraphe(page))?.etat.length, { timeout: 60_000 }).toBe(1500);
  const graphe = (await lireGraphe(page))!;
  const attendus = tradesDuGraphe(graphe, HORLOGE_AXIS_SR - 90 * JOUR);
  expect(attendus).toHaveLength(4);

  // Fenêtre BT au toucher.
  await page.getByRole("navigation", { name: "Navigation du terminal" }).getByRole("button", { name: "Fonctions", exact: true }).tap();
  await page.getByRole("menuitem", { name: /^BT\b/ }).tap();
  const bt = page.getByRole("complementary", { name: "Backtest" });
  await bt.getByRole("button", { name: "AXIS confluence (4h)" }).tap();
  await bt.getByLabel("Plage historique").selectOption("3m");
  await bt.getByRole("button", { name: "Lancer le backtest" }).tap();
  // Le premier run charge le worker du backtest et tout son graphe de modules, servis un à un
  // par le serveur de développement : plus lent sous WebKit que sous Chromium (le 12 novembre,
  // « Terminé » n'était pas paru au bout de 30 s sous WebKit en CI). L'attente lit l'état du
  // store et, si elle échoue, dit la phase atteinte, l'erreur et les erreurs de la page.
  await expect.poll(async () => ({ ...(await etatDuRun(page)), erreursPage }), { timeout: 90_000, message: "run du backtest" })
    .toMatchObject({ phase: "done" });
  await expect(bt.getByText("Terminé", { exact: true })).toBeVisible();
  // Le compte lu à l'écran (sur le code d'avant : « 2 trades »).
  const resume = bt.getByText(/^BTCUSDT · 4h · 3 mois · \d+ trades?$/);
  await expect(resume).toBeVisible();
  await expect(resume).toHaveText("BTCUSDT · 4h · 3 mois · 4 trades");

  const run = await page.evaluate(async () => {
    const importer = new Function("return import('/src/store/backtest.ts')") as () => Promise<{ backtestStore: { getState: () => {
      resultat: { nbBougies: number; trades: Array<{ tempsEntree: number; tempsSortie: number; raison: string }> } | null } } }>;
    const resultat = (await importer()).backtestStore.getState().resultat;
    return { nbBougies: resultat?.nbBougies, trades: resultat?.trades.map((t) => [t.tempsEntree, t.tempsSortie, t.raison]) };
  });
  expect(run.trades, "trades du BT = ceux d'un suiveur de l'état d'AXIS du graphe").toEqual(attendus);
  expect(run.nbBougies).toBe(539);

  const note = bt.getByText(NOTE, { exact: true });
  await expect(note).toHaveCount(1);
  await expect(bt).toContainText("Simulation sur des données passées : une mesure, pas une promesse.");

  for (const ecran of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(ecran);
    for (const theme of ["dark", "bloomberg"] as const) {
      await poserTheme(page, theme);
      // La fenêtre suit la nouvelle largeur à son rythme : la lecture est reprise jusqu'à ce
      // qu'elle tienne (défilement compris), dans les 5 s par défaut.
      await expect.poll(() => luEnEntier(note), { message: `note à ${ecran.width} px, thème ${theme}` })
        .toMatchObject({ dansEcran: true, sansCoupe: true, decouvert: true });
      // WebKit rend 0,9999 pour une boîte de largeur non entière : les bords sont mesurés ci-dessus.
      await expect(note).toBeInViewport({ ratio: 0.999 });
      const { lignes } = await luEnEntier(note);
      testInfo.annotations.push({ type: "note du run", description: `${ecran.width} × ${ecran.height}, ${theme} : ${lignes} ligne${lignes > 1 ? "s" : ""}, entière dans l'écran` });
      if (ecran.width === 320) {
        await page.screenshot({ path: testInfo.outputPath(`note-amorce-320x568-${theme}.png`), animations: "disabled" });
      }
    }
  }
});
